// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRuntime } from '../src/index.js';

let root: Root;
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
    () => [new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList,
  );
  const host = document.createElement('main');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function Editor({ accept = true }: { accept?: boolean }) {
  const [code, setCode] = useState('SELECT 1');
  return createElement(
    'label',
    null,
    'Source code',
    createElement('textarea', {
      value: code,
      onChange: (event: { target: { value: string } }) => {
        if (accept) {
          setCode(event.target.value);
        }
      },
    }),
    createElement('output', null, code),
  );
}

it('updates controlled React state and returns the value after rendering', async () => {
  flushSync(() => root.render(createElement(Editor)));
  const runtime = createRuntime({ root: document.querySelector('main')! });
  const control = runtime.getState().controls[0]!;
  const state = await runtime.setValue(control.target, 'SELECT 100');
  expect(state.controls[0]?.value).toBe('SELECT 100');
  expect(document.querySelector('output')!.textContent).toBe('SELECT 100');
});

it('reports rejection when React restores a controlled value', async () => {
  flushSync(() => root.render(createElement(Editor, { accept: false })));
  const runtime = createRuntime();
  await expect(
    runtime.setValue(runtime.getState().controls[0]!.target, 'SELECT 100'),
  ).rejects.toMatchObject({ code: 'VALUE_REJECTED' });
  expect(document.querySelector('textarea')!.value).toBe('SELECT 1');
});
