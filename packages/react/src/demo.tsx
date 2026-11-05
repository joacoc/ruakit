// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
// Browser-only entry for the local component playground. Not a package export.
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { RuntimeActionEvent } from "@ruakit/agent";
import { RuaCursor } from "./components/cursor.js";
import { useCursorTiming } from "./hooks/use-cursor-timing.js";
import { ToolbarDemo } from "./toolbar-demo.js";
import "./styles.css";

type Preview = "move" | "click" | "fill" | "check" | "follow";
type View = "both" | "cursor" | "highlight";

function Demo() {
  const [action, setAction] = useState<RuntimeActionEvent | null>(null);
  const [view, setView] = useState<View>("both");
  const [cursorLabel, setCursorLabel] = useState("");
  const [edgeGlow, setEdgeGlow] = useState(true);
  const [scrollToTarget, setScrollToTarget] = useState(false);
  const [message, setMessage] = useState(
    "Pick a behavior, or play the whole tour.",
  );
  const [name, setName] = useState("Untitled project");
  const [checked, setChecked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [moving, setMoving] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const checkbox = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const movingTarget = useRef<HTMLButtonElement>(null);
  const sequence = useRef(0);
  const timing = useCursorTiming();
  const timers = useRef(new Set<number>());

  function clearTimers() {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current.clear();
  }

  function later(callback: () => void, delay: number) {
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      callback();
    }, delay);
    timers.current.add(timer);
  }

  useEffect(() => () => clearTimers(), []);
  useEffect(() => {
    document.body.dataset.demoView = view;
    return () => {
      delete document.body.dataset.demoView;
    };
  }, [view]);

  function preview(kind: Preview, interrupt = true) {
    if (interrupt) clearTimers();
    setMoving(kind === "follow");
    const element =
      kind === "fill"
        ? field.current
        : kind === "check"
          ? checkbox.current
          : kind === "follow"
            ? movingTarget.current
            : button.current;
    if (!element) return;
    if (scrollToTarget)
      element.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "instant",
      });
    const bounds = element.getBoundingClientRect();
    const movementDuration = timing.actionDelayMs(element);
    const event: RuntimeActionEvent = {
      id: ++sequence.current,
      action: kind === "move" || kind === "follow" ? "focus" : kind,
      phase: "before",
      element,
      rect: {
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
      },
      durationMs: movementDuration,
    };
    setAction(event);
    const messages: Record<Preview, string> = {
      move: "The cursor and outline stay here until you finish or cancel.",
      click: "Move to the button, then show the click pulse.",
      fill: "Move to the field, then change its value.",
      check: "Move to the checkbox, then toggle it.",
      follow: "The cursor and outline follow the moving target.",
    };
    setMessage(messages[kind]);
    if (kind === "move" || kind === "follow") return;
    later(() => {
      if (kind === "click") setSaved((previous) => !previous);
      if (kind === "fill") {
        setName((previous) =>
          previous === "Orbit workspace"
            ? "Untitled project"
            : "Orbit workspace",
        );
        field.current?.focus({ preventScroll: true });
      }
      if (kind === "check") setChecked((previous) => !previous);
      setAction({ ...event, phase: "after" });
      setMessage("Action finished. The overlay fades away.");
    }, movementDuration + 180);
  }

  function finish(phase: "after" | "cancelled" | "failed") {
    clearTimers();
    setMoving(false);
    setAction((previous) => (previous ? { ...previous, phase } : null));
    setMessage(
      phase === "after"
        ? "Finished. The overlay fades away."
        : phase === "failed"
          ? "Failed. The overlay disappears immediately."
          : "Cancelled. The overlay disappears immediately.",
    );
  }

  function reset() {
    clearTimers();
    setAction(null);
    setMoving(false);
    setName("Untitled project");
    setChecked(false);
    setSaved(false);
    setView("both");
    setCursorLabel("");
    setEdgeGlow(true);
    setScrollToTarget(false);
    setMessage("Pick a behavior, or play the whole tour.");
  }

  function tour() {
    clearTimers();
    const steps: Preview[] = ["move", "fill", "check", "click"];
    steps.forEach((step, index) =>
      later(() => preview(step, false), index * 2600),
    );
    later(
      () => setMessage("Tour complete. Try Follow to see a moving target."),
      steps.length * 2600,
    );
  }

  const behaviors = [
    ["Move", "Hold on an element", () => preview("move")],
    ["Click", "Show the click pulse", () => preview("click")],
    ["Fill field", "Change the field value", () => preview("fill")],
    ["Toggle check", "Try a small target", () => preview("check")],
    ["Follow", "Track a moving target", () => preview("follow")],
    ["Finish", "Fade the overlay away", () => finish("after")],
    ["Cancel", "Hide it immediately", () => finish("cancelled")],
    ["Fail", "Preview a failed action", () => finish("failed")],
  ] as const;

  return (
    <main className="demo-shell">
      <p className="demo-eyebrow">RUA / PLAYGROUND</p>
      <header className="demo-header">
        <div>
          <h1>Cursor &amp; highlights</h1>
          <p>
            Try the pointer, the outline, and the little moments between them.
          </p>
        </div>
        <button className="demo-reset" type="button" onClick={reset}>
          Reset demo
        </button>
      </header>
      <div className="demo-layout">
        <section className="demo-controls" aria-label="Preview controls">
          <button className="demo-play" type="button" onClick={tour}>
            <span aria-hidden="true">▶&nbsp; </span>Play tour
          </button>
          <div className="demo-actions">
            {behaviors.map(([label, description, onClick]) => (
              <button
                className="demo-action"
                type="button"
                key={label}
                onClick={onClick}
              >
                {label}
                <span>{description}</span>
              </button>
            ))}
          </div>
          <label className="demo-field">
            Cursor label
            <input
              value={cursorLabel}
              placeholder="Leave blank to hide"
              onChange={(event) => setCursorLabel(event.target.value)}
            />
          </label>
          <label className="demo-checkbox">
            <input
              type="checkbox"
              checked={edgeGlow}
              onChange={(event) => setEdgeGlow(event.target.checked)}
            />
            Off-screen edge glow
          </label>
          <label className="demo-checkbox">
            <input
              type="checkbox"
              checked={scrollToTarget}
              onChange={(event) => setScrollToTarget(event.target.checked)}
            />
            Scroll to target
          </label>
          <p className="demo-help">
            Choose Both, Cursor, or Highlight to inspect each part. Move and
            Follow stay visible until you finish or cancel. Your reduced-motion
            setting applies.
          </p>
        </section>
        <section className="demo-stage" aria-label="Preview area">
          <div className="demo-stage-header">
            <h2>Live preview</h2>
            <div
              className="demo-modes"
              role="group"
              aria-label="Visible components"
            >
              {(["both", "cursor", "highlight"] as const).map((mode) => (
                <button
                  type="button"
                  key={mode}
                  aria-pressed={view === mode}
                  onClick={() => setView(mode)}
                >
                  {mode === "both"
                    ? "Both"
                    : mode === "cursor"
                      ? "Cursor"
                      : "Highlight"}
                </button>
              ))}
            </div>
          </div>
          <div className="demo-sandbox">
            <div className="demo-form">
              <h3>A little workspace</h3>
              <label className="demo-field">
                Project name
                <input
                  ref={field}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="demo-checkbox">
                <input
                  ref={checkbox}
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => setChecked(event.target.checked)}
                />
                Send me updates
              </label>
              <button
                ref={button}
                className="demo-save"
                type="button"
                onClick={() => setSaved((previous) => !previous)}
              >
                {saved ? "Changes saved ✓" : "Save changes"}
              </button>
            </div>
            <div className="demo-track">
              <button
                ref={movingTarget}
                type="button"
                className="demo-moving-target"
                data-moving={moving}
              >
                ↔&nbsp; Moving target
              </button>
            </div>
          </div>
          <p className="demo-status" role="status">
            {message}
          </p>
        </section>
      </div>
      <RuaCursor
        timing={timing}
        action={action}
        label={cursorLabel}
        dragging={moving}
        edgeGlow={edgeGlow}
        scrollToTarget={scrollToTarget}
      />
    </main>
  );
}

function Playground() {
  const [page, setPage] = useState(() =>
    window.location.hash === "#toolbar" ? "toolbar" : "cursor",
  );
  useEffect(() => {
    const navigate = () => {
      setPage(window.location.hash === "#toolbar" ? "toolbar" : "cursor");
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  useEffect(() => {
    document.title = `Rua · ${page === "toolbar" ? "Toolbar" : "Cursor & highlights"}`;
  }, [page]);
  return (
    <>
      <nav className="demo-navigation" aria-label="Component demos">
        <a href="#cursor" aria-current={page === "cursor" ? "page" : undefined}>
          Cursor &amp; highlights
        </a>
        <a
          href="#toolbar"
          aria-current={page === "toolbar" ? "page" : undefined}
        >
          Toolbar
        </a>
      </nav>
      {page === "toolbar" ? <ToolbarDemo /> : <Demo />}
    </>
  );
}

const container = document.getElementById("demo-root");
if (container)
  createRoot(container).render(
    <StrictMode>
      <Playground />
    </StrictMode>,
  );
