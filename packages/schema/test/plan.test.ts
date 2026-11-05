// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
import { expect, it } from 'vitest';
import { planSchema, planRequestSchema } from '../src/index.js';

const target = {
  id: null,
  role: 'textbox',
  label: 'Name',
  context: null,
  group: null,
};
const plan = {
  id: 'plan-1',
  message: 'Name updated',
  steps: [
    { id: 'name', message: 'Enter name', type: 'fill', target, value: 'Ana' },
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
it('requires plan IDs, unique step IDs, typed actions and completion criteria', () => {
  expect(planSchema.safeParse(plan).success).toBe(true);
  expect(planSchema.safeParse({ ...plan, id: '' }).success).toBe(false);
  expect(
    planSchema.safeParse({ ...plan, steps: [plan.steps[0], plan.steps[0]] })
      .success,
  ).toBe(false);
  expect(planSchema.safeParse({ ...plan, checks: [] }).success).toBe(false);
  expect(planSchema.safeParse({ ...plan, script: 'alert(1)' }).success).toBe(
    false,
  );
  expect(
    planSchema.safeParse({
      ...plan,
      steps: [{ ...plan.steps[0], selector: 'input' }],
    }).success,
  ).toBe(false);
  expect(
    planSchema.safeParse({
      ...plan,
      steps: [{ ...plan.steps[0], target: { id: 'node', version: 1 } }],
    }).success,
  ).toBe(false);
});
it('accepts bounded JSON context and rejects cyclic, non-JSON and oversized values', () => {
  const request = {
    protocol: 'plan',
    prompt: 'Enter name',
    checks: null,
    replan: null,
    clarifications: [],
    snapshot: {
      url: '/',
      title: '',
      text: '',
      controls: [],
      focused: null,
      truncated: false,
    },
  };
  expect(
    planRequestSchema.safeParse({
      ...request,
      context: { userId: 'user-1', choices: [1, true, null] },
    }).success,
  ).toBe(true);
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  for (const context of [
    cyclic,
    new Date(),
    { callback: () => {} },
    { value: Infinity },
    'x'.repeat(32769),
  ])
    expect(planRequestSchema.safeParse({ ...request, context }).success).toBe(
      false,
    );
});
