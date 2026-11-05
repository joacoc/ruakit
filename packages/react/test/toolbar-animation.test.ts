// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RequestState } from "@ruakit/agent";
import { Toolbar } from "../src/components/toolbar.js";

const animation = vi.hoisted(() => ({
  complete: undefined as ((definition: string) => void) | undefined,
  reduced: false,
}));

// Control animation completion explicitly; do not replace toolbar state or timers.
vi.mock("motion/react", async () => {
  const { createElement } = await import("react");
  function component(tag: string) {
    return ({
      children,
      initial,
      animate,
      variants,
      transition,
      layoutRoot,
      onAnimationStart,
      onAnimationComplete,
      ...props
    }: Record<string, unknown>) => {
      if (props.className === "ruakit-panel") {
        animation.complete = onAnimationComplete as typeof animation.complete;
      }
      return createElement(tag, props, children as ReactNode);
    };
  }
  return {
    motion: Object.fromEntries(
      ["aside", "div", "form", "p", "section"].map((tag) => [
        tag,
        component(tag),
      ]),
    ),
    useReducedMotion: () => animation.reduced,
  };
});

let root: Root | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  animation.complete = undefined;
  animation.reduced = false;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Harness({
  request,
  initialPrompt,
}: {
  request: RequestState;
  initialPrompt: string;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  return createElement(Toolbar, {
    prompt,
    placeholder: "Ask",
    request,
    onPromptChange: setPrompt,
    onSubmit() {},
    onCancel() {},
    onAnswer() {},
    onStartOver() {},
  });
}
async function mount(request: RequestState, initialPrompt = "") {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const render = async (next: RequestState) => {
    await act(async () =>
      root!.render(createElement(Harness, { request: next, initialPrompt })),
    );
  };
  await render(request);
  return render;
}
function visibleStatus() {
  return (
    document.querySelector(".ruakit-status")?.getAttribute("data-visible") ===
    "true"
  );
}
async function type(value: string) {
  const field = document.querySelector("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function advance(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}
const running: RequestState = {
  status: "running",
  requestId: 2,
  phase: "planning",
  message: "Thinking…",
};

it("reveals status only after the matching expansion completes", async () => {
  const render = await mount({ status: "idle", message: "Ready" });
  await render(running);
  expect(visibleStatus()).toBe(false);
  await act(async () => animation.complete?.("collapsed"));
  expect(visibleStatus()).toBe(false);
  await act(async () => animation.complete?.("expanded"));
  expect(visibleStatus()).toBe(true);
  expect(document.querySelector('[role="status"]')?.textContent).toBe(
    "Thinking…",
  );
});

it.each<RequestState>([
  { status: "cancelled", requestId: 1, message: "Request cancelled" },
  {
    status: "triggered",
    requestId: 1,
    message: "Done.",
    result: { planId: "test", status: "triggered", events: [] },
  },
])(
  "dismisses $status feedback 900 ms after editing starts",
  async (request) => {
    await mount(request, "Open billing");
    expect(visibleStatus()).toBe(true);
    // Waiting by itself does not discard the result.
    await advance(2000);
    expect(visibleStatus()).toBe(true);
    await type("Next");
    await advance(500);
    await type("Next request");
    await advance(399);
    expect(visibleStatus()).toBe(true);
    await advance(1);
    expect(visibleStatus()).toBe(false);
    expect(document.querySelector("textarea")?.value).toBe("Next request");
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      request.message,
    );
  },
);

it("shows errors without a trailing period and dismisses them after 900 ms", async () => {
  await mount({ status: "failed", requestId: 1, message: "Try again." }, "Open billing");
  expect(visibleStatus()).toBe(true);
  expect(document.querySelector(".ruakit-status")?.textContent).toBe("Try again");
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Try again");
  await advance(899);
  expect(visibleStatus()).toBe(true);
  await advance(1);
  expect(visibleStatus()).toBe(false);
});

it("cancels an old dismissal when a new request starts and cleans up on unmount", async () => {
  const failed: RequestState = {
    status: "failed",
    requestId: 1,
    message: "Try again.",
  };
  const render = await mount(failed, "Open billing");
  await type("New request");
  await advance(450);
  await render(running);
  await advance(1000);
  expect(visibleStatus()).toBe(true);
  expect(document.querySelector(".ruakit-status")?.textContent).toBe(
    "Thinking…",
  );
  await render({ ...failed, requestId: 3 });
  await type("Another request");
  expect(vi.getTimerCount()).toBe(1);
  await act(async () => root?.unmount());
  root = undefined;
  expect(vi.getTimerCount()).toBe(0);
});

it("does not hide a clarification when the user types an answer", async () => {
  await mount({
    status: "clarification",
    requestId: 1,
    originalPrompt: "Open billing",
    message: "Which page?",
    clarification: {
      type: "clarification",
      question: "Which page?",
      options: ["Personal"],
    },
  });
  await type("Workspace");
  await advance(2000);
  expect(document.querySelector("section")?.hidden).toBe(false);
  expect(document.querySelector(".ruakit-question")?.textContent).toBe(
    "Which page?",
  );
});

it("shows status immediately with reduced motion", async () => {
  animation.reduced = true;
  const render = await mount({ status: "idle", message: "Ready" });
  await render(running);
  expect(visibleStatus()).toBe(true);
});
