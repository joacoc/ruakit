// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RuaKitError } from '@ruakit/agent';
import { useRua } from '../dist/index.js';
import type {
  Plan,
  RequestPlan,
  RequestIdentity,
  RequestOutcome,
  RuaAgent,
  RuaOptions,
} from '../dist/index.js';

const complete: Plan = {
  id: 'checked-plan', steps: [],
  message: 'Name checked.',
  checks: [
    {
      type: 'value',
      description: 'Name is empty',
      control: {
        id: null,
        role: 'textbox',
        label: 'Name',
        context: null,
        group: null,
      },
      equals: '',
    },
  ],
};
const roots = new Set<Root>();

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
    () => [new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList,
  );
  document.body.innerHTML = '<label>Name<input /></label>';
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.clear();
  document.body.replaceChildren();
  document.head.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount<Context = unknown>(
  options: RuaOptions<Context> = {},
  strict = false,
) {
  let current!: RuaAgent<Context>;
  function Harness(props: RuaOptions<Context>) {
    current = useRua(props);
    return null;
  }
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  roots.add(root);
  const render = async (props: RuaOptions<Context>) => {
    await act(async () =>
      root.render(
        strict
          ? createElement(StrictMode, null, createElement(Harness, props))
          : createElement(Harness, props),
      ),
    );
  };
  await render(options);
  return { root, render, current: () => current };
}

async function settled(
  call: () => Promise<RequestOutcome>,
): Promise<RequestOutcome> {
  let outcome!: RequestOutcome;
  await act(async () => {
    outcome = await call();
  });
  return outcome;
}

it('returns completion and verification to the caller without reading captured React state', async () => {
  const hook = await mount({
    request: async () => complete,
    verifyCompletion: () => true,
  });
  const captured = hook.current();
  const outcome = await settled(() =>
    captured.execute({ prompt: 'Check name' }),
  );
  expect(captured.state.status).toBe('idle');
  expect(outcome).toMatchObject({
    status: 'completed',
    operationId: expect.any(String),
    result: { goalCompleted: true, verification: { level: 'confirmed' } },
  });
  expect(hook.current().state).toMatchObject({
    status: 'triggered',
    identity: { operationId: outcome.operationId },
  });
});

it('retains typed context, identity and correlation across planner steps, answers and rerenders', async () => {
  const context = { customerId: 'customer-1' };
  const correlation = {
    threadId: 'thread-1',
    messageId: 'message-1',
    toolCallId: 'tool-1',
  };
  const identities: RequestIdentity[] = [];
  const planner = vi.fn<RequestPlan<typeof context>>(
    async (input, ctx, signal, identity) => {
      expect(ctx).toBe(context);
      expect(signal.aborted).toBe(false);
      expect(input.context).toEqual(context);
      expect(input).not.toHaveProperty('correlation');
      identities.push(identity);
      return input.clarifications.length
        ? complete
        : { type: 'clarify', message: 'Which customer?' };
    },
  );
  const hook = await mount({ request: planner }, true);
  const methods = hook.current();
  const first = await settled(() =>
    methods.execute({ prompt: 'Check name', context, correlation }),
  );
  expect(first.status).toBe('needs-input');
  correlation.messageId = 'changed';
  const replacement = vi.fn<RequestPlan<typeof context>>(async () => complete);
  await hook.render({ request: replacement });
  expect(hook.current().execute).toBe(methods.execute);
  expect(hook.current().respond).toBe(methods.respond);
  expect(hook.current().cancel).toBe(methods.cancel);
  const second = await settled(() =>
    methods.respond({ operationId: first.operationId, answer: 'Customer one' }),
  );
  expect(second).toMatchObject({
    status: 'completed',
    operationId: first.operationId,
    correlation: {
      threadId: 'thread-1',
      messageId: 'message-1',
      toolCallId: 'tool-1',
    },
  });
  expect(identities[0]).toBe(identities[1]);
  expect(planner.mock.calls[1]?.[0].clarifications).toEqual([
    { question: 'Which customer?', answer: 'Customer one' },
  ]);
  expect(replacement).not.toHaveBeenCalled();
});

it('rejects invalid prompts without invoking the transport', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const hook = await mount({ fetch: fetcher });
  for (const input of [
    { prompt: ' ' },
    { prompt: 'a'.repeat(2001) },
  ]) {
    expect(await settled(() => hook.current().execute(input))).toMatchObject({
      status: 'rejected',
      error: { code: 'INVALID_REQUEST' },
    });
  }
  expect(fetcher).not.toHaveBeenCalled();
  expect(hook.current().state.status).toBe('idle');
});

it('uses the default transport without adding local identity or correlation to the wire protocol', async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify(complete)),
  );
  const hook = await mount({ fetch: fetcher });
  const outcome = await settled(() =>
    hook
      .current()
      .execute({ prompt: 'Check', correlation: { toolCallId: 'tool-1' } }),
  );
  expect(outcome).toMatchObject({
    status: 'completed',
    correlation: { toolCallId: 'tool-1' },
  });
  const payload = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
  expect(payload).not.toHaveProperty('correlation');
  expect(payload).not.toHaveProperty('operationId');
});

it('rejects same-hook and shared-session contention without releasing the original owner', async () => {
  const first = await mount({
    request: async () => new Promise<Plan>(() => {}),
  });
  const planner = vi.fn<RequestPlan>(async () => complete);
  const other = await mount({ request: planner });
  let running!: Promise<RequestOutcome>;
  await act(async () => {
    running = first.current().execute({ prompt: 'Check' });
  });
  const local = await settled(() =>
    first.current().execute({ prompt: 'Duplicate' }),
  );
  const shared = await settled(() =>
    other.current().execute({ prompt: 'Another' }),
  );
  expect(local).toMatchObject({ status: 'rejected', error: { code: 'BUSY' } });
  expect(shared).toMatchObject({ status: 'rejected', error: { code: 'BUSY' } });
  expect(local.operationId).not.toBe(shared.operationId);
  expect(planner).not.toHaveBeenCalled();
  expect(first.current().loading).toBe(true);
  await act(async () => first.current().cancel());
  expect(await running).toMatchObject({
    status: 'cancelled',
    reason: 'explicit',
  });
  expect(
    (await settled(() => other.current().execute({ prompt: 'Now available' })))
      .status,
  ).toBe('completed');
});

it('keeps cancel usable directly as a button event handler', async () => {
  const hook = await mount({ request: async () => new Promise(() => {}) });
  const button = document.createElement('button');
  button.onclick = hook.current().cancel;
  document.body.append(button);
  let pending!: Promise<RequestOutcome>;
  await act(async () => { pending = hook.current().execute({ prompt: 'Check' }); });
  await act(async () => button.click());
  expect(await pending).toMatchObject({ status: 'cancelled', reason: 'explicit' });
});

it('handles an already aborted caller without beginning work', async () => {
  const controller = new AbortController();
  controller.abort();
  const planner = vi.fn<RequestPlan>(async () => complete);
  const hook = await mount({ request: planner });
  expect(
    await settled(() =>
      hook.current().execute({ prompt: 'Check', signal: controller.signal }),
    ),
  ).toMatchObject({ status: 'cancelled', reason: 'caller' });
  expect(planner).not.toHaveBeenCalled();
  expect(hook.current().state.status).toBe('idle');
});

it('forwards caller abort and its reason, settles an uncooperative planner, and discards late actions', async () => {
  const controller = new AbortController();
  const abortReason = new Error('Chat stopped');
  let signal!: AbortSignal;
  let release!: (value: Plan) => void;
  const hook = await mount({
    request: async (_input, _ctx, currentSignal) => {
      signal = currentSignal;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  let pending!: Promise<RequestOutcome>;
  await act(async () => {
    pending = hook
      .current()
      .execute({ prompt: 'Fill name', signal: controller.signal });
  });
  await act(async () => controller.abort(abortReason));
  expect(await pending).toMatchObject({
    status: 'cancelled',
    reason: 'caller',
  });
  expect(signal.aborted).toBe(true);
  expect(signal.reason).toBe(abortReason);
  await act(async () =>
    release({
      ...complete, id: 'late-plan',
      steps: [{ id: 'late-fill', type: 'fill', message: 'Late fill',
        target: { id: null, role: 'textbox', label: 'Name', context: null, group: null }, value: 'Wrong' }],
    }),
  );
  expect(document.querySelector('input')!.value).toBe('');
  expect(hook.current().state.status).toBe('cancelled');
});

it.each([
  [new RuaKitError('HTTP_ERROR', 'Planner unavailable'), 'HTTP_ERROR'],
  [new RuaKitError('VERIFICATION_FAILED', 'Not saved'), 'VERIFICATION_FAILED'],
  [new Error('Custom planner failed'), 'REQUEST_FAILED'],
  ['invalid thrown value', 'REQUEST_FAILED'],
])('returns a stable failure code for %s', async (error, code) => {
  const hook = await mount({
    request: async () => {
      throw error;
    },
  });
  const outcome = await settled(() =>
    hook.current().execute({ prompt: 'Check' }),
  );
  expect(outcome).toMatchObject({
    status: 'failed',
    error: { code },
    canRespond: false,
  });
  expect(hook.current().state).toMatchObject({
    status: 'failed',
    error: { code },
  });
});

it('reports request deadlines as TIMEOUT failures', async () => {
  vi.useFakeTimers();
  const hook = await mount({
    requestTimeoutMs: 10,
    request: async () => new Promise(() => {}),
  });
  let pending!: Promise<RequestOutcome>;
  await act(async () => {
    pending = hook.current().execute({ prompt: 'Check' });
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
  });
  expect(await pending).toMatchObject({
    status: 'failed',
    error: { code: 'TIMEOUT' },
  });
  expect(hook.current().loading).toBe(false);
});

it('reports a planner AbortError as cancellation rather than an unknown failure', async () => {
  const hook = await mount({
    request: async () => {
      throw new DOMException('Stopped', 'AbortError');
    },
  });
  expect(
    await settled(() => hook.current().execute({ prompt: 'Check' })),
  ).toMatchObject({ status: 'cancelled', reason: 'aborted' });
});

it('rejects answers after the session configuration changes', async () => {
  const planner = vi.fn<RequestPlan>(async () => ({
    type: 'clarify',
    message: 'Which name?',
  }));
  const hook = await mount({ serverUrl: '/first', request: planner });
  const question = await settled(() =>
    hook.current().execute({ prompt: 'Check' }),
  );
  await hook.render({ serverUrl: '/second', request: planner });
  expect(
    await settled(() =>
      hook
        .current()
        .respond({ operationId: question.operationId, answer: 'Ana' }),
    ),
  ).toMatchObject({ status: 'rejected', error: { code: 'STALE_REQUEST' } });
  expect(planner).toHaveBeenCalledTimes(1);
});

it('reports unmount cancellation and rejects retained methods after unmount', async () => {
  const hook = await mount({ request: async () => new Promise(() => {}) });
  const retained = hook.current();
  let pending!: Promise<RequestOutcome>;
  await act(async () => {
    pending = retained.execute({ prompt: 'Check' });
  });
  await act(async () => hook.root.unmount());
  roots.delete(hook.root);
  expect(await pending).toMatchObject({
    status: 'cancelled',
    reason: 'unmounted',
  });
  expect(await retained.execute({ prompt: 'Late request' })).toMatchObject({
    status: 'rejected',
    error: { code: 'UNAVAILABLE' },
  });
});

it.each(['caller', 'explicit'] as const)(
  'cancels a pending clarification through %s cancellation',
  async (source) => {
    const controller = new AbortController();
    const hook = await mount({
      request: async () => ({ type: 'clarify', message: 'Which name?' }),
    });
    const first = await settled(() =>
      hook.current().execute({ prompt: 'Check', signal: controller.signal }),
    );
    await act(async () =>
      source === 'caller'
        ? controller.abort()
        : hook.current().cancel(first.operationId),
    );
    expect(hook.current().state).toMatchObject({
      status: 'cancelled',
      identity: { operationId: first.operationId },
    });
    expect(
      await settled(() =>
        hook
          .current()
          .respond({ operationId: first.operationId, answer: 'Ana' }),
      ),
    ).toMatchObject({ status: 'rejected', error: { code: 'STALE_REQUEST' } });
  },
);

it('rejects stale replies and ignores stale cancellations without affecting a replacement operation', async () => {
  const controller = new AbortController();
  const hook = await mount({
    request: async () => ({ type: 'clarify', message: 'Which name?' }),
  });
  const first = await settled(() =>
    hook.current().execute({ prompt: 'First', signal: controller.signal }),
  );
  const second = await settled(() =>
    hook.current().execute({ prompt: 'Second' }),
  );
  expect(second.operationId).not.toBe(first.operationId);
  await act(async () => {
    controller.abort();
    hook.current().cancel(first.operationId);
  });
  expect(hook.current().state).toMatchObject({
    status: 'clarification',
    identity: { operationId: second.operationId },
  });
  expect(
    await settled(() =>
      hook.current().respond({ operationId: first.operationId, answer: 'Ana' }),
    ),
  ).toMatchObject({ status: 'rejected', error: { code: 'STALE_REQUEST' } });
  expect(hook.current().state.status).toBe('clarification');
});

it('retains the question for invalid answers and explicit retries after a failed answer', async () => {
  let answering = 0;
  const hook = await mount({
    request: async (input) => {
      if (!input.clarifications.length)
        return { type: 'clarify', message: 'Which name?' };
      if (++answering === 1) throw new RuaKitError('HTTP_ERROR', 'Try again');
      return complete;
    },
  });
  const first = await settled(() =>
    hook.current().execute({ prompt: 'Check' }),
  );
  expect(
    await settled(() =>
      hook.current().respond({ operationId: first.operationId, answer: ' ' }),
    ),
  ).toMatchObject({ status: 'rejected', error: { code: 'INVALID_REQUEST' } });
  expect(
    await settled(() =>
      hook.current().respond({ operationId: first.operationId, answer: 'Ana' }),
    ),
  ).toMatchObject({
    status: 'failed',
    error: { code: 'HTTP_ERROR' },
    canRespond: true,
  });
  expect(hook.current().state.status).toBe('clarification');
  expect(
    await settled(() =>
      hook.current().respond({ operationId: first.operationId, answer: 'Ana' }),
    ),
  ).toMatchObject({ status: 'completed', operationId: first.operationId });
});

it('bounds clarification attempts while retaining the logical identity', async () => {
  const hook = await mount({
    request: async () => ({ type: 'clarify', message: 'Which name?' }),
  });
  let outcome = await settled(() =>
    hook.current().execute({ prompt: 'Check' }),
  );
  const operationId = outcome.operationId;
  for (let i = 0; i < 3; i++) {
    expect(outcome).toMatchObject({ status: 'needs-input', operationId });
    outcome = await settled(() =>
      hook.current().respond({ operationId, answer: 'Ana' }),
    );
  }
  expect(outcome).toMatchObject({
    status: 'failed',
    operationId,
    error: { code: 'CLARIFICATION_REQUIRED' },
    canRespond: false,
  });
});

it('removes the caller subscription after completion and when starting over from a question', async () => {
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const hook = await mount({ request: async () => complete });
  const first = await settled(() =>
    hook.current().execute({ prompt: 'Check', signal: controller.signal }),
  );
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  await act(async () => controller.abort());
  expect(hook.current().state).toMatchObject({
    status: 'triggered',
    identity: { operationId: first.operationId },
  });
  await hook.render({
    request: async () => ({ type: 'clarify', message: 'Which name?' }),
  });
  const secondController = new AbortController();
  const secondRemove = vi.spyOn(secondController.signal, 'removeEventListener');
  const second = await settled(() =>
    hook
      .current()
      .execute({ prompt: 'Check', signal: secondController.signal }),
  );
  expect(secondRemove).not.toHaveBeenCalled();
  await act(async () => hook.current().startOver());
  expect(secondRemove).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(hook.current().state.status).toBe('idle');
  expect(
    await settled(() =>
      hook
        .current()
        .respond({ operationId: second.operationId, answer: 'Ana' }),
    ),
  ).toMatchObject({ status: 'rejected', error: { code: 'STALE_REQUEST' } });
});
