// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { planResponseSchema, RUNTIME_META_NAME } from '@ruakit/schema';
import type { PlanRequest, PlanResponse } from '@ruakit/schema';
import { RuaKitError, parsePayload } from './errors.js';
import type { HttpTransportOptions } from './transport.js';

export interface PlanTransport {
  plan(input: PlanRequest, signal: AbortSignal): Promise<PlanResponse>;
}
export interface PlanHttpTransportOptions extends HttpTransportOptions {
  document?: Document;
}

/** The plan protocol shares the existing route, including the server-only proxy. */
export function createPlanTransport(
  options: PlanHttpTransportOptions = {},
): PlanTransport {
  let serverUrl = options.serverUrl;
  if (serverUrl === undefined) {
    const embedded = options.document?.querySelector<HTMLMetaElement>(
      `meta[name="${RUNTIME_META_NAME}"]`,
    )?.content;
    if (embedded !== undefined) {
      try {
        const config: unknown = JSON.parse(embedded);
        if (
          typeof config !== 'object' ||
          config === null ||
          Array.isArray(config) ||
          ('serverUrl' in config && typeof config.serverUrl !== 'string')
        )
          throw new Error();
        if ('serverUrl' in config) serverUrl = config.serverUrl as string;
      } catch (cause) {
        throw new RuaKitError(
          'INVALID_REQUEST',
          'The page has invalid RuaKit configuration.',
          { cause },
        );
      }
    }
  }
  const base = (serverUrl ?? '').replace(/\/$/, '');
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  return {
    async plan(input, signal) {
      const response = await fetcher(`${base}/v1/plan`, {
        method: 'POST',
        signal,
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      let data: unknown;
      try {
        data = await response.json();
      } catch (cause) {
        throw new RuaKitError(
          'HTTP_ERROR',
          'The server returned invalid JSON.',
          { cause },
        );
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
        planResponseSchema,
        data,
        'INVALID_PLAN',
        'The server returned an invalid plan response.',
      );
    },
  };
}
