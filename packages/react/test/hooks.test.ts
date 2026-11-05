// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { act, createElement, StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRua, useRun, useSnapshot } from '../dist/index.js';
import type {
  ExecutionResult,
  PlanRequest,
  Plan,
  PageState,
  RuaAgent,
  RuaRun,
  RequestPlan,
} from '../dist/index.js';

const roots = new Set<Root>();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
    () => [new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList,
  );
  document.body.innerHTML = '<label>Name<input /></label>';
});
afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.clear();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.head.replaceChildren();
  vi.restoreAllMocks();
});

async function mount(Component: () => null, strict = false) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.add(root);
  await act(async () =>
    root.render(
      strict ? createElement(StrictMode, null, createElement(Component)) : createElement(Component),
    ),
  );
  return root;
}

it('shares the runtime between snapshot and run hooks in separate components', async () => {
  let snapshot!: () => PageState;
  let runner!: RuaRun;
  function Observer() {
    snapshot = useSnapshot();
    return null;
  }
  function Executor() {
    runner = useRun();
    return null;
  }
  await mount(Observer);
  await mount(Executor);
  expect(runner.loading).toBe(false);
  const observed = snapshot();
  await act(async () => {
    await runner.run(
      {
        type: 'act',
        message: 'Fill',
        step: {
          type: 'fill',
          target: observed.controls[0]!.target,
          value: 'Ana',
        },
      },
      { snapshot: observed },
    );
  });
  expect(document.querySelector('input')!.value).toBe('Ana');
  expect(runner.state.status).toBe('triggered');
  expect(runner.loading).toBe(false);
  expect(runner.action).toBeNull();
});

it('executes a full plan that reveals controls with one backend request', async () => {
  document.body.innerHTML = '<button>Settings</button>';
  document.querySelector('button')!.addEventListener('click', () => {
    document.body.insertAdjacentHTML('beforeend', '<label>Name<input /></label>');
  });
  const context = { userId: 'user-1' };
  const seen: PlanRequest[] = [];
  const request = vi.fn<RequestPlan<typeof context>>(async (input, ctx, signal) => {
    expect(ctx).toBe(context);
    expect(signal.aborted).toBe(false);
    seen.push(input);
    const name = { id: null, role: 'textbox', label: 'Name', context: null, group: null };
    return {
      id: 'change-name', message: 'Name changed.',
      steps: [
        { id: 'open', type: 'click', message: 'Open settings', target: { ...name, role: 'button', label: 'Settings' } },
        { id: 'name', type: 'fill', message: 'Fill name', target: name, value: 'Ana' },
      ],
      checks: [{ type: 'value', description: 'Expected field value', control: name, equals: 'Ana' }],
    };
  });
  let planner!: RuaAgent<typeof context>;
  await mount(() => { planner = useRua({ request }); return null; });
  await act(async () => {
    await expect(planner.submit('Change my name to Ana', context)).resolves.toMatchObject({ goalCompleted: true });
  });
  expect(seen).toHaveLength(1);
  expect(seen[0]!.snapshot.controls).toHaveLength(1);
  expect(document.querySelector('input')!.value).toBe('Ana');
  expect(planner.state.status).toBe('triggered');
});

it('retains the original context and planner through clarification and rerenders', async () => {
  const context = { userId: 'user-1' };
  const calls = vi.fn();
  let planner!: RuaAgent<typeof context>;
  await mount(() => {
    // A new callback on each render must not make answering a question impossible.
    planner = useRua({
      request: async (input, ctx) => {
        calls(ctx);
        if (!input.clarifications.length) return { type: 'clarify', message: 'Which name?' };
        expect(input.prompt).toBe('Change name');
        expect(input.clarifications).toEqual([{ question: 'Which name?', answer: 'Ana' }]);
        return {
          id: 'checked-plan',
          steps: [],
          message: 'Ready',
          checks: [
            {
              type: 'value',
              description: 'Expected field value',
              control: { id: null, role: 'textbox', label: 'Name', context: null, group: null },
              equals: '',
            },
          ],
        };
      },
    });
    return null;
  });
  await act(async () => {
    await planner.submit('Change name', context);
  });
  expect(planner.state.status).toBe('clarification');
  await act(async () => {
    await planner.answer('Ana');
  });
  expect(planner.state.status).toBe('triggered');
  expect(calls).toHaveBeenCalledTimes(2);
  expect(calls.mock.calls.every(([ctx]) => ctx === context)).toBe(true);
});

it('keeps the default request hook connected to the plan HTTP protocol', async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          id: 'checked-plan',
          steps: [],
          message: 'Ready',
          checks: [
            {
              type: 'value',
              description: 'Expected field value',
              control: { id: null, role: 'textbox', label: 'Name', context: null, group: null },
              equals: '',
            },
          ],
        }),
      ),
  );
  let request!: ReturnType<typeof useRua>;
  await mount(() => {
    request = useRua({ fetch: fetcher, serverUrl: '/rua' });
    return null;
  });
  await act(async () => {
    await request.submit('Read name');
  });
  expect(request.state.status).toBe('triggered');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]![0]).toBe('/rua/v1/plan');
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toMatchObject({
    prompt: 'Read name',
    protocol: 'plan', checks: null, replan: null,
    clarifications: [],
  });
});

it('aborts an unmounted planner and discards a late action', async () => {
  let planner!: RuaAgent;
  let signal!: AbortSignal;
  let release!: (decision: Plan) => void;
  let input!: PlanRequest;
  const root = await mount(() => {
    planner = useRua({
      request: (request, _ctx, currentSignal) => {
        input = request;
        signal = currentSignal;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    return null;
  });
  let pending!: Promise<ExecutionResult | undefined>;
  await act(async () => {
    pending = planner.submit('Change name');
  });
  await act(async () => root.unmount());
  roots.delete(root);
  expect(signal.aborted).toBe(true);
  release({
    id: 'late-plan', message: 'Fill',
    steps: [{ id: 'name', type: 'fill', message: 'Fill',
      target: { id: null, role: input.snapshot.controls[0]!.role, label: input.snapshot.controls[0]!.label, context: null, group: null }, value: 'Ana' }],
    checks: [{ type: 'value', description: 'Name entered', control: { id: null, role: 'textbox', label: 'Name', context: null, group: null }, equals: 'Ana' }],
  });
  expect(await pending).toBeUndefined();
  expect(document.querySelector('input')!.value).toBe('');
});

it('restarts an effect-driven plan after Strict Mode cancels its first setup', async () => {
  let planner!: RuaAgent;
  const pending: Promise<ExecutionResult | undefined>[] = [];
  await mount(() => {
    planner = useRua({
      request: async () => ({
        id: 'checked-plan',
          steps: [],
        message: 'Ready',
        checks: [
          {
            type: 'value',
            description: 'Expected field value',
            control: { id: null, role: 'textbox', label: 'Name', context: null, group: null },
            equals: '',
          },
        ],
      }),
    });
    useEffect(() => {
      pending.push(planner.submit('Read name'));
    }, []);
    return null;
  }, true);
  await act(async () => {
    await Promise.all(pending);
  });
  expect(pending).toHaveLength(2);
  expect(await pending[0]).toBeUndefined();
  expect(await pending[1]).toMatchObject({ goalCompleted: true });
  expect(planner.state.status).toBe('triggered');
});

it('cancels a manual action without changing the field', async () => {
  let snapshot!: () => PageState;
  let runner!: RuaRun;
  await mount(() => {
    snapshot = useSnapshot();
    runner = useRun({ actionDelayMs: 10000 });
    return null;
  });
  const observed = snapshot();
  let pending!: Promise<ExecutionResult>;
  await act(async () => {
    pending = runner.run(
      {
        type: 'act',
        message: 'Fill',
        step: {
          type: 'fill',
          target: observed.controls[0]!.target,
          value: 'Ana',
        },
      },
      { snapshot: observed },
    );
  });
  expect(runner.loading).toBe(true);
  await act(async () => {
    const rejection = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    runner.cancel();
    await rejection;
  });
  expect(document.querySelector('input')!.value).toBe('');
  expect(runner.state.status).toBe('cancelled');
  expect(runner.loading).toBe(false);
  expect(runner.action).toBeNull();
});

it('renders all primitive hooks on the server without observing the page', () => {
  vi.stubGlobal('document', undefined);
  const html = renderToString(
    createElement(() => {
      useSnapshot();
      useRun();
      useRua();
      return createElement('span', null, 'Ready');
    }),
  );
  expect(html).toContain('Ready');
});
