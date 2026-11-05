// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createSession,
  createPlanTransport,
  ClarificationNeededError,
} from '../src/index.js';
import type {
  Plan,
  PlannedStep,
  PlanRequest,
  PlanPlanner,
} from '../src/index.js';

const name = {
  id: null,
  role: 'textbox',
  label: 'Name',
  context: null,
  group: null,
};
const button = (label: string) => ({
  id: null,
  role: 'button',
  label,
  context: null,
  group: null,
});
const checks: Plan['checks'] = [
  { type: 'value', description: 'Name is Ana', control: name, equals: 'Ana' },
];
const fill: PlannedStep = {
  id: 'fill-name',
  type: 'fill',
  message: 'Enter name',
  target: name,
  value: 'Ana',
};
const plan = (steps: PlannedStep[], id = 'plan-1'): Plan => ({
  id,
  message: 'Name updated',
  steps,
  checks,
});

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
    () => [new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList,
  );
  document.body.innerHTML = '<label>Name<input /></label>';
});
afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
  vi.restoreAllMocks();
});

it('executes several steps, resolving controls revealed by earlier actions without another planner call', async () => {
  document.body.innerHTML = '<button>Settings</button>';
  document.querySelector('button')!.onclick = () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<label>Name<input /></label>',
    );
  };
  const request = vi.fn<PlanPlanner>(async () =>
    plan(
      [
        {
          id: 'open',
          type: 'click',
          message: 'Open settings',
          target: button('Settings'),
        },
        fill,
      ],
      'backend-id',
    ),
  );
  const result = await createSession()
    .createPlanTask()
    .request('Enter Ana', request);
  expect(document.querySelector('input')!.value).toBe('Ana');
  expect(request).toHaveBeenCalledOnce();
  expect(result).toMatchObject({
    planId: 'backend-id',
    goalCompleted: true,
    verification: { level: 'observed' },
  });
});

it('reports a missing or ambiguous target without executing it or contacting a backend', async () => {
  document.body.innerHTML =
    '<label>Name<input /></label><label>Name<input /></label>';
  const result = await createSession().executePlan(plan([fill]));
  expect(result).toMatchObject({
    status: 'needs-replan',
    replan: {
      reason: 'target-unavailable',
      failedStepId: 'fill-name',
      completedSteps: [],
    },
  });
  expect(
    [...document.querySelectorAll('input')].map((input) => input.value),
  ).toEqual(['', '']);
});

it('replans from fresh state with locked checks, completed steps and linked backend IDs', async () => {
  document.body.innerHTML = '<button>Settings</button>';
  const clicked = vi.fn(() =>
    document.body.insertAdjacentHTML(
      'beforeend',
      '<label>Name<input /></label>',
    ),
  );
  document.querySelector('button')!.onclick = clicked;
  const seen: PlanRequest[] = [];
  const request: PlanPlanner = async (input) => {
    seen.push(input);
    return input.replan
      ? {
          ...plan([fill], 'plan-2'),
          replacesPlanId: 'plan-1',
        }
      : plan([
          {
            id: 'open',
            type: 'click',
            message: 'Open settings',
            target: button('Settings'),
          },
          { ...fill, target: { ...name, label: 'Old name' } },
        ]);
  };
  const result = await createSession()
    .createPlanTask()
    .request('Enter Ana', request, { context: { userId: '1' } });
  expect(result.planId).toBe('plan-2');
  expect(seen).toHaveLength(2);
  expect(seen[1]).toMatchObject({
    context: { userId: '1' },
    checks,
    replan: { planId: 'plan-1', completedSteps: [{ step: { id: 'open' } }] },
  });
  expect(
    seen[1]!.snapshot.controls.some((control) => control.label === 'Name'),
  ).toBe(true);
  expect(clicked).toHaveBeenCalledOnce();
});

it('retains the baseline and progress while a replanning task waits for clarification', async () => {
  const rua = createSession();
  const task = rua.createPlanTask();
  let calls = 0;
  const request: PlanPlanner = async (input) => {
    if (++calls === 1)
      return plan([{ ...fill, target: { ...name, label: 'Missing' } }]);
    if (!input.clarifications.length)
      return { type: 'clarify', message: 'Use Name?' };
    expect(input.replan?.planId).toBe('plan-1');
    expect(input.checks).toEqual(checks);
    return { ...plan([fill], 'plan-2'), replacesPlanId: 'plan-1' };
  };
  await expect(task.request('Enter Ana', request)).rejects.toBeInstanceOf(
    ClarificationNeededError,
  );
  const result = await task.request('Enter Ana', request, {
    clarifications: [{ question: 'Use Name?', answer: 'Yes' }],
  });
  expect(result.goalCompleted).toBe(true);
});

it.each(['checks', 'id', 'lineage', 'replay'])(
  'rejects a replacement plan with invalid %s',
  async (kind) => {
    document.body.insertAdjacentHTML('beforeend', '<button>Open</button>');
    const clicked = vi.fn();
    document.querySelector('button')!.onclick = clicked;
    const open: PlannedStep = {
      id: 'open',
      type: 'click',
      message: 'Open',
      target: button('Open'),
    };
    const request: PlanPlanner = async (input) => {
      if (!input.replan)
        return plan([open, { ...fill, target: { ...name, label: 'Missing' } }]);
      const next = { ...plan([fill], 'plan-2'), replacesPlanId: 'plan-1' };
      if (kind === 'checks')
        return { ...next, checks: [{ ...checks[0]!, equals: 'Eve' }] };
      if (kind === 'id') return { ...next, id: 'plan-1' };
      if (kind === 'lineage') return { ...next, replacesPlanId: 'unrelated' };
      return { ...next, steps: [{ ...open, id: 'replayed-open' }, fill] };
    };
    await expect(
      createSession().createPlanTask().request('Enter Ana', request),
    ).rejects.toMatchObject({ code: 'INVALID_PLAN' });
    expect(clicked).toHaveBeenCalledOnce();
  },
);

it('bounds replanning and never claims success from a dispatched action alone', async () => {
  const request = vi.fn<PlanPlanner>(async (input) => ({
    ...plan([], `plan-${input.replan ? 2 : 1}`),
    ...(input.replan ? { replacesPlanId: input.replan.planId } : {}),
  }));
  await expect(
    createSession()
      .createPlanTask()
      .request('Enter Ana', request, { maxReplans: 1 }),
  ).rejects.toMatchObject({ code: 'REPLAN_LIMIT' });
  expect(request).toHaveBeenCalledTimes(2);
});

it('holds the shared session while planning and stops waiting on cancellation', async () => {
  const rua = createSession();
  const controller = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = rua.createPlanTask().request(
    'Enter Ana',
    async () => {
      started();
      return new Promise(() => {});
    },
    { signal: controller.signal },
  );
  await ready;
  await expect(rua.executePlan(plan([fill]))).rejects.toMatchObject({
    code: 'BUSY',
  });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(document.querySelector('input')!.value).toBe('');
});

it.each(['', '/planner'])('uses /v1/plan for full plans and context with base URL "%s"', async (base) => {
  document.head.innerHTML = base
    ? `<meta name="ruakit-config" content='${JSON.stringify({ serverUrl: base })}' />`
    : '';
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json(plan([fill], 'http-plan')),
  );
  const transport = createPlanTransport({ document, fetch: fetcher });
  const result = await createSession()
    .createPlanTask()
    .request('Enter Ana', transport.plan, { context: { userId: '1' } });
  expect(result.planId).toBe('http-plan');
  expect(fetcher.mock.calls[0]![0]).toBe(`${base}/v1/plan`);
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toMatchObject({
    protocol: 'plan',
    context: { userId: '1' },
  });
});

it('requires the application verifier to confirm outcomes and prevents late actions', async () => {
  const rua = createSession();
  const controller = new AbortController();
  await expect(
    rua.executePlan(plan([fill]), { verifyCompletion: () => false }),
  ).rejects.toMatchObject({ code: 'VERIFICATION_FAILED' });
  document.querySelector('input')!.value = '';
  const pending = rua.executePlan(plan([fill]), {
    actionDelayMs: 100,
    signal: controller.signal,
  });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(document.querySelector('input')!.value).toBe('');
});
