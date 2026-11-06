[Documentation index](README.md) - [RuaKit](../README.md)

# Plans and planners

A plan describes the actions to take and the outcomes to check afterward. The
planner establishes those checks before the browser starts acting, so completion
has a concrete meaning throughout the task.

## Creating a plan

`useRua` and `usePlan` execute the same `Plan` format. Return the plan object
directly as JSON from your planner for `useRua`, or pass it to `usePlan(plan)`.
Each plan needs an `id`, a `message`, ordered `steps`, and completion `checks`.

For example, if the page has a Name field, a Save button, and shows "Profile saved"
after saving:

```ts
import type { Plan } from "@ruakit/react";

const nameTarget = {
  id: null,
  role: "textbox",
  label: "Name",
  context: null,
  group: null,
};

const plan: Plan = {
  id: "update-name-1",
  message: "Your name is Ana and the profile was saved.",
  steps: [
    {
      id: "fill-name",
      message: "Enter Ana in the Name field.",
      type: "fill",
      target: nameTarget,
      value: "Ana",
    },
    {
      id: "save-profile",
      message: "Save the profile.",
      type: "click",
      target: {
        id: null,
        role: "button",
        label: "Save",
        context: null,
        group: null,
      },
    },
  ],
  checks: [
    {
      type: "value",
      description: "The Name field contains Ana.",
      control: nameTarget,
      equals: "Ana",
    },
    {
      type: "text",
      description: "The page confirms the profile was saved.",
      text: "Profile saved",
      fresh: true,
    },
  ],
};
```

Build targets from the controls in `input.snapshot.controls`, which your planner
receives in its [planning request](schema.md#planning-requests).
`role` and `label` must match exactly. All five target fields are required:
use the observed `control.target.id` for `id`, or `null` to match by the other
fields. `context` and `group` can be `null`; set them from the observed context
and a containing group's name when needed to distinguish similar controls.
Use `id: null` for controls that appear only after an earlier step. RuaKit takes
a fresh snapshot before each action and requires one matching, enabled control.

Give each step a distinct `id`, a short `message`, a `type`, a `target`, and the
arguments for that action. Supported types are `click`, `focus`, `key`,
`insertText`, `fill`, `select`, and `check`; see the
[action arguments](schema.md#actions). Plans use these control
locators; the `{ id, version }` targets used by low-level decisions are resolved
locally by RuaKit.

Define 1–20 [completion checks](schema.md#completion-checks) for
the user's expected result. Every check must pass before RuaKit sets
`goalCompleted: true`. In this example, checking the field value confirms the edit, and
`fresh: true` requires the save message to be new since the task started. Choose
checks your page can actually satisfy; use `verifyCompletion` for additional
[application verification](react.md#completion-and-cancellation).

When `useRua` asks for a replacement, give it a new plan `id` and preserve
`input.checks` unchanged. No parent or replacement ID is needed.
Use `input.replan.completedSteps` to plan the remaining work without repeating
completed actions.

## Generating plan IDs

Pass `planDraftResponseSchema` from `@ruakit/schema` to your model. It contains
`message`, `steps`, and `checks`, including the corresponding approval wrapper,
without a plan ID. Step and target IDs retain their existing meaning.
Return `planResponseSchema.parse(object)` from your endpoint to validate the model
output and use Zod defaults to assign a fresh UUID v4 when a plan ID is missing.
This also handles approval plans and leaves clarification, screenshot, and unsupported responses unchanged.
See the [endpoint example](../README.md#1-set-up-an-endpoint).

`planResponseSchema` validates the final response, including the assigned ID.
Parsing that response again preserves its ID. Always send the draft schema to
the model: it omits the UUID default entirely, so converting it to JSON does not
generate or expose a default ID. Import the maintained `systemPrompt` from
`@ruakit/agent` instead of copying the Markdown prompt into your app.

## Custom planners

Use the optional `request` callback on `useRua` to connect your own backend. It
receives the current page and application context, and returns a plan with an ID,
ordered steps, and completion checks. RuaKit executes the steps and requests a
replacement plan if the page changes or the expected outcomes are missing.

```tsx
import { useRua } from "@ruakit/react";
import type { RequestPlan } from "@ruakit/react";

const request: RequestPlan = async (input, _context, signal) => {
  const response = await fetch("/api/my-planner", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) throw new Error("Planning failed.");
  return response.json();
};

function AgentHelp() {
  const { submit, loading } = useRua({ request });

  return (
    <button
      disabled={loading}
      onClick={() => void submit("Change my name to Ana and save")}
    >
      Update my name
    </button>
  );
}
```

The callback receives a [planning request](schema.md#planning-requests)
(`PlanRequest`) and returns a [planning response](schema.md#planning-responses)
(`PlanResponse`). Each replacement plan has a new backend ID. The runtime keeps
the task history without a parent or replacement field. Completed steps and the
original completion checks carry forward; replanning is bounded by `maxReplans` (default 3).
