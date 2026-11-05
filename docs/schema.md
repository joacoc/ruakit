# @ruakit/schema

[Documentation index](README.md) - [RuaKit](../README.md)

`@ruakit/schema` defines the data shared by the planner and browser executor. It
provides Zod schemas, inferred TypeScript types, and completion checks that run
without model inference. You can use it without Node.js or React APIs.

Use a schema's `.parse()` method to validate data received from a planner or
browser. Invalid data throws a Zod error. All protocol objects reject undeclared
fields, and payload sizes are bounded.

The examples below follow a small task: enter "Ana" in the Name field on a profile
page. Later snippets reuse values from earlier examples.

## Plans

A plan describes the actions to take and the outcomes to check afterward. The
planner establishes those checks before the browser starts acting, so completion
has a concrete meaning throughout the task.

### Control locators

[`controlLocatorSchema`](../packages/schema/src/verification.ts) describes a control by its role,
label, and optional context. All five fields are required, but `id`, `context`,
and `group` can be null.

```ts
import { controlLocatorSchema } from "@ruakit/schema";

const locator = controlLocatorSchema.parse({
  id: "name",
  role: "textbox",
  label: "Name",
  context: "Profile",
  group: "Profile",
});
```

A non-null `id` anchors a known control. Use `id: null` when a control may only
appear after an earlier step. A null `context` or `group` leaves that part of the
match unrestricted. `group` is the name of a containing form, dialog, or other
semantic group.

### Planned steps

[`plannedStepSchema`](../packages/schema/src/plan.ts), inferred as `PlannedStep`, describes one action
in a plan. Give each step a stable ID and a short message explaining what it does.

```ts
import { plannedStepSchema } from "@ruakit/schema";

const plannedStep = plannedStepSchema.parse({
  id: "fill-name",
  message: "Enter Ana in the Name field.",
  type: "fill",
  target: locator,
  value: "Ana",
});
```

Steps support `click`, `focus`, `key`, `insertText`, `fill`, `select`, and `check`.
The [action types](#actions) below list the arguments for each type. Planned steps
use semantic locators. Before each action, the browser takes a fresh snapshot,
resolves one enabled control, and uses its locally observed ID and version.
Selectors, scripts, and coordinates are rejected.

### Completion checks

[`completionCheckSchema`](../packages/schema/src/verification.ts), inferred as `CompletionCheck`,
describes one observable outcome. Its `description` should explain how that
outcome relates to the user's request.

```ts
import { completionCheckSchema } from "@ruakit/schema";

const nameCheck = completionCheckSchema.parse({
  type: "value",
  description: "The Name field contains Ana.",
  control: locator,
  equals: "Ana",
});
```

There are six kinds of checks. Each one also requires a `description`.

| Type       | Required fields                         | What passes                                                                                        |
| ---------- | --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `value`    | `control`, `equals: "Ana"`              | The field has that exact value.                                                                    |
| `checked`  | `control`, `equals: true`               | The control has that checked state.                                                                |
| `selected` | `control`, `equals: ["de"]`             | The control has exactly those selected values, in any order.                                       |
| `text`     | `text: "Profile saved"`, `fresh: true`  | The page contains that result text. With `fresh: true`, it must be new since the initial snapshot. |
| `url`      | `equals: "https://app.example/profile"` | The current URL matches exactly.                                                                   |
| `absent`   | `control`                               | No control matches the locator's semantic fields.                                                  |

[`completionChecksSchema`](../packages/schema/src/verification.ts) groups 1–20 checks. Every check
must pass for the task to complete.

```ts
import { completionChecksSchema } from "@ruakit/schema";

const checks = completionChecksSchema.parse([nameCheck]);
```

### A complete plan

[`planSchema`](../packages/schema/src/plan.ts), inferred as `Plan`, brings the steps and checks
together. The backend gives each plan revision its own ID. A plan can contain up
to 50 steps, and step IDs must be distinct within that plan.

```ts
import { planSchema } from "@ruakit/schema";

const plan = planSchema.parse({
  id: "plan-1",
  message: "The Name field will contain Ana.",
  steps: [plannedStep],
  checks,
});
```

The optional `replacesPlanId` field links a replacement to its previous plan.
A plan ID identifies a backend revision. An operation ID identifies the entire
local user request, which may need more than one revision.

## Planning requests

[`planRequestSchema`](../packages/schema/src/plan.ts), inferred as `PlanRequest`, sends the user's
prompt and a fresh page snapshot to the planner. Start with `checks: null` and
`replan: null`. Once checks are established, include them unchanged in later
requests.

```ts
import { planRequestSchema } from "@ruakit/schema";

const request = planRequestSchema.parse({
  protocol: "plan",
  prompt: "Enter Ana in the Name field.",
  clarifications: [],
  snapshot: {
    url: "https://app.example/profile",
    title: "Profile",
    text: "Edit your profile",
    controls: [
      {
        target: { id: "name", version: 1 },
        tag: "input",
        role: "textbox",
        label: "Name",
        context: "Profile",
        groups: [{ role: "form", name: "Profile" }],
        enabled: true,
        readOnly: false,
        value: "",
      },
    ],
    focused: null,
    truncated: false,
  },
  checks: null,
  replan: null,
});
```

`platform`, `context`, `canScreenshot`, and `screenshot` are optional. A request
can carry up to three clarification answers as `{ question, answer }` objects.

### Application context

[`planContextSchema`](../packages/schema/src/plan.ts) accepts JSON data your application wants to
share with the planner. For example, you might include the current profile ID and
the names of available sections.

```ts
import { planContextSchema } from "@ruakit/schema";

const context = planContextSchema.parse({
  profileId: "profile-42",
  sections: ["Profile", "Notifications"],
});

const requestWithContext = planRequestSchema.parse({ ...request, context });
```

Context is bounded to 8 nested levels, 2048 values, and roughly 32 KiB of content.
Functions, cycles, and non-JSON objects such as `Date` are rejected.

## Planning responses

[`planResponseSchema`](../packages/schema/src/plan.ts), inferred as `PlanResponse`, accepts a plan
directly. You don't need to wrap it in another object.

```ts
import { planResponseSchema } from "@ruakit/schema";

const response = planResponseSchema.parse(plan);
```

When the planner needs more information, a screenshot, or cannot handle the
request, it returns a message instead.

```ts
const clarificationResponse = planResponseSchema.parse({
  type: "clarify",
  message: "Which profile should I update?",
});

const screenshotResponse = planResponseSchema.parse({
  type: "screenshot",
  message: "I need to see the profile preview before continuing.",
});

const unsupportedResponse = planResponseSchema.parse({
  type: "unsupported",
  message: "This request needs a file upload, which I can't perform.",
});
```

A response can also ask for approval of a concrete plan. See
[approval](#approval) for that shape.

## Replanning

Sometimes the page changes while a plan is running. Replanning gives the planner
a fresh snapshot and a record of what already happened. Established checks and
completed actions are preserved.

[`completedPlanStepSchema`](../packages/schema/src/plan.ts), inferred as `CompletedPlanStep`, pairs a
finished step with the ID of the plan that produced it. For example, after the
Name field has been filled:

```ts
import { completedPlanStepSchema } from "@ruakit/schema";

const completedStep = completedPlanStepSchema.parse({
  planId: plan.id,
  step: plannedStep,
});
```

[`replanSchema`](../packages/schema/src/plan.ts), inferred as `Replan`, explains why another plan is
needed. Here, the control changed before the first step could run, so there are
no completed steps yet.

```ts
import { replanSchema } from "@ruakit/schema";

const replan = replanSchema.parse({
  planId: plan.id,
  completedSteps: [],
  failedStepId: "fill-name",
  reason: "target-stale",
  message: "The Name control changed before the step could run.",
});
```

`completedSteps` holds up to 200 entries shaped like `completedStep` above.
Completed clicks can carry `navigation: { url, target: "_blank" }` feedback.
It records activation, not destination loading; the HTTP(S) URL is bounded to 4,000 characters.
`failedStepId` can be null when no individual step failed. Reasons are
`target-unavailable`, `target-stale`, and `outcome-mismatch`.

The replacement needs a new ID, the correct `replacesPlanId`, and the same checks.
In this example, the browser can resolve the same locator again against a fresh
snapshot.

```ts
const replacementPlan = planSchema.parse({
  ...plan,
  id: "plan-2",
  replacesPlanId: plan.id,
});
```

The agent enforces revision links, preserved checks, and completed-action history
across the task. Parsing an individual plan validates its shape.

## One decision at a time

The single-decision protocol is available through `useRun` and the
framework-neutral session APIs. Instead of returning a full plan, the planner
chooses one next action or response from the current snapshot.

### Actions

[`actionSchema`](../packages/schema/src/decision.ts) describes one browser action. Its target must
contain an ID and positive version observed locally in the current snapshot.
Step IDs, messages, and semantic locators belong to planned steps.

```ts
import { actionSchema } from "@ruakit/schema";

const action = actionSchema.parse({
  type: "fill",
  target: { id: "name", version: 1 },
  value: "Ana",
});
```

Every action requires `type` and `target`. The other fields depend on its type.

| Type         | Additional fields                                                                           |
| ------------ | ------------------------------------------------------------------------------------------- |
| `click`      | None                                                                                        |
| `focus`      | None                                                                                        |
| `key`        | `key`, `altKey`, `ctrlKey`, `metaKey`, `shiftKey`. All four modifier booleans are required. |
| `insertText` | `text`                                                                                      |
| `fill`       | `value`                                                                                     |
| `select`     | `values`, a nonempty array of option values                                                 |
| `check`      | `checked`, a boolean                                                                        |

### Decision requests

[`decisionRequestSchema`](../packages/schema/src/decision.ts), inferred as `DecisionRequest`, carries
the original prompt, a fresh snapshot, up to three clarification answers, and up
to 20 previous decisions. Start with an empty history and `checks: null`.

```ts
import { decisionRequestSchema } from "@ruakit/schema";

const decisionRequest = decisionRequestSchema.parse({
  prompt: request.prompt,
  clarifications: [],
  snapshot: request.snapshot,
  history: [],
  checks: null,
});
```

`platform`, `canScreenshot`, and `screenshot` are optional. `checks` is also
optional in this schema. After preparation, send the established checks with
subsequent requests.

Executed clicks in `history` can carry `navigation` feedback added by the browser.
Planner responses cannot supply this field.

### Decisions

[`decisionSchema`](../packages/schema/src/decision.ts), inferred as `Decision`, accepts `prepare`,
`act`, `approval`, `screenshot`, `complete`, `clarify`, and `unsupported`.

Before the first action, `prepare` establishes the outcome checks. An `act`
decision then carries one action addressed to a fresh target. Finally, `complete`
repeats the established checks exactly.

```ts
import { decisionSchema } from "@ruakit/schema";

const preparation = decisionSchema.parse({
  type: "prepare",
  message: "I'll check that the Name field contains Ana.",
  checks,
});

const actionDecision = decisionSchema.parse({
  type: "act",
  message: "Enter Ana in the Name field.",
  step: action,
});

const completion = decisionSchema.parse({
  type: "complete",
  message: "The Name field contains Ana.",
  checks,
});
```

The browser retains the prepared checks and rejects attempts to replace or weaken
them. A request that is already satisfied can complete without preparation or an
action. `complete` takes structured checks, and the old `evidence` string is no
longer accepted.

`clarify`, `screenshot`, and `unsupported` use the same `{ type, message }` shapes
shown in [planning responses](#planning-responses).

## Approval

Clarification asks for missing information. Approval asks permission to execute a
concrete proposal. The model decides when approval is needed. The browser runtime
doesn't classify consequences from button labels or field names.

[`planApprovalSchema`](../packages/schema/src/plan.ts), inferred as `PlanApproval`, wraps the entire
plan revision that needs approval. It is also accepted by `planResponseSchema`.

```ts
import { planApprovalSchema } from "@ruakit/schema";

const planApproval = planApprovalSchema.parse({
  type: "approval",
  message: "Change the Name field to Ana?",
  plan,
});
```

[`approvalDecisionSchema`](../packages/schema/src/decision.ts), inferred as `ApprovalDecision`, wraps
one action in the single-decision protocol. It is also accepted by
`decisionSchema`.

```ts
import { approvalDecisionSchema } from "@ruakit/schema";

const actionApproval = approvalDecisionSchema.parse({
  type: "approval",
  message: "Change the Name field to Ana?",
  step: action,
});
```

The approval message must be a nonblank explanation of the proposed consequence,
up to 2000 characters. A planner cannot supply an `approved` field.

The agent waits for an explicit host response before executing the enclosed
action or plan. Clarification answers, page content, progress messages, and
earlier approvals don't grant consent for a different proposal. Approval doesn't
start a new browser operation or enable unsupported controls. See the
[agent lifecycle](agent.md#approval) and
[React controls](react.md#approval) for integration details.

## Verifying completion

`evaluateCompletionChecks(checks, state, baseline)` evaluates every outcome
without model inference. For the running example, filling the Name field makes
the value check pass:

```ts
import { evaluateCompletionChecks } from "@ruakit/schema";

const currentSnapshot = {
  ...request.snapshot,
  controls: request.snapshot.controls.map((control) => ({
    ...control,
    target: { ...control.target, version: control.target.version + 1 },
    value: "Ana",
  })),
};

const verification = evaluateCompletionChecks(
  checks,
  currentSnapshot,
  request.snapshot,
);
// { passed: true, checks: [{ description: "The Name field contains Ana.", passed: true }] }
```

Value and state checks fail when a control is missing or ambiguous. Absence
checks fail on truncated snapshots and still look for a semantic match if a
control remounts with a new ID. A control caption cannot serve as result prose.
Text checks with `fresh: true` need text that was absent from the initial page
and present in the final page. Value and URL checks can pass for outcomes that
were already satisfied.

These checks establish what the browser can observe. They don't prove backend
persistence or independently determine whether the planner understood the user's
intent.

### Execution results

[`resultSchema`](../packages/schema/src/protocol.ts), inferred as `ExecutionResult`, describes what
happened locally. An action receipt has `status: "triggered"` and omits
`goalCompleted`.

```ts
import { resultSchema } from "@ruakit/schema";

const receipt = resultSchema.parse({
  planId: "plan-1",
  status: "triggered",
  events: ["Filled Name"],
});
```

A completed task also carries `goalCompleted: true` and the checks used to verify
it. The `verification` field contains those outcome definitions.
`evaluateCompletionChecks` returns the per-check booleans separately.

```ts
const completedResult = resultSchema.parse({
  ...receipt,
  goalCompleted: true,
  verification: { level: "observed", checks },
  message: "The Name field contains Ana.",
});
```

`observed` means the browser checks passed. `confirmed` means the optional
application verifier also returned true. A failed execution uses
`status: "failed"` and can include a `message` explaining the failure. A manually
executed screenshot decision returns its image in `result.screenshot` without
marking the goal complete.

## Clarifications and screenshots

[`clarificationSchema`](../packages/schema/src/protocol.ts), inferred as `Clarification`, describes
a conversational question with up to four distinct options. Use `options: []`
when the question needs a free-form answer.

```ts
import { clarificationSchema } from "@ruakit/schema";

const clarification = clarificationSchema.parse({
  type: "clarification",
  question: "Which profile should I update?",
  options: ["Personal", "Work"],
});
```

This uses `type: "clarification"` and `question`. A planner's `clarify` response
uses `type: "clarify"` and `message` instead. Neither shape contains executable
instructions.

[`screenshotSchema`](../packages/schema/src/verification.ts) describes a base64 image with its MIME
type, dimensions, capture timestamp in milliseconds, and page URL. This example
uses a one-pixel PNG to keep the image data short.

```ts
import { screenshotSchema } from "@ruakit/schema";

const screenshot = screenshotSchema.parse({
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  mimeType: "image/png",
  width: 1,
  height: 1,
  capturedAt: 1_793_091_600_000,
  url: "https://app.example/profile",
});
```

Supported formats are PNG, JPEG, and WebP. Decoded image data must fit within
5 MiB and match the advertised format's signature. Each dimension can be at most
8192 pixels. Set `canScreenshot: true` on a request to advertise capture support.
After the planner requests a screenshot, the next request includes it in
`screenshot`.

Screenshots provide visual context. They don't create action targets or authorize
coordinate input. `RUNTIME_META_NAME` names the optional `ruakit-config` planner
configuration tag.
