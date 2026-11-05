// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Decision } from '@ruakit/schema';
import { createRuntime } from '../src/runtime.js';
import type { RequestPhase } from '../src/request-state.js';
import type { RuaKitTransport } from '../src/transport.js';

const complete: Decision = {
  type: 'complete',
  message: 'Ready.',
  checks: [
    { type: 'text', description: 'Expected result is visible', text: 'Ready', fresh: false },
  ],
};

beforeEach(() => {
  document.body.innerHTML = '<p>Ready</p>';
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
    () => [new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('requires a browser document', () => {
  vi.stubGlobal('document', undefined);
  expect(() => createRuntime()).toThrow('requires a browser document');
});

it.each(['', ' ', 'x'.repeat(2001)])(
  'rejects an invalid prompt before planning',
  async (prompt) => {
    const dom = vi.fn<RuaKitTransport['dom']>().mockResolvedValue(complete);
    const runtime = createRuntime({ document, transport: { dom } });
    await expect(runtime.request(prompt)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(dom).not.toHaveBeenCalled();
    await expect(runtime.request('Check readiness')).resolves.toMatchObject({
      goalCompleted: true,
    });
  },
);

it('prevents concurrent requests until the owned request settles', async () => {
  let release!: (decision: Decision) => void;
  const dom = vi.fn<RuaKitTransport['dom']>().mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const runtime = createRuntime({ document, transport: { dom } });
  const pending = runtime.request('Check readiness');
  await expect(runtime.request('Another request')).rejects.toMatchObject({
    code: 'BUSY',
  });
  release(complete);
  await expect(pending).resolves.toMatchObject({ goalCompleted: true });
  dom.mockResolvedValue(complete);
  await expect(runtime.request('Check again')).resolves.toMatchObject({
    goalCompleted: true,
  });
});

it('honors an already aborted signal before invoking the planner', async () => {
  const dom = vi.fn<RuaKitTransport['dom']>().mockResolvedValue(complete);
  const runtime = createRuntime({ document, transport: { dom } });
  const controller = new AbortController();
  controller.abort();
  await expect(
    runtime.request('Check readiness', { signal: controller.signal }),
  ).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(dom).not.toHaveBeenCalled();
  await expect(runtime.request('Check again')).resolves.toMatchObject({
    goalCompleted: true,
  });
});

it('bounds a planner that ignores cancellation and cleans up its deadline', async () => {
  vi.useFakeTimers();
  const dom = vi.fn<RuaKitTransport['dom']>().mockReturnValue(new Promise(() => {}));
  const runtime = createRuntime({
    document,
    transport: { dom },
    requestTimeoutMs: 50,
  });
  const pending = expect(runtime.request('Check readiness')).rejects.toMatchObject({
    name: 'TimeoutError',
  });
  await vi.advanceTimersByTimeAsync(50);
  await pending;
  expect(vi.getTimerCount()).toBe(0);
  dom.mockResolvedValue(complete);
  await expect(runtime.request('Check again')).resolves.toMatchObject({
    goalCompleted: true,
  });
  expect(vi.getTimerCount()).toBe(0);
});

it('discards a late planner action after cancellation', async () => {
  document.body.innerHTML = '<button>Save</button>';
  const click = vi.fn();
  document.querySelector('button')!.addEventListener('click', click);
  let release!: (decision: Decision) => void;
  let started!: () => void;
  const called = new Promise<void>((resolve) => {
    started = resolve;
  });
  const dom = vi.fn<RuaKitTransport['dom']>().mockImplementation(async (request) => {
    const decision: Decision = {
      type: 'act',
      message: 'Save',
      step: { type: 'click', target: request.snapshot.controls[0]!.target },
    };
    started();
    await new Promise<Decision>((resolve) => {
      release = resolve;
    });
    return decision;
  });
  const controller = new AbortController();
  const pending = createRuntime({ document, transport: { dom } }).request('Save', {
    signal: controller.signal,
  });
  await called;
  const rejected = expect(pending).rejects.toMatchObject({
    name: 'AbortError',
  });
  controller.abort();
  await rejected;
  release({ type: 'unsupported', message: 'Cancelled' });
  await Promise.resolve();
  expect(click).not.toHaveBeenCalled();
});

it('emits live phases and tolerates feedback exceptions', async () => {
  document.body.innerHTML = '<button>Save</button><p>Ready</p>';
  const button = document.querySelector('button')!;
  button.addEventListener('click', () => {
    document.querySelector('p')!.textContent = 'Profile saved';
  });
  const phases: RequestPhase[] = [];
  const checks = [
    {
      type: 'text' as const,
      description: 'Profile save result',
      text: 'Profile saved',
      fresh: true,
    },
  ];
  const dom = vi.fn<RuaKitTransport['dom']>().mockImplementation(async (request) => {
    if (!request.checks) return { type: 'prepare', message: 'Plan save', checks };
    if (request.history.some((item) => item.type === 'act'))
      return { type: 'complete', message: 'Saved.', checks };
    return {
      type: 'act',
      message: 'Save',
      step: { type: 'click', target: request.snapshot.controls[0]!.target },
    };
  });
  const runtime = createRuntime({
    document,
    transport: { dom },
    onProgress: () => {
      throw new Error('UI feedback failed');
    },
    onPhaseChange: (phase) => {
      phases.push(phase);
      throw new Error('UI phase failed');
    },
  });
  await expect(runtime.request('Save')).resolves.toMatchObject({
    goalCompleted: true,
    message: 'Saved.',
  });
  expect(phases).toEqual([
    'observing',
    'planning',
    'observing',
    'planning',
    'executing',
    'observing',
    'planning',
  ]);
  expect(dom).toHaveBeenCalledTimes(3);
});

it('rejects unverified completion evidence and malformed custom decisions', async () => {
  const dom = vi
    .fn<RuaKitTransport['dom']>()
    .mockResolvedValue({
      ...complete,
      checks: [
        { type: 'text', description: 'Expected result is visible', text: 'Missing', fresh: false },
      ],
    });
  const runtime = createRuntime({ document, transport: { dom } });
  await expect(runtime.request('Check readiness')).rejects.toMatchObject({
    code: 'INVALID_PLAN',
  });
  dom.mockResolvedValue({
    type: 'act',
    message: 'Run code',
    step: { type: 'eval', code: 'bad()' },
  } as unknown as Decision);
  await expect(runtime.request('Check again')).rejects.toMatchObject({
    code: 'INVALID_PLAN',
  });
});
