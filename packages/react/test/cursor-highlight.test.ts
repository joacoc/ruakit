// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cursorHighlightClip } from "../src/lib/cursor-highlight.js";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function box(element: HTMLElement, rect: DOMRect, border = 0, scale = 1) {
  // jsdom does not expand overflow shorthand into its computed longhands.
  if (element.style.overflow) {
    element.style.overflowX = element.style.overflow;
    element.style.overflowY = element.style.overflow;
  }
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect);
  Object.defineProperties(element, {
    offsetWidth: { configurable: true, value: rect.width / scale },
    offsetHeight: { configurable: true, value: rect.height / scale },
    clientLeft: { configurable: true, value: border },
    clientTop: { configurable: true, value: border },
    clientWidth: { configurable: true, value: rect.width / scale - border * 2 },
    clientHeight: {
      configurable: true,
      value: rect.height / scale - border * 2,
    },
  });
}

it.each(["hidden", "auto", "scroll", "clip"])(
  "keeps an oversized editor outline inside an overflow:%s card",
  (overflow) => {
    const card = document.body.appendChild(document.createElement("div"));
    card.style.overflow = overflow;
    box(card, new DOMRect(10, 10, 300, 200), 1);
    const editor = card.appendChild(document.createElement("div"));
    expect(cursorHighlightClip(editor, new DOMRect(20, 40, 650, 100))).toBe(
      "inset(-3px 361px -3px -3px)",
    );
  },
);

it("preserves the full outline and shadow when no ancestor cuts them off", () => {
  const card = document.body.appendChild(document.createElement("div"));
  card.style.overflow = "hidden";
  box(card, new DOMRect(10, 10, 300, 200));
  const target = card.appendChild(document.createElement("button"));
  expect(
    cursorHighlightClip(target, new DOMRect(30, 30, 80, 30)),
  ).toBeUndefined();
  card.style.overflowX = "visible";
  card.style.overflowY = "visible";
  expect(
    cursorHighlightClip(target, new DOMRect(-50, -50, 650, 300)),
  ).toBeUndefined();
});

it("intersects nested horizontal and vertical clipping independently", () => {
  const outer = document.body.appendChild(document.createElement("div"));
  outer.style.overflowX = "hidden";
  outer.style.overflowY = "visible";
  box(outer, new DOMRect(50, 20, 200, 400));
  const inner = outer.appendChild(document.createElement("div"));
  inner.style.overflowX = "visible";
  inner.style.overflowY = "clip";
  box(inner, new DOMRect(0, 80, 400, 100));
  const target = inner.appendChild(document.createElement("button"));
  expect(cursorHighlightClip(target, new DOMRect(0, 0, 400, 300))).toBe(
    "inset(80px 150px 120px 50px)",
  );
});

it("uses the padding box of a scaled container, excluding its borders", () => {
  const card = document.body.appendChild(document.createElement("div"));
  card.style.overflow = "hidden";
  box(card, new DOMRect(10, 20, 400, 200), 2, 2);
  const target = card.appendChild(document.createElement("button"));
  expect(cursorHighlightClip(target, new DOMRect(0, 0, 500, 300))).toBe(
    "inset(24px 94px 84px 14px)",
  );
});

it("follows overflow clipping across an editor shadow root and a slotted target", () => {
  const card = document.body.appendChild(document.createElement("div"));
  card.style.overflow = "hidden";
  box(card, new DOMRect(10, 20, 300, 200));
  const host = card.appendChild(document.createElement("div"));
  const shadow = host.attachShadow({ mode: "open" });
  const content = shadow.appendChild(document.createElement("div"));
  content.style.overflow = "hidden";
  box(content, new DOMRect(20, 30, 200, 100));
  const bounds = new DOMRect(0, 0, 600, 300);
  const editor = content.appendChild(document.createElement("div"));
  expect(cursorHighlightClip(editor, bounds)).toBe(
    "inset(30px 380px 170px 20px)",
  );
  content.appendChild(document.createElement("slot"));
  const slotted = host.appendChild(document.createElement("button"));
  expect(cursorHighlightClip(slotted, bounds)).toBe(
    "inset(30px 380px 170px 20px)",
  );
});

it.each([
  new DOMRect(-100, 30, 50, 30),
  new DOMRect(400, 30, 50, 30),
  new DOMRect(30, -100, 50, 30),
  new DOMRect(30, 300, 50, 30),
])(
  "hides the outline for a target completely outside its scroll container: %j",
  (bounds) => {
    const card = document.body.appendChild(document.createElement("div"));
    card.style.overflow = "auto";
    box(card, new DOMRect(10, 20, 300, 200));
    const target = card.appendChild(document.createElement("button"));
    expect(cursorHighlightClip(target, bounds)).toBe("inset(50%)");
  },
);
