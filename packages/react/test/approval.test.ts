// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRua, usePlan, Toolbar } from '../dist/index.js';
import type {
  RuaAgent,
  RequestOutcome,
  PlanApproval,
  RuaApprovalInput,
  RequestPlan,
  RuaPlan,
} from '../dist/index.js';

let root: Root | undefined;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
    () => [new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList,
  );
  document.body.innerHTML = '<label>Name<input /></label>';
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const target = {
  id: null,
  role: 'textbox',
  label: 'Name',
  context: null,
  group: null,
};
const proposal: PlanApproval = {
  type: 'approval',
  message: 'Send this name to the application?',
  plan: {
    id: 'approved-plan',
    message: 'Name entered',
    steps: [
      { id: 'name', message: 'Enter Ana', type: 'fill', target, value: 'Ana' },
    ],
    checks: [
      {
        type: 'value',
        description: 'Name entered',
        control: target,
        equals: 'Ana',
      },
    ],
  },
};
async function mount(Component: () => ReturnType<typeof createElement> | null) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(createElement(StrictMode, null, createElement(Component))),
  );
}
function response(
  rua: RuaAgent,
  approved: boolean,
): RuaApprovalInput {
  if (rua.state.status !== 'approval')
    throw new Error('Expected pending approval');
  return {
    operationId: rua.state.identity!.operationId,
    approvalId: rua.state.approvalId,
    approved,
  };
}

it('shows a distinct approval state, rejects stale responses, and executes only on approval', async () => {
  let rua!: RuaAgent;
  const request = vi.fn(async () => proposal);
  await mount(() => {
    rua = useRua({ request });
    return null;
  });
  let pending!: Promise<RequestOutcome>;
  await act(async () => {
    pending = rua.execute({ prompt: 'Enter Ana' });
  });
  expect(rua.state.status).toBe('approval');
  expect(rua.loading).toBe(true);
  expect(document.querySelector('input')!.value).toBe('');
  const input = response(rua, true);
  expect(rua.respondToApproval({ ...input, operationId: 'old' })).toBe(false);
  expect(rua.respondToApproval({ ...input, approvalId: 'old' })).toBe(false);
  expect(
    (await rua.respond({ operationId: input.operationId, answer: 'yes' }))
      .status,
  ).toBe('rejected');
  await act(async () => {
    expect(rua.respondToApproval(input)).toBe(true);
    expect(rua.respondToApproval(input)).toBe(false);
    expect(await pending).toMatchObject({
      status: 'completed',
      result: { planId: proposal.plan.id },
    });
  });
  expect(document.querySelector('input')!.value).toBe('Ana');
  expect(request).toHaveBeenCalledOnce();
});

it.each(['decline', 'cancel', 'unmount'] as const)(
  'settles pending approval on %s without entering a value',
  async (kind) => {
    let rua!: RuaAgent;
    const request = vi.fn(async () => proposal);
    await mount(() => {
      rua = useRua({ request });
      return null;
    });
    let pending!: Promise<RequestOutcome>;
    await act(async () => {
      pending = rua.execute({ prompt: 'Enter Ana' });
    });
    const input = response(rua, true);
    await act(async () => {
      if (kind === 'decline')
        rua.respondToApproval({ ...input, approved: false });
      else if (kind === 'cancel') rua.cancel();
      else {
        root!.unmount();
        root = undefined;
      }
      expect(await pending).toMatchObject(
        kind === 'decline'
          ? { status: 'failed', error: { code: 'APPROVAL_DENIED' } }
          : {
              status: 'cancelled',
              reason: kind === 'cancel' ? 'explicit' : 'unmounted',
            },
      );
    });
    expect(document.querySelector('input')!.value).toBe('');
    expect(rua.respondToApproval(input)).toBe(false);
  },
);

it('respects the deadline while awaiting approval and ignores a later response', async () => {
  let rua!: RuaAgent;
  await mount(() => {
    rua = useRua({ request: async () => proposal, requestTimeoutMs: 100 });
    return null;
  });
  let pending!: Promise<RequestOutcome>;
  await act(async () => {
    pending = rua.execute({ prompt: 'Enter Ana' });
  });
  const input = response(rua, true);
  await act(async () => {
    expect(await pending).toMatchObject({
      status: 'failed',
      error: { code: 'TIMEOUT' },
    });
  });
  expect(rua.respondToApproval(input)).toBe(false);
  expect(document.querySelector('input')!.value).toBe('');
});

it('uses a supplied host approval handler instead of waiting for the built-in UI', async () => {
  let rua!: RuaAgent;
  const onApproval = vi.fn(() => true);
  await mount(() => {
    rua = useRua({ request: async () => proposal, onApproval });
    return null;
  });
  await act(async () => {
    expect(await rua.execute({ prompt: 'Enter Ana' })).toMatchObject({
      status: 'completed',
    });
  });
  expect(onApproval).toHaveBeenCalledOnce();
});

it('executes an approval-wrapped supplied plan only through its host handler', async () => {
  let executor!: RuaPlan;
  let approve!: (value: boolean) => void;
  const onApproval = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        approve = resolve;
      }),
  );
  await mount(() => {
    executor = usePlan(proposal, { onApproval });
    return null;
  });
  let pending!: ReturnType<RuaPlan['execute']>;
  await act(async () => {
    pending = executor.execute();
  });
  expect(onApproval).toHaveBeenCalledOnce();
  expect(document.querySelector('input')!.value).toBe('');
  await act(async () => {
    approve(true);
    expect(await pending).toMatchObject({ status: 'completed' });
  });
  expect(document.querySelector('input')!.value).toBe('Ana');
});

it('requires a new approval ID for a second gate in the same operation', async () => {
  let rua!: RuaAgent;
  const request = vi.fn<RequestPlan>(async (input) => {
    const checks = proposal.plan.checks.map((check) => ({ ...check, equals: 'Bea' }));
    const value = input.replan ? 'Bea' : 'Ana';
    return {
      type: 'approval', message: `Enter ${value}?`,
      plan: {
        id: `enter-${value}`, ...(input.replan ? { replacesPlanId: input.replan.planId } : {}),
        message: 'Entered', checks,
        steps: [{ id: `name-${value}`, type: 'fill', message: `Enter ${value}`, target, value }],
      },
    };
  });
  await mount(() => {
    rua = useRua({ request });
    return null;
  });
  let pending!: Promise<RequestOutcome>;
  await act(async () => {
    pending = rua.execute({ prompt: 'Enter Ana, then Bea' });
  });
  const first = response(rua, true);
  await act(async () => {
    rua.respondToApproval(first);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });
  const second = response(rua, true);
  expect(second.operationId).toBe(first.operationId);
  expect(second.approvalId).not.toBe(first.approvalId);
  expect(rua.respondToApproval(first)).toBe(false);
  expect(document.querySelector('input')!.value).toBe('Ana');
  await act(async () => {
    rua.respondToApproval(second);
    await pending;
  });
  expect(document.querySelector('input')!.value).toBe('Bea');
});

it('offers Approve and Decline for a plan approval without using clarification answers', async () => {
  let rua!: RuaAgent;
  const request = vi.fn<RequestPlan>(async () => proposal);
  await mount(() => {
    rua = useRua({ request });
    return createElement(Toolbar, {
      request: rua.state,
      prompt: '',
      placeholder: 'Ask',
      onPromptChange() {},
      onSubmit() {},
      onCancel: rua.cancel,
      onAnswer() {},
      onStartOver: rua.startOver,
      onApprovalResponse: (approved) =>
        rua.respondToApproval(response(rua, approved)),
    });
  });
  let pending!: Promise<RequestOutcome>;
  await act(async () => {
    pending = rua.execute({ prompt: 'Enter Ana' });
  });
  expect(rua.state.status).toBe('approval');
  const buttons = [...document.querySelectorAll('button')];
  const approve = buttons.find((button) => button.textContent === 'Approve')!;
  expect(approve).toBeDefined();
  expect(buttons.some((button) => button.textContent === 'Decline')).toBe(true);
  expect(
    document.querySelector<HTMLTextAreaElement>('textarea')!.readOnly,
  ).toBe(true);
  expect(document.querySelector('aside')!.getAttribute('aria-busy')).toBe('false');
  expect(document.activeElement).toBe(document.querySelector('textarea'));
  await act(async () => {
    approve.click();
    expect(await pending).toMatchObject({ status: 'completed' });
  });
  expect(
    request.mock.calls.every(([input]) => input.clarifications.length === 0),
  ).toBe(true);
});
