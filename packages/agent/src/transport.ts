// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { decisionSchema } from '@ruakit/schema';
import type { DecisionRequest, Decision } from '@ruakit/schema';
import { RuaKitError, parsePayload } from './errors.js';

/** Replace HTTP with another planner without changing browser execution. */
export interface RuaKitTransport {
  dom(request: DecisionRequest, signal: AbortSignal): Promise<Decision>;
}

export interface HttpTransportOptions {
  serverUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export function createHttpTransport(options: HttpTransportOptions = {}): RuaKitTransport {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = (options.serverUrl ?? '').replace(/\/$/, '');
  return {
    async dom(request, signal) {
      const response = await fetcher(`${base}/v1/plan`, {
        method: 'POST',
        signal,
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      let data: unknown;
      try {
        data = await response.json();
      } catch (cause) {
        throw new RuaKitError('HTTP_ERROR', 'The server returned invalid JSON.', { cause });
      }
      if (!response.ok) {
        const message =
          typeof data === 'object' &&
          data !== null &&
          'error' in data &&
          typeof data.error === 'string'
            ? data.error
            : `RuaKit request failed (${response.status}).`;
        throw new RuaKitError('HTTP_ERROR', message);
      }
      return parsePayload(
        decisionSchema,
        data,
        'INVALID_PLAN',
        'The server returned an invalid decision.',
      );
    },
  };
}
