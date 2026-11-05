// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Toolbar, useRua, usePlan } from "../dist/index.js";
import type {
  Plan,
  RuaAgent,
  RuaPlan,
  RequestPlan,
  RequestOutcome,
} from "../dist/index.js";

let root: Root | undefined;
const plan: Plan = {
  id: "documentation",
  message: "Documentation is open",
  steps: [
    {
      id: "open",
      type: "click",
      message: "Open Documentation",
      target: {
        id: null,
        role: "link",
        label: "Documentation",
        context: null,
        group: null,
      },
    },
  ],
  checks: [
    {
      type: "url",
      description: "Documentation is open",
      equals: "https://docs.example/",
    },
  ],
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    () => [new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList,
  );
  document.body.innerHTML =
    '<a href="https://docs.example/" target="_blank">Documentation</a><div id="toolbar"></div>';
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("settles the toolbar after a clarification and new-tab click without rethinking or an ID error", async () => {
  const request = vi.fn<RequestPlan>(async (input) =>
    input.replan
      ? { ...plan, id: 'finished', replacesPlanId: input.replan.planId, steps: [], message: 'Requested Documentation in a new tab.' }
      : input.clarifications.length
      ? plan
      : { type: "clarify", message: "What do you want to do?" },
  );
  let rua!: RuaAgent;
  function Consumer() {
    rua = useRua({ request });
    return createElement(Toolbar, {
      request: rua.state,
      prompt: "",
      placeholder: "Ask",
      onPromptChange() {},
      onSubmit() {},
      onCancel: rua.cancel,
      onAnswer() {},
      onStartOver: rua.startOver,
    });
  }
  root = createRoot(document.querySelector("#toolbar")!);
  await act(async () => root!.render(createElement(Consumer)));
  let initial!: RequestOutcome;
  await act(async () => {
    initial = await rua.execute({ prompt: "Open Documentation" });
    expect(initial.status).toBe("needs-input");
  });
  expect(rua.state.status).toBe("clarification");
  await act(async () => {
    expect(
      await rua.respond({
        operationId: initial.operationId,
        answer: "Proceed",
      }),
    ).toMatchObject({ status: "triggered", result: { status: "triggered" } });
  });
  expect(rua.state.status).toBe("triggered");
  expect(rua.state.message).toContain("new tab");
  expect(rua.loading).toBe(false);
  expect(request).toHaveBeenCalledTimes(3);
  expect(document.querySelector("#toolbar")!.textContent).not.toMatch(
    /Each plan needs|page changed/i,
  );
});

it("returns navigation feedback to the owner of a supplied plan", async () => {
  let executor!: RuaPlan;
  function Consumer() {
    executor = usePlan(plan);
    return null;
  }
  root = createRoot(document.querySelector("#toolbar")!);
  await act(async () => root!.render(createElement(Consumer)));
  await act(async () => {
    const outcome = await executor.execute();
    expect(outcome).toMatchObject({ status: 'needs-replan',
      completedSteps: [{ navigation: { url: 'https://docs.example/', target: '_blank' } }],
    });
  });
  expect(executor.loading).toBe(false);
});
