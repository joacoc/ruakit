// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import { PaperAirplaneIcon, StopIcon } from "@heroicons/react/24/solid";
import { motion, useReducedMotion } from "motion/react";
import type { RequestState } from "@ruakit/agent";
import { TOOLBAR_TEXT } from "../constants.js";

export interface ToolbarProps {
  prompt: string;
  placeholder: string;
  request: RequestState;
  /** Appearance of the recessed status and clarification panels. Defaults to normal. */
  messageStyle?: "normal" | "glass" | undefined;
  onPromptChange(prompt: string): void;
  onSubmit(): void;
  onCancel(): void;
  onAnswer(answer: string): void;
  /** Approve or decline the currently displayed action. */
  onApprovalResponse?(approved: boolean): void;
  onStartOver(): void;
}

/** Input and presentation only. Execution and request ownership belong to the hook. */
export function Toolbar({
  prompt,
  placeholder,
  request,
  messageStyle = "normal",
  onPromptChange,
  onSubmit,
  onCancel,
  onAnswer,
  onApprovalResponse,
  onStartOver,
}: ToolbarProps): ReactElement {
  const approving = request.status === "approval";
  const busy =
    request.status === "running" ||
    request.status === "cancelling" ||
    approving;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [focusRequested, setFocusRequested] = useState(false);
  const [settled, setSettled] = useState(
    busy || request.status === "clarification" || prompt.length > 0,
  );
  const [dismissedStatus, setDismissedStatus] = useState<string | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const reducedMotion = useReducedMotion();
  const formId = useId();
  const questionId = useId();
  const opener = useRef<HTMLButtonElement | null>(null);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const clarifying = request.status === "clarification";
  const expanded =
    hovered || focused || busy || clarifying || prompt.length > 0;
  const expansion = useRef(expanded);
  const panelReady = expanded && (settled || !!reducedMotion);
  const statusKey =
    request.status === "idle"
      ? "idle"
      : `${request.requestId}:${request.status}`;
  const terminal =
    request.status === "triggered" ||
    request.status === "failed" ||
    request.status === "cancelled";
  const statusVisible =
    panelReady &&
    request.status !== "idle" &&
    !clarifying &&
    !approving &&
    dismissedStatus !== statusKey;
  const statusMessage =
    request.status === "failed"
      ? request.message.replace(/\.$/, "")
      : request.message;
  const messageVariants = {
    shown: { opacity: 1, y: 0, visibility: "visible" as const },
    hidden: {
      opacity: 0,
      y: reducedMotion ? 0 : 24,
      transitionEnd: { visibility: "hidden" as const },
    },
  };

  const focusRequestBox = useCallback(() => {
    setFocused(true);
    setFocusRequested(true);
  }, []);

  useEffect(() => {
    if (focusRequested) {
      textarea.current?.focus({ preventScroll: true });
      setFocusRequested(false);
    }
  }, [focusRequested]);

  useEffect(() => {
    expansion.current = expanded;
    if (!expanded) {
      setSettled(false);
    }
  }, [expanded]);

  useEffect(() => {
    if (request.status === "failed") {
      dismissTimer.current = setTimeout(() => {
        dismissTimer.current = undefined;
        setDismissedStatus(statusKey);
      }, 900);
    }
    return () => {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = undefined;
    };
  }, [statusKey, request.status]);

  function editPrompt(value: string): void {
    onPromptChange(value.replace(/[\r\n]+/g, " "));
    if (
      terminal &&
      dismissTimer.current === undefined &&
      dismissedStatus !== statusKey
    ) {
      dismissTimer.current = setTimeout(() => {
        dismissTimer.current = undefined;
        setDismissedStatus(statusKey);
      }, 900);
    }
  }

  useEffect(() => {
    if (request.status === "triggered") {
      onPromptChange("");
    }
    if (
      request.status === "clarification" &&
      request.message === request.clarification.question
    ) {
      onPromptChange("");
    }
    if (
      request.status === "triggered" ||
      request.status === "failed" ||
      request.status === "clarification" ||
      request.status === "approval" ||
      request.status === "cancelled"
    ) {
      // Native application field edits can move focus while executing. Restore
      // the request box when execution needs user input or has settled.
      focusRequestBox();
    }
  }, [request, onPromptChange, focusRequestBox]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy || !prompt.trim()) {
      return;
    }
    focusRequestBox();
    onSubmit();
  }

  return (
    <motion.aside
      layoutRoot
      className="ruakit-toolbar"
      data-ruakit-toolbar=""
      data-message-style={messageStyle}
      aria-label={TOOLBAR_TEXT.assistantLabel}
      aria-busy={busy && !approving}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={(event) => {
        if (event.target === opener.current) {
          setFocusRequested(true);
        }
        setFocused(true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false);
        }
      }}
    >
      <motion.div
        initial={false}
        animate={expanded ? "expanded" : "collapsed"}
        variants={{
          expanded: { width: "100%", height: 50 },
          collapsed: { width: 120, height: 20 },
        }}
        style={{ borderRadius: 40 }}
        transition={{
          type: "spring",
          bounce: 0,
          duration: reducedMotion ? 0 : 0.35,
        }}
        onAnimationStart={() => setSettled(false)}
        onAnimationComplete={(definition) => {
          if (definition !== (expansion.current ? "expanded" : "collapsed"))
            return;
          setSettled(expansion.current);
          if (expansion.current && focused) {
            textarea.current?.focus({ preventScroll: true });
          }
        }}
        onPointerDownCapture={(event) => {
          if (
            event.button === 0 &&
            (!expanded || (!settled && !reducedMotion))
          ) {
            event.preventDefault();
            focusRequestBox();
          }
        }}
        className="ruakit-panel"
        data-expanded={expanded}
      >
        {!expanded ? (
          <button
            ref={opener}
            type="button"
            aria-label={TOOLBAR_TEXT.openLabel}
            aria-expanded={false}
            aria-controls={formId}
            className="ruakit-opener"
            onClick={focusRequestBox}
          >
            <span className="ruakit-sr-only">{placeholder}</span>
          </button>
        ) : (
          <motion.form
            id={formId}
            initial={{ opacity: 0 }}
            animate={{ opacity: settled || reducedMotion ? 1 : 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.12 }}
            onSubmit={submit}
            className="ruakit-form"
          >
            <textarea
              ref={textarea}
              aria-label={TOOLBAR_TEXT.requestLabel}
              aria-description={
                approving
                  ? TOOLBAR_TEXT.approvalDescription
                  : clarifying
                    ? TOOLBAR_TEXT.clarificationDescription
                    : TOOLBAR_TEXT.requestDescription
              }
              aria-describedby={clarifying ? questionId : undefined}
              rows={1}
              wrap="off"
              maxLength={2000}
              placeholder={
                clarifying ? TOOLBAR_TEXT.answerPlaceholder : placeholder
              }
              value={prompt}
              readOnly={busy}
              onChange={(event) => editPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  if (!event.shiftKey) {
                    event.currentTarget.form?.requestSubmit();
                  }
                }
              }}
              className="ruakit-input"
            />
            <button
              type={busy ? "button" : "submit"}
              aria-label={busy ? TOOLBAR_TEXT.cancel : TOOLBAR_TEXT.send}
              title={busy ? TOOLBAR_TEXT.cancel : TOOLBAR_TEXT.send}
              className="ruakit-send"
              disabled={!busy && !prompt.trim()}
              onPointerDown={(event) => {
                if (event.button === 0) {
                  event.preventDefault();
                }
              }}
              onClick={() => {
                if (busy) {
                  onCancel();
                }
              }}
            >
              {busy ? (
                <StopIcon
                  data-slot="icon"
                  aria-hidden="true"
                  className="ruakit-icon"
                />
              ) : (
                <PaperAirplaneIcon
                  data-slot="icon"
                  aria-hidden="true"
                  className="ruakit-icon"
                />
              )}
            </button>
          </motion.form>
        )}
      </motion.div>
      {request.status === "clarification" && (
        <motion.section
          className="ruakit-message-surface ruakit-clarification"
          aria-labelledby={questionId}
          hidden={!panelReady}
          initial={{ opacity: 0, y: reducedMotion ? 0 : 24 }}
          animate={panelReady ? "shown" : "hidden"}
          variants={messageVariants}
          transition={{ duration: reducedMotion ? 0 : 0.22 }}
        >
          <p className="ruakit-original">
            {TOOLBAR_TEXT.regarding} {request.originalPrompt}
          </p>
          <p id={questionId} className="ruakit-question">
            {request.clarification.question}
          </p>
          <div className="ruakit-options">
            {request.clarification.options.map((option) => (
              <button
                key={option}
                type="button"
                className="ruakit-option"
                onClick={() => {
                  onPromptChange(option);
                  onAnswer(option);
                }}
              >
                {option}
              </button>
            ))}
          </div>
          {request.message !== request.clarification.question && (
            <p role="alert">{request.message}</p>
          )}
          <button
            type="button"
            className="ruakit-start-over"
            onClick={() => {
              onStartOver();
              onPromptChange("");
              focusRequestBox();
            }}
          >
            {TOOLBAR_TEXT.newRequest}
          </button>
        </motion.section>
      )}
      {request.status === "approval" && (
        <motion.section
          className="ruakit-message-surface ruakit-clarification"
          aria-labelledby={questionId}
          hidden={!panelReady}
          initial={{ opacity: 0, y: reducedMotion ? 0 : 24 }}
          animate={panelReady ? "shown" : "hidden"}
          variants={messageVariants}
          transition={{ duration: reducedMotion ? 0 : 0.22 }}
        >
          <p className="ruakit-original">
            {TOOLBAR_TEXT.regarding} {request.originalPrompt}
          </p>
          <p id={questionId} className="ruakit-question">
            {request.approval.message}
          </p>
          <div className="ruakit-options">
            <button
              type="button"
              className="ruakit-option"
              disabled={!onApprovalResponse}
              onClick={() => onApprovalResponse?.(true)}
            >
              {TOOLBAR_TEXT.approve}
            </button>
            <button
              type="button"
              className="ruakit-option"
              onClick={() =>
                onApprovalResponse ? onApprovalResponse(false) : onCancel()
              }
            >
              {TOOLBAR_TEXT.decline}
            </button>
          </div>
        </motion.section>
      )}
      <motion.p
        aria-hidden="true"
        className="ruakit-message-surface ruakit-status"
        data-visible={statusVisible}
        initial={{
          opacity: 0,
          y: reducedMotion ? 0 : 24,
          visibility: "hidden",
        }}
        animate={statusVisible ? "shown" : "hidden"}
        variants={messageVariants}
        transition={{ duration: reducedMotion ? 0 : 0.22, ease: "easeOut" }}
      >
        <span className={busy ? "ruakit-status-busy" : undefined}>
          {statusMessage}
        </span>
      </motion.p>
      <p role="status" aria-live="polite" className="ruakit-sr-only">
        {statusMessage}
      </p>
    </motion.aside>
  );
}
