// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RequestState } from "@ruakit/agent";
import { Toolbar } from "../src/components/toolbar.js";

const animation = vi.hoisted(() => ({
  start: undefined as (() => void) | undefined,
  complete: undefined as ((definition: string) => void) | undefined,
  messageDuration: undefined as number | undefined,
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
        animation.start = onAnimationStart as typeof animation.start;
        animation.complete = onAnimationComplete as typeof animation.complete;
      }
      if (props.className === "ruakit-message-surface ruakit-status") {
        animation.messageDuration = (transition as { duration: number }).duration;
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
  animation.start = undefined;
  animation.messageDuration = undefined;
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

it("hides the overlay immediately during collapse and keeps it hidden through interrupted expansion", async () => {
  await mount({ status: "cancelled", requestId: 1, message: "Request cancelled" });
  await act(async () => animation.complete?.("expanded"));
  const status = document.querySelector<HTMLElement>(".ruakit-status")!;
  expect(status.hidden).toBe(false);
  expect(visibleStatus()).toBe(true);
  expect(animation.messageDuration).toBe(0.22);

  // The request box is empty. Leaving focus and hover starts the notch collapse.
  await act(async () => document.querySelector<HTMLTextAreaElement>("textarea")!.blur());
  expect(document.querySelector(".ruakit-panel")?.getAttribute("data-expanded")).toBe("false");
  expect(status.hidden).toBe(true);
  expect(visibleStatus()).toBe(false);
  expect(animation.messageDuration).toBe(0);
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Request cancelled");

  // Reopen before the old collapse callback arrives.
  await act(async () => document.querySelector<HTMLButtonElement>(".ruakit-opener")!.click());
  expect(status.hidden).toBe(true);
  await act(async () => animation.complete?.("collapsed"));
  expect(status.hidden).toBe(true);
  await act(async () => animation.complete?.("expanded"));
  expect(status.hidden).toBe(false);
  expect(visibleStatus()).toBe(true);
  expect(animation.messageDuration).toBe(0.22);
});

it("removes a visible message when a size animation starts and restores it only when expansion settles", async () => {
  await mount(running, "Open billing");
  const status = document.querySelector<HTMLElement>(".ruakit-status")!;
  expect(status.hidden).toBe(false);
  await act(async () => animation.start?.());
  expect(status.hidden).toBe(true);
  expect(animation.messageDuration).toBe(0);
  await act(async () => animation.complete?.("expanded"));
  expect(status.hidden).toBe(false);
  expect(animation.messageDuration).toBe(0.22);
});

it.each<RequestState>([
  { status: "cancelled", requestId: 1, message: "Request cancelled" },
])(
  "dismisses $status feedback 3 seconds after editing starts",
  async (request) => {
    await mount(request, "Open billing");
    expect(visibleStatus()).toBe(true);
    // Waiting by itself does not discard the result.
    await advance(4000);
    expect(visibleStatus()).toBe(true);
    await type("Next");
    await advance(500);
    await type("Next request");
    await advance(2499);
    expect(visibleStatus()).toBe(true);
    await advance(1);
    expect(visibleStatus()).toBe(false);
    // A normal dismissal while the input is stable retains the fade.
    expect(document.querySelector<HTMLElement>(".ruakit-status")?.hidden).toBe(false);
    expect(animation.messageDuration).toBe(0.22);
    expect(document.querySelector("textarea")?.value).toBe("Next request");
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      request.message,
    );
  },
);

it("fades action feedback 3 seconds after execution finishes without further input", async () => {
  const render = await mount(running, "Update the topic");
  await advance(4000);
  expect(visibleStatus()).toBe(true);
  await render({
    status: "triggered",
    requestId: running.requestId,
    message: "Updated the topic.",
    result: { planId: "test", status: "triggered", events: [] },
  });
  expect(document.querySelector("textarea")?.value).toBe("");
  await advance(2999);
  expect(visibleStatus()).toBe(true);
  await advance(1);
  expect(visibleStatus()).toBe(false);
  expect(animation.messageDuration).toBe(0.22);
  expect(document.querySelector<HTMLElement>(".ruakit-status")?.hidden).toBe(false);
});

it("shows errors without a trailing period and dismisses them after 3 seconds", async () => {
  await mount({ status: "failed", requestId: 1, message: "Try again." }, "Open billing");
  expect(visibleStatus()).toBe(true);
  expect(document.querySelector(".ruakit-status")?.textContent).toBe("Try again");
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Try again");
  await advance(2999);
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
  await advance(3000);
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
  await advance(4000);
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
