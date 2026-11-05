// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { z } from 'zod';

/** Identifies a control by its observed identity and accessible context. */
export const controlLocatorSchema = z.strictObject({
  id: z.string().min(1).max(200).nullable(),
  role: z.string().max(100),
  label: z.string().max(1000),
  context: z.string().max(1000).nullable(),
  group: z.string().max(200).nullable(),
});

/** Reuse the same locator constraints for all control checks. */
const locator = controlLocatorSchema;

/** Human-readable explanation of the outcome being checked. */
const description = z.string().trim().min(1).max(500);

/** A single observable condition that can establish progress toward a goal. */
export const completionCheckSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('value'),
    description,
    control: locator,
    equals: z.string().max(20000),
  }),
  z.strictObject({
    type: z.literal('checked'),
    description,
    control: locator,
    equals: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('selected'),
    description,
    control: locator,
    equals: z.array(z.string().max(4000)).max(100),
  }),
  z.strictObject({
    type: z.literal('text'),
    description,
    text: z.string().trim().min(1).max(2000),
    fresh: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('url'),
    description,
    equals: z.string().min(1).max(4000),
  }),
  z.strictObject({ type: z.literal('absent'), description, control: locator }),
]);

/** A nonempty, bounded collection of outcome checks. */
export const completionChecksSchema = z.array(completionCheckSchema).min(1).max(20);

/** A validated observable outcome check. */
export type CompletionCheck = z.infer<typeof completionCheckSchema>;


/** The observed page information needed to evaluate outcome checks. */
export interface VerificationState {
  url: string;
  text: string;
  truncated: boolean;
  controls: {
    target: { id: string; version: number };
    role: string;
    label: string;
    context: string;
    groups?: { name: string }[] | undefined;
    value?: string | undefined;
    checked?: boolean | undefined;
    selectedValues?: string[] | undefined;
  }[];
}

type ObservedControl = VerificationState['controls'][number];
type ControlLocator = z.infer<typeof controlLocatorSchema>;
type ControlCheck = Extract<CompletionCheck, { control: ControlLocator }>;

/** Match accessible characteristics independently of the observation's target ID. */
function matchesControl(control: ObservedControl, locator: ControlLocator): boolean {
  return (
    control.role === locator.role &&
    control.label === locator.label &&
    (locator.context === null || control.context === locator.context) &&
    (locator.group === null ||
      control.groups?.some((group) => group.name === locator.group) === true)
  );
}

/** Check visible text without treating a control's caption as an acknowledgement. */
function matchesText(
  check: Extract<CompletionCheck, { type: 'text' }>,
  state: VerificationState,
  baseline: VerificationState,
): boolean {
  const isVisible = state.text.includes(check.text);
  const isControlLabel = state.controls.some((control) => control.label.includes(check.text));
  const isFresh = !check.fresh || !baseline.text.includes(check.text);

  return isVisible && !isControlLabel && isFresh;
}

/** Compare the observed control's state with the expected value. */
function matchesControlValue(
  check: Exclude<ControlCheck, { type: 'absent' }>,
  control: ObservedControl,
): boolean {
  if (check.type === 'value') return control.value === check.equals;
  if (check.type === 'checked') return control.checked === check.equals;

  const selectedValues = control.selectedValues;
  if (selectedValues === undefined) return false;

  return (
    selectedValues.length === check.equals.length &&
    new Set(check.equals).size === check.equals.length &&
    check.equals.every((value) => selectedValues.includes(value))
  );
}

/** Resolve a control check against the current observation. */
function matchesControlCheck(check: ControlCheck, state: VerificationState): boolean {
  const semanticMatches = state.controls.filter((control) => matchesControl(control, check.control));

  // A recycled target ID must not hide a control when checking for absence.
  if (check.type === 'absent') return !state.truncated && semanticMatches.length === 0;

  const matches = semanticMatches.filter(
    (control) => check.control.id === null || control.target.id === check.control.id,
  );

  // A value can only be verified when the locator identifies exactly one control.
  if (matches.length !== 1) return false;
  return matchesControlValue(check, matches[0]!);
}

/** Deterministic checks of observable outcomes. This does not infer intent or prove backend persistence. */
export function evaluateCompletionChecks(
  checks: readonly CompletionCheck[],
  state: VerificationState,
  baseline: VerificationState = state,
): { passed: boolean; checks: { description: string; passed: boolean }[] } {
  const results = checks.map((check) => {
    let passed: boolean;

    if (check.type === 'text') {
      passed = matchesText(check, state, baseline);
    } else if (check.type === 'url') {
      passed = state.url === check.equals;
    } else {
      passed = matchesControlCheck(check, state);
    }

    return { description: check.description, passed };
  });

  return {
    passed: results.length > 0 && results.every((result) => result.passed),
    checks: results,
  };
}

/** A bounded, encoded screenshot with its capture metadata. */
export const screenshotSchema = z
  .strictObject({
    data: z
      .string()
      .min(1)
      .max(7_000_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/)
      .refine((data) => data.length % 4 === 0),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    width: z.number().int().positive().max(8192),
    height: z.number().int().positive().max(8192),
    capturedAt: z.number().int().nonnegative(),
    url: z.string().max(4000),
  })
  .superRefine((image, context) => {
    try {
      // Decode the payload before checking its size and file signature.
      const bytes = globalThis.atob(image.data);

      const signatureMatches =
        image.mimeType === 'image/png'
          ? bytes.startsWith('\x89PNG\r\n\x1a\n')
          : image.mimeType === 'image/jpeg'
            ? bytes.startsWith('\xff\xd8\xff')
            : bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';

      if (bytes.length > 5 * 1024 * 1024 || !signatureMatches) {
        context.addIssue({
          code: 'custom',
          message: 'Screenshot bytes must match the image type and fit within 5 MiB.',
        });
      }
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Screenshot data must contain valid base64 image bytes.',
      });
    }
  });
