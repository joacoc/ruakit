// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { ExecutionResult } from "@ruakit/schema";
import {
  INITIAL_REQUEST_STATE,
  requestIsBusy,
  requestReducer,
} from "../dist/request-state.js";
import type { RequestEvent } from "../dist/request-state.js";

const result: ExecutionResult = {
  planId: "request-plan",
  status: "triggered",
  events: ["Action triggered"],
};

describe("request lifecycle transitions", () => {
  it("locks a running request and immediately replaces the previous feedback", () => {
    const running = requestReducer(INITIAL_REQUEST_STATE, {
      type: "started",
      requestId: 1,
    });
    expect(requestIsBusy(running)).toBe(true);
    expect(running).toMatchObject({
      status: "running",
      requestId: 1,
      phase: "observing",
      message: "Thinking…",
    });
    expect(requestReducer(running, { type: "started", requestId: 2 })).toBe(
      running,
    );

    const failed = requestReducer(running, {
      type: "failed",
      requestId: 1,
      message: "Action unavailable",
    });
    const restarted = requestReducer(failed, { type: "started", requestId: 2 });
    expect(restarted).toMatchObject({
      status: "running",
      message: "Thinking…",
    });
  });

  it("rejects callbacks from an older request after a new request starts", () => {
    const first = requestReducer(INITIAL_REQUEST_STATE, {
      type: "started",
      requestId: 1,
    });
    const settled = requestReducer(first, {
      type: "triggered",
      requestId: 1,
      result,
    });
    const current = requestReducer(settled, { type: "started", requestId: 2 });
    const obsoleteEvents: RequestEvent[] = [
      { type: "progress", requestId: 1, message: "Old progress" },
      { type: "phase", requestId: 1, phase: "executing" },
      { type: "cancelling", requestId: 1 },
      { type: "cancelled", requestId: 1 },
      { type: "triggered", requestId: 1, result },
      { type: "failed", requestId: 1, message: "Old failure" },
    ];
    for (const event of obsoleteEvents) {
      expect(requestReducer(current, event)).toBe(current);
    }
  });

  it("keeps cancellation locked and suppresses late progress and completion", () => {
    const running = requestReducer(INITIAL_REQUEST_STATE, {
      type: "started",
      requestId: 1,
    });
    const cancelling = requestReducer(running, {
      type: "cancelling",
      requestId: 1,
    });
    expect(requestIsBusy(cancelling)).toBe(true);
    expect(cancelling).toMatchObject({
      status: "cancelling",
      message: "Cancelling request…",
    });
    const lateEvents: RequestEvent[] = [
      { type: "started", requestId: 2 },
      { type: "progress", requestId: 1, message: "Action triggered" },
      { type: "phase", requestId: 1, phase: "executing" },
      { type: "triggered", requestId: 1, result },
      { type: "failed", requestId: 1, message: "Abort error" },
    ];
    for (const event of lateEvents) {
      expect(requestReducer(cancelling, event)).toBe(cancelling);
    }
    const cancelled = requestReducer(cancelling, {
      type: "cancelled",
      requestId: 1,
    });
    expect(requestIsBusy(cancelled)).toBe(false);
    expect(cancelled).toMatchObject({
      status: "cancelled",
      message: "Request cancelled",
    });
  });

  it("does not reopen a settled request when callbacks arrive late", () => {
    const running = requestReducer(INITIAL_REQUEST_STATE, {
      type: "started",
      requestId: 1,
    });
    const triggered = requestReducer(running, {
      type: "triggered",
      requestId: 1,
      result,
    });
    expect(requestIsBusy(triggered)).toBe(false);
    const lateEvents: RequestEvent[] = [
      { type: "progress", requestId: 1, message: "Late progress" },
      { type: "phase", requestId: 1, phase: "observing" },
      { type: "cancelling", requestId: 1 },
      { type: "failed", requestId: 1, message: "Late failure" },
    ];
    for (const event of lateEvents) {
      expect(requestReducer(triggered, event)).toBe(triggered);
    }
  });
});
