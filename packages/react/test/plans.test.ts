// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { act, createElement, StrictMode, useEffect } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePlan, useRua, useRun } from '../dist/index.js';
import type {
  Plan,
  RequestPlan,
  RuaAgent,
  RuaPlan,
  RequestOutcome,
} from '../dist/index.js';

const target = {
  id: null,
  role: 'textbox',
  label: 'Name',
  context: null,
  group: null,
};
const plan: Plan = {
  id: 'backend-plan',
  message: 'Name updated',
  steps: [
    { id: 'name', type: 'fill', message: 'Enter name', target, value: 'Ana' },
  ],
  checks: [
    {
      type: 'value',
      description: 'Name entered',
      control: target,
      equals: 'Ana',
    },
  ],
};
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
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mount(Component: () => ReactElement | null, strict = false) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.add(root);
  await act(async () =>
    root.render(
      strict
        ? createElement(StrictMode, null, createElement(Component))
        : createElement(Component),
    ),
  );
  return root;
}

it('prepares supplied plans without side effects and executes only when explicitly called', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  let executor!: RuaPlan;
  function Consumer() {
    executor = usePlan(plan);
    return null;
  }
  expect(renderToString(createElement(Consumer))).toBe('');
  await mount(Consumer, true);
  expect(document.querySelector('input')!.value).toBe('');
  expect(fetcher).not.toHaveBeenCalled();
  const method = executor.execute;
  await act(async () => {
    const outcome = await executor.execute();
    expect(outcome).toMatchObject({
      status: 'completed',
      result: { planId: 'backend-plan', goalCompleted: true },
    });
  });
  expect(executor.execute).toBe(method);
  expect(document.querySelector('input')!.value).toBe('Ana');
  expect(executor.loading).toBe(false);
  expect(executor.action).toBeNull();
});

it('adopts a replacement prop without executing it during the render', async () => {
  let executor!: RuaPlan;
  function Consumer({ value }: { value: Plan | null }) {
    executor = usePlan(value);
    return null;
  }
  const root = await mount(() => createElement(Consumer, { value: null }));
  await expect(executor.execute()).rejects.toMatchObject({
    code: 'INVALID_PLAN',
  });
  await act(async () => root.render(createElement(Consumer, { value: plan })));
  expect(document.querySelector('input')!.value).toBe('');
  await act(async () => {
    await executor.execute();
  });
  expect(document.querySelector('input')!.value).toBe('Ana');
});

it('uses the default backend with context and exposes the backend plan ID', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(plan));
  let rua!: RuaAgent<{ workspaceId: string }>;
  await mount(() => {
    rua = useRua({ fetch: fetcher, context: { workspaceId: 'workspace-1' } });
    return null;
  });
  let result!: RequestOutcome;
  await act(async () => {
    result = await rua.execute({ prompt: 'Enter Ana' });
  });
  expect(result).toMatchObject({
    status: 'completed',
    result: { planId: plan.id },
  });
  expect(rua.currentPlan?.id).toBe(plan.id);
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toMatchObject({
    protocol: 'plan',
    context: { workspaceId: 'workspace-1' },
  });
  expect(fetcher).toHaveBeenCalledOnce();
});

it('retains the original planner and context through replanning and clarification', async () => {
  const context = { conversationId: 'chat-1' };
  const request = vi.fn<RequestPlan<typeof context>>(
    async (input, ctx, _signal, identity) => {
      expect(ctx).toBe(context);
      expect(identity.operationId).toBeTruthy();
      if (!input.replan)
        return {
          ...plan,
          steps: [
            { ...plan.steps[0]!, target: { ...target, label: 'Missing' } },
          ],
        };
      if (!input.clarifications.length)
        return { type: 'clarify', message: 'Use Name?' };
      expect(input.checks).toEqual(plan.checks);
      return { ...plan, id: 'replacement-plan', replacesPlanId: plan.id };
    },
  );
  let rua!: RuaAgent<typeof context>;
  await mount(() => {
    rua = useRua({ request });
    return null;
  });
  let first!: RequestOutcome;
  await act(async () => {
    first = await rua.execute({ prompt: 'Enter Ana', context });
  });
  expect(first.status).toBe('needs-input');
  let final!: RequestOutcome;
  await act(async () => {
    final = await rua.respond({
      operationId: first.operationId,
      answer: 'Yes',
    });
  });
  expect(final).toMatchObject({
    status: 'completed',
    operationId: first.operationId,
    result: { planId: 'replacement-plan' },
  });
  expect(rua.currentPlan?.id).toBe('replacement-plan');
  expect(request).toHaveBeenCalledTimes(3);
});

it('cancels unmounted planners and ignores a plan returned after cancellation', async () => {
  let release!: (plan: Plan) => void;
  let signal!: AbortSignal;
  let rua!: RuaAgent;
  const root = await mount(() => {
    rua = useRua({
      request: async (_input, _context, abort) => {
        signal = abort;
        return new Promise<Plan>((resolve) => {
          release = resolve;
        });
      },
    });
    return null;
  });
  let pending!: Promise<RequestOutcome>;
  await act(async () => {
    pending = rua.execute({ prompt: 'Enter Ana' });
  });
  await act(async () => root.unmount());
  roots.delete(root);
  expect(signal.aborted).toBe(true);
  release(plan);
  expect(await pending).toMatchObject({
    status: 'cancelled',
    reason: 'unmounted',
  });
  expect(document.querySelector('input')!.value).toBe('');
});

it('releases cancelled Strict Mode execution before starting the replacement effect', async () => {
  const effects: Promise<unknown>[] = [];
  await mount(() => {
    const executor = usePlan(plan, { actionDelayMs: 1 });
    useEffect(() => {
      effects.push(executor.execute().catch((error: unknown) => error));
      return executor.cancel;
    }, [executor.execute, executor.cancel]);
    return null;
  }, true);
  await act(async () => {
    await Promise.all(effects);
  });
  expect(document.querySelector('input')!.value).toBe('Ana');
});

it('keeps single-decision hooks available alongside the plan executor', async () => {
  let runner!: ReturnType<typeof useRun>;
  await mount(() => {
    runner = useRun();
    usePlan(plan);
    useRua();
    return null;
  });
  expect(typeof runner.run).toBe('function');
});
