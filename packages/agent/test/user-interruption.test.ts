// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { createRequestOperation } from '../src/operations.js';

it('does not subscribe to page input and retains explicit cancellation', () => {
  const added = vi.spyOn(document, 'addEventListener');
  const controller = new AbortController();
  const operation = createRequestOperation(1000, controller.signal);
  try {
    document.body.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(operation.signal.aborted).toBe(false);
    expect(
      added.mock.calls.some(([type]) => ['keydown', 'pointerdown', 'wheel'].includes(type)),
    ).toBe(false);
    controller.abort(new Error('Explicit cancellation'));
    expect(operation.signal.aborted).toBe(true);
    expect(operation.signal.reason.message).toBe('Explicit cancellation');
  } finally {
    operation.dispose();
    added.mockRestore();
  }
});
