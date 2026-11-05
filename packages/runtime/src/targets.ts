// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import {
  configuration,
  activeElement,
  contains,
  controls,
  isField,
  isVisible,
  observeControl,
  visibleText,
} from './dom.js';
import type { ControlData } from './dom.js';
import { RuntimeError } from './errors.js';
import type { PageState, Target } from './types.js';

interface Binding {
  element: HTMLElement;
  target: Target;
  data: ControlData;
  configuration: string;
  parent: Element | null;
  form: HTMLFormElement | null;
  url: string;
}

let nextRuntime = 0;

export class Targets {
  readonly document: Document;
  private readonly prefix = `runtime-${++nextRuntime}`;
  private readonly ids = new WeakMap<HTMLElement, string>();
  private bindings = new Map<string, Binding>();
  private sequence = 0;
  private version = 0;

  constructor(readonly root: Document | HTMLElement) {
    this.document = root.ownerDocument ?? (root as Document);
    if (!this.document.defaultView) {
      throw new TypeError('Create the runtime in a browser, after the app has mounted.');
    }
  }

  getState(): PageState {
    const next = new Map<string, Binding>();
    let truncated = false;

    for (const element of controls(this.root)) {
      if (
        !isVisible(element) ||
        element.matches('input[type="hidden"], input[type="password"], input[type="file"]')
      ) {
        continue;
      }

      if (next.size === 200) {
        truncated = true;
        break;
      }

      let id = this.ids.get(element);
      if (!id) {
        id = `${this.prefix}:${++this.sequence}`;
        this.ids.set(element, id);
      }

      const data = observeControl(element, this.root);
      const previous = this.bindings.get(id);
      const unchanged = previous && this.matches(previous, data);

      next.set(id, {
        element,
        target: { id, version: unchanged ? previous.target.version : ++this.version },
        data,
        configuration: configuration(element),
        parent: element.parentElement,
        form: isField(element) ? element.form : null,
        url: this.document.URL,
      });
    }

    this.bindings = next;
    const text = visibleText(this.root, 20001);
    const focused = [...next.values()].find(
      ({ element }) => element === activeElement(this.document),
    )?.target;

    return {
      url: this.document.URL,
      title: this.document.title,
      text: text.slice(0, 20000),
      controls: [...next.values()].map(({ target, data }) => ({
        target: { ...target },
        ...structuredClone(data),
      })),
      focused: focused ? { ...focused } : null,
      truncated:
        truncated ||
        text.length > 20000 ||
        [...next.values()].some(
          ({ data }) =>
            data.context.length === 1000 ||
            data.label.length === 1000 ||
            data.description?.length === 1000 ||
            data.placeholder?.length === 1000 ||
            data.groupsTruncated === true,
        ),
    };
  }

  resolve(target: Target, requireEnabled = true): HTMLElement {
    const binding = this.bindings.get(target.id);
    if (
      !binding ||
      binding.target.version !== target.version ||
      !contains(this.root, binding.element) ||
      !isVisible(binding.element) ||
      !this.matches(binding, observeControl(binding.element, this.root))
    ) {
      throw new RuntimeError(
        'STALE_TARGET',
        'The control changed. Call getState() and choose it again.',
      );
    }

    if (requireEnabled && !binding.data.enabled) {
      throw new RuntimeError('DISABLED', 'The control is disabled.');
    }

    return binding.element;
  }

  private matches(binding: Binding, data: ControlData): boolean {
    return (
      binding.url === this.document.URL &&
      binding.parent === binding.element.parentElement &&
      binding.form === (isField(binding.element) ? binding.element.form : null) &&
      binding.configuration === configuration(binding.element) &&
      JSON.stringify(binding.data) === JSON.stringify(data)
    );
  }
}
