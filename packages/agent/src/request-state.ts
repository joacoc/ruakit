// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
import { REQUEST_MESSAGES } from './constants.js';
import type { Clarification, ExecutionResult } from "@ruakit/schema";
import type { RequestError, RequestIdentity } from "./request-outcome.js";
import type { ApprovalRequest } from "./approval.js";

/** Machine-readable execution stages; progress messages remain separate UI text. */
export type RequestPhase = "observing" | "planning" | "executing";

interface ActiveRequest {
  requestId: number;
  message: string;
  identity?: RequestIdentity;
}

export type RequestState =
  | { status: "idle"; message: string }
  | (ActiveRequest & { status: "running" | "cancelling"; phase: RequestPhase })
  | (ActiveRequest & {
      status: "approval";
      approvalId: string;
      approval: ApprovalRequest;
      originalPrompt: string;
    })
  | (ActiveRequest & { status: "triggered"; result: ExecutionResult })
  | (ActiveRequest & {
      status: "clarification";
      clarification: Clarification;
      originalPrompt: string;
    })
  | (ActiveRequest & { status: "cancelled" })
  | (ActiveRequest & { status: "failed"; error?: RequestError });

export type RequestEvent =
  | { type: "started"; requestId: number; identity?: RequestIdentity }
  | { type: "progress"; requestId: number; message: string }
  | { type: "phase"; requestId: number; phase: RequestPhase }
  | {
      type: "approval";
      requestId: number;
      approvalId: string;
      approval: ApprovalRequest;
      originalPrompt: string;
    }
  | { type: "approval-resolved"; requestId: number }
  | {
      type: "cancelling" | "cancelled";
      requestId: number;
    }
  | { type: "triggered"; requestId: number; result: ExecutionResult }
  | { type: "failed"; requestId: number; message: string; error?: RequestError }
  | {
      type: "clarification";
      requestId: number;
      clarification: Clarification;
      originalPrompt: string;
      message?: string;
    }
  | { type: "reset" };

export const INITIAL_REQUEST_STATE: RequestState = Object.freeze({
  status: "idle",
  message: REQUEST_MESSAGES.ready,
});

export function requestIsBusy(
  state: RequestState,
): state is Extract<
  RequestState,
  { status: "running" | "cancelling" | "approval" }
> {
  return (
    state.status === "running" ||
    state.status === "cancelling" ||
    state.status === "approval"
  );
}

/** Ignore obsolete completions and progress after cancellation or settlement. */
export function requestReducer(
  state: RequestState,
  event: RequestEvent,
): RequestState {
  if (event.type === "reset") {
    return requestIsBusy(state) ? state : INITIAL_REQUEST_STATE;
  }
  if (event.type === "started") {
    return requestIsBusy(state)
      ? state
      : {
          status: "running",
          requestId: event.requestId,
          ...(event.identity ? { identity: event.identity } : {}),
          phase: "observing",
          message: REQUEST_MESSAGES.thinking,
        };
  }
  const cancellingQuestion =
    state.status === "clarification" && event.type === "cancelled";
  if (cancellingQuestion && state.requestId === event.requestId) {
    return {
      status: "cancelled",
      requestId: state.requestId,
      ...(state.identity ? { identity: state.identity } : {}),
      message: REQUEST_MESSAGES.cancelled,
    };
  }
  if (!requestIsBusy(state) || state.requestId !== event.requestId) {
    return state;
  }
  const identity = state.identity ? { identity: state.identity } : {};
  switch (event.type) {
    case "progress":
      return state.status === "running"
        ? { ...state, message: event.message }
        : state;
    case "phase":
      return state.status === "running"
        ? { ...state, phase: event.phase }
        : state;
    case "approval":
      return state.status === "cancelling"
        ? state
        : {
            status: "approval",
            ...identity,
            requestId: event.requestId,
            approvalId: event.approvalId,
            approval: event.approval,
            originalPrompt: event.originalPrompt,
            message: event.approval.message,
          };
    case "approval-resolved":
      return state.status !== "approval"
        ? state
        : {
            status: "running",
            ...identity,
            requestId: event.requestId,
            phase: "executing",
            message: REQUEST_MESSAGES.checkingApproval,
          };
    case "cancelling":
      return {
        ...state,
        status: "cancelling",
        phase: state.status === "approval" ? "executing" : state.phase,
        message: REQUEST_MESSAGES.cancelling,
      };
    case "cancelled":
      return {
        status: "cancelled",
        ...identity,
        requestId: event.requestId,
        message: REQUEST_MESSAGES.cancelled,
      };
    case "triggered":
      return state.status === "cancelling"
        ? state
        : {
            status: "triggered",
            ...identity,
            requestId: event.requestId,
            result: event.result,
            message: event.result.message ?? REQUEST_MESSAGES.triggered,
          };
    case "clarification":
      return state.status === "cancelling"
        ? state
        : {
            status: "clarification",
            ...identity,
            requestId: event.requestId,
            clarification: event.clarification,
            originalPrompt: event.originalPrompt,
            message: event.message ?? event.clarification.question,
          };
    case "failed":
      return state.status === "cancelling"
        ? state
        : {
            status: "failed",
            ...identity,
            ...(event.error ? { error: event.error } : {}),
            requestId: event.requestId,
            message: event.message,
          };
  }
}
