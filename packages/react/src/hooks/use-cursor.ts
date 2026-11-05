// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import type { ActionRect } from "@ruakit/agent";
import { createCursorTrajectory } from "../lib/cursor-movement.js";
import { cursorOrigin } from "../lib/cursor-position.js";
import { cursorHighlightClip } from "../lib/cursor-highlight.js";
import type { CursorPoint } from "../lib/cursor-position.js";
import type { CursorAnchor, RuaCursorProps } from "../components/cursor.js";
import { useCursorViewport } from "./use-cursor-viewport.js";

interface Position {
  document: Document;
  id: number;
  rect: ActionRect;
  x: number;
  y: number;
  originX: number;
  originY: number;
  borderRadius: string;
  highlightClip: string | undefined;
  tracking: boolean;
}

const arrivalTolerance = 0.5;
const highlightDurationMs = 650;

function hasReached(
  point: CursorPoint | null,
  destination: { document: Document; x: number; y: number },
): boolean {
  return (
    !!point &&
    point.document === destination.document &&
    Math.hypot(point.x - destination.x, point.y - destination.y) <=
      arrivalTolerance
  );
}

function sameTargetPosition(
  previous: Position | null,
  next: Position,
): boolean {
  return (
    previous?.id === next.id &&
    previous.document === next.document &&
    previous.x === next.x &&
    previous.y === next.y &&
    previous.rect.left === next.rect.left &&
    previous.rect.top === next.rect.top &&
    previous.rect.width === next.rect.width &&
    previous.rect.height === next.rect.height &&
    previous.borderRadius === next.borderRadius &&
    previous.highlightClip === next.highlightClip &&
    previous.tracking === next.tracking
  );
}

/** Track the active destination and the cursor's displayed position. */
export function useCursor({
  action,
  timing,
  anchor,
  active = false,
  visibility = "plan",
  dragging = false,
  scrollToTarget = false,
}: RuaCursorProps) {
  const reducedMotion = useReducedMotion();
  const [position, setPosition] = useState<Position | null>(null);
  const [visible, setVisible] = useState(false);
  const [moving, setMoving] = useState(false);
  const [highlighted, setHighlighted] = useState(false);
  const lastPosition = useRef<Position | null>(null);
  const localPosition = useRef<CursorPoint | null>(null);
  const renderedPosition = timing?.position ?? localPosition;
  const renderedRotation = useRef<{
    document: Document;
    angle: number;
  } | null>(null);
  const anchorTarget = useRef<CursorAnchor | null>(null);
  const reachedAnchor = useRef<CursorAnchor | null>(null);
  const currentTarget = useRef<HTMLElement | null>(null);
  const arrivedTarget = useRef<HTMLElement | null>(null);
  const feedback =
    action &&
    action.phase !== "cancelled" &&
    action.phase !== "failed" &&
    !(visibility === "session" && !active && action.phase === "after")
      ? action
      : null;
  const anchored = feedback ? null : (anchor ?? null);
  const target = feedback?.element ?? anchored?.element;
  const immediate = (feedback?.durationMs ?? anchored?.durationMs) === 0;
  const canMove =
    !!(feedback || anchored) &&
    highlighted &&
    !reducedMotion &&
    !dragging &&
    !position?.tracking &&
    !immediate;
  const trajectory = useMemo(() => {
    if (!position) return null;
    const document = position.document;
    const from =
      renderedPosition.current?.document === document
        ? renderedPosition.current
        : { x: position.originX, y: position.originY };
    const to = feedback || anchored ? position : from;
    const view = document.defaultView;
    return createCursorTrajectory(
      from,
      to,
      canMove,
      renderedRotation.current?.document === document
        ? renderedRotation.current.angle
        : undefined,
      {
        left: view?.scrollX ?? 0,
        top: view?.scrollY ?? 0,
        width: view?.innerWidth ?? 0,
        height: view?.innerHeight ?? 0,
      },
    );
    // Target geometry, not highlight styling, starts movement.
  }, [position?.document, position?.x, position?.y, canMove]);
  const notifyAnchorReached = (): void => {
    if (
      !anchored ||
      anchorTarget.current !== anchored ||
      reachedAnchor.current === anchored ||
      !anchored.element.isConnected
    )
      return;
    const point = renderedPosition.current;
    const destination = lastPosition.current;
    if (!destination || !hasReached(point, destination)) return;
    reachedAnchor.current = anchored;
    try {
      anchored.onReached?.();
    } catch {
      /* Presentation feedback cannot interrupt the cursor. */
    }
  };

  useEffect(() => {
    if (!scrollToTarget || !target?.isConnected) return;
    try {
      target.scrollIntoView?.({
        block: "nearest",
        inline: "nearest",
        behavior: "instant",
      });
    } catch {
      // Presentation feedback cannot interrupt cursor movement.
    }
  }, [target, feedback?.id, anchored, scrollToTarget]);

  const { overlay, content, updateViewport } = useCursorViewport(
    position?.document,
    lastPosition,
    renderedPosition,
  );

  useEffect(() => {
    anchorTarget.current = anchored;
    if (currentTarget.current !== target) arrivedTarget.current = null;
    currentTarget.current = target ?? null;
    const rest = (keepVisible: boolean): void => {
      setMoving(false);
      setHighlighted(false);
      const previous = lastPosition.current;
      if (!keepVisible || !previous?.document.body) {
        setVisible(false);
        setPosition(null);
        return;
      }
      const point =
        renderedPosition.current?.document === previous.document
          ? renderedPosition.current
          : {
              x: reducedMotion ? previous.x : previous.originX,
              y: reducedMotion ? previous.y : previous.originY,
            };
      const resting =
        previous.x === point.x &&
        previous.y === point.y &&
        previous.originX === point.x &&
        previous.originY === point.y
          ? previous
          : {
              ...previous,
              x: point.x,
              y: point.y,
              originX: point.x,
              originY: point.y,
            };
      lastPosition.current = resting;
      setPosition(resting);
      setVisible(true);
    };
    const view = target?.ownerDocument.defaultView;
    if (!target || !view) {
      rest(visibility === "session");
      return;
    }
    setVisible(true);
    let frame = 0;
    let fade: number | undefined;
    let expired = false;
    let initialPosition = true;
    const update = (): void => {
      if (expired) return;
      if (!target.isConnected) {
        rest(active || visibility === "session");
        return;
      }
      const bounds = target.getBoundingClientRect();
      const borderRadius = view.getComputedStyle(target).borderRadius || "6px";
      if (bounds.width <= 0 || bounds.height <= 0) {
        rest(active || visibility === "session");
      } else {
        const left = bounds.left + view.scrollX;
        const top = bounds.top + view.scrollY;
        const x = left + bounds.width / 2;
        const y = top + bounds.height / 2;
        const document = target.ownerDocument;
        const origin =
          renderedPosition.current?.document === document
            ? renderedPosition.current
            : lastPosition.current?.document === document
              ? lastPosition.current
              : null;
        const reached = hasReached(renderedPosition.current, {
          document,
          x,
          y,
        });
        if (reached) arrivedTarget.current = target;
        const next: Position = {
          document,
          id: feedback?.id ?? -1,
          rect: {
            left,
            top,
            width: bounds.width,
            height: bounds.height,
          },
          x,
          y,
          originX: origin?.x ?? cursorOrigin(document).x,
          originY: origin?.y ?? cursorOrigin(document).y,
          borderRadius,
          highlightClip: cursorHighlightClip(target, bounds),
          tracking:
            dragging ||
            arrivedTarget.current === target ||
            // An after-only mount has no in-flight journey to preserve.
            (feedback?.phase === "after" && !lastPosition.current),
        };
        if (reducedMotion || immediate || next.tracking)
          renderedPosition.current = { document, x, y };
        lastPosition.current = next;
        setVisible(true);
        setHighlighted(true);
        setPosition((previous) =>
          sameTargetPosition(previous, next) ? previous : next,
        );
        if (
          anchored &&
          (reducedMotion ||
            immediate ||
            next.tracking ||
            (initialPosition &&
              hasReached(renderedPosition.current, { document, x, y })))
        )
          void Promise.resolve().then(notifyAnchorReached);
        initialPosition = false;
        if (
          next.tracking &&
          feedback?.phase === "after" &&
          !active &&
          visibility === "plan" &&
          fade === undefined
        ) {
          // Action completion is independent of arrival; keep long journeys visible.
          fade = view.setTimeout(() => {
            expired = true;
            view.cancelAnimationFrame(frame);
            setVisible(false);
          }, highlightDurationMs);
        }
      }
      frame = view.requestAnimationFrame(update);
    };
    update();
    return () => {
      expired = true;
      if (anchorTarget.current === anchored) anchorTarget.current = null;
      view.cancelAnimationFrame(frame);
      if (fade !== undefined) {
        view.clearTimeout(fade);
      }
    };
  }, [action, active, visibility, reducedMotion, anchor, dragging]);

  const updatePosition = (latest: { x?: unknown; y?: unknown }): void => {
    if (
      !position ||
      typeof latest.x !== "number" ||
      typeof latest.y !== "number"
    )
      return;
    renderedPosition.current = {
      document: position.document,
      x: latest.x,
      y: latest.y,
    };
    updateViewport();
  };

  const finishMovement = (): void => {
    setMoving(false);
    const point = renderedPosition.current;
    const destination = lastPosition.current;
    if (
      target &&
      currentTarget.current === target &&
      destination &&
      hasReached(point, destination)
    ) {
      arrivedTarget.current = target;
      setPosition((previous) =>
        previous?.document === destination.document &&
        previous.x === destination.x &&
        previous.y === destination.y &&
        !previous.tracking
          ? { ...previous, tracking: true }
          : previous,
      );
    }
    notifyAnchorReached();
  };

  const updateRotation = (latest: { rotate?: unknown }): void => {
    if (position && typeof latest.rotate === "number") {
      renderedRotation.current = {
        document: position.document,
        angle: latest.rotate,
      };
    }
  };

  return {
    feedback,
    anchored,
    target,
    position,
    trajectory,
    reducedMotion,
    immediate,
    visible,
    moving,
    highlighted,
    overlay,
    content,
    renderedRotation,
    startMovement: () => setMoving((trajectory?.duration ?? 0) > 0),
    updatePosition,
    finishMovement,
    updateRotation,
  };
}
