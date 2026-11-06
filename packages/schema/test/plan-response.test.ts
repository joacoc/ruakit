// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { afterEach, expect, it, vi } from 'vitest';
import {
  planDraftResponseSchema,
  planResponseSchema,
} from '../src/index.js';

const draft = {
  message: 'Enter Ana',
  steps: [{
    id: 'name', type: 'fill', message: 'Enter name', value: 'Ana',
    target: { id: null, role: 'textbox', label: 'Name', context: null, group: null },
  }],
  checks: [{
    type: 'value', description: 'Name is Ana', equals: 'Ana',
    control: { id: null, role: 'textbox', label: 'Name', context: null, group: null },
  }],
};
const approval = { type: 'approval', message: 'Enter this name?', plan: draft };
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

afterEach(() => vi.restoreAllMocks());

it('assigns fresh UUID v4 IDs to every ordinary and approval plan without parent metadata', () => {
  const plans = [draft, approval, draft].map((value) => {
    const response = planResponseSchema.parse(value);
    expect(planResponseSchema.safeParse(response).success).toBe(true);
    const plan = 'id' in response ? response : response.type === 'approval' ? response.plan : undefined;
    if (!plan) throw new Error('Expected an ordinary or approval plan.');
    expect(plan.id).toMatch(uuidV4);
    expect(Object.keys(plan).sort()).toEqual(['checks', 'id', 'message', 'steps']);
    expect(plan.steps).toEqual(draft.steps);
    expect(plan.checks).toEqual(draft.checks);
    expect(planResponseSchema.parse(response)).toEqual(response);
    return plan;
  });
  expect(new Set(plans.map((plan) => plan.id)).size).toBe(3);
});

it('converts the model schema without generating UUIDs or exposing plan identity fields', () => {
  const random = vi.spyOn(globalThis.crypto, 'randomUUID');
  const schema = planDraftResponseSchema.toJSONSchema();
  const plans = [schema.anyOf?.[0], schema.anyOf?.[1]?.properties?.plan];
  for (const plan of plans) {
    if (!plan || typeof plan !== 'object') throw new Error('Expected an object schema for plan content.');
    expect(Object.keys(plan.properties ?? {}).sort()).toEqual(['checks', 'message', 'steps']);
    expect(plan.required?.slice().sort()).toEqual(['checks', 'message', 'steps']);
  }
  expect(random).not.toHaveBeenCalled();
});

it.each(['id', 'replacesPlanId', 'parentPlanId', 'needsNewId'])(
  'rejects model-supplied %s on ordinary and approval plans', (key) => {
    const plan = { ...draft, [key]: key === 'needsNewId' ? true : 'model-id' };
    expect(() => planDraftResponseSchema.parse(plan)).toThrow();
    expect(() => planDraftResponseSchema.parse({ ...approval, plan })).toThrow();
  },
);

it.each(['replacesPlanId', 'parentPlanId'])(
  'rejects the obsolete %s field in browser responses', (key) => {
    const plan = { ...draft, id: 'revision', [key]: 'previous' };
    expect(planResponseSchema.safeParse(plan).success).toBe(false);
    expect(planResponseSchema.safeParse({ ...approval, plan }).success).toBe(false);
  },
);

it.each(['clarify', 'screenshot', 'unsupported'])(
  'leaves %s responses without a plan ID', (type) => {
    const random = vi.spyOn(globalThis.crypto, 'randomUUID');
    const response = { type, message: 'More information is needed.' };
    expect(planResponseSchema.parse(response)).toEqual(response);
    expect(random).not.toHaveBeenCalled();
  },
);
