// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
import { useCallback, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { useReducedMotion } from "motion/react";
import { createCursorTrajectory } from "../lib/cursor-movement.js";
import { cursorOrigin } from "../lib/cursor-position.js";
import type { CursorPoint } from "../lib/cursor-position.js";

const maxActionDelayMs = 10_000;
const arrivalBufferMs = 20;

export interface CursorTiming {
  /** The displayed document position, updated by RuaCursor during travel. */
  readonly position: MutableRefObject<CursorPoint | null>;
  /** Pass to the execution hook to allow travel before applying an action. */
  readonly actionDelayMs: (element: HTMLElement) => number;
}

/** Share distance-based action timing with a custom RuaCursor. */
export function useCursorTiming(
  minimumDelay?: number | ((element: HTMLElement) => number),
): CursorTiming {
  const position = useRef<CursorPoint | null>(null);
  const reducedMotion = useReducedMotion();

  const actionDelayMs = useCallback(
    (element: HTMLElement): number => {
      if (reducedMotion) return 0;

      const requested =
        typeof minimumDelay === "function"
          ? minimumDelay(element)
          : minimumDelay;
      // Preserve immediate feedback and let the runtime reject invalid configuration.
      if (
        requested !== undefined &&
        (requested === 0 ||
          !Number.isInteger(requested) ||
          requested < 0 ||
          requested > maxActionDelayMs)
      )
        return requested;

      const document = element.ownerDocument;
      const view = document.defaultView;
      if (!view) return 0;

      const bounds = element.getBoundingClientRect();
      const from =
        position.current?.document === document
          ? position.current
          : cursorOrigin(document);
      const trajectory = createCursorTrajectory(
        from,
        {
          x: bounds.left + view.scrollX + bounds.width / 2,
          y: bounds.top + view.scrollY + bounds.height / 2,
        },
        true,
        undefined,
        {
          left: view.scrollX,
          top: view.scrollY,
          width: view.innerWidth,
          height: view.innerHeight,
        },
      );
      const travelMs = trajectory.duration
        ? Math.ceil(trajectory.duration * 1000) + arrivalBufferMs
        : 0;

      return Math.max(requested ?? 0, Math.min(maxActionDelayMs, travelMs));
    },
    [minimumDelay, reducedMotion],
  );

  return useMemo(() => ({ position, actionDelayMs }), [actionDelayMs]);
}
