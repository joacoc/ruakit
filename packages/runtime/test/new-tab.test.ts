// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRuntime } from '../src/index.js';

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
    () => [new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList,
  );
  document.body.innerHTML = '<a href="https://docs.example/" target="_blank">Documentation</a>';
});
afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('reports uncancelled new-tab activation separately from the unchanged page observation', async () => {
  const runtime = createRuntime();
  const before = runtime.getState();
  const result = await runtime.click(before.controls[0]!.target);
  expect(result).toMatchObject({ url: before.url, navigation: { url: 'https://docs.example/', target: '_blank' } });
  expect(runtime.getState()).not.toHaveProperty('navigation');
});

it.each(['cancel', 'download', 'button'] as const)('does not report a new-tab navigation for %s', async (kind) => {
  const link = document.querySelector('a')!;
  if (kind === 'cancel') link.onclick = (event) => event.preventDefault();
  if (kind === 'download') {
    link.download = 'guide.html';
  }
  if (kind === 'button') document.body.innerHTML = '<button>Documentation</button>';
  const runtime = createRuntime();
  expect(await runtime.click(runtime.getState().controls[0]!.target)).not.toHaveProperty('navigation');
});

it('records the destination after click handlers and ignores later feedback mutations', async () => {
  const link = document.querySelector('a')!;
  link.onclick = () => { link.href = 'https://docs.example/guide'; };
  const runtime = createRuntime({
    onAction: (event) => { if (event.phase === 'after') link.href = 'https://other.example/'; },
  });
  expect(await runtime.click(runtime.getState().controls[0]!.target)).toHaveProperty('navigation', {
    url: 'https://docs.example/guide', target: '_blank',
  });
});

it('recognizes an inherited base target', async () => {
  document.head.innerHTML = '<base target="_blank">';
  document.querySelector('a')!.removeAttribute('target');
  const runtime = createRuntime();
  expect(await runtime.click(runtime.getState().controls[0]!.target)).toHaveProperty('navigation');
});
