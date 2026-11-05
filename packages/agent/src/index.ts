// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
export { createRuntime } from './runtime.js';
export type { RuntimeOptions, PlanRuntimeOptions, RequestOptions, RuaKitRuntime } from './runtime.js';
export { createSession } from './session.js';
export type {
  RuaSession,
  ExecutionOptions,
  RunOptions,
  PlanOptions,
  CompletionContext,
} from './session.js';
export type { PageState } from '@ruakit/runtime';
export { createHttpTransport } from './transport.js';
export type { HttpTransportOptions, RuaKitTransport } from './transport.js';
export { createPlanTransport } from './plan-transport.js';
export type { PlanTransport, PlanHttpTransportOptions } from './plan-transport.js';
export type { PlanExecutionOptions, PlanExecutionResult, PlanPlanner, PlanTaskOptions, PlanTask } from './plan.js';
export { RuaKitError, ClarificationNeededError, ApprovalNeededError } from './errors.js';
export type { ApprovalContext, ApprovalRequest, ApprovalOptions } from './approval.js';
export type { RuntimeErrorCode } from './errors.js';
export type { RequestPhase, RequestState } from './request-state.js';
export type {
  ActionFeedbackOptions,
  ActionRect,
  RuntimeAction,
  RuntimeActionEvent,
} from '@ruakit/runtime';
export type {
  Clarification,
  ClarificationTurn,
  ExecutionResult,
  CompletionCheck,
  DecisionRequest,
  Decision,
  ApprovalDecision,
  PlanApproval,
  Plan, PlannedStep, CompletedPlanStep, Replan, PlanRequest, PlanResponse, JsonValue,
} from '@ruakit/schema';

export { INITIAL_REQUEST_STATE, requestIsBusy, requestReducer } from './request-state.js';
export type { RequestEvent } from './request-state.js';
export { toRequestError } from './request-outcome.js';
export type {
  RequestCorrelation,
  RequestIdentity,
  RequestError,
  RequestOutcome,
} from './request-outcome.js';

export type { Screenshot, ScreenshotImage } from '@ruakit/runtime';
