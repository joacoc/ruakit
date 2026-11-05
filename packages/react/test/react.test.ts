// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionResult } from "@ruakit/schema";
import type * as Agent from "@ruakit/agent";
import { Rua } from "../dist/index.js";
import type { RuaProps } from "../dist/index.js";
import { createRuntime } from "@ruakit/agent";
import type { RuaKitRuntime } from "@ruakit/agent";
import { ClarificationNeededError } from "@ruakit/agent";

vi.mock("@ruakit/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof Agent>()),
  createRuntime: vi.fn(),
}));

const roots: Root[] = [];
const success: ExecutionResult = {
  planId: "toolbar-plan",
  status: "triggered",
  events: ["Action triggered"],
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(async () => {
  await act(async () => {
    roots.splice(0).forEach((root) => root.unmount());
  });
  document.body.replaceChildren();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function query<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing toolbar element: ${selector}`);
  }
  return element;
}

function requestBox(): HTMLTextAreaElement {
  return query('[aria-label="Rua request"]');
}

async function mount(props: Partial<RuaProps> = {}) {
  let resolve!: (result: ExecutionResult) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<ExecutionResult>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  const request = vi.fn<RuaKitRuntime["request"]>((_prompt, options) => {
    options?.signal?.addEventListener(
      "abort",
      () => reject(new Error("Aborted")),
      { once: true },
    );
    return pending;
  });
  vi.mocked(createRuntime).mockReturnValue({ request });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(createElement(Rua, { serverUrl: "/planner", ...props }));
  });
  return { request, resolve, reject, root };
}

async function open(): Promise<void> {
  await act(async () => {
    query<HTMLButtonElement>('[aria-label="Open Rua"]').click();
  });
}

async function type(prompt: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  if (!setter) {
    throw new Error("Missing textarea value setter.");
  }
  await act(async () => {
    setter.call(requestBox(), prompt);
    requestBox().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function send(): Promise<void> {
  await act(async () => {
    requestBox().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
}

describe("React toolbar focus and command lifecycle", () => {
  it("calculates readable travel time from the displayed position", async () => {
    const target = document.body.appendChild(document.createElement("button"));
    target.getBoundingClientRect = () => new DOMRect(100, 100, 80, 30);
    const test = await mount();
    await open();
    await type("Save");
    await send();
    const settings = vi.mocked(createRuntime).mock.calls.at(-1)?.[0];
    const delay = settings?.actionDelayMs;
    if (typeof delay !== "function")
      throw new Error("Expected automatic cursor timing");
    expect(delay(target)).toBeGreaterThan(400);
    await act(async () =>
      settings?.onAction?.({
        id: 1,
        action: "click",
        phase: "before",
        element: target,
        rect: target.getBoundingClientRect(),
        durationMs: 0,
      }),
    );
    expect(delay(target)).toBe(0);
    const next = document.body.appendChild(document.createElement("button"));
    next.getBoundingClientRect = () => new DOMRect(200, 100, 80, 30);
    const nearby = delay(next);
    next.getBoundingClientRect = () => new DOMRect(2100, 100, 80, 30);
    const far = delay(next);
    expect(nearby).toBeLessThan(200);
    expect(far).toBeGreaterThan(1600);
    expect(far).toBeLessThan(1800);
    await act(async () => test.resolve(success));
  });

  it("keeps a short action delay from accelerating cursor travel", async () => {
    const test = await mount({ actionDelayMs: 120 });
    await open();
    await type("Save");
    await send();
    const delay = vi
      .mocked(createRuntime)
      .mock.calls.at(-1)?.[0]?.actionDelayMs;
    if (typeof delay !== "function")
      throw new Error("Expected cursor travel timing");
    const target = document.body.appendChild(document.createElement("button"));
    target.getBoundingClientRect = () => new DOMRect(100, 100, 80, 30);
    expect(delay(target)).toBeGreaterThan(600);
    await act(async () => test.resolve(success));
  });

  it("changes message appearance without restarting a request or forwarding it to the runtime", async () => {
    const test = await mount({ messageStyle: "glass" });
    await open();
    await type("Open billing");
    await send();
    const input = requestBox();
    expect(
      query("[data-ruakit-toolbar]").getAttribute("data-message-style"),
    ).toBe("glass");
    expect(vi.mocked(createRuntime).mock.calls.at(-1)?.[0]).not.toHaveProperty(
      "messageStyle",
    );
    await act(async () => {
      test.root.render(
        createElement(Rua, { serverUrl: "/planner", messageStyle: "normal" }),
      );
    });
    expect(
      query("[data-ruakit-toolbar]").getAttribute("data-message-style"),
    ).toBe("normal");
    expect(requestBox()).toBe(input);
    expect(input.readOnly).toBe(true);
    expect(test.request).toHaveBeenCalledTimes(1);
    await act(async () =>
      test.reject(new Error("Something went wrong. Try again.")),
    );
    expect(query('[role="status"]').textContent).toBe(
      "Something went wrong. Try again.",
    );
    expect(query('[role="status"]').getAttribute("aria-live")).toBe("polite");
    expect(input.value).toBe("Open billing");
    expect(document.activeElement).toBe(input);
  });

  it("updates cursor labels during an action without forwarding presentation options to the runtime", async () => {
    const target = document.createElement("button");
    target.textContent = "Save";
    target.getBoundingClientRect = () => new DOMRect(100, 100, 120, 40);
    document.body.append(target);
    const test = await mount({
      cursorLabel: "Helper",
      cursorEdgeGlow: false,
      scrollToTarget: true,
    });
    await open();
    await type("Save the profile");
    await send();
    const settings = vi.mocked(createRuntime).mock.calls.at(-1)?.[0];
    expect(settings).not.toHaveProperty("cursorLabel");
    expect(settings).not.toHaveProperty("cursorMovement");
    expect(settings).not.toHaveProperty("cursorEdgeGlow");
    expect(settings?.scrollToTarget).toBe(true);
    await act(async () => {
      settings?.onAction?.({
        id: 1,
        action: "click",
        phase: "before",
        element: target,
        rect: target.getBoundingClientRect(),
        durationMs: 0,
      });
    });
    const overlay = query("[data-ruakit-cursor]");
    expect(query(".ruakit-cursor-label").textContent).toBe("Helper");
    expect(document.querySelector(".ruakit-cursor-edge")).toBeNull();
    for (const props of [{}, { cursorLabel: undefined }, { cursorLabel: "" }]) {
      await act(async () => {
        test.root.render(
          createElement(Rua, { serverUrl: "/planner", ...props }),
        );
      });
      expect(document.querySelector(".ruakit-cursor-label")).toBeNull();
      expect(query("[data-ruakit-cursor]")).toBe(overlay);
      expect(document.querySelectorAll(".ruakit-cursor-edge")).toHaveLength(4);
      await act(async () => {
        test.root.render(
          createElement(Rua, { serverUrl: "/planner", cursorLabel: "Helper" }),
        );
      });
      expect(query(".ruakit-cursor-label").textContent).toBe("Helper");
    }
    expect(test.request).toHaveBeenCalledTimes(1);
    await act(async () => test.resolve(success));
    expect(document.querySelector("[data-ruakit-cursor]")).toBeNull();
  });

  it("matches target corners and follows radius changes without a new action", async () => {
    const target = document.createElement("button");
    target.style.borderRadius = "16px 12px 8px 4px";
    target.getBoundingClientRect = () => new DOMRect(100, 100, 120, 40);
    document.body.append(target);
    let frame: FrameRequestCallback | undefined;
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frame = callback;
        return 1;
      });
    const cancelFrame = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {});
    const test = await mount();
    try {
      await open();
      await type("Save");
      await send();
      const settings = vi.mocked(createRuntime).mock.calls.at(-1)?.[0];
      await act(async () => {
        settings?.onAction?.({
          id: 1,
          action: "click",
          phase: "before",
          element: target,
          rect: target.getBoundingClientRect(),
          durationMs: 0,
        });
      });
      expect(
        query<HTMLElement>(".ruakit-cursor-highlight").style.borderRadius,
      ).toBe("16px 12px 8px 4px");
      target.style.borderRadius = "24px";
      await act(async () => frame?.(0));
      expect(
        query<HTMLElement>(".ruakit-cursor-highlight").style.borderRadius,
      ).toBe("24px");
      await act(async () => test.resolve(success));
    } finally {
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
    }
  });

  it("retains the session cursor after completion and removes it when visualCursor is disabled", async () => {
    const target = document.body.appendChild(document.createElement("button"));
    target.getBoundingClientRect = () => new DOMRect(100, 100, 120, 40);
    const test = await mount({ cursorVisibility: "session" });
    await open();
    await type("Save");
    await send();
    const settings = vi.mocked(createRuntime).mock.calls.at(-1)?.[0];
    expect(settings).not.toHaveProperty("cursorVisibility");
    await act(async () =>
      settings?.onAction?.({
        id: 1,
        action: "click",
        phase: "before",
        element: target,
        rect: target.getBoundingClientRect(),
        durationMs: 0,
      }),
    );
    const pointer = query(".ruakit-cursor-pointer");
    await act(async () => test.resolve(success));
    expect(query(".ruakit-cursor-pointer")).toBe(pointer);
    expect(document.querySelector(".ruakit-cursor-highlight")).toBeNull();
    await act(async () =>
      test.root.render(
        createElement(Rua, {
          serverUrl: "/planner",
          cursorVisibility: "session",
          visualCursor: false,
        }),
      ),
    );
    expect(document.querySelector("[data-ruakit-cursor]")).toBeNull();
    await act(async () =>
      test.root.render(
        createElement(Rua, {
          serverUrl: "/planner",
          cursorVisibility: "session",
        }),
      ),
    );
    expect(document.querySelector("[data-ruakit-cursor]")).toBeNull();
  });

  it.each(["option", "text"])(
    "answers a clarification using %s while retaining the original request",
    async (mode) => {
      const test = await mount();
      await open();
      await type("Open billing");
      await send();
      await act(async () =>
        test.reject(
          new ClarificationNeededError({
            type: "clarification",
            question: "Which billing page?",
            options: ["Personal billing", "Workspace billing"],
          }),
        ),
      );
      expect(query(".ruakit-question").textContent).toBe("Which billing page?");
      expect(query(".ruakit-original").textContent).toContain("Open billing");
      expect(requestBox().value).toBe("");
      expect(requestBox().readOnly).toBe(false);
      expect(document.activeElement).toBe(requestBox());
      test.request.mockResolvedValueOnce(success);
      if (mode === "option") {
        await act(async () =>
          query<HTMLButtonElement>(".ruakit-option").click(),
        );
      } else {
        await type("Personal billing");
        await send();
      }
      expect(test.request).toHaveBeenLastCalledWith(
        "Open billing",
        expect.objectContaining({
          clarifications: [
            { question: "Which billing page?", answer: "Personal billing" },
          ],
        }),
      );
      expect(document.querySelector(".ruakit-clarification")).toBeNull();
      expect(requestBox().value).toBe("");
    },
  );

  it("can leave a clarification and start a separate request", async () => {
    const test = await mount();
    await open();
    await type("Open billing");
    await send();
    await act(async () =>
      test.reject(
        new ClarificationNeededError({
          type: "clarification",
          question: "Which page?",
          options: [],
        }),
      ),
    );
    await act(async () =>
      query<HTMLButtonElement>(".ruakit-start-over").click(),
    );
    test.request.mockResolvedValueOnce(success);
    await type("Open reports");
    await send();
    expect(test.request).toHaveBeenLastCalledWith(
      "Open reports",
      expect.not.objectContaining({ clarifications: expect.anything() }),
    );
  });

  it("renders the collapsed toolbar on the server without constructing a browser runtime", () => {
    const html = renderToString(createElement(Rua));
    expect(html).toContain("data-ruakit-toolbar");
    expect(html).toContain("Open Rua");
    expect(html).toContain("ruakit-panel");
    expect(createRuntime).not.toHaveBeenCalled();
  });

  it("keeps the box focusable while running and clears it after successful execution", async () => {
    const test = await mount();
    await open();
    await type("Open billing");
    const input = requestBox();
    await send();
    expect(test.request).toHaveBeenCalledWith(
      "Open billing",
      expect.any(Object),
    );
    expect(input.disabled).toBe(false);
    expect(input.readOnly).toBe(true);
    expect(document.activeElement).toBe(input);

    // Application field edits may temporarily need focus. Completion must restore it.
    const applicationField = document.createElement("input");
    document.body.append(applicationField);
    await act(async () => applicationField.focus());
    expect(document.activeElement).toBe(applicationField);
    await act(async () => test.resolve(success));
    expect(requestBox()).toBe(input);
    expect(input.value).toBe("");
    expect(input.readOnly).toBe(false);
    expect(document.activeElement).toBe(input);
  });

  it("retains a failed command and restores focus for correction", async () => {
    const test = await mount();
    await open();
    await type("Unsupported request");
    await send();
    await act(async () => test.reject(new Error("Action unavailable")));
    expect(requestBox().value).toBe("Unsupported request");
    expect(requestBox().readOnly).toBe(false);
    expect(document.activeElement).toBe(requestBox());
    expect(query('[role="status"]').textContent).toBe("Action unavailable");
  });

  it("retains a cancelled command and leaves the box focused", async () => {
    await mount();
    await open();
    await type("Download an invoice");
    await send();
    await act(async () => {
      query<HTMLButtonElement>('[aria-label="Cancel request"]').click();
    });
    expect(requestBox().value).toBe("Download an invoice");
    expect(requestBox().readOnly).toBe(false);
    expect(document.activeElement).toBe(requestBox());
    expect(query('[role="status"]').textContent).toBe("Request cancelled");
  });

  it("carries a click during hover expansion into the request box", async () => {
    await mount();
    const notch = query<HTMLButtonElement>('[aria-label="Open Rua"]');
    const panel = notch.parentElement!;
    await act(async () => {
      notch.dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
    });
    expect(document.activeElement).toBe(document.body);
    await act(async () => {
      panel.dispatchEvent(
        new MouseEvent("pointerdown", {
          button: 0,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    const input = requestBox();
    expect(document.activeElement).toBe(input);
    await act(async () => {
      input.dispatchEvent(
        new MouseEvent("mouseout", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
    });
    expect(requestBox()).toBe(input);
    expect(document.activeElement).toBe(input);
  });

  it("moves keyboard focus from the notch into the request box", async () => {
    await mount();
    await act(async () => {
      query<HTMLButtonElement>('[aria-label="Open Rua"]').focus();
    });
    expect(document.activeElement).toBe(requestBox());
  });
});
