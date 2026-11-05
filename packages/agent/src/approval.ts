// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
import type { ApprovalDecision, PlanApproval } from '@ruakit/schema';
import type { PageState } from '@ruakit/runtime';
import { ApprovalNeededError, RuaKitError } from './errors.js';
import { runWithSignal } from './operations.js';

export type ApprovalRequest = ApprovalDecision | PlanApproval;

export interface ApprovalContext {
  /** A detached copy. Editing it cannot change the action awaiting approval. */
  approval: ApprovalRequest;
  snapshot: PageState;
  prompt: string | undefined;
  signal: AbortSignal;
}

export interface ApprovalOptions {
  /** Ask the user through trusted host UI. Only exactly true grants approval. */
  onApproval?: (context: ApprovalContext) => boolean | Promise<boolean>;
}

/** The model chooses the gate; the host owns the user's answer. Never infer consent. */
export async function requestApproval(
  approval: ApprovalRequest,
  snapshot: PageState,
  signal: AbortSignal,
  options: ApprovalOptions,
  prompt?: string,
): Promise<void> {
  signal.throwIfAborted();
  if (!options.onApproval)
    throw new ApprovalNeededError(structuredClone(approval));
  const accepted = await runWithSignal(signal, () =>
    options.onApproval!({
      approval: structuredClone(approval),
      snapshot: structuredClone(snapshot),
      prompt,
      signal,
    }),
  );
  signal.throwIfAborted();
  if (accepted !== true)
    throw new RuaKitError(
      'APPROVAL_DENIED',
      'The proposed action was not approved.',
    );
}
