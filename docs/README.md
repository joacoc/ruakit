# RuaKit documentation

[RuaKit overview and installation](../README.md)

Start with how RuaKit works, then choose the hooks or runtime APIs that fit your application.

## Guides

| Topic                                 | Contents                                                              |
| ------------------------------------- | --------------------------------------------------------------------- |
| [How RuaKit works](how-it-works.md)   | Read the page, plan, execute, and evaluate outcomes.                  |
| [Hooks](hooks.md)                     | Add `useRua` to your own interface.                                   |
| [Run a plan](run-a-plan.md)           | Execute an existing plan with `usePlan`.                              |
| [Creating a plan](creating-a-plan.md) | Define targets, steps, completion checks, and replacement plans.      |
| [Custom planners](custom-planners.md) | Connect your own backend through a request callback.                  |
| [Low-level hooks](low-level-hooks.md) | Manage each observation and decision with `useSnapshot` and `useRun`. |
| [Next.js setup](nextjs.md#setup)      | Add the server route and keep API credentials on the server.          |

## Package reference

### React

[`@ruakit/react`](react.md) provides hooks, the assistant toolbar, a controlled toolbar, and a visual cursor.

- [Plans and requests](react.md#plans-and-requests)
- [Execute a supplied plan](react.md#execute-a-supplied-plan)
- [Rua's visual cursor](react.md#ruas-visual-cursor)
- [Component playground](react.md#component-playground)
- [Request lifecycle](react.md#request-lifecycle)
- [Explicit outcomes and caller context](react.md#explicit-outcomes-and-caller-context)
- [Approval](react.md#approval)
- [Custom planners and primitive hooks](react.md#custom-planners-and-primitive-hooks)
- [React toolbar and packaging](react.md#react-toolbar-and-packaging)
- [Planner configuration](react.md#planner-configuration)
- [Completion and cancellation](react.md#completion-and-cancellation)

### Agent

[`@ruakit/agent`](agent.md) manages sessions, planning, requests, and conversation lifecycle without React.

- [Full-plan execution and replanning](agent.md#full-plan-execution-and-replanning)
- [Decision planning](agent.md#decision-planning)
- [Screenshots](agent.md#screenshots)
- [Approval](agent.md#approval)
- [Observation and execution primitives](agent.md#observation-and-execution-primitives)
- [Transport and configuration](agent.md#transport-and-configuration)
- [Request lifecycle](agent.md#request-lifecycle)
- [Clarification](agent.md#clarification)
- [Visual action feedback](agent.md#visual-action-feedback)
- [Reading and changing the runtime](agent.md#reading-and-changing-the-runtime)

### Runtime

[`@ruakit/runtime`](runtime.md) observes the DOM and performs browser actions.

- [Start with the page](runtime.md#start-with-the-page)
- [Observe, then act](runtime.md#observe-then-act)
- [Interactions](runtime.md#interactions)
- [React and routing](runtime.md#react-and-routing)
- [Deadlines and errors](runtime.md#deadlines-and-errors)
- [Action feedback](runtime.md#action-feedback)
- [Scope](runtime.md#scope)
- [Experimental pointer interactions](runtime.md#experimental-pointer-interactions)
- [Development](runtime.md#development)
- [Editable surfaces and user control](runtime.md#editable-surfaces-and-user-control)
- [Screenshots](runtime.md#screenshots)

### Schema

[`@ruakit/schema`](schema.md) defines planner protocols, validation schemas, and completion checks.

- [Plans](schema.md#plans)
- [Control locators](schema.md#control-locators)
- [Planned steps](schema.md#planned-steps)
- [Completion checks](schema.md#completion-checks)
- [A complete plan](schema.md#a-complete-plan)
- [Planning requests](schema.md#planning-requests)
- [Application context](schema.md#application-context)
- [Planning responses](schema.md#planning-responses)
- [Replanning](schema.md#replanning)
- [One decision at a time](schema.md#one-decision-at-a-time)
- [Actions](schema.md#actions)
- [Decision requests](schema.md#decision-requests)
- [Decisions](schema.md#decisions)
- [Approval](schema.md#approval)
- [Verifying completion](schema.md#verifying-completion)
- [Execution results](schema.md#execution-results)
- [Clarifications and screenshots](schema.md#clarifications-and-screenshots)

### Next.js

[`@ruakit/nextjs`](nextjs.md) forwards planning requests from a server-only App Router route.

- [Setup](nextjs.md#setup)
- [Application authentication](nextjs.md#application-authentication)
- [Configuration and local development](nextjs.md#configuration-and-local-development)
- [Current integration patterns](nextjs.md#current-integration-patterns)
