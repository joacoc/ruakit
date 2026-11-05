// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT

export type RuntimeErrorCode =
  'STALE_TARGET' | 'DISABLED' | 'READ_ONLY' | 'UNSUPPORTED' | 'VALUE_REJECTED' | 'BUSY' | 'TIMEOUT';

export class RuntimeError extends Error {
  constructor(
    readonly code: RuntimeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeError';
  }
}
