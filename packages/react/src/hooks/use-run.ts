// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  INITIAL_REQUEST_STATE,
  requestIsBusy,
  requestReducer,
  RuaKitError,
} from "@ruakit/agent";
import type {
  ExecutionOptions,
  ExecutionResult,
  RunOptions,
  RuntimeActionEvent,
  RequestState,
} from "@ruakit/agent";
import { getSession } from "../lib/session.js";
import type { RuaSessionOptions } from "../lib/session.js";

export interface RuaRunOptions
  extends
    RuaSessionOptions,
    Omit<
      ExecutionOptions,
      "signal" | "onProgress" | "onPhaseChange" | "onAction"
    > {}

export interface RuaRun {
  state: RequestState;
  loading: boolean;
  action: RuntimeActionEvent | null;
  /** Apply one decision; errors reject so custom integrations can handle them directly. */
  run(
    decision: unknown,
    options: Pick<RunOptions, "snapshot" | "signal" | "checks" | "baseline">,
  ): Promise<ExecutionResult>;
  cancel(): void;
}

/** Execute one decision using the same document session as useSnapshot and usePlan. */
export function useRun(options: RuaRunOptions = {}): RuaRun {
  const [state, dispatch] = useReducer(requestReducer, INITIAL_REQUEST_STATE);
  const [action, setAction] = useState<RuntimeActionEvent | null>(null);
  const active = useRef<{
    requestId: number;
    controller: AbortController;
  } | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const committedOptions = useRef(options);

  useEffect(() => {
    committedOptions.current = options;
  }, [options]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const request = active.current;
      active.current = null;
      if (request) {
        dispatch({ type: "cancelled", requestId: request.requestId });
        request.controller.abort();
      }
      setAction(null);
    };
  }, []);

  const run = useCallback(
    async (
      decision: unknown,
      settings: Pick<RunOptions, "snapshot" | "signal" | "checks" | "baseline">,
    ): Promise<ExecutionResult> => {
      if (!mounted.current) {
        throw new RuaKitError(
          "UNAVAILABLE",
          "Run a Rua decision after the component has mounted.",
        );
      }
      if (active.current) {
        throw new RuaKitError("BUSY", "A RuaKit request is already running.");
      }

      const request = {
        requestId: ++sequence.current,
        controller: new AbortController(),
      };
      active.current = request;

      const owns = (): boolean => mounted.current && active.current === request;
      const accepts = (): boolean =>
        owns() &&
        !request.controller.signal.aborted &&
        !settings.signal?.aborted;
      const callerSignal = settings.signal;
      const cancelFromCaller = (): void =>
        request.controller.abort(callerSignal?.reason);
      callerSignal?.addEventListener("abort", cancelFromCaller, { once: true });
      if (callerSignal?.aborted) cancelFromCaller();

      setAction(null);
      dispatch({ type: "started", requestId: request.requestId });

      try {
        const options = committedOptions.current;
        const result = await getSession(options).run(decision, {
          ...options,
          snapshot: settings.snapshot,
          ...(settings.checks ? { checks: settings.checks } : {}),
          ...(settings.baseline ? { baseline: settings.baseline } : {}),
          signal: request.controller.signal,
          onProgress: (message) => {
            if (accepts())
              dispatch({
                type: "progress",
                requestId: request.requestId,
                message,
              });
          },
          onPhaseChange: (phase) => {
            if (accepts())
              dispatch({ type: "phase", requestId: request.requestId, phase });
          },
          onAction: (event) => {
            if (!owns()) return;
            if (event.phase === "cancelled" || event.phase === "failed")
              setAction(null);
            else if (accepts()) setAction(event);
          },
        });

        request.controller.signal.throwIfAborted();
        if (owns())
          dispatch({ type: "triggered", requestId: request.requestId, result });
        return result;
      } catch (error) {
        if (owns()) {
          dispatch(
            request.controller.signal.aborted
              ? {
                  type: "cancelled",
                  requestId: request.requestId,
                }
              : {
                  type: "failed",
                  requestId: request.requestId,
                  message:
                    error instanceof Error
                      ? error.message
                      : "Execution failed.",
                },
          );
        }
        throw error;
      } finally {
        callerSignal?.removeEventListener("abort", cancelFromCaller);
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
    dispatch({ type: "cancelling", requestId: request.requestId });
    setAction(null);
    request.controller.abort();
  }, []);

  return { state, loading: requestIsBusy(state), action, run, cancel };
}
