// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSession, ApprovalNeededError } from '../src/index.js';
import type {
  ApprovalContext,
  ApprovalDecision,
  Plan,
  PlanApproval,
} from '../src/index.js';

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
    () => [new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList,
  );
  document.body.innerHTML = '<button>Delete Alpha</button><p></p>';
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function setup() {
  const clicked = vi.fn(() => {
    document.querySelector('p')!.textContent = 'Alpha deleted';
  });
  document.querySelector('button')!.onclick = clicked;
  const session = createSession();
  const snapshot = session.snapshot();
  const decision: ApprovalDecision = {
    type: 'approval',
    message: 'Permanently delete Alpha?',
    step: { type: 'click', target: snapshot.controls[0]!.target },
  };
  return { session, snapshot, decision, clicked };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
const checks: Plan['checks'] = [
  {
    type: 'text',
    description: 'Alpha deletion acknowledged',
    text: 'Alpha deleted',
    fresh: true,
  },
];
function planApproval(): PlanApproval {
  return {
    type: 'approval',
    message: 'Permanently delete Alpha?',
    plan: {
      id: 'delete-plan',
      message: 'Alpha deleted',
      checks,
      steps: [
        {
          id: 'delete-alpha',
          type: 'click',
          message: 'Delete Alpha',
          target: {
            id: null,
            role: 'button',
            label: 'Delete Alpha',
            context: null,
            group: null,
          },
        },
      ],
    },
  };
}

it('stops without an approval handler and exposes the unexecuted proposal', async () => {
  const { session, snapshot, decision, clicked } = setup();
  const error = await session
    .run(decision, { snapshot })
    .catch((value: unknown) => value);
  expect(error).toBeInstanceOf(ApprovalNeededError);
  expect(error).toMatchObject({
    code: 'APPROVAL_REQUIRED',
    approval: decision,
  });
  expect(clicked).not.toHaveBeenCalled();
});

it('holds the exact action until explicit approval and isolates callback mutations', async () => {
  const { session, snapshot, decision, clicked } = setup();
  const answer = deferred<boolean>();
  const onApproval = vi.fn((context: ApprovalContext) => {
    if ('step' in context.approval) context.approval.step.target.id = 'foreign';
    context.snapshot.controls.length = 0;
    return answer.promise;
  });
  const pending = session.run(decision, { snapshot, onApproval });
  await vi.waitFor(() => expect(onApproval).toHaveBeenCalledOnce());
  expect(clicked).not.toHaveBeenCalled();
  answer.resolve(true);
  await expect(pending).resolves.toMatchObject({ status: 'triggered' });
  expect(clicked).toHaveBeenCalledOnce();
  expect(decision.step.target.id).not.toBe('foreign');
});

it.each([false, undefined, 'yes', 1])(
  'requires exactly true, rejecting %s without effects',
  async (answer) => {
    const { session, snapshot, decision, clicked } = setup();
    await expect(
      session.run(decision, {
        snapshot,
        onApproval: (() => answer) as () => boolean,
      }),
    ).rejects.toMatchObject({ code: 'APPROVAL_DENIED' });
    expect(clicked).not.toHaveBeenCalled();
  },
);

it('does not let callback failures authorize execution', async () => {
  const { session, snapshot, decision, clicked } = setup();
  await expect(
    session.run(decision, {
      snapshot,
      onApproval: () => {
        throw new Error('UI failed');
      },
    }),
  ).rejects.toThrow('UI failed');
  expect(clicked).not.toHaveBeenCalled();
});

it('revalidates the live target after approval', async () => {
  const { session, snapshot, decision, clicked } = setup();
  await expect(
    session.run(decision, {
      snapshot,
      onApproval: () => {
        document.querySelector('button')!.textContent = 'Delete Beta';
        return true;
      },
    }),
  ).rejects.toMatchObject({ code: 'STALE_TARGET' });
  expect(clicked).not.toHaveBeenCalled();
});

it.each(['cancel', 'timeout'] as const)(
  'discards late approval after %s and releases session ownership',
  async (kind) => {
    const { session, snapshot, decision, clicked } = setup();
    const answer = deferred<boolean>();
    const onApproval = vi.fn(() => answer.promise);
    const controller = new AbortController();
    const pending = session.run(decision, {
      snapshot,
      onApproval,
      signal: controller.signal,
      requestTimeoutMs: kind === 'timeout' ? 40 : 2000,
    });
    const rejected = expect(pending).rejects.toMatchObject({
      name: kind === 'cancel' ? 'AbortError' : 'TimeoutError',
    });
    await vi.waitFor(() => expect(onApproval).toHaveBeenCalledOnce(), {
      interval: 1,
    });
    if (kind === 'cancel') controller.abort();
    await rejected;
    answer.resolve(true);
    await Promise.resolve();
    expect(clicked).not.toHaveBeenCalled();
    await expect(
      session.run(
        { type: 'act', message: 'Continue', step: decision.step },
        {
          snapshot: session.snapshot(),
        },
      ),
    ).resolves.toMatchObject({ status: 'triggered' });
  },
);

it('requires preparation for approval in the automatic decision loop', async () => {
  const { session, decision, clicked } = setup();
  const onApproval = vi.fn(() => true);
  await expect(
    session.plan('Delete Alpha', async () => decision, { onApproval }),
  ).rejects.toMatchObject({ code: 'INVALID_PLAN' });
  expect(onApproval).not.toHaveBeenCalled();
  expect(clicked).not.toHaveBeenCalled();
});

it('continues the decision loop after an approved action and verifies completion', async () => {
  const { session, clicked } = setup();
  const onApproval = vi.fn(() => true);
  const result = await session.plan(
    'Delete Alpha',
    async (input) => {
      if (!input.checks)
        return { type: 'prepare', message: 'Check deletion', checks };
      if (input.snapshot.text.includes('Alpha deleted'))
        return { type: 'complete', message: 'Deleted', checks };
      return {
        type: 'approval',
        message: 'Permanently delete Alpha?',
        step: {
          type: 'click',
          target: input.snapshot.controls[0]!.target,
        },
      };
    },
    { onApproval },
  );
  expect(result.goalCompleted).toBe(true);
  expect(onApproval.mock.calls[0]).toBeDefined();
  expect(clicked).toHaveBeenCalledOnce();
});

it.each(['manual', 'planner'] as const)(
  'gates a concrete plan through %s execution without another model call',
  async (mode) => {
    const { session, clicked } = setup();
    const answer = deferred<boolean>();
    const onApproval = vi.fn(() => answer.promise);
    const planner = vi.fn(async () => planApproval());
    const pending =
      mode === 'manual'
        ? session.executePlan(planApproval(), { onApproval })
        : session
            .createPlanTask()
            .request('Delete Alpha', planner, { onApproval });
    await vi.waitFor(() => expect(onApproval).toHaveBeenCalledOnce());
    expect(clicked).not.toHaveBeenCalled();
    answer.resolve(true);
    await expect(pending).resolves.toMatchObject(
      mode === 'manual'
        ? { status: 'completed', result: { planId: 'delete-plan' } }
        : { planId: 'delete-plan', goalCompleted: true },
    );
    expect(clicked).toHaveBeenCalledOnce();
    expect(planner).toHaveBeenCalledTimes(mode === 'manual' ? 0 : 1);
  },
);

it.each(['deny', 'change', 'missing'] as const)(
  'stops an approval plan on %s without executing or replanning',
  async (kind) => {
    const { session, clicked } = setup();
    const planner = vi.fn(async () => planApproval());
    const onApproval = () => {
      if (kind === 'change')
        document.querySelector('button')!.textContent = 'Delete Beta';
      return kind !== 'deny';
    };
    await expect(
      session
        .createPlanTask()
        .request(
          'Delete Alpha',
          planner,
          kind === 'missing' ? {} : { onApproval },
        ),
    ).rejects.toMatchObject({
      code:
        kind === 'deny'
          ? 'APPROVAL_DENIED'
          : kind === 'change'
            ? 'STALE_TARGET'
            : 'APPROVAL_REQUIRED',
    });
    expect(clicked).not.toHaveBeenCalled();
    expect(planner).toHaveBeenCalledOnce();
  },
);
