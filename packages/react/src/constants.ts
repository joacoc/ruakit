// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0

/** Fixed text used by the toolbar and its preview. */
export const TOOLBAR_TEXT = {
  placeholder: "Jot your intention",
  answerPlaceholder: "Your answer…",
  assistantLabel: "Rua assistant",
  openLabel: "Open Rua",
  requestLabel: "Rua request",
  approvalDescription: "Choose Approve or Decline for the pending action.",
  clarificationDescription:
    "Answer the clarification question. Press Enter to send.",
  requestDescription: "Single-line request. Press Enter to send.",
  cancel: "Cancel request",
  send: "Send request",
  regarding: "Regarding:",
  newRequest: "New request",
  approve: "Approve",
  decline: "Decline",
} as const;

export const TOOLBAR_PREVIEW_MESSAGES = {
  planning: "Planning the next step…",
  openingBilling: "Opening the billing page…",
  reading: "Reading the current page…",
  applying: "Applying the change…",
  cancelling: "Cancelling request…",
  stopping: "Stopping the local preview…",
} as const;
