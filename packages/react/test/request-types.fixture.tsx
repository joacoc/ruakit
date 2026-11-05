// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { createElement } from 'react';
import { Rua, RuaCursor, useRua, usePlan } from '../dist/index.js';
import { RuaCursor as ControlledCursor } from '../dist/lib/controlled.js';
import type { CursorVisibility as ControlledVisibility } from '../dist/lib/controlled.js';
import type { CursorAnchor as ControlledAnchor } from '../dist/lib/controlled.js';
import type {
  RequestPlan,
  RequestOutcome,
  RuaExecuteInput,
  CursorVisibility,
  CursorAnchor,
  Plan, PlanRequest,
} from '../dist/index.js';

export function cursorOptions(element?: HTMLElement) {
  const visibility: CursorVisibility = 'session';
  const controlledVisibility: ControlledVisibility = visibility;
  const anchor: CursorAnchor | null = element
    ? { element, onReached() {} }
    : null;
  const controlledAnchor: ControlledAnchor | null = anchor;
  // @ts-expect-error Cursor visibility supports only the declared lifecycle modes.
  createElement(Rua, { cursorVisibility: 'always' });
  // @ts-expect-error Path presets have been removed.
  createElement(Rua, { cursorMovement: 'power' });
  // @ts-expect-error Standalone cursors also use one fixed path.
  createElement(ControlledCursor, { action: null, movement: 'sigmoid' });
  return [
    createElement(Rua, { cursorVisibility: visibility }),
    createElement(Rua, { cursorEdgeGlow: false, scrollToTarget: true }),
    createElement(RuaCursor, { action: null, visibility, anchor, edgeGlow: false, scrollToTarget: true }),
    createElement(ControlledCursor, { action: null, dragging: true }),
    createElement(ControlledCursor, { action: null, edgeGlow: false, scrollToTarget: true }),
    createElement(ControlledCursor, {
      action: null,
      visibility: controlledVisibility,
      anchor: controlledAnchor,
    }),
  ];
}

type Context = { customerId: string };
const planner: RequestPlan<Context> = async (
  _input: PlanRequest,
  context,
  _signal,
  identity,
) => ({
  type: 'unsupported',
  message: `${context?.customerId}: ${identity.operationId}`,
});

export function Consumer() {
  const rua = useRua({ request: planner });
  const execute: (input: RuaExecuteInput<Context>) => Promise<RequestOutcome> =
    rua.execute;
  const run = () => {
    void execute({ prompt: 'Check', context: { customerId: 'one' } });
    // @ts-expect-error Context is inferred from the custom planner.
    void rua.execute({ prompt: 'Check', context: { customerId: 1 } });
    // @ts-expect-error Answering requires the logical operation identity.
    void rua.respond({ answer: 'one' });
    void rua.submit('Check', { customerId: 'one' });
  };
  // The existing zero-argument cancel callback remains a valid React event handler.
  return createElement(
    'div',
    null,
    createElement('button', { onClick: rua.cancel }, 'Cancel'),
    createElement('button', { onClick: run }, 'Run'),
  );
}

export function PlanConsumer({ plan }: { plan: Plan }) {
  const executor = usePlan(plan);
  const request: RequestPlan<Context> = async (_input: PlanRequest) => plan;
  const rua = useRua({ request, maxReplans: 2 });
  const defaultRua = useRua({ context: { customerId: 'one' } });
  // @ts-expect-error A supplied plan is required; this hook does not create plans.
  usePlan();
  // @ts-expect-error Planner configuration belongs to useRua.
  usePlan({ request });
  // @ts-expect-error Context is inferred from the custom plan request.
  void rua.submit('Check', { customerId: 1 });
  void defaultRua.execute({ prompt: 'Check', context: { customerId: 'two' } });
  return createElement('button', { onClick: () => void executor.execute() }, 'Run plan');
}

export function summary(outcome: RequestOutcome): string {
  switch (outcome.status) {
    case 'completed':
    case 'triggered':
      return outcome.result.message ?? outcome.result.planId;
    case 'needs-input':
      return outcome.clarification.question;
    case 'cancelled':
      return outcome.reason;
    case 'failed':
      return `${outcome.canRespond}: ${outcome.error.code}`;
    case 'rejected':
      return outcome.error.message;
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}
