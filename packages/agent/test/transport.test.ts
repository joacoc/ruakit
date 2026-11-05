// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
import { expect, it, vi } from 'vitest';
import type { DecisionRequest } from '@ruakit/schema';
import { createHttpTransport } from '../src/transport.js';

const request: DecisionRequest = {
  prompt: 'Open billing',
  clarifications: [],
  snapshot: {
    url: 'https://app.example/',
    title: 'App',
    text: 'Billing',
    controls: [],
    focused: null,
    truncated: false,
  },
  history: [],
};

it('validates untrusted HTTP decisions before exposing executable instructions', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      type: 'act',
      message: 'Run code',
      step: { type: 'eval', code: 'bad()' },
    }),
  );
  const transport = createHttpTransport({ fetch: fetcher });
  await expect(transport.dom(request, new AbortController().signal)).rejects.toMatchObject({
    code: 'INVALID_PLAN',
  });
});

it('propagates the request and signal and reports HTTP failures with stable error codes', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ error: 'Planner unavailable.' }, { status: 503 }));
  const transport = createHttpTransport({
    serverUrl: 'http://localhost:4310/',
    fetch: fetcher,
  });
  const controller = new AbortController();
  await expect(transport.dom(request, controller.signal)).rejects.toMatchObject({
    code: 'HTTP_ERROR',
    message: 'Planner unavailable.',
  });
  expect(fetcher).toHaveBeenCalledWith('http://localhost:4310/v1/plan', {
    method: 'POST',
    signal: controller.signal,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
});

it('accepts conversational decisions and rejects mixed executable responses', async () => {
  const question = { type: 'clarify', message: 'Which billing page?' };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(question));
  const transport = createHttpTransport({ fetch: fetcher });
  await expect(transport.dom(request, new AbortController().signal)).resolves.toEqual(question);
  fetcher.mockImplementation(async () =>
    Response.json({
      ...question,
      step: { type: 'click', target: { id: 'a', version: 1 } },
    }),
  );
  await expect(transport.dom(request, new AbortController().signal)).rejects.toMatchObject({
    code: 'INVALID_PLAN',
  });
});

it('reports invalid JSON as an HTTP error', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('not JSON'));
  await expect(
    createHttpTransport({ fetch: fetcher }).dom(request, new AbortController().signal),
  ).rejects.toMatchObject({
    code: 'HTTP_ERROR',
    message: 'The server returned invalid JSON.',
  });
});
