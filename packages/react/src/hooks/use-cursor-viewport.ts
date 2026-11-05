// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { CursorPoint } from "../lib/cursor-position.js";

interface ViewportPosition {
  document: Document;
  originX: number;
  originY: number;
}

/** Keep the overlay aligned with document coordinates as the viewport changes. */
export function useCursorViewport(
  document: Document | undefined,
  lastPosition: RefObject<ViewportPosition | null>,
  renderedPosition: RefObject<CursorPoint | null>,
) {
  const overlay = useRef<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);

  // Keep travel in document coordinates so scrolling cannot pin or restart it.
  // Update the decorative layer directly alongside Motion's animation frames.
  const updateViewport = (): void => {
    const previous = lastPosition.current;
    const view = previous?.document.defaultView;
    const layer = overlay.current;
    if (!previous || !view || !layer || !content.current) return;
    const viewport = view.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? view.innerWidth;
    const height = viewport?.height ?? view.innerHeight;
    const offsetX = view.scrollX + left;
    const offsetY = view.scrollY + top;
    layer.style.left = `${left}px`;
    layer.style.top = `${top}px`;
    layer.style.width = `${width}px`;
    layer.style.height = `${height}px`;
    content.current.style.transform = `translate(${-offsetX}px, ${-offsetY}px)`;
    const point =
      renderedPosition.current?.document === previous.document
        ? renderedPosition.current
        : { x: previous.originX, y: previous.originY };
    const x = point.x - offsetX;
    const y = point.y - offsetY;
    layer.dataset.edgeLeft = String(x < 0);
    layer.dataset.edgeRight = String(x > width);
    layer.dataset.edgeTop = String(y < 0);
    layer.dataset.edgeBottom = String(y > height);
    layer.dataset.offscreen = String(x < 0 || x > width || y < 0 || y > height);
  };

  useEffect(() => {
    const view = document?.defaultView;
    if (!view) return;
    const viewport = view.visualViewport;
    view.addEventListener("scroll", updateViewport, { passive: true });
    view.addEventListener("resize", updateViewport);
    viewport?.addEventListener("scroll", updateViewport, { passive: true });
    viewport?.addEventListener("resize", updateViewport);
    return () => {
      view.removeEventListener("scroll", updateViewport);
      view.removeEventListener("resize", updateViewport);
      viewport?.removeEventListener("scroll", updateViewport);
      viewport?.removeEventListener("resize", updateViewport);
    };
  }, [document]);

  useEffect(updateViewport);

  return { overlay, content, updateViewport };
}
