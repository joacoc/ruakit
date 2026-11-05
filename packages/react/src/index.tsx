// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- Ship CSS import types to consumers without requiring host declarations.
/// <reference path="./styles.d.ts" preserve="true" />
"use client";

import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import "./styles.css";
import { TOOLBAR_TEXT } from "./constants.js";
import { Toolbar } from "./components/toolbar.js";
import { useRua } from "./hooks/use-rua.js";
import type { RuaOptions } from "./hooks/use-rua.js";
import { useCursorTiming } from "./hooks/use-cursor-timing.js";
import { RuaCursor } from "./components/cursor.js";
import type { CursorVisibility } from "./components/cursor.js";

export { useRua } from "./hooks/use-rua.js";
export { useCursorTiming } from "./hooks/use-cursor-timing.js";
export type { CursorTiming } from "./hooks/use-cursor-timing.js";
export type { RuaAgent, RuaOptions, RequestPlan } from "./hooks/use-rua.js";
export { useSnapshot } from "./hooks/use-snapshot.js";
export { useRun } from "./hooks/use-run.js";
export type { RuaRun, RuaRunOptions } from "./hooks/use-run.js";
export { usePlan } from "./hooks/use-plan.js";
export type { RuaPlan, RuaPlanOptions } from "./hooks/use-plan.js";
export type {
  RuaExecuteInput,
  RuaAnswerInput,
  RuaApprovalInput,
} from "./hooks/use-request-coordinator.js";
export type { RuaSessionOptions } from "./lib/session.js";
export type {
  PageState,
  DecisionRequest,
  Decision,
  ExecutionResult,
  RuaSession,
  CompletionCheck,
  CompletionContext,
  ApprovalContext,
  ApprovalRequest,
  ApprovalDecision,
  PlanApproval,
  Screenshot,
  Plan,
  PlannedStep,
  CompletedPlanStep,
  Replan,
  PlanRequest,
  PlanResponse,
  PlanExecutionResult,
} from "@ruakit/agent";
export type {
  RequestPhase,
  RequestState,
  RuntimeActionEvent,
} from "@ruakit/agent";
export type {
  RequestCorrelation,
  RequestIdentity,
  RequestOutcome,
  RequestError,
} from "@ruakit/agent";
export { RuaCursor } from "./components/cursor.js";
export type {
  CursorAnchor,
  CursorVisibility,
  RuaCursorProps,
} from "./components/cursor.js";

export interface RuaProps extends RuaOptions {
  placeholder?: string;
  /** Show Rua's decorative cursor. Defaults to true. */
  visualCursor?: boolean;
  /** Retain the cursor for each plan or the mounted session. Defaults to plan. */
  cursorVisibility?: CursorVisibility | undefined;
  /** Optional text beside the cursor. Empty or undefined hides the label. */
  cursorLabel?: string | undefined;
  /** Show a subtle strip at the edge when the cursor is off-screen. Defaults to true. */
  cursorEdgeGlow?: boolean | undefined;
  /** Recessed status and question panels. Defaults to normal. */
  messageStyle?: "normal" | "glass" | undefined;
}

/** Optional React UI: connect draft input to the independently usable request hook. */
export function Rua({
  placeholder = TOOLBAR_TEXT.placeholder,
  visualCursor = true,
  cursorVisibility = "plan",
  cursorLabel,
  cursorEdgeGlow = true,
  messageStyle,
  ...options
}: RuaProps): ReactElement {
  const [prompt, setPrompt] = useState("");
  const timing = useCursorTiming(options.actionDelayMs);
  useEffect(() => {
    if (!visualCursor) timing.position.current = null;
  }, [visualCursor, timing.position]);
  const request = useRua({
    ...options,
    actionDelayMs: visualCursor ? timing.actionDelayMs : 0,
  });

  return (
    <>
      {visualCursor && (
        <RuaCursor
          timing={timing}
          action={request.action}
          active={request.loading}
          visibility={cursorVisibility}
          label={cursorLabel}
          edgeGlow={cursorEdgeGlow}
        />
      )}
      <Toolbar
        prompt={prompt}
        placeholder={placeholder}
        request={request.state}
        messageStyle={messageStyle}
        onPromptChange={setPrompt}
        onSubmit={() => {
          void (request.state.status === "clarification"
            ? request.answer(prompt)
            : request.submit(prompt));
        }}
        onCancel={request.cancel}
        onAnswer={(answer) => {
          void request.answer(answer);
        }}
        onApprovalResponse={(approved) => {
          if (request.state.status !== "approval" || !request.state.identity)
            return;
          request.respondToApproval({
            operationId: request.state.identity.operationId,
            approvalId: request.state.approvalId,
            approved,
          });
        }}
        onStartOver={request.startOver}
      />
    </>
  );
}

export { Toolbar } from "./components/toolbar.js";
export type { ToolbarProps } from "./components/toolbar.js";
