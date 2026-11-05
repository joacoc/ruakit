// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import {
  activeElement,
  configuration,
  contains,
  isField,
  isVisible,
  observeControl,
} from "./dom.js";
import type { NativeField } from "./dom.js";
import { RuntimeError } from "./errors.js";
import { pause, validateTimeout, withDeadline } from "./operations.js";
import { Targets } from "./targets.js";
import { withActionFeedback } from "./action-feedback.js";
import { captureScreenshot } from "./screenshot.js";
import type {
  ActionOptions,
  PageState,
  Runtime,
  RuntimeAction,
  RuntimeOptions,
  Target,
} from "./types.js";

type Verification = () => void;
interface Edit {
  apply(signal: AbortSignal): void;
  accepted(): boolean;
}

interface FieldSnapshot {
  configuration: string;
  form: HTMLFormElement | null;
  parent: HTMLElement | null;
}

const textTypes = new Set([
  "text",
  "search",
  "email",
  "tel",
  "url",
  "number",
  "date",
  "datetime-local",
  "time",
  "month",
  "week",
  "color",
  "range",
]);

function assignValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const view = element.ownerDocument.defaultView!;
  const prototype =
    element.tagName === "TEXTAREA"
      ? view.HTMLTextAreaElement.prototype
      : view.HTMLInputElement.prototype;
  // Bypass React's value tracker so its input handler receives the new value.
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
    element,
    value,
  );
}

/** Create this after mounting. Importing the package itself is safe during server rendering. */
export function createRuntime(options: RuntimeOptions = {}): Runtime {
  const root = options.root === undefined ? globalThis.document : options.root;
  if (!root) {
    throw new TypeError(
      "Create the runtime in a browser, after the app has mounted.",
    );
  }

  const targets = new Targets(root);
  const document = targets.document;
  const view = document.defaultView!;
  const timeoutMs = options.timeoutMs ?? 2000;

  validateTimeout(timeoutMs);
  let busy = false;

  async function run<T>(
    settings: ActionOptions,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (busy) {
      throw new RuntimeError(
        "BUSY",
        "Another operation is running. Await it before starting the next one.",
      );
    }

    busy = true;
    try {
      return await withDeadline(
        settings.timeoutMs ?? timeoutMs,
        settings.signal,
        operation,
      );
    } finally {
      busy = false;
    }
  }

  function act(
    settings: ActionOptions,
    effect: (
      signal: AbortSignal,
    ) => void | Verification | Promise<void | Verification>,
    feedback?: {
      action: RuntimeAction;
      target: Target;
      requireEnabled?: boolean;
    },
  ): Promise<PageState> {
    return run(settings, async (signal) => {
      const execute = async (): Promise<PageState> => {
        const verify = await effect(signal);

        // Give controlled inputs and ordinary React event updates a turn to commit.
        await pause(signal);
        signal.throwIfAborted();
        verify?.();

        return targets.getState();
      };

      return feedback
        ? withActionFeedback(
            options,
            feedback.action,
            () => targets.resolve(feedback.target, feedback.requireEnabled),
            signal,
            execute,
          )
        : execute();
    });
  }

  function focusTarget(target: Target, signal: AbortSignal): HTMLElement {
    const element = targets.resolve(target);
    element.focus({ preventScroll: true });
    signal.throwIfAborted();
    targets.resolve(target);
    return element;
  }

  function verifyEdit(
    field: NativeField,
    before: FieldSnapshot,
    change: Edit,
  ): void {
    // A field replaced or reconfigured during the edit is no longer the same target.
    const fieldChanged =
      !contains(root, field) ||
      !isVisible(field) ||
      !observeControl(field, root).enabled ||
      configuration(field) !== before.configuration ||
      field.form !== before.form ||
      field.parentElement !== before.parent;

    if (fieldChanged || !change.accepted()) {
      throw new RuntimeError(
        "VALUE_REJECTED",
        "The application did not accept the requested field value.",
      );
    }
  }

  function edit(
    action: "fill" | "select" | "check",
    target: Target,
    settings: ActionOptions,
    prepare: (field: NativeField) => Edit,
  ): Promise<PageState> {
    return act(
      settings,
      (signal) => {
        const element = targets.resolve(target);
        if (!isField(element)) {
          throw new RuntimeError(
            "UNSUPPORTED",
            "This operation needs a native input, textarea or select.",
          );
        }

        if (observeControl(element, root).readOnly) {
          throw new RuntimeError("READ_ONLY", "The field is read-only.");
        }

        const change = prepare(element);
        focusTarget(target, signal);

        const before: FieldSnapshot = {
          configuration: configuration(element),
          form: element.form,
          parent: element.parentElement,
        };

        change.apply(signal);

        // Check the result after the application has processed the field events.
        return () => verifyEdit(element, before, change);
      },
      { action, target },
    );
  }

  function fieldEvents(element: NativeField, signal: AbortSignal): void {
    element.dispatchEvent(new view.Event("input", { bubbles: true }));
    signal.throwIfAborted();
    element.dispatchEvent(new view.Event("change", { bubbles: true }));
  }

  return {
    getState: () => targets.getState(),
    screenshot(settings = {}) {
      return run(settings, (signal) => captureScreenshot(root, signal));
    },

    click(target, settings = {}) {
      return act(settings, () => targets.resolve(target).click(), {
        action: "click",
        target,
      });
    },

    focus(target, settings = {}) {
      return act(
        settings,
        (signal) => {
          const element = focusTarget(target, signal);
          return () => {
            if (activeElement(document) !== element) {
              throw new RuntimeError(
                "UNSUPPORTED",
                "The control did not receive focus.",
              );
            }
          };
        },
        { action: "focus", target },
      );
    },

    blur(target, settings = {}) {
      return act(settings, () => targets.resolve(target).blur(), {
        action: "blur",
        target,
      });
    },

    setValue(target, value, settings = {}) {
      return edit("fill", target, settings, (field) => {
        if (
          field.tagName === "SELECT" ||
          (field.tagName === "INPUT" &&
            !textTypes.has((field as HTMLInputElement).type))
        ) {
          throw new RuntimeError(
            "UNSUPPORTED",
            "Use setValue with a text or value input or a textarea.",
          );
        }

        const element = field as HTMLInputElement | HTMLTextAreaElement;
        const clone = element.cloneNode(true) as typeof element;

        // Check the browser's normalization before changing the real field.
        assignValue(clone, value);
        if (
          clone.value !== value ||
          (element.maxLength >= 0 && value.length > element.maxLength)
        ) {
          throw new RuntimeError(
            "VALUE_REJECTED",
            "The requested value does not fit this field.",
          );
        }

        return {
          apply(signal) {
            assignValue(element, value);
            fieldEvents(element, signal);
          },
          accepted: () => element.value === value,
        };
      });
    },

    selectOption(target, values, settings = {}) {
      return edit("select", target, settings, (field) => {
        if (field.tagName !== "SELECT") {
          throw new RuntimeError(
            "UNSUPPORTED",
            "Use selectOption with a native select.",
          );
        }

        const select = field as HTMLSelectElement;
        const options = [...select.options];

        if (
          new Set(values).size !== values.length ||
          (!select.multiple && values.length > 1) ||
          values.some(
            (value) => !options.some((option) => option.value === value),
          ) ||
          options.some(
            (option) =>
              values.includes(option.value) &&
              (option.disabled || option.closest("optgroup[disabled]")),
          )
        ) {
          throw new RuntimeError(
            "UNSUPPORTED",
            "Choose available option values from getState().",
          );
        }

        return {
          apply(signal) {
            select.selectedIndex = -1;
            for (const option of options) {
              option.selected = values.includes(option.value);
            }

            fieldEvents(select, signal);
          },
          accepted: () =>
            select.selectedOptions.length === values.length &&
            [...select.selectedOptions].every((option) =>
              values.includes(option.value),
            ),
        };
      });
    },

    setChecked(target, checked, settings = {}) {
      return edit("check", target, settings, (field) => {
        const input = field as HTMLInputElement;
        if (
          field.tagName !== "INPUT" ||
          !["checkbox", "radio"].includes(input.type)
        ) {
          throw new RuntimeError(
            "UNSUPPORTED",
            "Use setChecked with a native checkbox or radio.",
          );
        }

        if (input.type === "radio" && input.checked && !checked) {
          throw new RuntimeError(
            "UNSUPPORTED",
            "Select another radio in the group to change its value.",
          );
        }

        return {
          apply() {
            if (input.checked !== checked) {
              input.click();
            }
          },
          accepted: () => input.checked === checked,
        };
      });
    },

    insertText(target, text, settings = {}) {
      return act(
        settings,
        (signal) => {
          const element = targets.resolve(target);
          const data = observeControl(element, root);

          if (data.readOnly) {
            throw new RuntimeError("READ_ONLY", "The editor is read-only.");
          }

          if (!data.contentEditable && !element.matches("input, textarea")) {
            throw new RuntimeError(
              "UNSUPPORTED",
              "Insert text requires a text field or contenteditable surface.",
            );
          }

          focusTarget(target, signal);
          signal.throwIfAborted();

          // Rich editors own their document and intercept beforeinput. Let them
          // handle insertion before falling back to the browser editing command.
          const input = new view.InputEvent("beforeinput", {
            inputType: "insertText",
            data: text,
            bubbles: true,
            cancelable: true,
            composed: true,
          });

          if (!element.dispatchEvent(input)) {
            signal.throwIfAborted();
            return () => {
              if (text && observeControl(element, root).value === data.value) {
                throw new RuntimeError(
                  "VALUE_REJECTED",
                  "The editor did not accept text insertion.",
                );
              }
            };
          }

          signal.throwIfAborted();
          targets.resolve(target);

          if (typeof document.execCommand !== "function") {
            throw new RuntimeError(
              "UNSUPPORTED",
              "This browser does not support the text insertion command.",
            );
          }

          if (!document.execCommand("insertText", false, text)) {
            throw new RuntimeError(
              "VALUE_REJECTED",
              "The browser or editor rejected text insertion.",
            );
          }
        },
        { action: "insertText", target },
      );
    },

    pressKey(target, key, settings = {}) {
      return act(
        settings,
        (signal) => {
          if (!key) {
            throw new TypeError(
              "Provide a keyboard key, such as Enter or Escape.",
            );
          }

          const element = focusTarget(target, signal);
          const event = {
            key,
            bubbles: true,
            cancelable: true,
            altKey: settings.altKey ?? false,
            ctrlKey: settings.ctrlKey ?? false,
            metaKey: settings.metaKey ?? false,
            shiftKey: settings.shiftKey ?? false,
          };

          element.dispatchEvent(new view.KeyboardEvent("keydown", event));
          signal.throwIfAborted();
          if (element.isConnected) {
            element.dispatchEvent(new view.KeyboardEvent("keyup", event));
          }
        },
        { action: "key", target },
      );
    },

    scrollIntoView(target, settings = {}) {
      return act(
        settings,
        () => {
          const element = targets.resolve(target, false);
          if (typeof element.scrollIntoView !== "function") {
            throw new RuntimeError(
              "UNSUPPORTED",
              "This environment does not support scrollIntoView.",
            );
          }

          element.scrollIntoView({
            block: "nearest",
            inline: "nearest",
            behavior: "instant",
          });
        },
        { action: "scroll", target, requireEnabled: false },
      );
    },

    goto(path, settings = {}) {
      return act(settings, async (signal) => {
        const navigate = options.navigate;
        if (!navigate) {
          throw new RuntimeError(
            "UNSUPPORTED",
            "Pass your router navigation callback to createRuntime.",
          );
        }

        const url = new URL(path, document.URL);
        if (
          url.origin !== document.location.origin ||
          !["http:", "https:"].includes(url.protocol)
        ) {
          throw new RuntimeError(
            "UNSUPPORTED",
            "Navigation must stay within this application origin.",
          );
        }

        await navigate(url.pathname + url.search + url.hash, signal);
        signal.throwIfAborted();

        return () => {
          if (document.URL !== url.href) {
            throw new RuntimeError(
              "VALUE_REJECTED",
              "The router did not reach the requested URL.",
            );
          }
        };
      });
    },

    waitFor(condition, settings = {}) {
      return run(settings, async (signal) => {
        while (true) {
          signal.throwIfAborted();
          const state = targets.getState();

          if (condition(state)) {
            return state;
          }

          await pause(signal, 50);
        }
      });
    },
  };
}
