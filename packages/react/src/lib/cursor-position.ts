// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
export interface CursorPoint {
  document: Document;
  x: number;
  y: number;
}

export function cursorOrigin(document: Document): CursorPoint {
  const view = document.defaultView;
  return {
    document,
    x:
      (view?.scrollX ?? 0) +
      (view?.visualViewport?.offsetLeft ?? 0) +
      (view?.visualViewport?.width ?? view?.innerWidth ?? 0) / 2,
    y:
      (view?.scrollY ?? 0) +
      (view?.visualViewport?.offsetTop ?? 0) +
      (view?.visualViewport?.height ?? view?.innerHeight ?? 0) -
      40,
  };
}
