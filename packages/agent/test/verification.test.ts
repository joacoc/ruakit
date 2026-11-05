// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRuntime } from '../src/index.js';
const capture = vi.hoisted(() => vi.fn());
vi.mock('@ruakit/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ruakit/runtime')>();
  return {
    ...actual,
    createRuntime: (...args: Parameters<typeof actual.createRuntime>) => ({
      ...actual.createRuntime(...args),
      screenshot: capture,
    }),
  };
});
import type {
  CompletionCheck,
  Decision,
  DecisionRequest,
} from '@ruakit/schema';

const name: CompletionCheck = {
  type: 'value',
  description: 'The requested name is entered',
  control: {
    id: null,
    role: 'textbox',
    label: 'Name',
    context: null,
    group: null,
  },
  equals: 'Ada',
};
const saved: CompletionCheck = {
  type: 'text',
  description: 'The profile save is acknowledged',
  text: 'Profile saved',
  fresh: true,
};
beforeEach(() => {
  document.body.innerHTML =
    '<label>Name<input></label><button>Save</button><p></p>';
  capture.mockReset();
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    new DOMRect(0, 0, 10, 10),
  ] as unknown as DOMRectList);
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function planner(
  checks: CompletionCheck[],
  finish?: (input: DecisionRequest) => Decision,
) {
  return vi.fn(async (input: DecisionRequest): Promise<Decision> => {
    if (!input.checks)
      return {
        type: 'prepare',
        message: 'Establish requested outcomes',
        checks,
      };
    const field = input.snapshot.controls[0]!;
    if (field.value !== 'Ada')
      return {
        type: 'act',
        message: 'Enter Ada',
        step: { type: 'fill', target: field.target, value: 'Ada' },
      };
    return (
      finish?.(input) ?? {
        type: 'complete',
        message: 'Name entered',
        checks: input.checks,
      }
    );
  });
}

it('prepares outcomes before actions and reports observed completion for every request', async () => {
  const dom = planner([name]);
  const result = await createRuntime({ transport: { dom } }).request(
    'Enter Ada',
  );
  expect(result).toMatchObject({
    goalCompleted: true,
    verification: { level: 'observed', checks: [name] },
  });
  expect(dom.mock.calls[0]![0].checks).toBeNull();
  expect(dom.mock.calls[1]![0].checks).toEqual([name]);
  expect(dom).toHaveBeenCalledTimes(3);
});

it('rejects an action before preparation without dispatching its effect', async () => {
  const clicked = vi.fn();
  document.querySelector('button')!.addEventListener('click', clicked);
  const dom = async (input: DecisionRequest): Promise<Decision> => ({
    type: 'act',
    message: 'Save',
    step: { type: 'click', target: input.snapshot.controls[1]!.target },
  });
  await expect(
    createRuntime({ transport: { dom } }).request('Save'),
  ).rejects.toThrow('before taking actions');
  expect(clicked).not.toHaveBeenCalled();
});

it('rejects partial completion and prevents dropping established checks', async () => {
  await expect(
    createRuntime({ transport: { dom: planner([name, saved]) } }).request(
      'Enter Ada and save',
    ),
  ).rejects.toThrow('not all present');
  document.querySelector('input')!.value = '';
  const changed = planner([name, saved], () => ({
    type: 'complete',
    message: 'Done',
    checks: [name],
  }));
  await expect(
    createRuntime({ transport: { dom: changed } }).request(
      'Enter Ada and save',
    ),
  ).rejects.toThrow('cannot change');
});

it('rejects stale success prose and button captions as completion', async () => {
  document.querySelector('p')!.textContent = 'Profile saved';
  await expect(
    createRuntime({ transport: { dom: planner([saved]) } }).request(
      'Save again',
    ),
  ).rejects.toThrow('not all present');
  await expect(
    createRuntime({
      transport: {
        dom: async () => ({
          type: 'complete',
          message: 'Saved',
          checks: [
            {
              type: 'text',
              description: 'Save completed',
              text: 'Save',
              fresh: false,
            },
          ],
        }),
      },
    }).request('Save'),
  ).rejects.toThrow('not all present');
});

it('requires the fresh save result as well as the accepted field value', async () => {
  document.querySelector('button')!.addEventListener('click', () => {
    document.querySelector('p')!.textContent = 'Profile saved';
  });
  const dom = planner([name, saved], (input) =>
    input.snapshot.text.includes('Profile saved')
      ? { type: 'complete', message: 'Profile saved', checks: input.checks! }
      : {
          type: 'act',
          message: 'Save profile',
          step: { type: 'click', target: input.snapshot.controls[1]!.target },
        },
  );
  await expect(
    createRuntime({ transport: { dom } }).request('Enter Ada and save'),
  ).resolves.toMatchObject({
    goalCompleted: true,
    verification: { level: 'observed' },
  });
});

it('supports already-satisfied requests without requiring an action', async () => {
  document.querySelector('input')!.value = 'Ada';
  const dom = vi.fn(async (): Promise<Decision> => ({
    type: 'complete',
    message: 'Already Ada',
    checks: [name],
  }));
  await expect(
    createRuntime({ transport: { dom } }).request('Set name to Ada'),
  ).resolves.toMatchObject({ goalCompleted: true });
  expect(dom).toHaveBeenCalledTimes(1);
});

it('distinguishes application confirmation and rejects failed or stale confirmation', async () => {
  const verify = vi.fn(() => true);
  await expect(
    createRuntime({
      transport: { dom: planner([name]) },
      verifyCompletion: verify,
    }).request('Enter Ada'),
  ).resolves.toMatchObject({ verification: { level: 'confirmed' } });
  expect(verify).toHaveBeenCalledWith(
    expect.objectContaining({
      prompt: 'Enter Ada',
      checks: [name],
      signal: expect.any(AbortSignal),
    }),
  );
  await expect(
    createRuntime({
      transport: { dom: planner([name]) },
      verifyCompletion: () => false,
    }).request('Enter Ada'),
  ).rejects.toMatchObject({ code: 'VERIFICATION_FAILED' });
  await expect(
    createRuntime({
      transport: { dom: planner([name]) },
      verifyCompletion: () => {
        document.querySelector('input')!.value = 'Changed';
        return true;
      },
    }).request('Enter Ada'),
  ).rejects.toThrow('page changed');
});

it('captures only when requested and supplies the image to the next planner turn', async () => {
  const image = {
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG7cAAAAASUVORK5CYII=',
    mimeType: 'image/png' as const,
    width: 1,
    height: 1,
  };
  capture.mockResolvedValue({
    ...image,
    capturedAt: Date.now(),
    url: document.URL,
  });
  const dom = vi.fn(async (input: DecisionRequest): Promise<Decision> => {
    if (!input.screenshot) {
      expect(input.canScreenshot).toBe(true);
      return { type: 'screenshot', message: 'Inspect the visual state' };
    }
    expect(input.screenshot).toMatchObject(image);
    return {
      type: 'complete',
      message: 'Page inspected',
      checks: [
        {
          type: 'url',
          description: 'The current page is open',
          equals: input.snapshot.url,
        },
      ],
    };
  });
  await expect(
    createRuntime({ transport: { dom } }).request('Inspect the page'),
  ).resolves.toMatchObject({ goalCompleted: true });
  expect(capture).toHaveBeenCalledTimes(1);
  expect(dom).toHaveBeenCalledTimes(2);
  capture.mockClear();
  document.querySelector('input')!.value = '';
  await createRuntime({
    transport: { dom: planner([name]) },
  }).request('Enter Ada');
  expect(capture).not.toHaveBeenCalled();
});

it('bounds an application verifier that ignores cancellation and never reports a late success', async () => {
  vi.useFakeTimers();
  document.querySelector('input')!.value = 'Ada';
  let finish!: (confirmed: boolean) => void;
  const verifyCompletion = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  const runtime = createRuntime({
    transport: { dom: planner([name]) },
    verifyCompletion,
    requestTimeoutMs: 30,
  });
  const rejected = expect(runtime.request('Enter Ada')).rejects.toMatchObject({
    name: 'TimeoutError',
  });
  await vi.advanceTimersByTimeAsync(30);
  await rejected;
  expect(verifyCompletion).toHaveBeenCalledOnce();
  finish(true);
  await Promise.resolve();
  expect(vi.getTimerCount()).toBe(0);
});
