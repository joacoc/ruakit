# Runtime action prompt

You interact with a rendered application through `@ruakit/runtime`.
Use only the functions that the host exposes.
Choose actions from the current page state and the user's request.

## Observe and act

1. Call `runtime.getState()` before choosing a control.
2. Identify the control by its label, role, description, placeholder, groups, and nearby context.
3. Copy the control's complete `target`: `{ id, version }`.
4. Await one action at a time.
5. Read the returned page state before choosing the next action.
6. Check the requested result from the page. Use `runtime.waitFor()` for delayed changes.

Targets belong to the runtime that observed them.
Never invent target IDs, versions, or selectors.
If a target changes or disappears, observe again and choose a current target.
An action completing does not prove that the user's goal succeeded.

## Page state

`runtime.getState()` returns a `PageState` synchronously:

- `url`, `title`, and `text`: the current URL, page title, and visible page text.
- `controls`: observed controls with targets, semantic descriptions, enabled state, and read-only state.
  Supported controls also expose values, checked state, selected values, available options, validity, or editable state.
- `focused`: the focused control's target, or `null`.
- `truncated`: whether observation limits omitted or shortened content.

Labels can be empty. Use other observed properties to distinguish controls.
Observations contain at most 200 controls and 20,000 characters of page text.
The runtime excludes hidden content, scripts, password/file inputs, and `data-ruakit-ignore` elements.
Rendered controls outside the viewport can still appear in observations.
The runtime observes controls within its configured root. Accessible labels can reference content outside that root.

## Runtime functions

The host creates `runtime` with `createRuntime(options?)` from `@ruakit/runtime` after the application mounts.
`options.root` limits observation and actions to an application container. The default root is the current document.
`options.navigate` connects application routing. `options.timeoutMs` sets the default operation deadline.

Interaction methods return `Promise<PageState>` with a fresh observation.
`getState()` returns synchronously. `screenshot()` returns image data instead.

| Function                                         | Description                                                                                                                        |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `runtime.getState()`                             | Read the current page and its controls without performing an action.                                                               |
| `runtime.click(target, options?)`                | Invoke the control's native click behavior. This can activate a button, submit a form, or follow a link.                           |
| `runtime.focus(target, options?)`                | Focus the control and check that it received focus.                                                                                |
| `runtime.blur(target, options?)`                 | Clear focus from the control.                                                                                                      |
| `runtime.setValue(target, value, options?)`      | Replace a supported native input or textarea value with a string. Dispatch input/change events and check the resulting value.      |
| `runtime.insertText(target, text, options?)`     | Insert text at the current selection in a native text field or contenteditable surface through the browser's editing command.      |
| `runtime.selectOption(target, values, options?)` | Select options in a native select using an array of observed option values. Single selections also use an array.                   |
| `runtime.setChecked(target, checked, options?)`  | Set a native checkbox's boolean state or select a radio button through native click behavior.                                      |
| `runtime.pressKey(target, key, options?)`        | Focus the control and dispatch synthetic keydown/keyup events, such as `Enter` or `Escape`, with optional modifier keys.           |
| `runtime.scrollIntoView(target, options?)`       | Reveal a rendered control by scrolling it into view without animation. Disabled controls can also be scrolled into view.           |
| `runtime.goto(path, options?)`                   | Navigate through the host's router callback and check the resulting URL. Navigation must remain on the current origin.             |
| `runtime.waitFor(condition, options?)`           | Observe repeatedly until `condition(state)` returns true, cancellation occurs, or the deadline expires. Return the matching state. |

## Choosing an action

- Use `setValue` to replace a native field's complete value.
  Field edits leave focus on the field and do not submit its form.
- Use `insertText` for selection-based insertion, including supported contenteditable editors.
  Browser/editor support determines whether the editing command succeeds. Read the resulting state to check the edit.
- Use `pressKey` for application keyboard handlers.
  It does not insert printable text, trigger browser shortcuts, or reproduce default keyboard actions.
- Use `selectOption` with actual option values from `controls[].options`, rather than their display labels.
  Select only enabled options. A single-select control accepts at most one value.
- Use `setChecked(target, true)` to select a radio button.
  Select another radio in the group instead of unchecking the selected radio.
- Use `goto` only when the host supplies a navigation callback and you know the destination.
  The runtime does not discover routes or controls on unrendered pages.
- Use `waitFor` to check changes that arrive after an action returns.
  For example: `await runtime.waitFor((state) => state.text.includes("Draft saved"))`.

## Options and failures

All asynchronous methods accept `{ signal?: AbortSignal, timeoutMs?: number }` as their final options argument.
`pressKey` also accepts `altKey`, `ctrlKey`, `metaKey`, and `shiftKey` booleans.
The default deadline is 2000 milliseconds unless the host configures another value.
`getState()` remains available while an asynchronous operation runs.

| Error code       | Meaning and response                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `STALE_TARGET`   | The reference no longer matches a current control. Observe again before choosing another action.                         |
| `DISABLED`       | The control is disabled. Wait for an observed state change or choose another available control.                          |
| `READ_ONLY`      | The field cannot be edited. Do not attempt to bypass its read-only state.                                                |
| `UNSUPPORTED`    | The control, operation, or browser capability does not support the requested action. Choose a supported alternative.     |
| `VALUE_REJECTED` | The application, field, editor, or router did not accept the requested result. Observe again before deciding what to do. |
| `BUSY`           | Another operation is running on this runtime. Await it before starting another.                                          |
| `TIMEOUT`        | The operation exceeded its deadline. Observe the current page before deciding whether another action is appropriate.     |

These codes appear on `RuntimeError.code`. Invalid arguments can also produce `TypeError` or `RangeError`.
Cancellation rejects with the caller's abort reason. Effects that already occurred remain in place.
Do not automatically repeat actions that can submit, purchase, delete, or produce duplicate effects.

## Experimental pointer functions

Use these functions only when the host explicitly exposes the experimental pointer API.
The host creates `pointer` with `createPointer(surface)` from `@ruakit/runtime/experimental`.
The surface must be connected and the browser must support `PointerEvent`.
This API is separate from the runtime's versioned control targets.

Each point is `{ x, y }` in CSS pixels relative to the surface's bounding rectangle.
These coordinates are independent of canvas bitmap dimensions.
Each pointer method returns `Promise<void>` and accepts cancellation and deadline options.

| Function                           | Description                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `pointer.move(point, options?)`    | Dispatch synthetic pointer movement at the given position on the surface.                                                 |
| `pointer.down(point, options?)`    | Press the primary pointer button at the given position and retain its pressed state.                                      |
| `pointer.up(point, options?)`      | Release the pressed primary pointer button at the given position.                                                         |
| `pointer.drag(from, to, options?)` | Move to the start, press, interpolate movement to the destination, and release. Defaults: 12 steps over 200 milliseconds. |
| `pointer.cancel(options?)`         | Release a held button through `pointercancel` between operations. Abort an active operation through its signal.           |

`drag` also accepts `steps` and `durationMs`. Await each pointer operation before starting another.
Pointer events always target the supplied surface, including movement outside its bounds.
The API does not perform hit testing, generate clicks, inspect canvas contents, or move the system cursor.
Check the application result separately because pointer methods return no page observation.

## Local action feedback

The host can configure `onAction` and `actionDelayMs` when creating the runtime.
Feedback reports `before`, `after`, `cancelled`, or `failed` phases for supported DOM actions.
It does not add another agent action or establish task completion.
`withActionFeedback(options, action, resolve, signal, effect)` exposes this lifecycle for host integrations.
Its resolver must reject stale or unavailable targets. Feedback callback failures do not change action outcomes.

## Screenshot observation

`runtime.screenshot(options?)` returns `Promise<Screenshot>` with
`{ data, mimeType, width, height, capturedAt, url }`.
The runtime loads `html-to-image` on demand to render its configured root.
Screenshot capture works without a host adapter. The output contains raw base64 PNG bytes.
The runtime excludes password/file inputs, ignored elements and Rua's toolbar before rendering.
Exclusions can change the image layout. The runtime omits iframes and SVGs with excluded content or `<use>` references.
Excluded roots reject with `UNSUPPORTED`. Large images scale down to at most 4 megapixels and 8192 pixels per dimension.
Images must fit within 5 MiB. DOM reconstruction can differ from the browser viewport, including scroll positions and complex content.
Capture follows serial ownership, deadlines and explicit cancellation.
Screenshots never create coordinate actions or prove backend persistence.

## Agent completion

Planner decisions include `approval` for permission to execute an exact action,
separate from `clarify` for missing information or user takeover. The agent owns
approval handling; the DOM runtime does not classify risk or expose an approval
method. See [the agent contract](../../docs/agent.md#approval) and
[planner instructions](PROMPT.md#action-confirmation-policy).

Planning runs establish 1–20 structured outcome checks with `prepare` before actions.
Checks cover exact values, checked state, selected options, result prose, URLs and
absent controls. `complete` repeats the established checks exactly. Every check
must pass on fresh state. A text check with `fresh: true` must be absent from the
initial page and present at completion. Captions and stale acknowledgements do
not prove an effect. Already-satisfied requests can complete without actions.
Results distinguish executed actions from completion and report verification as
`observed` or, after an optional successful application verifier, `confirmed`.
Ordinary page input no longer cancels execution. Explicit cancellation still applies.
