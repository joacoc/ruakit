// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT

/** Default messages shown during a request. */
export const REQUEST_MESSAGES = {
  ready: "Ready",
  thinking: "Thinking…",
  observing: "Observing the current page…",
  replanning: "The page changed. Planning the remaining steps…",
  checkingApproval: "Checking the approval response…",
  cancelling: "Cancelling request…",
  cancelled: "Request cancelled",
  triggered: "Actions triggered",
} as const;
