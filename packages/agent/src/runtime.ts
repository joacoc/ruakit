// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { RUNTIME_META_NAME } from '@ruakit/schema';
import type { ClarificationTurn, ExecutionResult } from '@ruakit/schema';
import { RuaKitError } from './errors.js';
import { createDecisionRuntime } from './decision-runtime.js';
import type { ExecutionOptions, RuaSession } from './session.js';
import { createHttpTransport } from './transport.js';
import { createPlanTransport } from './plan-transport.js';
import type { PlanTransport } from './plan-transport.js';
import type { PlanPlanner, PlanTask, PlanTaskOptions } from './plan.js';
import { createSession } from './session.js';
import type { HttpTransportOptions, RuaKitTransport } from './transport.js';

export interface RuntimeOptions extends HttpTransportOptions, Omit<ExecutionOptions, 'signal'> {
  protocol?: 'decision';
  document?: Document;
  /** Reuse the target registry used by snapshot/run primitives. */
  session?: RuaSession;
  transport?: RuaKitTransport;
}
export interface PlanRuntimeOptions extends Omit<RuntimeOptions, 'transport' | 'protocol'>,
  Pick<PlanTaskOptions, 'context' | 'maxReplans' | 'onPlan'> {
  protocol: 'plan';
  transport?: PlanTransport;
  planner?: PlanPlanner;
  task?: PlanTask;
}

export interface RequestOptions {
  signal?: AbortSignal;
  clarifications?: ClarificationTurn[];
}

export interface RuaKitRuntime {
  request(prompt: string, options?: RequestOptions): Promise<ExecutionResult>;
}

/** Plan from the rendered page and execute only locally observed DOM targets. */
export function createRuntime(options?: RuntimeOptions): RuaKitRuntime;
export function createRuntime(options: PlanRuntimeOptions): RuaKitRuntime;
export function createRuntime(options: RuntimeOptions | PlanRuntimeOptions = {}): RuaKitRuntime {
  const document = options.document ?? options.session?.document ?? globalThis.document;
  if (!document?.defaultView) {
    throw new RuaKitError('UNAVAILABLE', 'RuaKit requires a browser document.');
  }
  const embedded = document.querySelector<HTMLMetaElement>(
    `meta[name="${RUNTIME_META_NAME}"]`,
  )?.content;
  let serverUrl: string | undefined;
  if (embedded !== undefined) {
    try {
      const value: unknown = JSON.parse(embedded);
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error();
      }
      const record = value as Record<string, unknown>;
      if (
        record.serverUrl !== undefined &&
        (typeof record.serverUrl !== 'string' || !record.serverUrl.trim())
      ) {
        throw new Error();
      }
      serverUrl = record.serverUrl as string | undefined;
    } catch {
      throw new RuaKitError('INVALID_REQUEST', 'The page has invalid RuaKit configuration.');
    }
  }
  if (options.protocol === 'plan') {
    const session = options.session ?? createSession({ document });
    if (session.document !== document)
      throw new RuaKitError('INVALID_REQUEST', 'The Rua session belongs to a different document.');
    const transport = options.planner ? undefined : options.transport ?? createPlanTransport({
      ...options, ...(options.serverUrl === undefined && serverUrl ? { serverUrl } : {}), document,
    });
    return {
      request: (prompt, settings = {}) => (options.task ?? session.createPlanTask()).request(prompt,
        options.planner ?? ((input, signal) => transport!.plan(input, signal)), { ...options, ...settings }),
    };
  }
  return createDecisionRuntime(
    options,
    options.transport ??
      createHttpTransport({
        ...options,
        ...(options.serverUrl === undefined && serverUrl ? { serverUrl } : {}),
      }),
  );
}
