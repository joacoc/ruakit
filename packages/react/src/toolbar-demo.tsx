// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
import { TOOLBAR_PREVIEW_MESSAGES } from "./constants.js";
// Local presentation demo. It does not construct an agent or call a planner.
import { useEffect, useRef, useState } from "react";
import type { ExecutionResult, RequestState } from "@ruakit/agent";
import { Toolbar } from "./components/toolbar.js";

type Preview =
  | "collapsed"
  | "draft"
  | "planning"
  | "executing"
  | "completed"
  | "failed"
  | "clarification"
  | "cancelled";
type Outcome = "completed" | "clarification" | "failed";

const samplePrompt = "Open billing";
const question = "Which billing page should I open?";
const descriptions: Record<Preview, string> = {
  collapsed: "Hover over the notch, click it, or reach it with the keyboard.",
  draft: "Edit the request and press Enter or Send to try a local preview.",
  planning:
    "The request stays read-only while the toolbar is busy. Try Cancel.",
  executing: "The Send button becomes Cancel while an action is running.",
  completed: "Completion clears the request and returns focus to the input.",
  failed: "A failure keeps your request so you can edit it and try again.",
  clarification: "Choose an answer, type your own, or start a new request.",
  cancelled: "Cancellation preserves your request and makes it editable again.",
};

export function ToolbarDemo() {
  const [prompt, setPrompt] = useState("");
  const [request, setRequest] = useState<RequestState>({
    status: "idle",
    message: "Ready",
  });
  const [placeholder, setPlaceholder] = useState("Jot your intention");
  const [outcome, setOutcome] = useState<Outcome>("completed");
  const [messageStyle, setMessageStyle] = useState<"normal" | "glass">(
    "normal",
  );
  const [backdrop, setBackdrop] = useState("plain");
  const [note, setNote] = useState(descriptions.collapsed);
  const [lastAnswer, setLastAnswer] = useState<string | null>(null);
  const [touring, setTouring] = useState(false);
  const [instance, setInstance] = useState(0);
  const sequence = useRef(0);
  const originalPrompt = useRef(samplePrompt);
  const timers = useRef(new Set<number>());

  function clearTimers() {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current.clear();
  }
  function stop() {
    clearTimers();
    setTouring(false);
  }
  function later(callback: () => void, delay: number) {
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      callback();
    }, delay);
    timers.current.add(timer);
  }
  useEffect(() => () => clearTimers(), []);

  function complete(requestId: number) {
    const message = "Preview completed successfully.";
    const result: ExecutionResult = {
      planId: `demo-${requestId}`,
      status: "triggered",
      events: ["Local preview completed"],
      message,
    };
    setRequest({ status: "triggered", requestId, result, message });
    setNote(descriptions.completed);
  }
  function clarify(requestId: number, intention: string) {
    setRequest({
      status: "clarification",
      requestId,
      message: question,
      originalPrompt: intention,
      clarification: {
        type: "clarification",
        question,
        options: ["Personal billing", "Workspace billing"],
      },
    });
    setNote(descriptions.clarification);
  }

  function show(preview: Preview, interrupt = true) {
    if (interrupt) stop();
    const requestId = ++sequence.current;
    setNote(descriptions[preview]);
    setLastAnswer(null);
    if (preview === "collapsed") {
      setPrompt("");
      setRequest({ status: "idle", message: "Ready" });
      setInstance((previous) => previous + 1);
      return;
    }
    const intention = prompt.trim() || samplePrompt;
    originalPrompt.current = intention;
    setPrompt(intention);
    switch (preview) {
      case "draft":
        setRequest({ status: "idle", message: "Ready" });
        break;
      case "planning":
      case "executing":
        setRequest({
          status: "running",
          requestId,
          phase: preview,
          message:
            preview === "planning"
              ? TOOLBAR_PREVIEW_MESSAGES.planning
              : TOOLBAR_PREVIEW_MESSAGES.openingBilling,
        });
        break;
      case "completed":
        complete(requestId);
        break;
      case "failed":
        setRequest({
          status: "failed",
          requestId,
          message: "Something went wrong. Try again.",
        });
        break;
      case "clarification":
        clarify(requestId, intention);
        break;
      case "cancelled":
        setRequest({
          status: "cancelled",
          requestId,
          message: "Request cancelled",
        });
        break;
    }
  }

  function begin(text: string, answering = false) {
    if (!text.trim()) return;
    stop();
    const requestId = ++sequence.current;
    if (!answering) {
      originalPrompt.current = text;
      setLastAnswer(null);
    }
    setPrompt(text);
    const ending = answering ? "completed" : outcome;
    setRequest({
      status: "running",
      requestId,
      phase: "observing",
      message: TOOLBAR_PREVIEW_MESSAGES.reading,
    });
    setNote("A local preview is running. Cancel at any point to stop it.");
    later(
      () =>
        setRequest({
          status: "running",
          requestId,
          phase: "planning",
          message: TOOLBAR_PREVIEW_MESSAGES.planning,
        }),
      900,
    );
    if (ending === "clarification") {
      later(() => clarify(requestId, originalPrompt.current), 2100);
      return;
    }
    later(
      () =>
        setRequest({
          status: "running",
          requestId,
          phase: "executing",
          message: TOOLBAR_PREVIEW_MESSAGES.applying,
        }),
      1800,
    );
    later(() => {
      if (ending === "failed") {
        setRequest({
          status: "failed",
          requestId,
          message: "Something went wrong. Try again.",
        });
        setNote(descriptions.failed);
      } else complete(requestId);
    }, 3000);
  }
  function answer(text: string) {
    if (!text.trim()) return;
    setLastAnswer(text);
    begin(text, true);
  }
  function cancel() {
    if (request.status !== "running") return;
    stop();
    const { requestId, phase } = request;
    setRequest({
      status: "cancelling",
      requestId,
      phase,
      message: TOOLBAR_PREVIEW_MESSAGES.cancelling,
    });
    setNote(TOOLBAR_PREVIEW_MESSAGES.stopping);
    later(() => {
      setRequest({
        status: "cancelled",
        requestId,
        message: "Request cancelled",
      });
      setNote(descriptions.cancelled);
    }, 500);
  }
  function startOver() {
    stop();
    setPrompt("");
    setLastAnswer(null);
    setRequest({ status: "idle", message: "Ready" });
    setNote("Type a new request to try another local preview.");
  }
  function reset() {
    stop();
    setOutcome("completed");
    setPlaceholder("Jot your intention");
    setMessageStyle("normal");
    setBackdrop("plain");
    show("collapsed", false);
  }
  function tour() {
    stop();
    setTouring(true);
    const steps: Preview[] = [
      "collapsed",
      "draft",
      "planning",
      "executing",
      "completed",
      "failed",
      "clarification",
      "cancelled",
    ];
    steps.forEach((step, index) =>
      later(() => show(step, false), index * 1800),
    );
    later(() => {
      setTouring(false);
      setNote(
        "Tour complete. Choose a state, or send your own sample request.",
      );
    }, steps.length * 1800);
  }

  const states = [
    ["collapsed", "Collapsed", "Hover or focus to open"],
    ["draft", "Ready to type", "Edit and send a request"],
    ["planning", "Planning", "Preview a busy toolbar"],
    ["executing", "Executing", "Try the Cancel button"],
    ["completed", "Completed", "Clear the request text"],
    ["failed", "Failed", "Keep the text for retry"],
    ["clarification", "Clarification", "Question and answers"],
    ["cancelled", "Cancelled", "Return to an editable draft"],
  ] as const;
  const status =
    request.status === "running"
      ? request.phase
      : request.status === "triggered"
        ? "completed"
        : request.status;

  return (
    <main className="demo-shell">
      <p className="demo-eyebrow">RUA / PLAYGROUND</p>
      <header className="demo-header">
        <div>
          <h1>Toolbar</h1>
          <p>Try every state, from a quiet notch to a follow-up question.</p>
        </div>
        <button className="demo-reset" type="button" onClick={reset}>
          Reset demo
        </button>
      </header>
      <div className="demo-layout">
        <section
          className="demo-controls"
          aria-label="Toolbar preview controls"
        >
          <button
            className="demo-play"
            type="button"
            onClick={() => {
              if (touring) {
                stop();
                setNote(
                  "Tour stopped. The current state stays visible for inspection.",
                );
              } else tour();
            }}
          >
            <span aria-hidden="true">{touring ? "■" : "▶"}&nbsp; </span>
            {touring ? "Stop tour" : "Play tour"}
          </button>
          <div className="demo-actions">
            {states.map(([state, label, description]) => (
              <button
                className="demo-action"
                type="button"
                key={state}
                onClick={() => show(state)}
              >
                {label}
                <span>{description}</span>
              </button>
            ))}
          </div>
          <div className="demo-speed">
            <span id="message-style-label">Message style</span>
            <div
              className="demo-modes"
              role="group"
              aria-labelledby="message-style-label"
            >
              {(["normal", "glass"] as const).map((style) => (
                <button
                  key={style}
                  type="button"
                  aria-pressed={messageStyle === style}
                  onClick={() => setMessageStyle(style)}
                >
                  {style === "normal" ? "Normal" : "Glass"}
                </button>
              ))}
            </div>
          </div>
          <label className="demo-speed">
            Preview background
            <select
              value={backdrop}
              onChange={(event) => setBackdrop(event.target.value)}
            >
              <option value="plain">Plain</option>
              <option value="gradient">Gradient</option>
            </select>
          </label>
          <label className="demo-speed">
            On Send
            <select
              value={outcome}
              onChange={(event) => setOutcome(event.target.value as Outcome)}
            >
              <option value="completed">Complete</option>
              <option value="clarification">Ask a question</option>
              <option value="failed">Fail</option>
            </select>
          </label>
          <label className="demo-field">
            Placeholder
            <input
              value={placeholder}
              onChange={(event) => setPlaceholder(event.target.value)}
            />
          </label>
          <p className="demo-help">
            State buttons hold a preview until you choose another. Send plays a
            short local sequence. Nothing is sent to a service.
          </p>
        </section>
        <section className="demo-stage" aria-label="Toolbar preview area">
          <div className="demo-stage-header">
            <h2>Live preview</h2>
            <span className="demo-state-badge">{status}</span>
          </div>
          <div className="demo-toolbar-preview" data-backdrop={backdrop}>
            <div className="demo-toolbar-intro">
              <span className="demo-eyebrow">A LITTLE SPACE TO TRY THINGS</span>
              <h3>What would you like to do?</h3>
              <p>Hover over the notch below, or choose a preview state.</p>
              <p>Type anything and press Enter to see the toolbar respond.</p>
            </div>
            <Toolbar
              key={instance}
              prompt={prompt}
              placeholder={placeholder}
              request={request}
              messageStyle={messageStyle}
              onPromptChange={setPrompt}
              onSubmit={() =>
                request.status === "clarification"
                  ? answer(prompt)
                  : begin(prompt)
              }
              onCancel={cancel}
              onAnswer={answer}
              onStartOver={startOver}
            />
          </div>
          <div
            className="demo-status"
            role="status"
            aria-label="Preview status"
          >
            <div>
              {note}
              {lastAnswer && (
                <div className="demo-last-answer">
                  Last answer: {lastAnswer}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
