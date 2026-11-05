// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { REQUEST_MESSAGES } from './constants.js';
import { createRuntime as createDomRuntime } from '@ruakit/runtime';
import type { ActionFeedbackOptions, PageState, Screenshot } from '@ruakit/runtime';
import {
  completionChecksSchema,
  evaluateCompletionChecks,
  decisionSchema,
  decisionRequestSchema,
} from '@ruakit/schema';
import type {
  ClarificationTurn,
  CompletionCheck,
  ExecutionResult,
  Decision,
} from '@ruakit/schema';
import { ClarificationNeededError, RuaKitError, parsePayload } from './errors.js';
import { createRequestOperation, runWithSignal, validateRequestTimeout } from './operations.js';
import type { RequestPhase } from './request-state.js';
import type { RuaKitTransport } from './transport.js';
import { executePlan, createPlanTask } from './plan.js';
import { requestApproval } from './approval.js';
import type { ApprovalOptions } from './approval.js';
import type { PlanExecutionOptions, PlanExecutionResult, PlanTask, PlanEngine } from './plan.js';

export interface ExecutionOptions extends ActionFeedbackOptions, ApprovalOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  requestTimeoutMs?: number;
  /** Optional stronger application check, called only after all DOM outcomes pass. */
  verifyCompletion?: (context: CompletionContext) => boolean | Promise<boolean>;
  /** Observational feedback; exceptions cannot change execution. */
  onProgress?: (message: string) => void;
  onPhaseChange?: (phase: RequestPhase) => void;
}

export interface CompletionContext {
  prompt: string | undefined;
  checks: readonly CompletionCheck[];
  baseline: PageState;
  snapshot: PageState;
  signal: AbortSignal;
}

export interface RunOptions extends ExecutionOptions {
  /** The original observation used to obtain this decision, from this session. */
  snapshot: PageState;
  /** Optional host-established outcomes for a manually owned loop. */
  checks?: CompletionCheck[];
  /** Original session observation for checks requiring a newly appeared result. */
  baseline?: PageState;
}

export interface PlanOptions extends ExecutionOptions {
  clarifications?: ClarificationTurn[];
}

export interface RuaSession {
  readonly document: Document;
  snapshot(): PageState;
  /** Validate and apply one decision. A triggered action does not establish task completion. */
  run(decision: unknown, options: RunOptions): Promise<ExecutionResult>;
  executePlan(plan: unknown, options?: PlanExecutionOptions): Promise<PlanExecutionResult>;
  createPlanTask(): PlanTask;
  /** Observe, request a decision, and apply it until the planner finishes or asks a question. */
  plan(
    prompt: string,
    request: RuaKitTransport['dom'],
    options?: PlanOptions,
  ): Promise<ExecutionResult>;
}

/** One browser target registry shared by observation, execution, and planning. */
export function createSession(options: { document?: Document } = {}): RuaSession {
  const document = options.document ?? globalThis.document;
  if (!document?.defaultView) {
    throw new RuaKitError('UNAVAILABLE', 'RuaKit requires a browser document.');
  }
  let active: ExecutionOptions | undefined;
  let busy = false;
  let currentSignal: AbortSignal | undefined;
  let settled: Promise<void> | undefined;
  let sequence = 0;
  const observations = new WeakMap<PageState, PageState>();
  const baselines = new WeakMap<PageState, PageState>();
  const dom = createDomRuntime({
    root: document,
    timeoutMs: 8000,
    onAction: (event) => active?.onAction?.(event),
    get actionDelayMs() {
      return active?.actionDelayMs ?? 0;
    },
    get scrollToTarget() {
      return active?.scrollToTarget ?? false;
    },
  });

  function snapshot(): PageState {
    const state = dom.getState();
    // Keep our own copy so callers cannot authorize targets by editing a snapshot.
    const original = structuredClone(state);
    observations.set(state, original);
    baselines.set(state, original);
    return state;
  }

  function notify(settings: ExecutionOptions, message: string): void {
    try {
      settings.onProgress?.(message);
    } catch {
      /* Feedback is observational. */
    }
  }

  function phase(settings: ExecutionOptions, value: RequestPhase): void {
    try {
      settings.onPhaseChange?.(value);
    } catch {
      /* Feedback is observational. */
    }
  }

  async function own<T>(
    settings: ExecutionOptions,
    perform: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (busy) {
      // React Strict Mode can start a replacement before the cancelled call's
      // finally block runs. Wait for that owner rather than overlapping actions.
      if (currentSignal?.aborted) {
        await settled;
        return own(settings, perform);
      }
      throw new RuaKitError('BUSY', 'A RuaKit request is already running.');
    }
    busy = true;
    let release!: () => void;
    settled = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      validateRequestTimeout(settings.timeoutMs ?? 8000);
      const operation = createRequestOperation(settings.requestTimeoutMs ?? 60000, settings.signal);
      currentSignal = operation.signal;
      active = settings;
      try {
        operation.signal.throwIfAborted();
        return await perform(operation.signal);
      } finally {
        operation.dispose();
      }
    } finally {
      active = undefined;
      currentSignal = undefined;
      busy = false;
      release();
    }
  }

  function receipt(
    events: string[],
    decision: Decision,
    level: 'observed' | 'confirmed' = 'observed',
  ): ExecutionResult {
    return {
      planId: `dom-${Date.now()}-${++sequence}`,
      status: 'triggered',
      events,
      ...(decision.type === 'complete'
        ? {
            goalCompleted: true as const,
            message: decision.message,
            verification: { level, checks: decision.checks },
          }
        : {}),
    };
  }

  async function apply(
    value: unknown,
    source: PageState,
    signal: AbortSignal,
    settings: ExecutionOptions,
    verification?: {
      baseline: PageState;
      checks: CompletionCheck[] | undefined;
      prompt: string | undefined;
      requirePreparation?: boolean;
    },
  ): Promise<Decision> {
    signal.throwIfAborted();
    const observed = observations.get(source);
    if (!observed) {
      throw new RuaKitError('INVALID_PLAN', 'Use an unused snapshot from this Rua session.');
    }
    const decision = parsePayload(
      decisionSchema,
      value,
      'INVALID_PLAN',
      'The planner returned an invalid decision.',
    );
    observations.delete(source);
    notify(settings, decision.message);
    signal.throwIfAborted();
    if (decision.type === 'clarify') {
      throw new ClarificationNeededError({
        type: 'clarification',
        question: decision.message,
        options: [],
      });
    }
    if (decision.type === 'unsupported') {
      throw new RuaKitError('UNAVAILABLE', decision.message);
    }
    if (decision.type === 'complete') {
      const checks = verification?.checks ?? decision.checks;
      if (JSON.stringify(checks) !== JSON.stringify(decision.checks)) {
        throw new RuaKitError(
          'INVALID_PLAN',
          'Completion checks cannot change after execution begins.',
        );
      }
      const baseline = verification?.baseline ?? observed;
      if (
        !evaluateCompletionChecks(checks, observed, baseline).passed ||
        !evaluateCompletionChecks(checks, dom.getState(), baseline).passed
      ) {
        throw new RuaKitError(
          'INVALID_PLAN',
          'The requested outcomes are not all present on the live page.',
        );
      }
      if (settings.verifyCompletion) {
        const confirmed = await runWithSignal(signal, () =>
          settings.verifyCompletion!({
            prompt: verification?.prompt,
            checks: structuredClone(checks),
            baseline: structuredClone(baseline),
            snapshot: dom.getState(),
            signal,
          }),
        );
        signal.throwIfAborted();
        if (confirmed !== true)
          throw new RuaKitError(
            'VERIFICATION_FAILED',
            'The application could not confirm the requested outcome.',
          );
        if (!evaluateCompletionChecks(checks, dom.getState(), baseline).passed) {
          throw new RuaKitError(
            'INVALID_PLAN',
            'The page changed while the application verified completion.',
          );
        }
      }
      return decision;
    }
    if (decision.type === 'prepare' || decision.type === 'screenshot') return decision;
    if (verification?.requirePreparation && !verification.checks) {
      throw new RuaKitError(
        'INVALID_PLAN',
        'Establish completion checks with prepare before taking actions.',
      );
    }
    const step = decision.step;
    const control = observed.controls.find(
      (item) => item.target.id === step.target.id && item.target.version === step.target.version,
    );
    if (!control || !control.enabled) {
      throw new RuaKitError('INVALID_PLAN', 'The planner selected an unavailable live DOM target.');
    }
    if (decision.type === 'approval') {
      await requestApproval(decision, observed, signal, settings, verification?.prompt);
    }
    phase(settings, 'executing');
    const action = { signal, timeoutMs: settings.timeoutMs ?? 8000 };
    switch (step.type) {
      case 'focus':
        await dom.focus(step.target, action);
        break;
      case 'key':
        await dom.pressKey(step.target, step.key, {
          ...action,
          altKey: step.altKey,
          ctrlKey: step.ctrlKey,
          metaKey: step.metaKey,
          shiftKey: step.shiftKey,
        });
        break;
      case 'insertText':
        await dom.insertText(step.target, step.text, action);
        break;
      case 'click':
        await dom.click(step.target, action);
        break;
      case 'fill':
        await dom.setValue(step.target, step.value, action);
        break;
      case 'select':
        await dom.selectOption(step.target, step.values, action);
        break;
      case 'check':
        await dom.setChecked(step.target, step.checked, action);
        break;
    }
    signal.throwIfAborted();
    return decision;
  }

  const planEngine: PlanEngine = {
    platform: document.defaultView?.navigator.platform ?? '',
    snapshot, apply,
    screenshot: (signal, timeoutMs) => dom.screenshot({ signal, timeoutMs }),
  };

  return {
    document,
    snapshot,
    executePlan: (plan, options = {}) => own(options, (signal) => executePlan(planEngine, plan, signal, options)),
    createPlanTask: () => createPlanTask(planEngine, own),
    run: (decision, settings) =>
      own(settings, async (signal) => {
        const baseline = settings.baseline ? baselines.get(settings.baseline) : undefined;
        if (settings.baseline && !baseline)
          throw new RuaKitError(
            'INVALID_PLAN',
            'Use an original session observation as the verification baseline.',
          );
        const checks = settings.checks ? completionChecksSchema.parse(settings.checks) : undefined;
        const applied = await apply(decision, settings.snapshot, signal, settings, {
          baseline: baseline ?? observations.get(settings.snapshot) ?? settings.snapshot,
          checks,
          prompt: undefined,
        });
        const result = receipt(
          [applied.message.slice(0, 500)],
          applied,
          settings.verifyCompletion ? 'confirmed' : 'observed',
        );
        if (applied.type === 'screenshot')
          result.screenshot = await dom.screenshot({
            signal,
            timeoutMs: settings.timeoutMs ?? 8000,
          });
        return result;
      }),
    plan: (prompt, request, settings = {}) =>
      own(settings, async (signal) => {
        const history: Decision[] = [];
        const events: string[] = [];
        let checks: CompletionCheck[] | undefined;
        let baseline: PageState | undefined;
        let image: Screenshot | undefined;
        notify(settings, REQUEST_MESSAGES.observing);
        while (true) {
          signal.throwIfAborted();
          phase(settings, 'observing');
          const source = snapshot();
          baseline ??= structuredClone(source);
          if (image && image.url !== source.url) image = undefined;
          const input = parsePayload(
            decisionRequestSchema,
            {
              platform: document.defaultView?.navigator.platform ?? '',
              prompt,
              clarifications: settings.clarifications ?? [],
              snapshot: source,
              history: history.slice(-20),
              checks: checks ? structuredClone(checks) : null,
              canScreenshot: true,
              ...(image ? { screenshot: image } : {}),
            },
            'INVALID_REQUEST',
            'Enter a valid request for the current application page.',
          );
          phase(settings, 'planning');
          const decision = await apply(
            await runWithSignal(signal, () => request(input, signal)),
            source,
            signal,
            settings,
            { baseline, checks, prompt, requirePreparation: true },
          );
          events.push(decision.message.slice(0, 500));
          if (decision.type === 'complete') {
            return receipt(events, decision, settings.verifyCompletion ? 'confirmed' : 'observed');
          }
          if (decision.type === 'prepare') {
            if (checks)
              throw new RuaKitError(
                'INVALID_PLAN',
                'Completion checks cannot change after preparation.',
              );
            checks = structuredClone(decision.checks);
          }
          if (decision.type === 'screenshot') {
            if (image)
              throw new RuaKitError(
                'INVALID_PLAN',
                'Use the supplied screenshot before requesting another image.',
              );
            image = await dom.screenshot({ signal, timeoutMs: settings.timeoutMs ?? 8000 });
          } else image = undefined;
          history.push(decision);
        }
      }),
  };
}
