// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
import type { Clarification, ExecutionResult } from '@ruakit/schema';
import { RuntimeError } from '@ruakit/runtime';
import type { RuntimeErrorCode as BrowserErrorCode } from '@ruakit/runtime';
import { RuaKitError } from './errors.js';
import type { RuntimeErrorCode } from './errors.js';

/** Host labels for associating local work with a conversation. Never authorize actions. */
export interface RequestCorrelation {
  readonly threadId?: string;
  readonly messageId?: string;
  readonly toolCallId?: string;
}

export interface RequestIdentity {
  /** Stable across clarification attempts; distinct from the UI's numeric attempt ID. */
  readonly operationId: string;
  readonly correlation?: RequestCorrelation;
}

export interface RequestError {
  readonly code:
    RuntimeErrorCode | BrowserErrorCode | 'STALE_REQUEST' | 'REQUEST_FAILED';
  readonly message: string;
}

/** Local integration outcomes, not additions to the planner wire protocol. */
export type RequestOutcome = RequestIdentity &
  (
    | { status: 'completed'; result: ExecutionResult }
    | { status: 'triggered'; result: ExecutionResult }
    | { status: 'needs-input'; clarification: Clarification }
    | {
        status: 'cancelled';
        reason: 'caller' | 'explicit' | 'unmounted' | 'aborted';
      }
    | { status: 'rejected'; error: RequestError }
    | {
        status: 'failed';
        error: RequestError;
        /** A failed answer can be retried against the same pending question. */
        canRespond: boolean;
      }
  );

/** Preserve known execution codes without trusting arbitrary thrown objects. */
export function toRequestError(error: unknown): RequestError {
  const exception = error instanceof Error || error instanceof DOMException;
  return {
    code:
      error instanceof RuaKitError || error instanceof RuntimeError
        ? error.code
        : exception && error.name === 'TimeoutError'
          ? 'TIMEOUT'
          : 'REQUEST_FAILED',
    message: exception ? error.message : 'Request failed.',
  };
}
