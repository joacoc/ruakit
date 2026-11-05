# Hooks

[Documentation index](README.md) - [RuaKit](../README.md)

Use `useRua` to bring Rua into your own chat, button, or wherever you need it. Give it a prompt and it handles the backend requests and executes the actions.

```tsx
import { useRua } from "@ruakit/react";

function AgentHelp() {
  const { submit, loading } = useRua();

  return (
    <button disabled={loading} onClick={() => void submit("Help filling form")}>
      Help filling form
    </button>
  );
}
```

It calls `/v1/plan` by default. You can also
[connect your own backend](react.md#plans-and-requests).

## Running a plan

Use `usePlan(plan)` when you already have a plan. Call `execute()` to start it;
rendering the hook or passing a different plan does not start any actions.

```tsx
import { usePlan } from "@ruakit/react";
import type { Plan } from "@ruakit/react";

function RunPlan({ plan }: { plan: Plan }) {
  const { execute, loading } = usePlan(plan);

  return (
    <button
      disabled={loading}
      onClick={() => void execute().catch(console.error)}
    >
      Run plan
    </button>
  );
}
```

A [plan](schema.md#plans) contains an ID, typed steps, and completion
checks. RuaKit resolves each target against the current page before acting.
`execute()` returns `completed` or `needs-replan`; it never contacts a backend.
Use `useRua` to handle those backend requests and replacement plans automatically.

## Low-level hooks

For full control over the loop, use `useSnapshot` to read the page and `useRun` to
apply one [decision](schema.md#decisions) from your backend. An
`act` decision contains one [action](schema.md#actions). You
handle the steps between calls.

```tsx
import { useSnapshot, useRun } from "@ruakit/react";

function AgentHelp() {
  const getSnapshot = useSnapshot();
  const { run, loading } = useRun();

  async function onHelp(question: string) {
    const snapshot = getSnapshot();
    const response = await fetch("/api/my-planner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot, prompt: question }),
    });
    if (!response.ok) throw new Error("Planning failed.");

    const decision: unknown = await response.json();
    await run(decision, { snapshot });
  }

  return (
    <button
      disabled={loading}
      onClick={() => void onHelp("Open settings").catch(console.error)}
    >
      Open settings
    </button>
  );
}
```

Keep the original snapshot for `run`, and take a new one for each step.
See [more on low-level hooks](react.md#custom-planners-and-primitive-hooks).
