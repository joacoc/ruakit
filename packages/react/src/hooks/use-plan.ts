// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  INITIAL_REQUEST_STATE,
  requestIsBusy,
  requestReducer,
  RuaKitError,
} from "@ruakit/agent";
import type {
  PlanExecutionOptions,
  PlanExecutionResult,
  RequestState,
  RuntimeActionEvent,
} from "@ruakit/agent";
import type { Plan, PlanApproval } from "@ruakit/schema";
import { getSession } from "../lib/session.js";
import type { RuaSessionOptions } from "../lib/session.js";

export interface RuaPlanOptions
  extends
    RuaSessionOptions,
    Omit<
      PlanExecutionOptions,
      "signal" | "onProgress" | "onPhaseChange" | "onAction"
    > {}
export interface RuaPlan {
  state: RequestState;
  loading: boolean;
  action: RuntimeActionEvent | null;
  /** Explicit execution only. Rendering or replacing a plan never starts actions. */
  execute(options?: { signal?: AbortSignal }): Promise<PlanExecutionResult>;
  cancel(): void;
}

export function usePlan(
  plan: Plan | PlanApproval | null,
  options: RuaPlanOptions = {},
): RuaPlan {
  const [state, dispatch] = useReducer(requestReducer, INITIAL_REQUEST_STATE);
  const [action, setAction] = useState<RuntimeActionEvent | null>(null);
  const committed = useRef({ plan, options });
  const mounted = useRef(false);
  const sequence = useRef(0);
  const active = useRef<{ id: number; controller: AbortController } | null>(
    null,
  );

  useEffect(() => {
    committed.current = { plan, options };
  }, [plan, options]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.controller.abort();
      active.current = null;
      setAction(null);
    };
  }, []);

  const execute = useCallback(
    async (
      settings: { signal?: AbortSignal } = {},
    ): Promise<PlanExecutionResult> => {
      if (!mounted.current)
        throw new RuaKitError(
          "UNAVAILABLE",
          "Execute a plan after the component has mounted.",
        );
      if (active.current)
        throw new RuaKitError("BUSY", "A RuaKit request is already running.");

      const { plan, options } = committed.current;
      if (!plan)
        throw new RuaKitError(
          "INVALID_PLAN",
          "Supply a plan before starting execution.",
        );

      const request = {
        id: ++sequence.current,
        controller: new AbortController(),
      };
      active.current = request;

      const owns = () => mounted.current && active.current === request;
      const accepts = () => owns() && !request.controller.signal.aborted;
      const fromCaller = () =>
        request.controller.abort(settings.signal?.reason);
      settings.signal?.addEventListener("abort", fromCaller, { once: true });
      if (settings.signal?.aborted) fromCaller();

      setAction(null);
      dispatch({ type: "started", requestId: request.id });

      try {
        const result = await getSession(options).executePlan(plan, {
          ...options,
          signal: request.controller.signal,
          onProgress: (message) => {
            if (accepts())
              dispatch({ type: "progress", requestId: request.id, message });
          },
          onPhaseChange: (phase) => {
            if (accepts())
              dispatch({ type: "phase", requestId: request.id, phase });
          },
          onAction: (event) => {
            if (
              owns() &&
              (event.phase === "failed" || event.phase === "cancelled")
            )
              setAction(null);
            else if (accepts()) setAction(event);
          },
        });

        request.controller.signal.throwIfAborted();
        if (owns()) {
          if (result.status === "completed")
            dispatch({
              type: "triggered",
              requestId: request.id,
              result: result.result,
            });
          else
            dispatch({
              type: "failed",
              requestId: request.id,
              message: result.replan.message,
            });
        }
        return result;
      } catch (error) {
        if (owns())
          dispatch(
            request.controller.signal.aborted
              ? { type: "cancelled", requestId: request.id }
              : {
                  type: "failed",
                  requestId: request.id,
                  message:
                    error instanceof Error
                      ? error.message
                      : "Plan execution failed.",
                },
          );
        throw error;
      } finally {
        settings.signal?.removeEventListener("abort", fromCaller);
        if (active.current === request) {
          active.current = null;
          setAction(null);
        }
      }
    },
    [],
  );

  const cancel = useCallback(() => {
    const request = active.current;
    if (!mounted.current || !request || request.controller.signal.aborted)
      return;
    dispatch({ type: "cancelling", requestId: request.id });
    setAction(null);
    request.controller.abort();
  }, []);

  return { state, loading: requestIsBusy(state), action, execute, cancel };
}
