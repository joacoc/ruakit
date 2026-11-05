// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
import type { ReactElement } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import type { RuntimeActionEvent } from "@ruakit/agent";
import { cursorRestingRotation } from "../lib/cursor-movement.js";
import { useCursor } from "../hooks/use-cursor.js";
import type { CursorTiming } from "../hooks/use-cursor-timing.js";

export type CursorVisibility = "plan" | "session";

/** A presentation destination used while no runtime action is executing. */
export interface CursorAnchor {
  element: HTMLElement;
  /** Set to 0 for immediate placement. Travel otherwise uses the fixed cursor speed. */
  durationMs?: number | undefined;
  /** Called once when this anchor request is reached. */
  onReached?: (() => void) | undefined;
}

export interface RuaCursorProps {
  action: RuntimeActionEvent | null;
  /** Share the displayed position with useCursorTiming's action delay. */
  timing?: CursorTiming | undefined;
  /** Move beside a host-supplied element without creating a runtime action. */
  anchor?: CursorAnchor | null | undefined;
  /** Keep the pointer visible between actions until the owning plan settles. */
  active?: boolean | undefined;
  /** Session mode retains the pointer after its first action. Defaults to plan. */
  visibility?: CursorVisibility | undefined;
  /** Optional text beside the pointer. Empty or undefined hides the label. */
  label?: string | undefined;
  /** Keep the normal arrow orientation and follow the target directly while dragging. */
  dragging?: boolean | undefined;
  /** Show a subtle strip on the screen edge when the cursor is off-screen. Defaults to true. */
  edgeGlow?: boolean | undefined;
  /** Scroll the destination into view before moving. Defaults to false. */
  scrollToTarget?: boolean | undefined;
}

/** Decorative agent cursor. It neither moves the system pointer nor dispatches mouse events. */
export function RuaCursor(props: RuaCursorProps): ReactElement | null {
  const {
    label,
    dragging = false,
    edgeGlow = true,
    visibility = "plan",
  } = props;
  const {
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
    startMovement,
    updatePosition,
    finishMovement,
    updateRotation,
  } = useCursor(props);

  if (
    !position ||
    !trajectory ||
    (!feedback && !anchored && visibility === "plan") ||
    (target && target.ownerDocument !== position.document)
  ) {
    return null;
  }
  const document = position.document;
  if (!document.body) {
    return null;
  }
  const duration = trajectory.duration;
  const rotation =
    duration > 0
      ? (trajectory.rotation[0] ?? 0)
      : cursorRestingRotation(
          renderedRotation.current?.document === document
            ? renderedRotation.current.angle
            : 0,
        );
  const clicked =
    position.tracking &&
    feedback?.phase === "after" &&
    ["click", "check"].includes(feedback.action);
  return createPortal(
    <div
      ref={overlay}
      className="ruakit-cursor"
      data-ruakit-cursor=""
      data-ruakit-ignore=""
      data-phase={feedback?.phase ?? (anchored ? "anchor" : "idle")}
      aria-hidden="true"
      style={{ opacity: visible ? 1 : 0 }}
    >
      {edgeGlow &&
        (["top", "right", "bottom", "left"] as const).map((edge) => (
          <span key={edge} className="ruakit-cursor-edge" data-edge={edge} />
        ))}
      <div ref={content} className="ruakit-cursor-content">
        {feedback && highlighted && (
          <div
            className="ruakit-cursor-highlight"
            style={{
              left: position.rect.left,
              top: position.rect.top,
              width: position.rect.width,
              height: position.rect.height,
              borderRadius: position.borderRadius,
            }}
          />
        )}
        <motion.div
          className="ruakit-cursor-pointer"
          data-moving={!!(feedback || anchored) && moving && !reducedMotion}
          initial={{
            x: trajectory.x[0] ?? position.originX,
            y: trajectory.y[0] ?? position.originY,
          }}
          animate={
            duration > 0
              ? { x: trajectory.x, y: trajectory.y }
              : {
                  x: trajectory.x.at(-1) ?? position.x,
                  y: trajectory.y.at(-1) ?? position.y,
                }
          }
          transition={{ duration, ease: "linear" }}
          onUpdate={updatePosition}
          onAnimationStart={startMovement}
          onAnimationComplete={finishMovement}
        >
          {clicked && (
            <motion.span
              key={feedback.id}
              className="ruakit-cursor-click"
              initial={{ scale: reducedMotion ? 1 : 0.5, opacity: 0.8 }}
              animate={{
                scale: reducedMotion ? 1 : 2,
                opacity: reducedMotion ? 0.8 : 0,
              }}
              transition={{ duration: reducedMotion ? 0 : 0.35 }}
            />
          )}
          <motion.span
            className="ruakit-cursor-heading"
            initial={{ rotate: rotation }}
            animate={{ rotate: duration > 0 ? trajectory.rotation : rotation }}
            transition={{
              duration:
                duration > 0
                  ? duration
                  : reducedMotion || immediate || dragging
                    ? 0
                    : 0.12,
              ease: "linear",
            }}
            onUpdate={updateRotation}
          >
            <svg
              className="ruakit-cursor-arrow"
              width="26"
              height="28"
              viewBox="0 0 26 28"
              fill="none"
            >
              <path
                d="M1.06417 3.49276L6.36438 24.7082C6.82098 26.5358 9.32038 26.7763 10.1171 25.0693L13.2885 18.274C13.542 17.7308 14.0257 17.33 14.6065 17.1819L22.9158 15.0623C24.6945 14.6086 24.9736 12.1989 23.3456 11.3507L3.92865 1.2343C2.39948 0.437592 0.646244 1.81991 1.06417 3.49276Z"
                fill="#0F1B34"
                stroke="white"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
          </motion.span>
          {label && <span className="ruakit-cursor-label">{label}</span>}
        </motion.div>
      </div>
    </div>,
    document.body,
  );
}
