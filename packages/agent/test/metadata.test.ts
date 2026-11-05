// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { JSDOM } from 'jsdom';
import { afterEach, expect, it, vi } from 'vitest';
import { createRuntime } from '../src/runtime.js';

const windows: JSDOM[] = [];
afterEach(() => windows.splice(0).forEach((dom) => dom.window.close()));
function page(config?: unknown) {
  const dom = new JSDOM('', { url: 'https://app.example/' });
  windows.push(dom);
  if (config !== undefined) {
    const meta = dom.window.document.createElement('meta');
    meta.name = 'ruakit-config';
    meta.content = JSON.stringify(config);
    dom.window.document.head.append(meta);
  }
  return dom.window.document;
}

it('discovers the planner URL from the page', async () => {
  const document = page({ serverUrl: 'https://planner.example' });
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('planner reached'));
  await expect(createRuntime({ document, fetch: fetcher }).request('Open billing')).rejects.toThrow(
    'planner reached',
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[0]).toBe('https://planner.example/v1/plan');
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
    prompt: 'Open billing',
    snapshot: { url: 'https://app.example/' },
  });
});

it('lets an explicit same-origin URL override embedded configuration', async () => {
  const document = page({ serverUrl: 'https://embedded.example' });
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('override reached'));
  await expect(
    createRuntime({ document, serverUrl: '', fetch: fetcher }).request('Open billing'),
  ).rejects.toThrow('override reached');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[0]).toBe('/v1/plan');
});

it.each([undefined, {}])(
  'uses the current origin with optional configuration %j',
  async (config) => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('planner reached'));
    await expect(
      createRuntime({ document: page(config), fetch: fetcher }).request('Open billing'),
    ).rejects.toThrow('planner reached');
    expect(fetcher.mock.calls[0]?.[0]).toBe('/v1/plan');
  },
);

it('rejects malformed metadata before fetching', () => {
  const fetcher = vi.fn<typeof fetch>();
  for (const config of [null, [], { serverUrl: 42 }, { serverUrl: '' }, { serverUrl: ' ' }]) {
    expect(() => createRuntime({ document: page(config), fetch: fetcher })).toThrow(
      'invalid RuaKit configuration',
    );
  }
  const document = page({});
  document.querySelector('meta')!.content = '{';
  expect(() => createRuntime({ document, fetch: fetcher })).toThrow('invalid RuaKit configuration');
  expect(fetcher).not.toHaveBeenCalled();
});
