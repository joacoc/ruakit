// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { expect, it } from 'vitest';
import { completedPlanStepSchema, decisionRequestSchema, decisionSchema } from '../src/index.js';

const navigation = { url: 'https://profiles.example/1', target: '_blank' };
const step = { id: 'profile-1', type: 'click', message: 'Open profile',
  target: { id: null, role: 'link', label: 'Profile 1', context: null, group: null } };

it('accepts bounded navigation receipts only on completed clicks', () => {
  const entry = { planId: 'profiles', step, navigation };
  expect(completedPlanStepSchema.parse(entry)).toEqual(entry);
  for (const invalid of [
    { ...navigation, target: '_self' },
    { ...navigation, url: 'javascript:alert(1)' },
    { ...navigation, url: `https://profiles.example/${'x'.repeat(4000)}` },
    { ...navigation, opened: true },
  ]) expect(completedPlanStepSchema.safeParse({ ...entry, navigation: invalid }).success).toBe(false);
  expect(completedPlanStepSchema.safeParse({ ...entry, step: { ...step, type: 'focus' } }).success).toBe(false);
});

it('accepts navigation in executed decision history without accepting model-supplied navigation claims', () => {
  const decision = { type: 'act', message: 'Open profile', step: { type: 'click', target: { id: 'profile-1', version: 1 } } };
  const entry = { ...decision, navigation };
  const request = { prompt: 'Open five profiles', clarifications: [],
    snapshot: { url: 'https://app.example/', title: '', text: '', controls: [], focused: null, truncated: false },
    history: [entry],
  };
  expect(decisionRequestSchema.parse(request).history).toEqual([entry]);
  expect(decisionSchema.safeParse(entry).success).toBe(false);
  expect(decisionRequestSchema.safeParse({ ...request, history: [{ ...entry, step: { ...decision.step, type: 'focus' } }] }).success).toBe(false);
});
