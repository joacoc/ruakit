// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
import type { Clarification } from '@ruakit/schema';
import type { ApprovalRequest } from './approval.js';
export type RuntimeErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_PLAN'
  | 'UNAVAILABLE'
  | 'STALE_TARGET'
  | 'BUSY'
  | 'HTTP_ERROR'
  | 'CLARIFICATION_REQUIRED'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_DENIED'
  | 'VERIFICATION_FAILED'
  | 'REPLAN_LIMIT';

/** Errors expose a stable code for embedding applications and a readable message for the toolbar. */
export class RuaKitError extends Error {
  constructor(
    readonly code: RuntimeErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RuaKitError';
  }
}

/** A validated conversational response. Headless consumers can present it and resend with answers. */
export class ClarificationNeededError extends RuaKitError {
  constructor(readonly clarification: Clarification) {
    super('CLARIFICATION_REQUIRED', clarification.question);
    this.name = 'ClarificationNeededError';
  }
}

/** No approval handler was supplied. The proposed action or plan has not executed. */
export class ApprovalNeededError extends RuaKitError {
  constructor(readonly approval: ApprovalRequest) {
    super('APPROVAL_REQUIRED', approval.message);
    this.name = 'ApprovalNeededError';
  }
}

export function parsePayload<T>(
  schema: { parse(value: unknown): T },
  value: unknown,
  code: RuntimeErrorCode,
  message: string,
): T {
  try {
    return schema.parse(value);
  } catch (cause) {
    throw new RuaKitError(code, message, { cause });
  }
}
