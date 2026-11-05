# @ruakit/runtime

[Documentation index](README.md) - [RuaKit](../README.md)

Read the page and interact with its controls from inside your application.
`@ruakit/runtime` runs in the browser and works with native controls, controlled
React inputs, and editable text. Use [`@ruakit/agent`](agent.md) to add a planner
and manage a complete user request.

## Start with the page

Create a runtime after your app mounts. Pass your app container as `root` to keep
observations and actions inside it. The default root is the current document.

```ts
import { createRuntime } from "@ruakit/runtime";

const runtime = createRuntime({
  root: document.querySelector<HTMLElement>("#app")!,
});
const state = runtime.getState();
const name = state.controls.find((control) => control.label === "Name");

if (name) {
  const updated = await runtime.setValue(name.target, "Ana");
  console.log(
    updated.controls.find((control) => control.label === "Name")?.value,
  );
}
```

Each action returns a fresh page observation. Use that result to choose the next
control. The runtime sees the rendered page, so it cannot discover controls or
routes on pages you haven't opened.

## Observe, then act

`getState()` returns the URL, title, text, controls, focused target, and
`truncated` flag. Native fields also expose values, validity, checked state,
and options.

### Targets

Each control has a target: `{ id, version }`. Pass the whole target to an action.
References belong to the runtime that created them and become stale when a
control changes or disappears. Read the page again before choosing a replacement.

### Labels and groups

`label` is the control's computed accessible name. It can be empty. Descriptions
and placeholders are separate hints, and nearby row or list-item text appears in
`context`. Accessible names and descriptions use `dom-accessibility-api`.

Use `groups` to distinguish fields with the same label. Groups describe named
forms, fieldsets, sections, ARIA groups, and dialogs. For example:

```json
{
  "label": "Service",
  "role": "combobox",
  "groups": [{ "role": "form", "name": "Log search filters" }]
}
```

Names come from accessible names, legends, or direct headings. Groups stay
inside the root, exclude field values, and retain the four nearest names from
outermost to innermost. Group changes invalidate the target.

### Limits and exclusions

| Observation | Limit |
| --- | --- |
| Controls | 200 |
| Page text | 20,000 characters |
| Each label, description, placeholder, or nearby context | 1,000 characters |
| Each group name | 200 characters |

`truncated` marks omitted or shortened content. `groupsTruncated` marks omitted
group metadata. The core runtime returns field values in full; planner payloads
have [additional bounds](schema.md#decision-requests).

Hidden content, scripts, password/file inputs, `data-ruakit-ignore` elements, and
Rua's toolbar are excluded. Rendered controls outside the viewport can appear in
observations. Use `scrollIntoView` to reveal them.

Accessible names can reference hidden or outside labels without creating extra
action targets. This is a DOM snapshot, not a complete accessibility tree.

## Interactions

Run one action at a time. Actions return `PageState` after giving application
handlers a turn to render. You can still call `getState()` while an action waits.

| Method | Purpose |
| --- | --- |
| `click(target)` | Activate a control, follow a link, or submit a form. |
| `focus(target)` / `blur(target)` | Change focus. |
| `setValue(target, value)` | Replace a native input or textarea value and check readback. |
| `insertText(target, text)` | Insert at the current selection, including in editable text. |
| `selectOption(target, values)` | Select native options by value. Pass an array for single or multiple selection. |
| `setChecked(target, checked)` | Set a checkbox or select a radio button. |
| `pressKey(target, key, options)` | Send synthetic keyboard events with optional modifiers. |
| `scrollIntoView(target)` | Reveal a rendered control, including a disabled one. |
| `goto(path)` | Navigate through your router callback. |
| `waitFor(condition)` | Wait for a page state that matches a predicate. |

An action can finish before a delayed server response arrives. Use `waitFor` for
a concrete result, such as a save acknowledgement:

```ts
await runtime.waitFor((state) => state.text.includes("Draft saved"));
```

Use the agent's [completion checks](agent.md#completion-and-verification) to check
the full request, and [approval](agent.md#approval) for permission. Direct runtime
callers own approval; the DOM runtime does not classify risk.

## Editable surfaces and user control

`setValue` dispatches input/change events and checks readback without submitting.
Focus stays on the field; native validity is separate from readback. Change a
radio group by selecting another radio.

Use `insertText` for insertion, including contenteditable editors. Editors can
handle its cancelable `beforeinput` event through their own document model.
Otherwise, it uses the browser's editing command, never `textContent` replacement.

Contenteditable text appears as `value`. Unsupported or rejected insertion
produces an error. `pressKey` reaches editor shortcuts and application handlers,
but does not insert characters or reproduce browser editing defaults.

Agent requests continue through clicks, typing, and wheel input without toolbar
error feedback. Cancel, abort signals, React unmount cleanup, and deadlines stop
owned work. Earlier effects remain in place.

## React and routing

Imports are safe during server rendering. Create the runtime after mounting.
Native setters and events let React process field edits without component
registration or React internals.

Connect your router with a callback that resolves after navigation commits:

```ts
const runtime = createRuntime({
  root: document.querySelector<HTMLElement>("#app")!,
  navigate: async (path, signal) => {
    signal.throwIfAborted();
    await router.navigate(path);
  },
});

await runtime.goto("/logs");
```

Navigation stays on the current origin, and RuaKit checks the resulting URL.
Your callback should honor cancellation and finish its own work when aborted.

## Deadlines and errors

The default operation deadline is two seconds. Set `timeoutMs` on the runtime or
an individual call to change it. Every asynchronous method accepts a signal:

```ts
const controller = new AbortController();
const pending = runtime.waitFor((state) => state.text.includes("Ready"), {
  timeoutMs: 5000,
  signal: controller.signal,
});
controller.abort();
await pending; // Rejects with the caller's cancellation reason.
```

| `RuntimeError.code` | Meaning |
| --- | --- |
| `STALE_TARGET` | The control or its observed context changed. Read the page again. |
| `DISABLED` | The control cannot receive this action yet. |
| `READ_ONLY` | The control cannot be edited. |
| `UNSUPPORTED` | The requested operation is unavailable. |
| `VALUE_REJECTED` | The field did not accept the requested value. |
| `BUSY` | Another operation is still running. |
| `TIMEOUT` | The operation exceeded its deadline. |

Cancellation preserves the caller's abort reason. Check the current state before
retrying an action that could submit, delete, or create duplicate effects.

Switching tabs does not pause operations or deadlines, though browser throttling
can delay rendering and timers. Abort from `visibilitychange` to stop while
hidden. Cancelled work does not restart when the tab becomes visible.

## Action feedback

`onAction` reports the action ID/type, phase (`before`, `after`, `cancelled`, or
`failed`), element, viewport rectangle, and duration. Use it for a cursor or
highlight. DOM references stay local, and callback errors do not affect execution.

With a subscriber, an action follows this sequence:

1. Scroll to the target if `scrollToTarget: true`.
2. Emit `before` and allow `actionDelayMs` for visual feedback.
3. Revalidate the target, execute, check readback, and emit `after`.

`actionDelayMs` accepts 0–10000 ms (default zero) or a local
`(element: HTMLElement) => number` function evaluated after scrolling. The result
uses the same range. Targets are revalidated after the function and delay.

Delays share cancellation and deadlines. Scrolling defaults to off; focus uses
`preventScroll`. Without a subscriber, delays, delay functions, and automatic
scrolling are skipped. Explicit `scrollIntoView` still works.

`withActionFeedback` exposes this lifecycle for other validated target resolvers.
The [React cursor](react.md#ruas-visual-cursor) handles visuals and travel timing.
Feedback does not move the system pointer or dispatch pointer events.

## Scope

The runtime supports native fields, buttons, links, and controls identified by
supported ARIA roles or `tabindex`. It observes open shadow trees, including
editable controls. Hidden or ignored hosts exclude their shadow contents too.
Page prose comes from the light DOM; shadow editor text appears as a field value.

Closed shadow trees, frames, clipboard access, full-page reloads, and
editor-specific transaction adapters are outside this API. Keyboard events are
synthetic: they cannot trigger browser shortcuts or default editing behavior.

## Screenshots

Call `runtime.screenshot()` to render the configured root to PNG. The runtime
loads [`html-to-image`](https://github.com/bubkoo/html-to-image) on demand; ordinary
observations and actions do not capture images.

```ts
const image = await runtime.screenshot();
// { data, mimeType: "image/png", width, height, capturedAt, url }
```

Capture renders the document element or your container's box without changing
the live page. DOM reconstruction can differ from the viewport, especially with
scrolling, complex CSS, video, canvas, or cross-origin assets.

Password/file inputs, ignored elements, and Rua's toolbar are excluded along
with their children. Exclusions can change image layout. Excluded roots, or
roots inside ignored elements, reject with `UNSUPPORTED`. Iframes and SVGs with
excluded content or `<use>` references are also omitted.

| Image property | Limit or format |
| --- | --- |
| Resolution | One output pixel per CSS pixel, scaled down for large roots |
| Pixel count | At most 4 megapixels |
| Width or height | At most 8192 pixels |
| Encoded data | Raw base64 PNG, without a data URL prefix |
| Decoded size | At most 5 MiB |

Capture shares operation ownership, deadlines, and cancellation. Asset requests
receive the signal. Disconnection or URL changes reject capture; cancellation
discards late output, though rendering can continue until the library yields.

Screenshots return image data instead of `PageState`. They provide visual
context, not coordinate targets or proof of backend persistence.

> **Migrating:** The `captureScreenshot` option and the `ScreenshotProvider` and
> `ScreenshotContext` types were removed. Capture needs no adapter or screen-sharing permission.
> Agent and React integrations advertise it automatically and capture on request.

## Experimental pointer interactions

Import the pointer API separately from `@ruakit/runtime/experimental`. It binds
to a connected surface such as a canvas and does not use DOM target references.

```ts
import { createPointer } from "@ruakit/runtime/experimental";

const pointer = createPointer(document.querySelector("canvas")!);
await pointer.move({ x: 20, y: 30 });
await pointer.drag({ x: 20, y: 30 }, { x: 140, y: 90 });
// Or call down(), move(), and up() individually.
```

Coordinates are CSS pixels from the surface's bounding rectangle, independent
of bitmap resolution. Drags default to 12 steps over 200 ms, adjustable with
`steps` and `durationMs`. Operations accept `signal` and `timeoutMs` (default
2000 ms). Await each operation.

Cancellation or failure releases a held button through `pointercancel`.
`cancel()` releases it explicitly between operations. Each instance owns its
button state and requires browser `PointerEvent` support.

All events target the supplied element, even outside its bounds. They are
synthetic, with mouse compatibility events when the pointer event is not
cancelled.

There is no hit testing, native pointer capture, automatic click, hover
enter/leave, native drag-and-drop, text selection, or cursor overlay.

Inspect application state afterward: pointer methods return no observation or
success verification. This API is experimental and may change.

## Development

From the workspace root:

```sh
pnpm --filter @ruakit/runtime build
pnpm --filter @ruakit/runtime test
```

Tests cover observation, actions, React inputs, navigation, and cancellation.
The package ships ESM, TypeScript declarations, and source under MIT.
