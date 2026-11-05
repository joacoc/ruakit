// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
import { createRuntime } from "@ruakit/agent";
import type {
  RuntimeOptions,
  RequestIdentity,
  PlanTask,
  PlanTransport,
} from "@ruakit/agent";
import type { PlanRequest, PlanResponse } from "@ruakit/schema";
import { useRequestCoordinator } from "./use-request-coordinator.js";
import type { RequestCoordinator } from "./use-request-coordinator.js";

export type RequestPlan<Context = unknown> = (
  input: PlanRequest,
  context: Context | undefined,
  signal: AbortSignal,
  identity: RequestIdentity,
) => Promise<PlanResponse>;

export interface RuaOptions<Context = unknown> extends Omit<
  RuntimeOptions,
  "transport" | "onProgress" | "onPhaseChange" | "onAction"
> {
  /** Optional override; the default backend receives context and replanning progress. */
  request?: RequestPlan<Context>;
  transport?: PlanTransport;
  context?: Context;
  maxReplans?: number;
}
export type RuaAgent<Context = unknown> = Omit<
  RequestCoordinator<Context>,
  "plan"
> & {
  submit: RequestCoordinator<Context>["plan"];
};

/** Request plans and execute them through the same engine as usePlan. */
export function useRua<Context = unknown>(
  options: RuaOptions<Context> = {},
): RuaAgent<Context> {
  const { plan, ...request } = useRequestCoordinator<Context>({
    ...options,
    canRespond: (_error, memory) =>
      (memory.get("plan-task") as PlanTask | undefined)?.canResume !== false,
    runRequest: (input, session, feedback) => {
      let task = input.memory.get("plan-task") as PlanTask | undefined;
      if (!task) {
        task = session.createPlanTask();
        input.memory.set("plan-task", task);
      }

      const runtime = createRuntime({
        ...options,
        ...feedback,
        protocol: "plan",
        session,
        task,
        context: input.context,
        ...(options.request
          ? {
              planner: (body: PlanRequest, signal: AbortSignal) =>
                options.request!(body, input.context, signal, input.identity),
            }
          : {}),
      });

      return runtime.request(input.prompt, {
        signal: input.signal,
        ...(input.clarifications.length
          ? { clarifications: input.clarifications }
          : {}),
      });
    },
  });

  return { ...request, submit: plan };
}
