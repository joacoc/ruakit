// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('preserves the server-only import guard in the built package', () => {
  const entry = new URL('../dist/index.js', import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', `await import(${JSON.stringify(entry)});`],
    { encoding: 'utf8' },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('This module cannot be imported from a Client Component module.');
});
