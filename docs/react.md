# @ruakit/react

[Documentation index](README.md) - [RuaKit](../README.md)

Add RuaKit to a React 18 or 19 application. Use the ready-made assistant, connect
the request hook to your own UI, or control each observation and action yourself.

```tsx
import { Rua } from "@ruakit/react";

<Rua />;
```

The assistant sends requests to `/v1/plan` and includes a toolbar and visual
cursor. The package imports its scoped styles automatically.

| API | Use it to |
| --- | --- |
| `useRua` | Request and execute plans through your own interface. |
| `usePlan` | Execute a plan you already have. |
| `useSnapshot` / `useRun` | Own the observation and decision loop. |
| `Toolbar` | Display request state using callbacks you supply. |
| `RuaCursor` | Add visual feedback to a custom interface. |

## Plans and requests

`useRua` observes the page, requests a full plan, executes it, and handles
replanning. Use it from a chat, button, or another part of your application:

```tsx
import { useRua } from "@ruakit/react";

function UpdateName() {
  const rua = useRua({
    context: { workspaceId: "workspace-1" },
    maxReplans: 3,
  });

  return (
    <button
      data-ruakit-ignore
      disabled={rua.loading}
      onClick={() => void rua.submit("Change my name to Ana and save")}
    >
      Update name
    </button>
  );
}
```

The default transport posts to `/v1/plan`. Pass a custom
[`request` callback](#custom-planners-and-primitive-hooks) to use your own backend.
Application context works with either approach.

`submit(prompt, context?)` returns an `ExecutionResult` on success and `undefined`
on failure, cancellation, blank input, or an ignored duplicate submission. Use
[`execute`](#explicit-outcomes-and-caller-context) when you need a detailed outcome.
`currentPlan` contains a copy of the latest backend plan, including its ID.

Plans contain ordered actions and checks for every requested outcome. The browser
resolves targets from a fresh observation before each action. Missing targets or
unmet checks can request a replacement; uncertain execution errors stop the task.

`maxReplans` defaults to 3 and accepts 0–10. Tasks stop after 200 executed steps.
Replacements preserve the original checks and completed-step history. See the
[agent's plan contract](agent.md#full-plan-execution-and-replanning) for revision
IDs and replay rules.

### Execute a supplied plan

`usePlan(plan, options?)` executes a plan without contacting a backend. Call
`execute()` after mounting; rendering or changing the plan never starts actions.
You can pass `null` while loading it.

```tsx
import { usePlan } from "@ruakit/react";
import type { Plan } from "@ruakit/react";

function RunPlan({ plan }: { plan: Plan }) {
  const executor = usePlan(plan);

  return (
    <button
      data-ruakit-ignore
      disabled={executor.loading}
      onClick={() => void executor.execute().catch(console.error)}
    >
      Run plan
    </button>
  );
}
```

The hook exposes `execute({ signal? }?)`, `cancel`, `loading`, `state`, and `action`.
Execution uses the plan and options captured at the call, even if props change.

| `PlanExecutionResult.status` | Meaning |
| --- | --- |
| `completed` | All checks passed. Includes the execution result and completed-step history. |
| `needs-replan` | Includes the plan ID, fresh snapshot, completed steps, failed step, and reason. Your integration obtains and explicitly runs the replacement. |

Invalid plans, cancellation, and execution errors reject. An unmet plan also
appears as a failure in `state`. Options support document/session selection,
deadlines, feedback, scrolling, an optional verification prompt, and `verifyCompletion`.

> **Migrating:** The former `usePlan({ request })` API is now `useRua({ request })`.

## Request lifecycle

Read `state.message` to show progress and `state.status` to choose your UI.
`loading` is true while running, awaiting approval, or cancelling. Errors stay
available in state instead of disappearing when `submit` resolves.

| Method or value | Purpose |
| --- | --- |
| `submit(prompt, context?)` | Start a request and return its result or `undefined`. |
| `execute(input)` | Start a request with an explicit outcome. |
| `answer(text)` / `respond(input)` | Answer a pending clarification. |
| `respondToApproval(input)` | Approve or decline the exact pending proposal. |
| `cancel(operationId?)` | Cancel this hook's operation, optionally checking its identity. |
| `startOver()` | Clear a pending question and return to idle. |
| `currentPlan` | Read the latest plan. |
| `action` | Read local visual feedback for the current action. |

`RequestState` includes `idle`, `running`, `cancelling`, `triggered`,
`clarification`, `approval`, `cancelled`, and `failed`. Active phases are
`observing`, `planning`, and `executing`. Non-idle states have a local request ID;
a triggered state includes the execution result.

`submit` and `cancel` keep stable function identities. Each operation captures
the latest committed options; changes configure the next request. Sessions are
accessed lazily after mounting. Unmounting aborts owned work and ignores obsolete
callbacks, including during React Strict Mode setup and cleanup.

### Explicit outcomes and caller context

Inside an event handler, await `execute` to get the outcome of that call:

```ts
const outcome = await rua.execute({
  prompt: "Filter the report to the selected customers",
  context: { selectedCustomerIds: ["customer-1"] },
  correlation: { toolCallId: "tool-1" },
});

if (outcome.status === "failed" || outcome.status === "rejected") {
  console.error(outcome.error.code, outcome.error.message);
}
```

| `outcome.status` | Meaning |
| --- | --- |
| `completed` | All completion checks passed. Includes the result and verification level. |
| `triggered` | An execution result without verified goal completion. Inspect it before reporting success. |
| `needs-input` | A question is waiting. Answer it with `respond`. |
| `cancelled` | Stopped by caller signal, explicit cancellation, unmount, or adapter abort. |
| `rejected` | Invalid input, unavailable mounting, a busy session, or a stale answer. Inspect `error.code`. |
| `failed` | Execution failed. Inspect `error` and `canRespond` before retrying an answer. |

Known agent and browser errors retain their codes. Unexpected failures use `REQUEST_FAILED`.

Every outcome has an `operationId`, which remains stable through clarification
and retries. Accepted operations expose it in `state.identity`. The numeric
`state.requestId` identifies an individual attempt.
Optional `correlation` carries `threadId`, `messageId`, or `toolCallId`; it is
copied when submitted and does not authorize actions.

Per-call context overrides the hook's default. Context must be JSON within eight
nested levels, 2048 values, and roughly 32 KiB. The default transport includes it
in the planning request. Identity and correlation stay local unless a custom
callback sends them.

### Answering a question

For `needs-input`, call `respond({ operationId, answer })`. The resumed operation
keeps its identity, context, planner, and caller signal. Invalid answers do not
consume the question. Stale identities or changed session/transport configuration
are rejected.

A failed answer with `canRespond: true` leaves the question available for another
explicit response. Up to three answers are allowed. Actions are never retried
automatically.

`cancel(operationId)` ignores stale IDs. `cancel()` also stops a pending question.
A locally accepted `execute` replaces the previous question; invalid input or an
already aborted signal does not. `startOver` clears it.

Clarification belongs to the mounted hook and is lost on unmount or reload.
`needs-input` already resolves the current promise; later cancellation updates
state without resolving it again. Keep the chat interaction open until the next
outcome or cancellation.

## Approval

When the planner returns `approval`, `state.status` becomes `"approval"` and
`state.approval` holds the proposal. `loading` stays true and the original promise
remains pending. `<Rua />` shows **Approve** and **Decline** controls.

For custom UI, respond to the exact operation and approval instance:

```tsx
if (rua.state.status === "approval" && rua.state.identity) {
  const { approval, approvalId, identity } = rua.state;
  return (
    <button
      onClick={() =>
        rua.respondToApproval({
          operationId: identity.operationId,
          approvalId,
          approved: true,
        })
      }
    >
      Approve: {approval.message}
    </button>
  );
}
```

Pass `approved: false` to decline. `respondToApproval` returns false for obsolete,
duplicate, or mismatched responses. Each proposal has a distinct approval ID.
Declining settles the request with `APPROVAL_DENIED` and executes no proposed action.

Enter and clarification answers cannot approve. Cancellation, unmount, and the
total request deadline discard the proposal and late answers. Approval waiting
counts toward `requestTimeoutMs` (60000 ms by default).

Use `onApproval(context)` for your own dialog instead of the built-in approval
state. `useRun` and `usePlan` also accept it and throw `ApprovalNeededError` when
approval is needed but no handler exists. Only exactly `true` grants approval.
See the [agent contract](agent.md#approval) for revalidation and model policy.

## Custom planners and primitive hooks

### Connect your backend

Pass `request` to `useRua` to receive the full page snapshot and planning history:

```tsx
import { useRua } from "@ruakit/react";
import type { RequestPlan } from "@ruakit/react";
import { planResponseSchema } from "@ruakit/schema";

type Context = { selectedCustomerIds: string[] };

const request: RequestPlan<Context> = async (input, _context, signal) => {
  const response = await fetch("/api/my-planner", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) throw new Error("Planning failed.");
  return planResponseSchema.parse(await response.json());
};

function CustomerAction() {
  const rua = useRua<Context>({ request });

  return (
    <button
      data-ruakit-ignore
      disabled={rua.loading}
      onClick={() => void rua.submit("Filter to these customers", {
        selectedCustomerIds: ["customer-1"],
      })}
    >
      Apply filters
    </button>
  );
}
```

`RequestPlan<Context>` receives `(input, context, signal, identity)`. Three-argument
callbacks remain valid. `PlanRequest` is the wire payload, `PlanResponse` is the
result, and `RuaAgent<Context>` is the controller returned by `useRua`.

Context reaches the callback on every planning and clarification attempt. Your
callback chooses what to send; the example forwards the complete validated
request. Return a plan, approval, clarification, screenshot request, or unsupported
response matching the [planning schema](schema.md#planning-responses).

### Own the decision loop

Use `useSnapshot` and `useRun` to manage each observation and decision yourself:

```tsx
import { useSnapshot, useRun } from "@ruakit/react";

function CustomAction() {
  const snapshot = useSnapshot();
  const { run, loading, state } = useRun();

  async function takeOneStep() {
    const observed = snapshot();
    const response = await fetch("/api/my-planner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot: observed, prompt: "Open settings" }),
    });
    if (!response.ok) throw new Error("Planning failed.");
    await run(await response.json(), { snapshot: observed });
  }

  return (
    <button
      data-ruakit-ignore
      disabled={loading}
      onClick={() => void takeOneStep().catch(console.error)}
    >
      {state.message}
    </button>
  );
}
```

`useSnapshot()` returns a stable page reader. `useRun()` exposes `run`, `cancel`,
`loading`, `action`, and `state`. `run(decision, { snapshot, signal?, checks?, baseline? })`
returns an `ExecutionResult`; errors, clarification, unsupported decisions, and
cancellation reject. Only checked completion sets `goalCompleted` and verification.

Keep the original snapshot locally and pass it to `run`. Copies and consumed
snapshots are rejected. Read the page again before requesting another decision.
See [session primitives](agent.md#observation-and-execution-primitives) for target
validation and manually established completion checks.

Your integration owns cancellation of its external planner fetch. Primitive
`cancel()` and `signal` cover execution. `useRua` cancels the entire loop.

### Shared sessions

Observation, execution, and request hooks share one session per document,
including across components. No React provider component is required. One
execution or loop can own the session at a time. Browser work starts when you
call an imperative method after mounting; rendering the hooks is safe during SSR.

For another document, pass the same `document` to both hooks. You can also supply
a `session` created with `@ruakit/agent.createSession()`. Operations capture their
options when started. Unmounting cancels that hook's work without disposing the
shared session. Mark assistant UI with `data-ruakit-ignore` to exclude it from observations.

## Rua's visual cursor

`<Rua />` includes a dark pointer with a white border, a target outline, and a
pulse for clicks and checkbox changes. It follows observed controls during
scrolling and layout changes. The overlay passes input through and is hidden
from observations and assistive technology. It never moves the system pointer
or dispatches hover events.

```tsx
<Rua cursorLabel="Helper" cursorVisibility="session" scrollToTarget />;
```

| `<Rua>` prop | Default | Purpose |
| --- | --- | --- |
| `visualCursor` | `true` | Show or hide the cursor. |
| `cursorLabel` | No label | Add text or emoji beside the pointer. |
| `cursorVisibility` | `"plan"` | Keep it for a request or the mounted session. |
| `cursorEdgeGlow` | `true` | Show edge strips when the pointer leaves the viewport. |
| `scrollToTarget` | `false` | Reveal each action target before movement. |
| `actionDelayMs` | Calculated from travel | Set a minimum movement allowance; zero skips movement. |

### Movement and timing

The cursor follows one shallow arc at **1200 CSS pixels per second**. Its bend
is capped at 3% of the journey and 24 pixels. The arrow follows the curve, then
returns to its resting orientation. Longer journeys take longer; positive
`durationMs` values do not change speed.

Rua calculates the action delay from path length within the request deadline.
A positive `actionDelayMs` is a minimum; longer travel can extend it. An explicit
zero or reduced motion skips movement and its delay. Reduced motion also skips rotation.

Action completion does not snap an ongoing journey to its destination. Click
feedback and fade wait for arrival. After reaching a control, the cursor follows
its movement directly without replaying the curve. Outlines match the target's
corners. The pointer has no drop shadow or glow beneath it.

### Visibility and scrolling

In `"plan"` mode, the cursor stays visible during the request and disappears when
it settles. In `"session"` mode, it appears on the first action or presentation
anchor and retains its last document position between requests.

Completion, failure, or cancellation stops session-mode travel and removes the
outline and pulse. An idle cursor does not track its previous control. Unmounting
Rua or setting `visualCursor={false}` removes it and its retained position.

Targets use their full document center without viewport clamping. Off-screen
pointers are hidden and light the corresponding edges; diagonal positions light
both. Scrolling reveals the actual position. Edge feedback follows travel and
updates for zoom, mobile viewports, and on-screen keyboards without restarting movement.

`scrollToTarget` reveals the target and its scrollable ancestors without
animation. Focus causes no extra scrolling. Enable it on `Rua`, `useRua`,
`usePlan`, `useRun`, or a standalone `RuaCursor`, depending on your integration.

### Use a standalone cursor

Share a timing object between the cursor and execution hook:

```tsx
import { RuaCursor, useCursorTiming, useRua } from "@ruakit/react";

function CustomAssistant() {
  const timing = useCursorTiming(500); // Minimum delay for travel.
  const rua = useRua({ actionDelayMs: timing.actionDelayMs });

  return (
    <>
      <button
        data-ruakit-ignore
        disabled={rua.loading}
        onClick={() => void rua.submit("Open settings")}
      >
        Open settings
      </button>
      <RuaCursor
        timing={timing}
        action={rua.action}
        active={rua.loading}
        visibility="session"
        label="Helper"
      />
    </>
  );
}
```

`useCursorTiming` accepts a minimum number or callback and respects reduced
motion. Zero skips travel. Pass the same object to `timing` and its
`actionDelayMs` to the hook. The cursor remembers its displayed position even
when the hook clears `action`.

`active` keeps the pointer visible through planning pauses or removed targets;
a missing target removes its outline. Without `active`, standalone feedback
fades after 650 ms. Keep passing the current `action`, including `null` after
settlement. Session-mode retention belongs to the cursor.

For dragging, set `dragging` while the host holds the object. The cursor follows
the target directly with its normal orientation; your integration owns drag
state and actual pointer events.

For a guided tour, pass a stable `anchor` object with
`{ element, durationMs?, onReached? }`. It moves to the element's center without
an outline while no action is active. `onReached` runs once per anchor object
after arrival. Runtime actions take precedence; clear the anchor before the next plan.

Anchors affect presentation only. Travel uses the same speed; `durationMs: 0`
skips it. `RuaCursor`, `useCursorTiming`, `CursorTiming`, `CursorAnchor`,
`CursorVisibility`, and `RuaCursorProps` are also exported from
`@ruakit/react/toolbar`. Cursor movement makes no model requests.

### Cursor styling

`cursorLabel` on Rua and `label` on RuaCursor accept any text. Empty strings or
`undefined` hide the label; changes apply during an active action. Use
`cursorEdgeGlow={false}` or standalone `edgeGlow={false}` to hide edge feedback.

The cursor is portalled into its action document's body. Set
`--ruakit-cursor-color` and `--ruakit-z-index` on that document's root for the
label, outline, edge glow, pulse, and stacking order. The default accent is
`#7c3aed`; the pointer fill is `#0F1B34`.

> **Migrating:** Movement presets and `cursorMovement`, standalone `movement`,
> `CursorMovement`, `CursorMovementPreset`, and `CursorMovementOptions` were removed.

### Component playground

From the workspace root:

```sh
pnpm --filter @ruakit/react demo
```

Open `http://127.0.0.1:4318` for the cursor or `/#toolbar` for the toolbar. Both
use the real components with local state and timers, without a planner or API key.
Preview movement, moving targets, request states, and clarification controls.

Use the label field, edge-glow and scrolling toggles, Normal/Glass message styles,
and background controls to inspect appearance. Scrolling starts disabled.
Send, Cancel, answers, and New request operate locally. Reset clears pending
timers; appearance changes preserve the current preview state.

`pnpm --filter @ruakit/react demo:build` generates ignored `results/demo` assets
for opening `packages/react/index.html` directly. Set `RUAKIT_DEMO_PORT` to change
the development server's port.

## React toolbar and packaging

Render `<Rua />` outside page components so route changes do not unmount it.
The toolbar opens on hover, focus, or tap and stays open while focused, holding
a draft, or processing a request. An empty, unfocused box collapses when the
pointer leaves.

Set `placeholder` to replace the default “Jot your intention” text.

Enter sends; Send becomes Cancel while active. Shift+Enter does not add a line,
and pasted line breaks become spaces. Requests are limited to 2000 characters.
The input stays focusable but read-only during a request. Focus returns after
execution. Success clears the draft; failure and cancellation preserve it.

### Controlled toolbar

Import the presentation component separately when your application owns request state:

```tsx
import { Toolbar } from "@ruakit/react/toolbar";

<Toolbar
  prompt={prompt}
  placeholder="Jot your intention"
  request={requestState}
  onPromptChange={setPrompt}
  onSubmit={submit}
  onCancel={cancel}
  onAnswer={answer}
  onStartOver={startOver}
/>;
```

This entry point uses agent types without loading its orchestration code. Wire
`onApprovalResponse(approved)` to enable approval controls; Approve stays disabled
without it. `ToolbarProps` and `RequestState` are exported types.

### Appearance

The default toolbar fill is `#2F2F2F`. Send and Cancel have white circles with
icons matching the fill; `--ruakit-button-text` overrides the icon color. Panels
have no visible borders, while keyboard focus indicators remain visible.

Set these variables on `.ruakit-toolbar`:

- `--ruakit-background`, `--ruakit-text`, `--ruakit-focus` for colors.
- `--ruakit-max-width`, `--ruakit-bottom`, `--ruakit-z-index` for layout.
- `--ruakit-message-background`, `--ruakit-message-text`, `--ruakit-message-highlight` for messages.

The default `messageStyle="normal"` uses an opaque `#242424` recessed panel.
`messageStyle="glass"` adds translucency and blur, with an opaque fallback when
backdrop filtering is unavailable. Both work on Rua and Toolbar. Styles are
scoped, but host CSS can still override them.

Status panels appear after the toolbar expands. Settled messages remain until
the user edits the draft, then dismiss after 900 ms. Answering keeps questions
visible. New requests replace dismissal timers, and unmounting clears them.

Announcements use one persistent polite live region. Reduced motion skips
movement, forced colors disable the busy shimmer, and icon controls have
accessible labels.

### Bundling and server rendering

React and React DOM 18/19 are peer dependencies. Motion and Heroicons are bundled;
React, React DOM, their JSX runtimes, the browser engine, and CSS stay external.
Builds include minified assets, source maps, declarations, and dependency notices.

Scoped CSS loads automatically, so no Tailwind setup, reset, or separate import
is needed. Your bundler must support CSS imports; use `@ruakit/agent` for code
that needs neither React nor CSS.

Both React entry points preserve `"use client"` for Next.js. Components such as
Rua can be imported from Server Components, while hooks and event handlers
belong in Client Components. Browser access waits until execution after mounting.
Use modern browsers with `AbortSignal.any` and `AbortSignal.timeout`.

For linked Vite apps, use `resolve.dedupe: ['react', 'react-dom']` with normal SSR
externalization to keep one React instance.

## Planner configuration

By default, Rua and `useRua` post to `/v1/plan` on the current origin. Set
`serverUrl` for another base URL or use a custom `request` callback. Metadata can
also supply the base URL:

```html
<meta name="ruakit-config" content='{"serverUrl":"http://127.0.0.1:4310"}' />
```

Explicit options override metadata, and `fetch` can replace the HTTP client.
Pass `transport` with a `PlanTransport.plan(input, signal)` implementation that
honors cancellation. The
[single-decision transport](agent.md#transport-and-configuration) uses
`RuaKitTransport.dom`. Each planning turn starts from a fresh observation.

## Completion and cancellation

Completion requires every fixed check to pass on fresh page state. Full-plan
backends preserve checks in replacement plans. Legacy decision loops establish
them through `prepare` and repeat them in `complete`; the old evidence string is
no longer accepted.

Without a verifier, completion has level `"observed"`. Use `verifyCompletion` to
check application state after DOM checks pass. It must return exactly `true`
for level `"confirmed"`; false, errors, or cancellation prevent completion.
See [agent verification](agent.md#completion-and-verification) for details.

The planner can request [built-in screenshots](runtime.md#screenshots). No capture
adapter is needed; the old `captureScreenshot` option was removed. Ordinary
observations and actions do not capture images.

### Deadlines and abort signals

| Option | Default |
| --- | --- |
| `timeoutMs` | 8000 ms per browser operation. |
| `requestTimeoutMs` | 60000 ms per active request attempt, including approval. |

Both accept positive integers up to 2147483647. Clarification waits between
attempts without a running deadline. A supplied `AbortSignal` covers the entire
operation, including planner work and pending clarification. Its reason reaches
the planner; an already aborted signal starts no work.

Cancel, abort signals, deadlines, and unmount cleanup stop owned work. Ordinary
clicks, typing, wheel input, and switching tabs do not cancel it or trigger error
feedback. Cancelling retains ownership until settlement, ignores late progress,
and prevents late success from clearing the draft.

Deadlines bound waiting even if a transport never settles. Timers and signal
listeners are removed on settlement, replacement, reset, or unmount. Earlier
application effects and late adapter side effects cannot be undone.
