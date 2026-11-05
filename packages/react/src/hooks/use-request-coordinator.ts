// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type {
  Clarification,
  ClarificationTurn,
  ExecutionResult,
  Plan,
} from "@ruakit/schema";
import {
  ClarificationNeededError,
  INITIAL_REQUEST_STATE,
  requestIsBusy,
  requestReducer,
  toRequestError,
} from "@ruakit/agent";
import type {
  RequestCorrelation,
  RequestIdentity,
  RequestOutcome,
  RequestState,
  RuntimeActionEvent,
  RuntimeOptions,
  RuaSession,
  ExecutionOptions,
} from "@ruakit/agent";
import { getSession } from "../lib/session.js";

export interface CoordinatorInput<Context> {
  prompt: string;
  context: Context | undefined;
  signal: AbortSignal;
  identity: RequestIdentity;
  clarifications: ClarificationTurn[];
  memory: Map<string, unknown>;
}
export interface CoordinatorFeedback extends Pick<
  ExecutionOptions,
  "onProgress" | "onPhaseChange" | "onAction" | "onApproval"
> {
  onPlan(plan: Plan): void;
}
export interface CoordinatorOptions<Context = unknown> extends Omit<
  RuntimeOptions,
  "onProgress" | "onPhaseChange" | "onAction" | "transport"
> {
  transport?: unknown;
  context?: Context;
  canRespond?(error: unknown, memory: Map<string, unknown>): boolean;
  runRequest(
    input: CoordinatorInput<Context>,
    session: RuaSession,
    feedback: CoordinatorFeedback,
  ): Promise<ExecutionResult>;
}

export interface RuaExecuteInput<Context = unknown> {
  prompt: string;
  /** Application context for planning; overrides the hook's default context. */
  context?: Context;
  correlation?: RequestCorrelation;
  /** Cancels this operation, including while it is waiting for clarification. */
  signal?: AbortSignal;
}

export interface RuaAnswerInput {
  operationId: string;
  answer: string;
}

export interface RuaApprovalInput {
  operationId: string;
  approvalId: string;
  approved: boolean;
}

export interface RequestCoordinator<Context = unknown> {
  currentPlan: Plan | null;
  state: RequestState;
  loading: boolean;
  /** Local feedback for the currently owned action; cleared on cancellation or settlement. */
  action: RuntimeActionEvent | null;
  /** Detailed outcome for this call; never infer it from a captured React state value. */
  execute(input: RuaExecuteInput<Context>): Promise<RequestOutcome>;
  /** Answer only the identified pending operation; stale answers are rejected. */
  respond(input: RuaAnswerInput): Promise<RequestOutcome>;
  /** Respond only to this pending approval. Returns false for obsolete responses. */
  respondToApproval(input: RuaApprovalInput): boolean;
  /** Compatibility interface: returns the receipt on success, otherwise undefined. */
  plan(
    intention: string,
    context?: Context,
  ): Promise<ExecutionResult | undefined>;
  answer(answer: string): Promise<ExecutionResult | undefined>;
  startOver(): void;
  /** Omit the identity to cancel this hook's current operation. */
  cancel(): void;
  cancel(operationId: string): void;
}

type CancellationReason = Extract<
  RequestOutcome,
  { status: "cancelled" }
>["reason"];

interface Operation<Context> {
  identity: RequestIdentity;
  options: CoordinatorOptions<Context>;
  context: Context | undefined;
  prompt: string;
  controller: AbortController;
  memory: Map<string, unknown>;
  cancellationReason?: CancellationReason;
  dispose(): void;
}

interface OwnedRequest<Context> {
  requestId: number;
  operation: Operation<Context>;
}

interface PendingClarification<Context> extends OwnedRequest<Context> {
  turns: ClarificationTurn[];
  clarification: Clarification;
}

let identitySequence = 0;
function createIdentity(correlation?: RequestCorrelation): RequestIdentity {
  return Object.freeze({
    operationId:
      globalThis.crypto?.randomUUID?.() ??
      `rua-${Date.now()}-${++identitySequence}`,
    ...(correlation ? { correlation: Object.freeze({ ...correlation }) } : {}),
  });
}

function rejected(
  identity: RequestIdentity,
  code: "INVALID_REQUEST" | "UNAVAILABLE" | "BUSY" | "STALE_REQUEST",
  message: string,
): RequestOutcome {
  return { ...identity, status: "rejected", error: { code, message } };
}

function receipt(outcome: RequestOutcome): ExecutionResult | undefined {
  return outcome.status === "completed" || outcome.status === "triggered"
    ? outcome.result
    : undefined;
}

function abort<Context>(
  operation: Operation<Context>,
  reason: CancellationReason,
  cause?: unknown,
): void {
  if (!operation.controller.signal.aborted) {
    operation.cancellationReason = reason;
    operation.controller.abort(cause);
  }
}

/** React request coordination. Browser construction starts only after submission. */
export function useRequestCoordinator<Context>(
  options: CoordinatorOptions<Context>,
): RequestCoordinator<Context> {
  const [state, dispatch] = useReducer(requestReducer, INITIAL_REQUEST_STATE);
  const [currentPlan, setCurrentPlan] = useState<Plan | null>(null);
  const [action, setAction] = useState<RuntimeActionEvent | null>(null);
  const active = useRef<OwnedRequest<Context> | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const committedOptions = useRef(options);
  const pending = useRef<PendingClarification<Context> | null>(null);
  const pendingApproval = useRef<{
    operationId: string;
    approvalId: string;
    resolve(approved: boolean): void;
  } | null>(null);

  useEffect(() => {
    committedOptions.current = options;
  }, [options]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const request = active.current ?? pending.current;
      active.current = null;
      pending.current = null;
      setAction(null);
      if (request) {
        // Settle the old attempt before Strict Mode can start its replacement.
        dispatch({ type: "cancelled", requestId: request.requestId });
        abort(request.operation, "unmounted");
        request.operation.dispose();
      }
    };
  }, []);

  const perform = useCallback(
    async (
      operation: Operation<Context>,
      turns: ClarificationTurn[] = [],
      previous?: PendingClarification<Context>,
    ): Promise<RequestOutcome> => {
      const request: OwnedRequest<Context> = {
        requestId: ++sequence.current,
        operation,
      };
      const {
        identity,
        options: settings,
        context,
        prompt,
        controller,
      } = operation;

      active.current = request;
      pending.current = null;
      setAction(null);
      dispatch({ type: "started", requestId: request.requestId, identity });

      const ownsRequest = (): boolean =>
        mounted.current && active.current === request;
      const acceptsProgress = (): boolean =>
        ownsRequest() && !controller.signal.aborted;
      const cancelled = (): RequestOutcome => ({
        ...identity,
        status: "cancelled",
        reason: operation.cancellationReason ?? "aborted",
      });

      try {
        controller.signal.throwIfAborted();
        const result = await settings.runRequest(
          {
            prompt,
            context,
            identity,
            signal: controller.signal,
            clarifications: turns,
            memory: operation.memory,
          },
          getSession(settings),
          {
            onApproval: (context) => {
              context.signal.throwIfAborted();
              if (settings.onApproval) return settings.onApproval(context);
              const approvalId = createIdentity().operationId;
              setAction(null);
              return new Promise<boolean>((resolve) => {
                const cancel = () => finish(false);
                const finish = (approved: boolean): void => {
                  context.signal.removeEventListener("abort", cancel);
                  if (pendingApproval.current === entry)
                    pendingApproval.current = null;
                  if (acceptsProgress() && !context.signal.aborted)
                    dispatch({
                      type: "approval-resolved",
                      requestId: request.requestId,
                    });
                  resolve(approved);
                };
                const entry = {
                  operationId: identity.operationId,
                  approvalId,
                  resolve: finish,
                };
                pendingApproval.current = entry;
                context.signal.addEventListener("abort", cancel, {
                  once: true,
                });
                if (context.signal.aborted) cancel();
                else
                  dispatch({
                    type: "approval",
                    requestId: request.requestId,
                    approvalId,
                    approval: context.approval,
                    originalPrompt: prompt,
                  });
              });
            },
            onPlan: (plan) => {
              if (acceptsProgress()) setCurrentPlan(plan);
            },
            onProgress: (message) => {
              if (acceptsProgress())
                dispatch({
                  type: "progress",
                  requestId: request.requestId,
                  message,
                });
            },
            onPhaseChange: (phase) => {
              if (acceptsProgress())
                dispatch({
                  type: "phase",
                  requestId: request.requestId,
                  phase,
                });
            },
            onAction: (event) => {
              if (!ownsRequest()) return;
              if (event.phase === "cancelled" || event.phase === "failed")
                setAction(null);
              else if (acceptsProgress()) setAction(event);
            },
          },
        );

        if (!ownsRequest()) return cancelled();
        controller.signal.throwIfAborted();
        if (result.status === "failed")
          throw new Error(result.events.at(-1) || "Request failed.");

        dispatch({ type: "triggered", requestId: request.requestId, result });
        return {
          ...identity,
          status: result.goalCompleted ? "completed" : "triggered",
          result,
        };
      } catch (error) {
        if (!ownsRequest()) return cancelled();
        if (
          controller.signal.aborted ||
          ((error instanceof Error || error instanceof DOMException) &&
            error.name === "AbortError")
        ) {
          dispatch({ type: "cancelled", requestId: request.requestId });
          return cancelled();
        }
        if (error instanceof ClarificationNeededError && turns.length < 3) {
          pending.current = {
            ...request,
            turns,
            clarification: error.clarification,
          };
          dispatch({
            type: "clarification",
            requestId: request.requestId,
            clarification: error.clarification,
            originalPrompt: prompt,
          });
          return {
            ...identity,
            status: "needs-input",
            clarification: error.clarification,
          };
        }
        const failure =
          error instanceof ClarificationNeededError
            ? {
                code: "CLARIFICATION_REQUIRED" as const,
                message:
                  "I still could not resolve the request. Start a new request with more detail.",
              }
            : toRequestError(error);
        // Keep the existing answer-retry behavior, and describe it in the outcome.
        const canRespond =
          !!previous &&
          !(error instanceof ClarificationNeededError) &&
          failure.code !== "APPROVAL_DENIED" &&
          failure.code !== "APPROVAL_REQUIRED" &&
          (settings.canRespond?.(error, operation.memory) ?? true);
        if (previous && canRespond) {
          pending.current = { ...previous, requestId: request.requestId };
          dispatch({
            type: "clarification",
            requestId: request.requestId,
            clarification: previous.clarification,
            originalPrompt: prompt,
            message: failure.message,
          });
        } else {
          dispatch({
            type: "failed",
            requestId: request.requestId,
            message: failure.message,
            error: failure,
          });
        }
        return failure.code === "BUSY" || failure.code === "INVALID_REQUEST"
          ? { ...identity, status: "rejected", error: failure }
          : { ...identity, status: "failed", error: failure, canRespond };
      } finally {
        if (active.current === request) {
          active.current = null;
          setAction(null);
        }
        if (pending.current?.operation !== operation) operation.dispose();
      }
    },
    [],
  );

  const execute = useCallback(
    (input: RuaExecuteInput<Context>): Promise<RequestOutcome> => {
      const identity = createIdentity(input.correlation);
      const callerSignal = input.signal;
      const refuse = (
        code: "INVALID_REQUEST" | "UNAVAILABLE" | "BUSY",
        message: string,
      ) => Promise.resolve(rejected(identity, code, message));
      if (!mounted.current)
        return refuse(
          "UNAVAILABLE",
          "Submit a Rua request after the component has mounted.",
        );
      if (active.current)
        return refuse("BUSY", "A RuaKit request is already running.");
      if (
        typeof input.prompt !== "string" ||
        !input.prompt.trim() ||
        input.prompt.trim().length > 2000
      ) {
        return refuse(
          "INVALID_REQUEST",
          "Enter a request between 1 and 2000 characters.",
        );
      }

      const settings = committedOptions.current;
      const context =
        input.context === undefined ? settings.context : input.context;
      if (callerSignal?.aborted)
        return Promise.resolve({
          ...identity,
          status: "cancelled",
          reason: "caller",
        });

      const previous = pending.current;
      pending.current = null;
      if (previous) {
        previous.operation.dispose();
        abort(previous.operation, "explicit");
      }

      const controller = new AbortController();
      setCurrentPlan(null);
      const operation: Operation<Context> = {
        identity,
        options: settings,
        context,
        prompt: input.prompt,
        controller,
        memory: new Map(),
        dispose() {
          operation.memory.clear();
          callerSignal?.removeEventListener("abort", fromCaller);
          controller.signal.removeEventListener("abort", onAbort);
        },
      };
      const fromCaller = (): void =>
        abort(operation, "caller", callerSignal?.reason);
      const onAbort = (): void => {
        if (!mounted.current) return;
        if (active.current?.operation === operation) {
          dispatch({ type: "cancelling", requestId: active.current.requestId });
          setAction(null);
        } else if (pending.current?.operation === operation) {
          const question = pending.current;
          pending.current = null;
          operation.dispose();
          dispatch({ type: "cancelled", requestId: question.requestId });
        }
      };

      controller.signal.addEventListener("abort", onAbort, { once: true });
      callerSignal?.addEventListener("abort", fromCaller, { once: true });
      // Cover an abort between the initial check and listener attachment.
      if (callerSignal?.aborted) fromCaller();

      return perform(operation);
    },
    [perform],
  );

  const respond = useCallback(
    (input: RuaAnswerInput): Promise<RequestOutcome> => {
      const question = pending.current;
      if (
        !question ||
        question.operation.identity.operationId !== input.operationId
      ) {
        return Promise.resolve(
          rejected(
            { operationId: input.operationId },
            "STALE_REQUEST",
            "This request is no longer waiting for an answer.",
          ),
        );
      }

      const { operation } = question;
      if (
        typeof input.answer !== "string" ||
        !input.answer.trim() ||
        input.answer.trim().length > 2000
      ) {
        return Promise.resolve(
          rejected(
            operation.identity,
            "INVALID_REQUEST",
            "Enter an answer between 1 and 2000 characters.",
          ),
        );
      }

      const current = committedOptions.current;
      if (
        operation.options.session !== current.session ||
        operation.options.document !== current.document ||
        operation.options.serverUrl !== current.serverUrl ||
        operation.options.transport !== current.transport
      ) {
        return Promise.resolve(
          rejected(
            operation.identity,
            "STALE_REQUEST",
            "The Rua session or planner configuration changed. Start a new request.",
          ),
        );
      }

      return perform(
        operation,
        [
          ...question.turns,
          {
            question: question.clarification.question,
            answer: input.answer.trim(),
          },
        ],
        question,
      );
    },
    [perform],
  );

  const plan = useCallback(
    async (prompt: string, context?: Context) =>
      receipt(
        await execute({
          prompt,
          ...(context !== undefined ? { context } : {}),
        }),
      ),
    [execute],
  );

  const respondToApproval = useCallback((input: RuaApprovalInput): boolean => {
    const approval = pendingApproval.current;
    if (
      !mounted.current ||
      !approval ||
      typeof input.approved !== "boolean" ||
      input.operationId !== approval.operationId ||
      input.approvalId !== approval.approvalId
    )
      return false;
    approval.resolve(input.approved);
    return true;
  }, []);

  const answer = useCallback(
    async (reply: string): Promise<ExecutionResult | undefined> => {
      const operationId = pending.current?.operation.identity.operationId;
      return operationId
        ? receipt(await respond({ operationId, answer: reply }))
        : undefined;
    },
    [respond],
  );

  const startOver = useCallback(() => {
    if (active.current) return;
    const question = pending.current;
    pending.current = null;
    if (question) {
      question.operation.dispose();
      abort(question.operation, "explicit");
    }
    dispatch({ type: "reset" });
    setCurrentPlan(null);
  }, []);

  const cancel = useCallback((operationId?: string): void => {
    const operation = (active.current ?? pending.current)?.operation;
    if (
      !mounted.current ||
      !operation ||
      (typeof operationId === "string" &&
        operation.identity.operationId !== operationId)
    )
      return;
    abort(operation, "explicit");
  }, []);

  return {
    currentPlan,
    state,
    loading: requestIsBusy(state),
    action,
    execute,
    respond,
    respondToApproval,
    plan,
    answer,
    startOver,
    cancel,
  };
}
