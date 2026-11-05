// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSession, createRuntime } from '../src/index.js';
import type { Decision } from '@ruakit/schema';

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
    () => [new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList,
  );
  document.body.innerHTML = '<label>Name<input /></label><button>Save</button>';
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('uses each operation\'s scroll setting without leaking it to later operations', async () => {
  const rua = createSession();
  const scroll = vi.fn();
  document.querySelector('button')!.scrollIntoView = scroll;
  for (const scrollToTarget of [undefined, false, true, undefined]) {
    const snapshot = rua.snapshot();
    await rua.run({
      type: 'act', message: 'Save',
      step: { type: 'click', target: snapshot.controls.find((control) => control.label === 'Save')!.target },
    }, {
      snapshot,
      ...(scrollToTarget === undefined ? {} : { scrollToTarget }),
      onAction: () => {},
    });
    expect(scroll).toHaveBeenCalledTimes(scrollToTarget ? 1 : 0);
    scroll.mockClear();
  }
});

it('lets an external planner apply a decision to an observed target', async () => {
  const rua = createSession();
  const snapshot = rua.snapshot();
  const result = await rua.run(
    {
      type: 'act',
      message: 'Fill name',
      step: {
        type: 'fill',
        target: snapshot.controls[0]!.target,
        value: 'Ana',
      },
    },
    { snapshot },
  );
  expect(document.querySelector('input')!.value).toBe('Ana');
  expect(result.status).toBe('triggered');
  expect(result.goalCompleted).toBeUndefined();
  const updated = rua.snapshot();
  await expect(
    rua.run(
      {
        type: 'complete',
        message: 'Name entered.',
        checks: [
          {
            type: 'value',
            description: 'Expected field value',
            control: { id: null, role: 'textbox', label: 'Name', context: null, group: null },
            equals: 'Ana',
          },
        ],
      },
      { snapshot: updated },
    ),
  ).resolves.toMatchObject({ goalCompleted: true });
});

it('continues an owned request when the browser tab becomes hidden', async () => {
  const rua = createSession();
  let hide = true;
  const result = await rua.plan('Enter Ana', async (input) => {
    if (hide) {
      hide = false;
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      document.dispatchEvent(new Event('visibilitychange'));
    }
    const checks = [{
      type: 'value' as const,
      description: 'Name entered',
      control: { id: null, role: 'textbox', label: 'Name', context: null, group: null },
      equals: 'Ana',
    }];
    if (!input.checks) return { type: 'prepare', message: 'Enter name', checks };
    const control = input.snapshot.controls.find((item) => item.label === 'Name')!;
    if (control.value !== 'Ana') return {
      type: 'act', message: 'Enter name',
      step: { type: 'fill', target: control.target, value: 'Ana' },
    };
    return { type: 'complete', message: 'Done', checks: input.checks };
  });
  expect(result.goalCompleted).toBe(true);
  expect(document.querySelector('input')!.value).toBe('Ana');
});

it('rejects foreign snapshots and prevents reapplying a consumed observation', async () => {
  const rua = createSession();
  const other = createSession();
  const snapshot = rua.snapshot();
  const clicked = vi.fn();
  document.querySelector('button')!.addEventListener('click', clicked);
  const decision = {
    type: 'act',
    message: 'Save',
    step: { type: 'click', target: snapshot.controls[1]!.target },
  };
  await expect(other.run(decision, { snapshot })).rejects.toMatchObject({
    code: 'INVALID_PLAN',
  });
  await rua.run(decision, { snapshot });
  await expect(rua.run(decision, { snapshot })).rejects.toMatchObject({
    code: 'INVALID_PLAN',
  });
  expect(clicked).toHaveBeenCalledTimes(1);
});

it('rejects stale controls and does not trust edits to a returned snapshot', async () => {
  const rua = createSession();
  const snapshot = rua.snapshot();
  document.querySelector('input')!.value = 'User edit';
  await expect(
    rua.run(
      {
        type: 'act',
        message: 'Fill',
        step: {
          type: 'fill',
          target: snapshot.controls[0]!.target,
          value: 'Ana',
        },
      },
      { snapshot },
    ),
  ).rejects.toMatchObject({ code: 'STALE_TARGET' });
  const fresh = rua.snapshot();
  fresh.controls.push({
    ...fresh.controls[0]!,
    target: { id: 'invented', version: 1 },
  });
  await expect(
    rua.run(
      {
        type: 'act',
        message: 'Fill',
        step: {
          type: 'fill',
          target: { id: 'invented', version: 1 },
          value: 'Ana',
        },
      },
      { snapshot: fresh },
    ),
  ).rejects.toMatchObject({ code: 'INVALID_PLAN' });
  expect(document.querySelector('input')!.value).toBe('User edit');
});

it('validates untrusted decisions and current completion evidence', async () => {
  const rua = createSession();
  const snapshot = rua.snapshot();
  await expect(
    rua.run(
      {
        type: 'act',
        message: 'Execute',
        step: { type: 'eval', code: 'bad()' },
      },
      { snapshot },
    ),
  ).rejects.toMatchObject({ code: 'INVALID_PLAN' });
  document.querySelector('button')!.textContent = 'Delete';
  await expect(
    rua.run(
      {
        type: 'complete',
        message: 'Saved',
        checks: [
          { type: 'text', description: 'Expected result is visible', text: 'Save', fresh: false },
        ],
      },
      { snapshot },
    ),
  ).rejects.toMatchObject({ code: 'INVALID_PLAN' });
});

it('shares ownership between a planning loop and manual execution', async () => {
  const session = createSession();
  const snapshot = session.snapshot();
  let release!: (decision: Decision) => void;
  const pending = createRuntime({
    session,
    transport: {
      dom: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    },
  }).request('Read page');
  await expect(
    session.run(
      {
        type: 'complete',
        message: 'Ready',
        checks: [
          {
            type: 'value',
            description: 'Expected field value',
            control: { id: null, role: 'textbox', label: 'Name', context: null, group: null },
            equals: '',
          },
        ],
      },
      { snapshot },
    ),
  ).rejects.toMatchObject({ code: 'BUSY' });
  release({
    type: 'complete',
    message: 'Ready',
    checks: [
      {
        type: 'value',
        description: 'Expected field value',
        control: { id: null, role: 'textbox', label: 'Name', context: null, group: null },
        equals: '',
      },
    ],
  });
  await expect(pending).resolves.toMatchObject({ goalCompleted: true });
  await expect(
    session.run(
      {
        type: 'complete',
        message: 'Ready',
        checks: [
          {
            type: 'value',
            description: 'Expected field value',
            control: { id: null, role: 'textbox', label: 'Name', context: null, group: null },
            equals: '',
          },
        ],
      },
      { snapshot },
    ),
  ).resolves.toMatchObject({ goalCompleted: true });
});

it('cancels action feedback before a manual decision can change the page', async () => {
  const session = createSession();
  const snapshot = session.snapshot();
  const controller = new AbortController();
  await expect(
    session.run(
      {
        type: 'act',
        message: 'Fill',
        step: {
          type: 'fill',
          target: snapshot.controls[0]!.target,
          value: 'Ana',
        },
      },
      {
        snapshot,
        signal: controller.signal,
        actionDelayMs: 100,
        onAction: (event) => {
          if (event.phase === 'before') controller.abort();
        },
      },
    ),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(document.querySelector('input')!.value).toBe('');
  const fresh = session.snapshot();
  await expect(
    session.run(
      {
        type: 'complete',
        message: 'Ready',
        checks: [
          {
            type: 'value',
            description: 'Expected field value',
            control: { id: null, role: 'textbox', label: 'Name', context: null, group: null },
            equals: '',
          },
        ],
      },
      { snapshot: fresh },
    ),
  ).resolves.toMatchObject({ goalCompleted: true });
});

it('releases the shared session after invalid execution settings', async () => {
  const session = createSession();
  const snapshot = session.snapshot();
  const decision = {
    type: 'complete',
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
  await expect(session.run(decision, { snapshot, timeoutMs: 0 })).rejects.toBeInstanceOf(
    RangeError,
  );
  await expect(session.run(decision, { snapshot, requestTimeoutMs: 0 })).rejects.toBeInstanceOf(
    RangeError,
  );
  await expect(session.run(decision, { snapshot })).resolves.toMatchObject({ goalCompleted: true });
});
