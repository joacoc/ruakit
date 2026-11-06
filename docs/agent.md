# @ruakit/agent

[Documentation index](README.md) - [RuaKit](../README.md)

Give your planner a page snapshot, execute its plan, and check the result.
`@ruakit/agent` manages this loop, including replanning, clarification, approval,
and cancellation. It works without React; use [`@ruakit/react`](react.md) for hooks
and UI.

Create the runtime after your app mounts. By default, it calls `/v1/plan` on your
application's origin:

```ts
import { createRuntime } from "@ruakit/agent";

const controller = new AbortController();
const runtime = createRuntime({ protocol: "plan" });
const result = await runtime.request("Open billing", {
  signal: controller.signal,
});
```

## Planner prompt

Import `systemPrompt` from `@ruakit/agent` in your planner endpoint.
It is generated from [PROMPT.md](PROMPT.md) during the package build. Append
application-specific instructions when needed.

## Full-plan execution and replanning

Use `protocol: "plan"` to request a full [plan](schema.md#plans): an ID, message,
ordered steps, and completion checks. Targets describe controls by their label,
role, and context. Before each action, the browser observes the page again and
resolves a current, enabled target.

To execute an existing plan, call `executePlan` directly:

```ts
import { createSession } from "@ruakit/agent";

const session = createSession();
const outcome = await session.executePlan(plan);
```

`executePlan` returns one of two outcomes:

| Status | Result |
| --- | --- |
| `completed` | Execution has finished, with the supplied plan ID. Check `result.goalCompleted` and `result.verification` for verified outcomes. |
| `needs-replan` | The failed step, fresh snapshot, and completed-step history. |

A successful native `target="_blank"` click appears in completed-step history.
RuaKit runs any remaining steps, then finishes without replanning against the
unchanged original page. Missing or stale targets still require a replacement.
An empty plan also ends execution. In either case, unmet checks leave
`goalCompleted` and `verification` unset; opening a tab does not verify its contents.

`createRuntime({ protocol: "plan" })` handles replacement requests automatically.
Use `planner(input, signal)` or a `PlanTransport` to connect your own backend.
Options also include JSON `context`, `onPlan`, and `maxReplans`.

### Replacement plans

A missing or ambiguous target, or an unmet outcome check, can request another
plan. Other execution errors stop the task because their effects may be uncertain.
Each replacement receives the previous plan ID, completed actions, failure
reason, and fresh page state.

Replacement plans must:

- Have a new plan ID and retain the original completion checks. No parent or replacement field is required.
- Keep completed step IDs attached to the same actions.
- Never repeat completed actions that could create duplicate effects, even with new step IDs.

`maxReplans` defaults to 3 and accepts 0–10. A task also stops after 200 executed
steps. To retain this history across clarification answers, [reuse a plan task](#clarification).

## Decision planning

Use the default `createRuntime()` or `session.plan()` for one decision at a time.
Requests include the prompt, clarification answers, platform, a fresh snapshot,
and up to 20 previous decisions. See the [request schema](schema.md#decision-requests)
and [page observations](runtime.md#observe-then-act) for fields and limits.

The planner returns one [decision](schema.md#decisions): `prepare`, `act`,
`approval`, `screenshot`, `complete`, `clarify`, or `unsupported`. Actions use
current, enabled `{ id, version }` targets, which the browser revalidates before
acting. See [supported actions](schema.md#actions). JavaScript and selectors
cannot be executed through planner responses.

Before actions, `prepare` locks the outcome checks. A later `complete` must
repeat them exactly, and all must pass against both the planner's observation
and the fresh live page. Already-satisfied requests can complete without acting.
The old `complete.evidence` string is no longer accepted.

## Completion and verification

Checks cover field values, checkbox state, selected options, result text, URLs,
and absent controls. Use `fresh: true` when result text must acknowledge a new
operation. An existing success message or button caption cannot prove a new save.
Partial completion and changed criteria are rejected.

A completed result includes `goalCompleted: true` and
`verification: { level: "observed", checks }`. These checks verify what the page
shows. Your planner still needs to choose checks that express the user's request.

Use `verifyCompletion(context)` to check persisted application state after DOM
checks pass. Context contains the prompt, fixed checks, original baseline, fresh
snapshot, and signal.

Return exactly `true` for verification level `"confirmed"`. False produces
`VERIFICATION_FAILED`; exceptions and cancellation reject. The browser checks
the DOM again afterward, and the request deadline also bounds the callback.
Failures do not roll back or automatically retry earlier effects.

## Screenshots

Screenshot support is built in. When the planner returns `screenshot`, the agent
captures one PNG and includes it in the next planning turn. Ordinary observations
and actions do not capture images. The model should use a supplied image before
requesting another.

See [runtime screenshots](runtime.md#screenshots) for limits and rendering
details. Images do not enable coordinate actions or prove persistence.

## Approval

The planner returns `approval` with a `message` and either a single `step` or a
full `plan`. Prepare reversible work separately and ask immediately before the
consequential action. Use `clarify` for missing details or user takeover.

Supply `onApproval` to ask the user through your application's UI:

```ts
const runtime = createRuntime({
  protocol: "plan",
  onApproval: async ({ approval, signal }) => {
    return showApprovalDialog(approval.message, { signal });
  },
});
```

`showApprovalDialog` is your dialog. The callback also receives `snapshot` and
`prompt` (undefined for manual execution without one). Proposal and snapshot are
detached copies; editing them cannot change execution.

| Response | Behavior |
| --- | --- |
| Exactly `true` | Revalidate the proposal, then execute. |
| Any other value | Stop with `APPROVAL_DENIED`. |
| Missing handler | Throw `ApprovalNeededError` (`APPROVAL_REQUIRED`), with the unexecuted proposal in `error.approval`. |
| Error, timeout, or cancellation | Stop without executing the proposal. |

The callback is also available on session, plan-task, and plan-execution options.
Approval waits retain session ownership and share the request's deadline and
signal. Late answers cannot resume cancelled work.

Approval covers the exact proposal. The agent revalidates targets and, for full
plans, the URL and current controls. Future controls must match the plan's
locators. Changed proposals and replacement plans need fresh approval. Decision
loops must `prepare` their checks first. Approval failures stop without retrying
or replanning; obtain a fresh proposal to continue.

> **Note:** The agent enforces approvals the planner requests. It cannot detect
> consequential actions returned as ordinary actions or ungated plans. The DOM
> runtime does not classify risk. React provides [approval UI](react.md#approval).

## Observation and execution primitives

Use `createSession()` when your integration owns the loop. It exposes the same
observation and validation used by `runtime.request()`:

```ts
import { createSession } from "@ruakit/agent";

const session = createSession();
const snapshot = session.snapshot();
const response = await fetch("/api/my-planner", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: "Open billing", snapshot }),
});
if (!response.ok) throw new Error("Planning failed.");
const result = await session.run(await response.json(), { snapshot });
```

Keep the original snapshot locally. `run` validates decisions against the schema,
that observation, and the live target. Foreign, copied, or consumed snapshots
are rejected. Editing a snapshot cannot authorize extra actions.

Successful actions return `status: "triggered"`. Only a checked `complete` adds
`goalCompleted` and `verification`. Clarification throws
`ClarificationNeededError`; unsupported decisions and failures also throw.

For a manual loop, supply fixed `checks` and an original session `baseline` for
fresh-result checks. The baseline may precede consumed action snapshots. Manual
actions do not claim completion, and a manual `prepare` receipt leaves check
ownership to your integration.

For automatic iteration, use `session.plan(prompt, requestDecision, options)`.
Your callback receives a `DecisionRequest` and signal each turn. Options support
clarification, cancellation, deadlines, and feedback.

A session retains its target registry and permits one execution or loop at a
time. Reuse it through `createRuntime({ session, serverUrl })` when combining
primitives with a configured planner. React shares sessions per document.

## Transport and configuration

Both HTTP transports post to `/v1/plan` on the current origin by default.
`serverUrl` changes the base URL, and `fetch` overrides the HTTP client.
Responses are validated with `@ruakit/schema`.

| Protocol | Built-in transport | Custom transport method |
| --- | --- | --- |
| Full plans | `createPlanTransport` | `plan(input, signal)` on `PlanTransport` |
| Decisions | `createHttpTransport` | `dom(input, signal)` on `RuaKitTransport` |

Custom transports should stop underlying work when the signal aborts. A page can
also configure the base URL with metadata:

```html
<meta name="ruakit-config" content='{"serverUrl":"http://127.0.0.1:4310"}' />
```

An explicit `serverUrl` overrides metadata. Neither is needed for the current
origin or an explicitly configured transport.

## Request lifecycle

One request can run on a runtime at a time. Progress callbacks receive messages,
while `onPhaseChange` reports `observing`, `planning`, and `executing`.
Feedback callback errors do not change execution.

| Deadline | Default |
| --- | --- |
| `timeoutMs`: each operation | 8000 ms |
| `requestTimeoutMs`: the whole request | 60000 ms |

Both accept positive integers up to 2147483647. The total deadline bounds waiting
even if a transport ignores cancellation. Timers and listeners are cleaned up
when the request settles. Use `document` to select another browser document.

Explicit cancellation and deadlines stop requests. React unmount cleanup cancels
owned work too. Ordinary clicks, typing, wheel input, and switching tabs do not
cancel or pause requests. Browser throttling can delay background work, but the
request deadline keeps running. To stop while hidden, abort from a
`visibilitychange` listener. Returning does not restart cancelled work.

## Clarification

Headless integrations receive `ClarificationNeededError`
(`CLARIFICATION_REQUIRED`). Read its `clarification` question and options, show
them to the user, then resend the original prompt with the answer:

```ts
await runtime.request(originalPrompt, {
  clarifications: [...history, { question, answer }],
});
```

The next request observes the page again. For full plans, retain one
`session.createPlanTask()` for the logical request and pass it as `task` to
`createRuntime`. This keeps the baseline, fixed checks, completed steps, and
plan history across answers.

The task's `request(prompt, planner, options?)` method is also available directly.
Without a supplied task, each runtime request starts fresh. Each active attempt
owns the session, including time awaiting the backend.

React's `useRua` retains the prompt and earlier answers, accepts up to three
answers, and ignores obsolete callbacks. See [React request lifecycle](react.md#request-lifecycle)
for `answer`, `startOver`, and identity-checked `execute`/`respond` outcomes.

React re-exports the agent's outcome, identity, correlation, and error types.
These local types do not change the wire protocol. Known errors retain their
codes; unknown failures use `REQUEST_FAILED`.

## Visual action feedback

Use `onAction`, `actionDelayMs`, and `scrollToTarget` for a cursor or target
highlight. Headless execution defaults to zero delay and no automatic scrolling.
The [runtime feedback guide](runtime.md#action-feedback) covers events, timing,
cancellation, and target revalidation.

React handles cursor rendering, distance-based timing, reduced motion, and
cleanup. Feedback stays local and adds no model requests.

## Reading and changing the runtime

| Module | Responsibility |
| --- | --- |
| `runtime.ts` | Browser setup and planner configuration. |
| `decision-runtime.ts` | Connect a decision transport to a session. |
| `session.ts` | Shared target registry, observations, and decisions. |
| `plan.ts` | Plan execution, replacement plans, and task history. |
| `request-state.ts` | Request state, phases, and reducer. |
| `operations.ts` | Deadlines, cancellation, and cleanup. |
| `transport.ts` / `plan-transport.ts` | HTTP requests and response validation. |
| `approval.ts` | Wait for the host's approval response. |

The package ships ESM and has no React or CSS imports. React request ownership
and presentation live in `@ruakit/react`.
