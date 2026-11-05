# AGENTS.md

The [Getting started guide](README.md#getting-started) is in the root `README.md`.

## Project structure

RuaKit lets agents observe a rendered application and interact with its controls.
The public repository contains five ESM packages:

| Directory          | Package              | Responsibility                                                                                |
| ------------------ | -------------------- | --------------------------------------------------------------------------------------------- |
| `packages/schema`  | `@ruakit/schema`     | Strict Zod schemas and inferred types for planner requests, decisions, and execution results. |
| `packages/runtime` | `@ruakit/runtime`    | DOM observation, versioned targets, browser actions, and local action feedback.               |
| `packages/agent`   | `@ruakit/agent`      | Sessions, planner transport, request state, and the observe/plan/execute loop.                |
| `packages/react`   | `@ruakit/react`      | React hooks, the assistant toolbar, the controlled toolbar, styles, and the visual cursor.    |
| `packages/shared`  | No published package | Shared TypeScript configuration and build scripts.                                            |

`agent` depends on `runtime` and `schema`. `react` depends on `agent` and `schema`.
Keep `schema`, `runtime`, and `agent` independent of React and React DOM.
`@ruakit/runtime.createRuntime` provides browser primitives. `@ruakit/agent.createRuntime` provides agent orchestration.
Read the affected package's `README.md` before changing its behavior or public API.

## Development commands

Use the Node.js engine range and pnpm version declared in the root `package.json`.
Use pnpm for dependency changes. Keep `pnpm-lock.yaml` consistent with package manifests.

| Task                                   | Command from this repository root                          |
| -------------------------------------- | ---------------------------------------------------------- |
| Install dependencies                   | `pnpm install --frozen-lockfile`                           |
| Build all packages                     | `pnpm build`                                               |
| Check package types                    | `pnpm --filter './packages/**' -r typecheck`               |
| Build and run all unit tests           | `pnpm test`                                                |
| Build before focused tests             | `pnpm build:packages`                                      |
| Run one test file after building       | `pnpm exec vitest run packages/agent/test/session.test.ts` |
| Run one package's tests after building | `pnpm exec vitest run packages/react/test`                 |

Build before type checks or focused tests that depend on other packages.
Package exports resolve to `dist`, and several tests import built files directly.
Rebuild after source changes to prevent tests from using stale output.

The root `test:e2e` script references `@ruakit/e2e`, which is absent from this public checkout.
Do not report end-to-end coverage from that script unless the suite exists and actually runs.
ESLint and Prettier dependencies exist, but this checkout has no lint or format scripts or configuration.
Do not assume those checks exist because the tools appear in `package.json`.

## Implementation conventions

- Check Git status before editing. Preserve existing staged, unstaged, and untracked work.
- Change source files in `src` and tests in each package's `test` directory.
  Generate `dist` through the package build scripts.
- Follow the surrounding formatting. Avoid formatting unrelated code.
- Use `.js` extensions for relative TypeScript imports under NodeNext resolution.
  Use `import type` and `export type` for types.
- Preserve the strict compiler settings in `packages/shared/tsconfig.base.json`.
  Handle optional properties and indexed access explicitly.
- Treat external JSON as `unknown`. Parse protocol data with `@ruakit/schema` before use.
  Preserve strict object validation and payload bounds.
  Derive protocol types from the Zod schemas instead of maintaining duplicate interfaces.
- Coordinate protocol changes across schemas, producers, consumers, tests, and package documentation.
- Expose public APIs through the package entry points and `package.json` exports.
  Use workspace package imports across packages instead of importing another package's source files.
- Preserve Apache-2.0 source headers, package `LICENSE` and `NOTICE` files, and bundled dependency notices.

## Behavior to preserve

- Keep DOM observation and action targets within the configured runtime root.
  Preserve exclusions for password/file inputs, hidden content, and `data-ruakit-ignore` elements.
  Accessible names can reference hidden labels or labels outside the root. These labels do not create action targets.
- Require current, locally observed `{ id, version }` targets before executing actions.
  Revalidate after asynchronous delays that could change the page.
- Preserve session ownership of snapshots. Use the original snapshot object when applying a planner decision.
  Reject foreign or consumed snapshots. Never let snapshot edits authorize additional targets.
- Accept only the supported typed planner decisions and actions.
  Do not introduce planner-supplied JavaScript or arbitrary selector execution.
- Establish structured outcome checks before planning actions. Require every check to pass on the observed and current page before setting `goalCompleted: true`.
  Keep application verification optional. A triggered action alone does not establish completion.
- Preserve cancellation, deadlines, and one active operation per runtime or session.
  Prevent further actions after cancellation. Avoid automatic retries of actions that can produce duplicate effects.
- Preserve explicit cancellation, request deadlines, and unmount cleanup.
  Ordinary keyboard, pointer, and wheel input must not automatically cancel an active request.
- Keep progress and visual feedback observational. Callback failures must not authorize actions or change execution outcomes.
  Keep DOM references in local feedback events, outside serialized snapshots and planner requests.
- Keep imports and React rendering safe during server rendering.
  Access browser state through imperative methods after mounting.
- Preserve React Strict Mode cleanup, stable hook methods, and suppression of obsolete callbacks.
  Hooks for the same document must retain their shared session behavior.

## React packaging and UI

- Keep React, React DOM, and their JSX runtimes external to the bundle.
  Preserve compatibility with the declared React 18 and 19 peer ranges.
- Keep `@ruakit/react/toolbar` usable without loading agent orchestration.
  Agent state types can use type-only imports.
- Preserve the React build scripts that bundle UI dependencies, collect licenses, and copy CSS and CSS declarations.
  Preserve automatic stylesheet imports and the CSS `sideEffects` declaration.
- Scope styles to RuaKit elements. Avoid global resets and host application styling requirements.
- Preserve accessible control labels, focus behavior, reduced-motion support, and explicit cancellation.
  Decorative cursor overlays must allow page input and remain outside observations and the accessibility tree.
- Keep experimental pointer APIs under `@ruakit/runtime/experimental`.

## Validation and handoff

Add focused regression tests for behavior changes using Vitest and the existing package test patterns.
Use `// @vitest-environment jsdom` for DOM tests.
Restore mocks, timers, event listeners, and DOM fixtures after each test.
Check observable behavior rather than duplicating implementation details in assertions.

Run the affected tests after building their dependencies.
For changes across packages, run the full build, package type checks, and unit suite.
For documentation-only changes, check the documented paths and commands against the current repository.
Update package READMEs when public APIs, configuration, or behavior change.
Report the resulting behavior, checks actually completed, and any remaining failures or unavailable checks.
