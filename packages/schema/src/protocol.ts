// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import type { DecisionRequest } from './decision.js';
import { completionChecksSchema, screenshotSchema } from './verification.js';

/** Name of the HTML metadata element used for runtime configuration. */
export const RUNTIME_META_NAME = 'ruakit-config';

/** A conversational response contains no executable instructions. */
export const clarificationSchema = z.strictObject({
  type: z.literal('clarification'),
  question: z.string().trim().min(1).max(500),
  options: z
    .array(z.string().trim().min(1).max(400))
    .max(4)
    .refine((items) => new Set(items).size === items.length, 'Expected distinct options.'),
});

/** Result of an execution, including any observed verification evidence. */
export const resultSchema = z.strictObject({
  planId: z.string().min(1).max(200),
  status: z.enum(['triggered', 'failed']),
  events: z.array(z.string().max(500)).max(220),
  goalCompleted: z.literal(true).optional(),
  verification: z
    .strictObject({ level: z.enum(['observed', 'confirmed']), checks: completionChecksSchema })
    .optional(),
  screenshot: screenshotSchema.optional(),
  message: z.string().max(2000).optional(),
});

/** A question and optional choices returned to the user. */
export type Clarification = z.infer<typeof clarificationSchema>;
/** One question and answer included in a decision request. */
export type ClarificationTurn = DecisionRequest['clarifications'][number];
/** A validated execution result. */
export type ExecutionResult = z.infer<typeof resultSchema>;
