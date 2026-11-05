// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { z } from "zod";
import { completionChecksSchema, screenshotSchema } from "./verification.js";

/** Identifies a control in a particular observation. */
const target = z.strictObject({
  id: z.string().min(1).max(200),
  version: z.number().int().positive(),
});

/** Describes an accessible group containing a control. */
const controlGroup = z.strictObject({
  role: z.enum([
    "form",
    "group",
    "radiogroup",
    "region",
    "dialog",
    "alertdialog",
  ]),
  name: z.string().min(1).max(200),
});

/** Describes an observed control and its current state. */
const control = z.strictObject({
  target,
  tag: z.string().max(100),
  type: z.string().max(100).optional(),
  role: z.string().max(100),
  label: z.string().max(1000),
  description: z.string().max(1000).optional(),
  placeholder: z.string().max(1000).optional(),
  groups: z.array(controlGroup).min(1).max(4).optional(),
  groupsTruncated: z.boolean().optional(),
  context: z.string().max(1000),
  enabled: z.boolean(),
  readOnly: z.boolean(),
  value: z.string().max(20000).optional(),
  checked: z.boolean().optional(),
  expanded: z.boolean().optional(),
  selectedValues: z.array(z.string().max(4000)).max(100).optional(),
  options: z
    .array(
      z.strictObject({
        value: z.string().max(4000),
        label: z.string().max(1000),
        enabled: z.boolean(),
      }),
    )
    .max(200)
    .optional(),
  valid: z.boolean().optional(),
  contentEditable: z.boolean().optional(),
});

/** Actions the runtime can perform on an observed target. */
export const actionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("click"), target }),
  z.strictObject({ type: z.literal("focus"), target }),
  z.strictObject({
    type: z.literal("insertText"),
    target,
    text: z.string().max(20000),
  }),
  z.strictObject({
    type: z.literal("key"),
    target,
    key: z.string().min(1).max(100),
    altKey: z.boolean(),
    ctrlKey: z.boolean(),
    metaKey: z.boolean(),
    shiftKey: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("fill"),
    target,
    value: z.string().max(4000),
  }),
  z.strictObject({
    type: z.literal("select"),
    target,
    values: z.array(z.string().max(4000)).min(1).max(100),
  }),
  z.strictObject({ type: z.literal("check"), target, checked: z.boolean() }),
]);

/** The model requests permission for this exact action. Only the host can approve it. */
export const approvalDecisionSchema = z.strictObject({
  type: z.literal("approval"),
  message: z.string().trim().min(1).max(2000),
  step: actionSchema,
});

/** Decisions a planner can return for the current observation. */
export const decisionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("act"),
    message: z.string().min(1).max(2000),
    step: actionSchema,
  }),
  z.strictObject({
    type: z.literal("complete"),
    message: z.string().min(1).max(2000),
    checks: completionChecksSchema,
  }),
  z.strictObject({
    type: z.literal("prepare"),
    message: z.string().min(1).max(2000),
    checks: completionChecksSchema,
  }),
  z.strictObject({
    type: z.literal("screenshot"),
    message: z.string().min(1).max(2000),
  }),
  z.strictObject({
    type: z.literal("clarify"),
    message: z.string().min(1).max(500),
  }),
  z.strictObject({
    type: z.literal("unsupported"),
    message: z.string().min(1).max(2000),
  }),
  approvalDecisionSchema,
]);

/** A previous question and the user's answer. */
const clarification = z.strictObject({
  question: z.string().max(500),
  answer: z.string().max(2000),
});

/** The page observation on which the planner should base its decision. */
const snapshot = z.strictObject({
  url: z.string().max(4000),
  title: z.string().max(2000),
  text: z.string().max(20000),
  controls: z.array(control).max(200),
  focused: target.nullable(),
  truncated: z.boolean(),
});

/** Observation and conversation context sent to the planner. */
export const decisionRequestSchema = z.strictObject({
  platform: z.string().max(200).optional(),
  prompt: z.string().trim().min(1).max(2000),
  clarifications: z.array(clarification).max(3),
  snapshot,
  history: z.array(decisionSchema).max(20),
  checks: completionChecksSchema.nullable().optional(),
  canScreenshot: z.boolean().optional(),
  screenshot: screenshotSchema.optional(),
});

/** A validated request for a planner decision. */
export type DecisionRequest = z.infer<typeof decisionRequestSchema>;
/** A validated planner decision. */
export type Decision = z.infer<typeof decisionSchema>;
/** A decision asking the host to approve one action. */
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
