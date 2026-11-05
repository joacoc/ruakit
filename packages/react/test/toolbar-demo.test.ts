// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToolbarDemo } from "../src/toolbar-demo.js";

let root: Root | undefined;
const fetch = vi.fn(() => {
  throw new Error("The toolbar demo must not call an API.");
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetch);
  fetch.mockClear();
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(ToolbarDemo)));
}
function input(): HTMLTextAreaElement {
  const field = document.querySelector("textarea");
  if (!field) throw new Error("The toolbar is not expanded.");
  return field;
}
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (element) =>
      element.getAttribute("aria-label") === label ||
      element.textContent?.startsWith(label),
  );
  if (!button) throw new Error(`Missing demo control: ${label}`);
  await act(async () => button.click());
}
async function advance(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

it("runs locally and discards pending completion after cancellation or reset", async () => {
  await mount();
  await click("Ready to type");
  expect(input().value).toBe("Open billing");
  await click("Send request");
  expect(input().readOnly).toBe(true);
  await click("Cancel request");
  await advance(4000);
  expect(input().readOnly).toBe(false);
  expect(input().value).toBe("Open billing");
  expect(document.querySelector(".demo-state-badge")?.textContent).toBe(
    "cancelled",
  );
  await click("Send request");
  await click("Reset demo");
  await advance(4000);
  expect(document.querySelector(".demo-state-badge")?.textContent).toBe("idle");
  expect(document.querySelector(".ruakit-opener")).not.toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it("changes message style while preserving the active preview and cancellation", async () => {
  await mount();
  await click("Planning");
  const field = input();
  await click("Glass");
  expect(document.querySelector('[data-message-style="glass"]')).not.toBeNull();
  expect(input()).toBe(field);
  expect(field.readOnly).toBe(true);
  await click("Cancel request");
  await advance(500);
  expect(field.value).toBe("Open billing");
  expect(field.readOnly).toBe(false);
  expect(document.querySelector(".ruakit-status")?.textContent).toBe(
    "Request cancelled",
  );
  await click("Reset demo");
  expect(
    document.querySelector('[data-message-style="normal"]'),
  ).not.toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["choice", "typed"])(
  "accepts a %s clarification answer and can start over without APIs",
  async (mode) => {
    await mount();
    await click("Clarification");
    expect(document.querySelector(".ruakit-question")?.textContent).toContain(
      "Which billing page",
    );
    expect(input().value).toBe("");
    const answer = mode === "choice" ? "Workspace billing" : "Team billing";
    if (mode === "choice") await click(answer);
    else {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      await act(async () => {
        setter.call(input(), answer);
        input().dispatchEvent(new Event("input", { bubbles: true }));
      });
      await click("Send request");
    }
    expect(input().readOnly).toBe(true);
    expect(document.querySelector(".demo-last-answer")?.textContent).toContain(
      answer,
    );
    await advance(3000);
    expect(input().readOnly).toBe(false);
    expect(input().value).toBe("");
    expect(document.activeElement).toBe(input());
    expect(document.querySelector(".demo-state-badge")?.textContent).toBe(
      "completed",
    );
    await click("Clarification");
    await click("New request");
    expect(document.querySelector(".ruakit-clarification")).toBeNull();
    expect(input().value).toBe("");
    expect(document.activeElement).toBe(input());
    expect(fetch).not.toHaveBeenCalled();
  },
);
