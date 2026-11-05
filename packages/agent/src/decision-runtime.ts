// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { RuaKitError } from './errors.js';
import { validateRequestTimeout } from './operations.js';
import type { RuntimeOptions, RuaKitRuntime } from './runtime.js';
import { createSession } from './session.js';
import type { RuaKitTransport } from './transport.js';

/** The default integration uses the same primitives as custom planning loops. */
export function createDecisionRuntime(
  options: RuntimeOptions,
  transport: RuaKitTransport,
): RuaKitRuntime {
  const session = options.session ?? createSession(options);
  if (options.document && options.document !== session.document) {
    throw new RuaKitError('INVALID_REQUEST', 'The Rua session belongs to a different document.');
  }
  validateRequestTimeout(options.requestTimeoutMs ?? 60000);
  validateRequestTimeout(options.timeoutMs ?? 8000);
  return {
    request: (prompt, settings = {}) =>
      session.plan(prompt, (input, signal) => transport.dom(input, signal), {
        ...options,
        ...settings,
      }),
  };
}
