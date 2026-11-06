// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSession, ClarificationNeededError } from '../src/index.js';
import type { Plan, PlannedStep, PlanPlanner, RuaKitTransport } from '../src/index.js';

const documentation: Plan = {
  id: 'documentation-plan',
  message: 'Documentation is open',
  steps: [{
    id: 'open-documentation', type: 'click', message: 'Open Documentation',
    target: { id: null, role: 'link', label: 'Documentation', context: null, group: null },
  }],
  checks: [{ type: 'url', description: 'Documentation is open', equals: 'https://docs.example/' }],
};

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
    () => [new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList,
  );
  document.body.innerHTML = '<a href="https://docs.example/" target="_blank">Documentation</a>';
  window.history.replaceState({}, '', '/');
});
afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

it.each(['direct', 'clarification', 'approval'] as const)(
  'finishes after a %s new-tab click without replanning',
  async (mode) => {
    const clicked = vi.fn();
    document.querySelector('a')!.addEventListener('click', clicked);
    const request = vi.fn<PlanPlanner>(async (input) => {
      if (mode === 'clarification' && !input.clarifications.length)
        return { type: 'clarify', message: 'What do you want to do?' };
      expect(input.replan).toBeNull();
      return mode === 'approval'
        ? { type: 'approval', message: 'Open Documentation?', plan: documentation }
        : documentation;
    });
    const onProgress = vi.fn();
    const onApproval = vi.fn(() => true);
    const task = createSession().createPlanTask();
    if (mode === 'clarification')
      await expect(task.request('Open Documentation', request)).rejects.toBeInstanceOf(ClarificationNeededError);
    const result = await task.request('Open Documentation', request, {
      onProgress, onApproval,
      clarifications: mode === 'clarification'
        ? [{ question: 'What do you want to do?', answer: 'Proceed' }] : [],
    });
    expect(result).toMatchObject({ status: 'triggered', planId: 'documentation-plan' });
    expect(result.goalCompleted).not.toBe(true);
    expect(result.verification).toBeUndefined();
    expect(clicked).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledTimes(mode === 'clarification' ? 2 : 1);
    expect(onApproval).toHaveBeenCalledTimes(mode === 'approval' ? 1 : 0);
    expect(onProgress.mock.calls.flat().join(' ')).not.toMatch(/page changed|replan/i);
    expect(task.canResume).toBe(false);
  },
);

it.each(['url', 'text'] as const)('finishes a supplied plan with an unobservable destination %s check', async (type) => {
  const verifyCompletion = vi.fn(() => true);
  const outcome = await createSession().executePlan({ ...documentation, checks: type === 'url'
    ? documentation.checks
    : [{ type: 'text', description: 'Documentation page content', text: 'Getting started', fresh: true }],
  }, { verifyCompletion });
  expect(outcome).toMatchObject({
    status: 'completed',
    completedSteps: [{ step: { id: 'open-documentation' }, navigation: { url: 'https://docs.example/', target: '_blank' } }],
    result: { status: 'triggered' },
  });
  if (outcome.status === 'completed') {
    expect(outcome.result.goalCompleted).not.toBe(true);
    expect(outcome.result.verification).toBeUndefined();
  }
  expect(verifyCompletion).not.toHaveBeenCalled();
});

it('verifies same-tab navigation normally after its own click changes the page', async () => {
  const link = document.querySelector('a')!;
  link.removeAttribute('target');
  link.href = '/docs';
  link.onclick = (event) => {
    event.preventDefault();
    window.history.pushState({}, '', '/docs');
  };
  const request = vi.fn<PlanPlanner>(async () => ({
    ...documentation,
    checks: [{ type: 'url', description: 'Documentation is open', equals: `${window.location.origin}/docs` }],
  }));
  const onProgress = vi.fn();
  const result = await createSession().createPlanTask().request('Open Documentation', request, { onProgress });
  expect(result.goalCompleted).toBe(true);
  expect(result.verification?.level).toBe('observed');
  expect(request).toHaveBeenCalledOnce();
  expect(onProgress.mock.calls.flat().join(' ')).not.toMatch(/page changed|replan/i);
});

it('still rejects invalid replacement IDs when a cancelled link activation leaves the outcome unmet', async () => {
  const clicked = vi.fn((event: Event) => event.preventDefault());
  document.querySelector('a')!.addEventListener('click', clicked);
  const request = vi.fn<PlanPlanner>(async () => documentation);
  await expect(createSession().createPlanTask().request('Open Documentation', request))
    .rejects.toMatchObject({ code: 'INVALID_PLAN' });
  expect(request).toHaveBeenCalledTimes(2);
  expect(clicked).toHaveBeenCalledOnce();
});

function profiles(): Plan {
  document.body.innerHTML = Array.from({ length: 5 }, (_, index) =>
    `<a href="https://profiles.example/${index}" target="_blank">Profile ${index + 1}</a>`,
  ).join('');
  return {
    ...documentation, id: 'profiles',
    steps: Array.from({ length: 5 }, (_, index): PlannedStep => ({
      ...documentation.steps[0]!, id: `profile-${index}`, type: 'click',
      target: { ...documentation.steps[0]!.target, label: `Profile ${index + 1}` },
    })),
  };
}

it('opens all five profiles and continues with later work in the original tab', async () => {
  const plan = profiles();
  document.body.insertAdjacentHTML('beforeend', '<button>Save</button><p></p>');
  const clicked = vi.fn();
  for (const link of document.querySelectorAll('a')) link.addEventListener('click', clicked);
  const saved = vi.fn(() => { document.querySelector('p')!.textContent = 'Settings saved'; });
  document.querySelector('button')!.onclick = saved;
  plan.steps.push({ id: 'save', type: 'click', message: 'Save settings',
    target: { id: null, role: 'button', label: 'Save', context: null, group: null } });
  plan.checks.push({ type: 'text', description: 'Settings saved', text: 'Settings saved', fresh: true });
  const request = vi.fn<PlanPlanner>(async () => plan);
  const result = await createSession().createPlanTask().request('Open five profiles, then save settings', request);
  expect(result.goalCompleted).not.toBe(true);
  expect(result.verification).toBeUndefined();
  expect(clicked).toHaveBeenCalledTimes(5);
  expect(saved).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledOnce();
});

it('still replans when a later target is unavailable after a new-tab click', async () => {
  const plan = profiles();
  const clicked = vi.fn();
  for (const link of document.querySelectorAll('a')) link.addEventListener('click', clicked);
  const missing: PlannedStep = { id: 'missing', type: 'click', message: 'Open missing link',
    target: { id: null, role: 'link', label: 'Missing', context: null, group: null } };
  const request = vi.fn<PlanPlanner>(async (input) => {
    if (!input.replan) return { ...plan, steps: [plan.steps[0]!, missing] };
    expect(input.replan.reason).toBe('target-unavailable');
    expect(input.replan.completedSteps).toMatchObject([{
      step: { id: 'profile-0' }, navigation: { url: 'https://profiles.example/0', target: '_blank' },
    }]);
    return { ...plan, id: 'remaining-profiles', steps: plan.steps.slice(1) };
  });
  const result = await createSession().createPlanTask().request('Open five profiles', request);
  expect(result.goalCompleted).not.toBe(true);
  expect(clicked).toHaveBeenCalledTimes(5);
  expect(request).toHaveBeenCalledTimes(2);
});

it("does not let a previous revision's new-tab receipt hide a later outcome mismatch", async () => {
  document.body.insertAdjacentHTML('beforeend', '<button>Save</button>');
  const request = vi.fn<PlanPlanner>(async (input) => ({
    ...documentation, id: `revision-${input.replan?.completedSteps.length ?? 0}`,
    steps: !input.replan ? [...documentation.steps, {
      id: 'missing', type: 'click', message: 'Open missing link',
      target: { id: null, role: 'link', label: 'Missing', context: null, group: null },
    }] : [{ id: 'save', type: 'click', message: 'Save settings',
      target: { id: null, role: 'button', label: 'Save', context: null, group: null } }],
  }));
  await expect(createSession().createPlanTask().request('Open Docs and save', request, { maxReplans: 1 }))
    .rejects.toMatchObject({ code: 'REPLAN_LIMIT' });
  expect(request).toHaveBeenCalledTimes(2);
});

it('verifies original-page outcomes normally when a plan also opens a new tab', async () => {
  document.body.insertAdjacentHTML('beforeend', '<p></p>');
  document.querySelector('a')!.onclick = () => { document.querySelector('p')!.textContent = 'Documentation requested'; };
  const verifyCompletion = vi.fn(() => true);
  const request = vi.fn<PlanPlanner>(async () => ({ ...documentation,
    checks: [{ type: 'text', description: 'Documentation requested', text: 'Documentation requested', fresh: true }],
  }));
  const result = await createSession().createPlanTask().request('Open Docs', request, { verifyCompletion });
  expect(result.goalCompleted).toBe(true);
  expect(result.verification?.level).toBe('confirmed');
  expect(verifyCompletion).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledOnce();
});

it('lets the decision planner choose all five clicks and completion from observed application feedback', async () => {
  profiles();
  document.body.insertAdjacentHTML('beforeend', '<p></p>');
  const clicked = vi.fn(() => {
    if (clicked.mock.calls.length === 5) document.querySelector('p')!.textContent = 'Five profile links requested';
  });
  for (const link of document.querySelectorAll('a')) link.addEventListener('click', clicked);
  const checks: Plan['checks'] = [{ type: 'text', description: 'Five profile links requested', text: 'Five profile links requested', fresh: true }];
  const request = vi.fn<RuaKitTransport['dom']>(async (input) => {
    if (!input.checks) return { type: 'prepare', message: 'Check profile requests', checks };
    const actions = input.history.filter((entry) => entry.type === 'act');
    if (actions.length) expect(actions.at(-1)).toHaveProperty('navigation');
    return actions.length === 5
      ? { type: 'complete', message: 'Five profile links requested', checks }
      : { type: 'act', message: 'Open profile', step: { type: 'click', target: input.snapshot.controls[actions.length]!.target } };
  });
  const result = await createSession().plan('Request five profile tabs', request);
  expect(result.goalCompleted).toBe(true);
  expect(clicked).toHaveBeenCalledTimes(5);
  expect(request).toHaveBeenCalledTimes(7);
});

it('lets an empty plan finish execution without claiming that unmet checks passed', async () => {
  const verifyCompletion = vi.fn(() => true);
  const result = await createSession().executePlan({ ...documentation, steps: [], message: 'No further actions available.' }, { verifyCompletion });
  expect(result.status).toBe('completed');
  if (result.status === 'completed') {
    expect(result.result.goalCompleted).not.toBe(true);
    expect(result.result.verification).toBeUndefined();
  }
  expect(verifyCompletion).not.toHaveBeenCalled();
});

it('honors cancellation after activation instead of returning a successful handoff', async () => {
  const controller = new AbortController();
  await expect(createSession().executePlan(documentation, {
    signal: controller.signal,
    onAction: (event) => { if (event.phase === 'after') controller.abort(); },
  })).rejects.toMatchObject({ name: 'AbortError' });
});
