// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT

/** A reference returned by getState. Keep both fields when passing it across a boundary. */
export interface Target {
  id: string;
  version: number;
}

/** A named enclosing form, fieldset, section, ARIA group or dialog. Outer groups come first. */
export interface ControlGroup {
  role: 'form' | 'group' | 'radiogroup' | 'region' | 'dialog' | 'alertdialog';
  name: string;
}

export interface ControlState {
  target: Target;
  tag: string;
  type?: string;
  role: string;
  /** Computed accessible name. Empty when the control has no accessible name. */
  label: string;
  description?: string;
  /** A field hint, reported separately from the accessible name. */
  placeholder?: string;
  /** Up to four nearest named groups, ordered from outermost to innermost. */
  groups?: ControlGroup[];
  /** A group name or enclosing group was omitted because of observation limits. */
  groupsTruncated?: boolean;
  context: string;
  enabled: boolean;
  readOnly: boolean;
  value?: string;
  checked?: boolean;
  expanded?: boolean;
  selectedValues?: string[];
  options?: { value: string; label: string; enabled: boolean }[];
  valid?: boolean;
  contentEditable?: boolean;
}

export interface PageState {
  url: string;
  title: string;
  text: string;
  controls: ControlState[];
  focused: Target | null;
  /** Text or controls were omitted because the observation limit was reached. */
  truncated: boolean;
}

/** An uncancelled native link activation, not proof that its destination loaded. */
export interface LinkNavigation {
  url: string;
  target: '_blank';
}

/** Navigation feedback belongs to this click only, never to later observations. */
export interface ClickResult extends PageState {
  navigation?: LinkNavigation;
}

export interface ActionOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface KeyOptions extends ActionOptions {
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export type RuntimeAction =
  'click' | 'focus' | 'blur' | 'fill' | 'select' | 'check' | 'insertText' | 'key' | 'scroll';

export interface ActionRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Local UI feedback only. DOM references never enter planner requests or receipts. */
export interface RuntimeActionEvent {
  readonly id: number;
  readonly action: RuntimeAction;
  readonly phase: 'before' | 'after' | 'cancelled' | 'failed';
  readonly element: HTMLElement;
  readonly rect: ActionRect;
  readonly durationMs: number;
}

export interface ActionFeedbackOptions {
  /** Observational callback. Exceptions are ignored; targets are revalidated before execution. */
  onAction?: (event: RuntimeActionEvent) => void;
  /** Movement allowance in ms, or a resolver called after scrolling. Integer 0–10000; defaults to 0. */
  actionDelayMs?: number | ((element: HTMLElement) => number);
  /** Scroll feedback targets into view before cursor movement. Defaults to false. */
  scrollToTarget?: boolean;
}

export interface RuntimeOptions extends ActionFeedbackOptions {
  /** Defaults to the current document. Use an app container to limit observation and actions. */
  root?: Document | HTMLElement;
  /** Connect your router here. Resolve once navigation has committed. */
  navigate?: (path: string, signal: AbortSignal) => void | Promise<void>;
  /** Default operation deadline, in milliseconds. Defaults to 2000. */
  timeoutMs?: number;
}

export interface ScreenshotImage {
  /** Raw base64 image bytes, without a data URL prefix. Maximum decoded size: 5 MiB. */
  data: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
}
export interface Screenshot extends ScreenshotImage {
  capturedAt: number;
  url: string;
}

/** Each action returns a fresh observation. It does not establish that a larger task succeeded. */
export interface Runtime {
  getState(): PageState;
  /** Render the configured root to PNG on demand using html-to-image. Private UI is excluded. */
  screenshot(options?: ActionOptions): Promise<Screenshot>;
  click(target: Target, options?: ActionOptions): Promise<ClickResult>;
  focus(target: Target, options?: ActionOptions): Promise<PageState>;
  blur(target: Target, options?: ActionOptions): Promise<PageState>;
  /** Insert text at the current selection using the browser editing command. */
  insertText(target: Target, text: string, options?: ActionOptions): Promise<PageState>;
  setValue(target: Target, value: string, options?: ActionOptions): Promise<PageState>;
  selectOption(
    target: Target,
    values: readonly string[],
    options?: ActionOptions,
  ): Promise<PageState>;
  setChecked(target: Target, checked: boolean, options?: ActionOptions): Promise<PageState>;
  /** Dispatch keydown/keyup to a control. Browser shortcuts and text insertion are not simulated. */
  pressKey(target: Target, key: string, options?: KeyOptions): Promise<PageState>;
  scrollIntoView(target: Target, options?: ActionOptions): Promise<PageState>;
  goto(path: string, options?: ActionOptions): Promise<PageState>;
  waitFor(condition: (state: PageState) => boolean, options?: ActionOptions): Promise<PageState>;
}
