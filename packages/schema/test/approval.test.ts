// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
import { expect, it } from 'vitest';
import { decisionSchema, planResponseSchema } from '../src/index.js';

const step = { type: 'click', target: { id: 'control-1', version: 1 } };
const approval = {
  type: 'approval',
  message: 'Permanently delete Alpha?',
  step,
};
it('requires an exact supported action and rejects model-supplied consent', () => {
  expect(decisionSchema.parse(approval)).toEqual(approval);
  for (const value of [
    { type: 'approval', message: approval.message },
    { ...approval, message: ' ' },
    { ...approval, message: 'x'.repeat(2001) },
    { ...approval, approved: true },
    { ...approval, step: { type: 'click', selector: '#delete' } },
    { ...approval, step: { ...step, target: { id: 'control-1', version: 0 } } },
  ])
    expect(decisionSchema.safeParse(value).success).toBe(false);
  expect(
    decisionSchema.safeParse({
      type: 'clarify',
      message: 'Which project?',
      step,
    }).success,
  ).toBe(false);
});

it('binds plan approval to a strict concrete plan with outcomes and a revision ID', () => {
  const plan = {
    id: 'plan-1',
    message: 'Alpha removed',
    steps: [
      {
        id: 'delete',
        message: 'Delete Alpha',
        type: 'click',
        target: {
          id: 'control-1',
          role: 'button',
          label: 'Delete Alpha',
          context: null,
          group: null,
        },
      },
    ],
    checks: [
      {
        type: 'text',
        description: 'Deletion acknowledged',
        text: 'Alpha deleted',
        fresh: true,
      },
    ],
  };
  const value = { type: 'approval', message: approval.message, plan };
  expect(planResponseSchema.parse(value)).toEqual(value);
  for (const invalid of [
    { ...value, approved: true },
    { ...value, plan: { ...plan, id: '' } },
    { ...value, plan: { ...plan, checks: [] } },
    {
      ...value,
      plan: { ...plan, steps: [{ type: 'eval', code: 'deleteEverything()' }] },
    },
  ])
    expect(planResponseSchema.safeParse(invalid).success).toBe(false);
});
