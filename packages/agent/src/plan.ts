// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { REQUEST_MESSAGES } from "./constants.js";
import {
  evaluateCompletionChecks,
  planSchema,
  planRequestSchema,
  planResponseSchema,
  planApprovalSchema,
} from "@ruakit/schema";
import type {
  Plan,
  PlannedStep,
  CompletedPlanStep,
  Replan,
  PlanRequest,
  PlanResponse,
  CompletionCheck,
  ExecutionResult,
  Decision,
  ClarificationTurn,
  PlanApproval,
} from "@ruakit/schema";
import { RuntimeError } from "@ruakit/runtime";
import type { LinkNavigation, PageState, Screenshot } from "@ruakit/runtime";
import {
  ClarificationNeededError,
  RuaKitError,
  parsePayload,
} from "./errors.js";
import { runWithSignal } from "./operations.js";
import type { ExecutionOptions } from "./session.js";
import { requestApproval } from "./approval.js";

export type PlanPlanner = (
  input: PlanRequest,
  signal: AbortSignal,
) => Promise<unknown>;
export interface PlanExecutionOptions extends ExecutionOptions {
  prompt?: string;
}
export interface PlanTaskOptions extends ExecutionOptions {
  context?: unknown;
  clarifications?: ClarificationTurn[];
  /** Maximum replacement plans after the initial plan. Defaults to 3. */
  maxReplans?: number;
  onPlan?: (plan: Plan) => void;
}
export type PlanExecutionResult =
  | {
      /** Execution finished. Outcome verification is reported in result. */
      status: "completed";
      planId: string;
      completedSteps: CompletedPlanStep[];
      result: ExecutionResult;
    }
  | {
      status: "needs-replan";
      planId: string;
      completedSteps: CompletedPlanStep[];
      replan: Replan;
      snapshot: PageState;
    };

/** A task retains checks and completed actions while waiting for clarification. */
export interface PlanTask {
  readonly canResume: boolean;
  request(
    prompt: string,
    planner: PlanPlanner,
    options?: PlanTaskOptions,
  ): Promise<ExecutionResult>;
}

export interface PlanEngine {
  readonly platform: string;
  snapshot(): PageState;
  apply(
    value: unknown,
    source: PageState,
    signal: AbortSignal,
    options: ExecutionOptions,
    verification: {
      baseline: PageState;
      checks: CompletionCheck[];
      prompt: string | undefined;
    },
  ): Promise<Decision & { navigation?: LinkNavigation }>;
  screenshot(signal: AbortSignal, timeoutMs: number): Promise<Screenshot>;
}
type Owner = <T>(
  options: ExecutionOptions,
  perform: (signal: AbortSignal) => Promise<T>,
) => Promise<T>;
interface Progress {
  baseline: PageState;
  checks: CompletionCheck[] | undefined;
  completedSteps: CompletedPlanStep[];
  events: string[];
  effects: { planId: string; signature: string }[];
}

function progress(engine: PlanEngine): Progress {
  return {
    baseline: structuredClone(engine.snapshot()),
    checks: undefined,
    completedSteps: [],
    events: [],
    effects: [],
  };
}
function notify(callback: (() => void) | undefined): void {
  try {
    callback?.();
  } catch {
    /* Feedback cannot change execution. */
  }
}
function signature(step: PlannedStep): string {
  const { id: _id, message: _message, ...action } = step;
  return JSON.stringify({ ...action, target: { ...action.target, id: null } });
}
function matches(step: PlannedStep, state: PageState): PageState["controls"] {
  const locator = step.target;
  return state.controls.filter(
    (control) =>
      (locator.id === null || control.target.id === locator.id) &&
      control.role === locator.role &&
      control.label === locator.label &&
      (locator.context === null || control.context === locator.context) &&
      (locator.group === null ||
        control.groups?.some((group) => group.name === locator.group)),
  );
}

async function execute(
  engine: PlanEngine,
  plan: Plan,
  state: Progress,
  signal: AbortSignal,
  options: PlanExecutionOptions,
  approval?: PlanApproval,
): Promise<PlanExecutionResult> {
  if (
    state.checks &&
    JSON.stringify(state.checks) !== JSON.stringify(plan.checks)
  )
    throw new RuaKitError(
      "INVALID_PLAN",
      "Replacement plans must preserve every completion check.",
    );
  state.checks ??= structuredClone(plan.checks);
  const verification = {
    baseline: state.baseline,
    checks: state.checks,
    prompt: options.prompt,
  };
  const incomplete = (
    snapshot: PageState,
    reason: Replan["reason"],
    message: string,
    failedStepId: string | null,
  ): PlanExecutionResult => ({
    status: "needs-replan",
    planId: plan.id,
    completedSteps: structuredClone(state.completedSteps),
    snapshot,
    replan: {
      planId: plan.id,
      completedSteps: structuredClone(state.completedSteps),
      failedStepId,
      reason,
      message,
    },
  });
  const prior = [...state.completedSteps];
  if (approval) {
    const observed = engine.snapshot();
    await requestApproval(approval, observed, signal, options, options.prompt);
    const current = engine.snapshot();
    // Approval cannot silently move to a changed control while the user is reading.
    if (
      current.url !== observed.url ||
      plan.steps.some((step) => {
        const before = matches(step, observed);
        // A later step can reveal a control described by a semantic locator.
        if (!before.length && step.target.id === null) return false;
        const after = matches(step, current);
        return (
          before.length !== 1 ||
          after.length !== 1 ||
          before[0]!.target.id !== after[0]!.target.id ||
          before[0]!.target.version !== after[0]!.target.version
        );
      })
    )
      throw new RuaKitError(
        "STALE_TARGET",
        "The page changed while awaiting approval. Request approval again from a fresh observation.",
      );
  }
  // Existing outcomes may already satisfy a request without dispatching an action.
  if (
    !evaluateCompletionChecks(state.checks, engine.snapshot(), state.baseline)
      .passed
  ) {
    for (const step of plan.steps) {
      signal.throwIfAborted();
      const previous = prior.find((entry) => entry.step.id === step.id);
      if (previous) {
        if (signature(previous.step) !== signature(step))
          throw new RuaKitError(
            "INVALID_PLAN",
            "A completed step ID cannot describe a different action.",
          );
        continue;
      }
      if (
        !["fill", "select", "check", "focus"].includes(step.type) &&
        prior.some((entry) => signature(entry.step) === signature(step))
      )
        throw new RuaKitError(
          "INVALID_PLAN",
          "A replacement plan cannot replay an already completed action.",
        );
      if (state.completedSteps.length >= 200)
        throw new RuaKitError(
          "REPLAN_LIMIT",
          "The task reached its execution limit.",
        );
      notify(() => options.onPhaseChange?.("observing"));
      const source = engine.snapshot();
      const controls = matches(step, source);
      if (controls.length !== 1 || !controls[0]!.enabled)
        return incomplete(
          source,
          "target-unavailable",
          "The next step has no unique enabled target on the current page.",
          step.id,
        );
      const { id: _id, message, ...action } = step;
      const effect = JSON.stringify({
        ...action,
        target: controls[0]!.target.id,
      });
      if (
        !["fill", "select", "check", "focus"].includes(step.type) &&
        state.effects.some(
          (entry) => entry.planId !== plan.id && entry.signature === effect,
        )
      )
        throw new RuaKitError(
          "INVALID_PLAN",
          "A replacement plan cannot replay an already completed action.",
        );
      let navigation: LinkNavigation | undefined;
      try {
        const applied = await engine.apply(
          {
            type: "act",
            message,
            step: { ...action, target: controls[0]!.target },
          },
          source,
          signal,
          options,
          verification,
        );
        navigation = applied.navigation;
      } catch (error) {
        // STALE_TARGET is raised before dispatch. Other failures can have effects;
        // stop rather than automatically retrying an uncertain action.
        if (error instanceof RuntimeError && error.code === "STALE_TARGET")
          return incomplete(
            engine.snapshot(),
            "target-stale",
            error.message,
            step.id,
          );
        throw error;
      }
      state.completedSteps.push({
        planId: plan.id,
        step: structuredClone(step),
        ...(navigation ? { navigation: structuredClone(navigation) } : {}),
      });
      state.effects.push({ planId: plan.id, signature: effect });
      state.events.push(message.slice(0, 500));
    }
  }
  signal.throwIfAborted();
  const final = engine.snapshot();
  const passed = evaluateCompletionChecks(state.checks, final, state.baseline).passed;
  if (!passed && plan.steps.length)
    return incomplete(
      final,
      "outcome-mismatch",
      "The plan finished, but the expected outcomes are not all present.",
      null,
    );
  // An empty plan means the planner has no remaining actions. Execution can
  // finish without claiming that unobserved outcomes have been verified.
  if (passed) await engine.apply(
    { type: "complete", message: plan.message, checks: state.checks },
    final,
    signal,
    options,
    verification,
  );
  return {
    status: "completed",
    planId: plan.id,
    completedSteps: structuredClone(state.completedSteps),
    result: {
      planId: plan.id,
      status: "triggered",
      message: plan.message,
      events: [...state.events],
      ...(passed ? {
        goalCompleted: true as const,
        verification: {
          level: options.verifyCompletion ? "confirmed" as const : "observed" as const,
          checks: structuredClone(state.checks),
        },
      } : {}),
    },
  };
}

/** Execute one supplied plan. This function never contacts a planner. */
export async function executePlan(
  engine: PlanEngine,
  value: unknown,
  signal: AbortSignal,
  options: PlanExecutionOptions,
): Promise<PlanExecutionResult> {
  const approval = planApprovalSchema.safeParse(value);
  const plan = approval.success
    ? approval.data.plan
    : parsePayload(
        planSchema,
        value,
        "INVALID_PLAN",
        "Expected a valid plan or approval with an ID, steps and completion checks.",
      );
  return execute(
    engine,
    plan,
    progress(engine),
    signal,
    options,
    approval.success ? approval.data : undefined,
  );
}

export function createPlanTask(engine: PlanEngine, own: Owner): PlanTask {
  let state: Progress | undefined;
  let originalPrompt: string | undefined;
  let replan: Replan | null = null;
  let image: Screenshot | undefined;
  let replacements = 0;
  let finished = false;
  const ids = new Set<string>();
  return {
    get canResume() {
      return !finished;
    },
    request: (prompt, planner, options = {}) =>
      own(options, async (signal) => {
        if (finished)
          throw new RuaKitError(
            "INVALID_REQUEST",
            "This plan task has already settled.",
          );
        const limit = options.maxReplans ?? 3;
        if (!Number.isInteger(limit) || limit < 0 || limit > 10)
          throw new RuaKitError(
            "INVALID_REQUEST",
            "maxReplans must be an integer between 0 and 10.",
          );
        if (originalPrompt !== undefined && originalPrompt !== prompt)
          throw new RuaKitError(
            "INVALID_REQUEST",
            "Resume a plan task with its original prompt.",
          );
        originalPrompt = prompt;
        state ??= progress(engine);
        while (true) {
          signal.throwIfAborted();
          notify(() => options.onPhaseChange?.("observing"));
          const source = engine.snapshot();
          if (image && image.url !== source.url) image = undefined;
          const input = parsePayload(
            planRequestSchema,
            {
              protocol: "plan",
              prompt,
              snapshot: source,
              platform: engine.platform,
              clarifications: options.clarifications ?? [],
              checks: state.checks ?? null,
              replan,
              ...(options.context === undefined
                ? {}
                : { context: options.context }),
              canScreenshot: true,
              ...(image ? { screenshot: image } : {}),
            },
            "INVALID_REQUEST",
            "Expected a valid planning request and bounded JSON context.",
          );
          notify(() => options.onPhaseChange?.("planning"));
          const response: PlanResponse = parsePayload(
            planResponseSchema,
            await runWithSignal(signal, () => planner(input, signal)),
            "INVALID_PLAN",
            "The backend returned an invalid plan response.",
          );
          const approval =
            "type" in response && response.type === "approval"
              ? response
              : undefined;
          if (!("id" in response) && response.type !== "approval") {
            if (response.type === "clarify")
              throw new ClarificationNeededError({
                type: "clarification",
                question: response.message,
                options: [],
              });
            if (response.type === "unsupported")
              throw new RuaKitError("UNAVAILABLE", response.message);
            if (image)
              throw new RuaKitError(
                "INVALID_PLAN",
                "Use the supplied screenshot before requesting another image.",
              );
            image = await engine.screenshot(signal, options.timeoutMs ?? 8000);
            continue;
          }
          const plan = "id" in response ? response : response.plan;
          if (ids.has(plan.id) || plan.replacesPlanId !== replan?.planId)
            throw new RuaKitError(
              "INVALID_PLAN",
              "Each plan needs a new ID and the correct replacement plan ID.",
            );
          if (replan && ++replacements > limit)
            throw new RuaKitError(
              "REPLAN_LIMIT",
              "The task reached its replanning limit.",
            );
          ids.add(plan.id);
          notify(() => options.onPlan?.(structuredClone(plan)));
          let result: PlanExecutionResult;
          try {
            result = await execute(
              engine,
              plan,
              state,
              signal,
              { ...options, prompt },
              approval,
            );
          } catch (error) {
            finished = true;
            throw error;
          }
          image = undefined;
          if (result.status === "completed") {
            finished = true;
            return result.result;
          }
          replan = result.replan;
          if (replacements >= limit) {
            finished = true;
            throw new RuaKitError(
              "REPLAN_LIMIT",
              "The task reached its replanning limit.",
            );
          }
          notify(() => options.onProgress?.(REQUEST_MESSAGES.replanning));
        }
      }),
  };
}
