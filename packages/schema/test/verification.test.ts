// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { expect, it } from 'vitest';
import { completionChecksSchema, evaluateCompletionChecks, screenshotSchema } from '../src/index.js';
import type { CompletionCheck, VerificationState } from '../src/index.js';

const control = {
  id: null,
  role: 'textbox',
  label: 'Name',
  context: null,
  group: null,
};
const page: VerificationState = {
  url: 'https://app.test/profile',
  text: 'Profile saved',
  truncated: false,
  controls: [
    {
      target: { id: 'name', version: 2 },
      role: 'textbox',
      label: 'Name',
      context: '',
      value: 'Ada',
    },
  ],
};
it('requires every outcome and rejects ambiguous control matches', () => {
  const checks: CompletionCheck[] = [
    { type: 'value', description: 'Name is Ada', control, equals: 'Ada' },
  ];
  expect(evaluateCompletionChecks(checks, page).passed).toBe(true);
  expect(
    evaluateCompletionChecks(checks, {
      ...page,
      controls: [...page.controls, ...page.controls],
    }).passed,
  ).toBe(false);
  expect(
    evaluateCompletionChecks(
      [
        ...checks,
        {
          type: 'url',
          description: 'Billing is open',
          equals: 'https://app.test/billing',
        },
      ],
      page,
    ).passed,
  ).toBe(false);
});
it('distinguishes new success text from a preexisting acknowledgement', () => {
  const checks: CompletionCheck[] = [
    {
      type: 'text',
      description: 'Save acknowledged',
      text: 'Profile saved',
      fresh: true,
    },
  ];
  expect(evaluateCompletionChecks(checks, page, { ...page, text: '' }).passed).toBe(true);
  expect(evaluateCompletionChecks(checks, page, page).passed).toBe(false);
});
it('does not prove absence from truncated state or a remounted matching item', () => {
  const checks: CompletionCheck[] = [
    {
      type: 'absent',
      description: 'Name removed',
      control: { ...control, id: 'old-name' },
    },
  ];
  expect(evaluateCompletionChecks(checks, page).passed).toBe(false);
  expect(evaluateCompletionChecks(checks, { ...page, controls: [], truncated: true }).passed).toBe(
    false,
  );
  expect(evaluateCompletionChecks(checks, { ...page, controls: [] }).passed).toBe(true);
});
it('rejects empty, excessive, mixed and unstructured outcome requirements', () => {
  for (const checks of [
    [],
    Array(21).fill({ type: 'url', description: 'Open page', equals: page.url }),
    [{ type: 'label', description: 'Save', text: 'Save' }],
    [{ type: 'text', description: 'Save', text: ' ', fresh: false }],
  ]) {
    expect(completionChecksSchema.safeParse(checks).success).toBe(false);
  }
});

it('rejects an image whose bytes do not match its advertised type', () => {
  expect(screenshotSchema.safeParse({
    data: 'aGVsbG8=', mimeType: 'image/png', width: 1, height: 1,
    capturedAt: 1, url: page.url,
  }).success).toBe(false);
});
