// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { expect, it } from 'vitest';
import { RuntimeError } from '@ruakit/runtime';
import { RuaKitError, toRequestError } from '../dist/index.js';

it.each([
  [
    new RuaKitError('VERIFICATION_FAILED', 'Not saved'),
    'VERIFICATION_FAILED',
    'Not saved',
  ],
  [
    new RuntimeError('STALE_TARGET', 'Control changed'),
    'STALE_TARGET',
    'Control changed',
  ],
  [
    new RuntimeError('DISABLED', 'Disabled control'),
    'DISABLED',
    'Disabled control',
  ],
  [
    new DOMException('Deadline expired', 'TimeoutError'),
    'TIMEOUT',
    'Deadline expired',
  ],
  [new Error('Custom failure'), 'REQUEST_FAILED', 'Custom failure'],
  [
    { code: 'BUSY', message: 'Untrusted error shape' },
    'REQUEST_FAILED',
    'Request failed.',
  ],
  [null, 'REQUEST_FAILED', 'Request failed.'],
])('maps %s to a stable integration error', (error, code, message) => {
  expect(toRequestError(error)).toEqual({ code, message });
});
