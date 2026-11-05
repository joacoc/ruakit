// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
import { expect, it } from 'vitest';
import {
  clarificationSchema,
  decisionSchema,
  decisionRequestSchema,
  resultSchema,
} from '../src/index.js';

const target = { id: 'control-1', version: 1 };
const control = {
  target,
  tag: 'input',
  role: 'textbox',
  label: 'Name',
  context: 'Profile',
  enabled: true,
  readOnly: false,
};
const request = {
  prompt: 'Enter Ada',
  clarifications: [],
  snapshot: {
    url: 'https://app.example/',
    title: 'Profile',
    text: 'Name',
    controls: [control],
    focused: null,
    truncated: false,
  },
  history: [],
};

it('accepts live observations with bounded semantic groups and clarification answers', () => {
  expect(decisionRequestSchema.safeParse(request).success).toBe(true);
  const groups = [{ role: 'form', name: 'Profile' }];
  expect(
    decisionRequestSchema.safeParse({
      ...request,
      clarifications: [{ question: 'Which name?', answer: 'Ada' }],
      snapshot: { ...request.snapshot, controls: [{ ...control, groups }] },
    }).success,
  ).toBe(true);
  expect(
    decisionRequestSchema.safeParse({
      ...request,
      snapshot: {
        ...request.snapshot,
        controls: [{ ...control, groups: Array(5).fill(groups[0]) }],
      },
    }).success,
  ).toBe(false);
});

it('bounds prompts, clarification turns and decision history', () => {
  for (const prompt of ['', ' ', 'x'.repeat(2001)]) {
    expect(decisionRequestSchema.safeParse({ ...request, prompt }).success).toBe(false);
  }
  expect(
    decisionRequestSchema.safeParse({
      ...request,
      clarifications: Array(4).fill({ question: 'Which name?', answer: 'Ada' }),
    }).success,
  ).toBe(false);
  expect(
    decisionRequestSchema.safeParse({
      ...request,
      history: Array(21).fill({ type: 'clarify', message: 'Which name?' }),
    }).success,
  ).toBe(false);
});

it('requires versioned targets and rejects code, selectors and mixed decisions', () => {
  expect(
    decisionSchema.safeParse({
      type: 'act',
      message: 'Fill Name',
      step: { type: 'fill', target, value: 'Ada' },
    }).success,
  ).toBe(true);
  for (const step of [
    { type: 'eval', code: 'bad()' },
    { type: 'click', selector: '#name' },
    { type: 'click', target: { ...target, version: 0 } },
    { type: 'click', target, code: 'bad()' },
  ]) {
    expect(decisionSchema.safeParse({ type: 'act', message: 'Act', step }).success).toBe(
      false,
    );
  }
  expect(
    decisionSchema.safeParse({
      type: 'clarify',
      message: 'Which name?',
      step: { type: 'click', target },
    }).success,
  ).toBe(false);
  expect(
    decisionSchema.safeParse({
      type: 'complete',
      message: 'Done',
      checks: [{ type: 'text', description: 'Expected result is visible', text: '', fresh: false }],
    }).success,
  ).toBe(false);
});

it('validates conversational questions and local execution results', () => {
  const clarification = {
    type: 'clarification',
    question: 'Which name?',
    options: ['Ada', 'Grace'],
  };
  expect(clarificationSchema.safeParse(clarification).success).toBe(true);
  expect(clarificationSchema.safeParse({ ...clarification, options: ['Ada', 'Ada'] }).success).toBe(
    false,
  );
  expect(
    resultSchema.safeParse({
      planId: 'dom-1',
      status: 'triggered',
      events: ['Filled Name'],
      goalCompleted: true,
      message: 'Done',
    }).success,
  ).toBe(true);
});
