// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { z } from 'zod';
import { decisionRequestSchema, actionSchema } from './decision.js';
import {
  completionChecksSchema,
  controlLocatorSchema,
} from './verification.js';

/** Shared constraints for plan and step identifiers. */
const identifier = z.string().trim().min(1).max(200);

/** Fields added to each action when it becomes a planned step. */
const metadata = {
  id: identifier,
  message: z.string().trim().min(1).max(2000),
  target: controlLocatorSchema,
};

/** Resolve these locators against a fresh observation before executing each step. */
export const plannedStepSchema = z.discriminatedUnion('type', [
  actionSchema.options[0].extend(metadata),
  actionSchema.options[1].extend(metadata),
  actionSchema.options[2].extend(metadata),
  actionSchema.options[3].extend(metadata),
  actionSchema.options[4].extend(metadata),
  actionSchema.options[5].extend(metadata),
  actionSchema.options[6].extend(metadata),
]);

/** An ordered plan and the checks used to assess its outcome. */
export const planSchema = z.strictObject({
  id: identifier,
  replacesPlanId: identifier.optional(),
  message: z.string().trim().min(1).max(2000),
  steps: z
    .array(plannedStepSchema)
    .max(50)
    .refine(
      (steps) => new Set(steps.map((step) => step.id)).size === steps.length,
      'Plan step IDs must be distinct.',
    ),
  checks: completionChecksSchema,
});

/** Approval covers this concrete plan revision, including every action and argument. */
export const planApprovalSchema = z.strictObject({
  type: z.literal('approval'),
  message: z.string().trim().min(1).max(2000),
  plan: planSchema,
});

/** A step that has already been executed as part of a plan. */
export const completedPlanStepSchema = z.strictObject({
  planId: identifier,
  step: plannedStepSchema,
});

/** Execution history and reason supplied when requesting a replacement plan. */
export const replanSchema = z.strictObject({
  planId: identifier,
  completedSteps: z.array(completedPlanStepSchema).max(200),
  failedStepId: identifier.nullable(),
  reason: z.enum(['target-unavailable', 'target-stale', 'outcome-mismatch']),
  message: z.string().min(1).max(2000),
});

/** JSON-compatible context accepted by the planning protocol. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Return the estimated size of a JSON primitive, or null for other values. */
function primitiveSize(value: unknown): number | null {
  if (value === null || typeof value === 'boolean') return 5;
  if (typeof value === 'string') return value.length;
  if (typeof value === 'number' && Number.isFinite(value)) return 24;
  return null;
}

/** Accept arrays and plain objects, but not class instances or other objects. */
function isJsonContainer(value: object): boolean {
  if (Array.isArray(value)) return true;

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Check that context is plain JSON within the protocol's traversal and size limits. */
function boundedJson(value: unknown): value is JsonValue {
  const maxNodes = 2048;
  const maxDepth = 8;
  const maxSize = 32768;

  // Track pending values, visited objects, and the estimated serialized size.
  const pending = [{ value, depth: 0 }];
  const seen = new Set<object>();
  let size = 0;
  let nodes = 0;

  while (pending.length > 0) {
    const item = pending.pop()!;
    const current = item.value;

    nodes += 1;
    if (nodes > maxNodes || item.depth > maxDepth) return false;

    const estimatedSize = primitiveSize(current);
    if (estimatedSize !== null) {
      size += estimatedSize;
    } else if (typeof current === 'object' && current !== null) {
      // Repeated references, cycles, and non-plain objects are not accepted.
      if (seen.has(current)) return false;
      seen.add(current);
      if (!isJsonContainer(current)) return false;

      // Account for property names and visit their values at the next depth.
      for (const [key, child] of Object.entries(current)) {
        size += key.length + 4;
        pending.push({ value: child, depth: item.depth + 1 });
      }
    } else {
      return false;
    }

    if (size > maxSize) return false;
  }

  return true;
}

/** Context is JSON data, bounded independently of page observations and images. */
export const planContextSchema = z.custom<JsonValue>(
  boundedJson,
  'Expected bounded JSON context.',
);

/** Request for a plan, optionally including application context and replan history. */
export const planRequestSchema = decisionRequestSchema
  .omit({ history: true })
  .extend({
    protocol: z.literal('plan'),
    context: planContextSchema.optional(),
    checks: completionChecksSchema.nullable(),
    replan: replanSchema.nullable(),
  });

/** A plan or a response explaining what the planner needs next. */
export const planResponseSchema = z.union([
  planSchema,
  planApprovalSchema,
  z.strictObject({
    type: z.literal('clarify'),
    message: z.string().min(1).max(500),
  }),
  z.strictObject({
    type: z.literal('screenshot'),
    message: z.string().min(1).max(2000),
  }),
  z.strictObject({
    type: z.literal('unsupported'),
    message: z.string().min(1).max(2000),
  }),
]);

/** A validated plan. */
export type Plan = z.infer<typeof planSchema>;
/** One action in a plan. */
export type PlannedStep = z.infer<typeof plannedStepSchema>;
/** A completed step and its originating plan. */
export type CompletedPlanStep = z.infer<typeof completedPlanStepSchema>;
/** The context for replacing a plan. */
export type Replan = z.infer<typeof replanSchema>;
/** A validated planning request. */
export type PlanRequest = z.infer<typeof planRequestSchema>;
/** A validated planning response. */
export type PlanResponse = z.infer<typeof planResponseSchema>;
/** A request to approve a concrete plan. */
export type PlanApproval = z.infer<typeof planApprovalSchema>;
