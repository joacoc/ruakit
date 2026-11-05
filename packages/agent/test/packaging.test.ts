// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('maps errors from the built package back to the original TypeScript', () => {
  const entry = new URL('../dist/index.js', import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    ['--enable-source-maps', '--input-type=module', '--eval',
      `import { createRuntime } from ${JSON.stringify(entry)}; createRuntime();`],
    { encoding: 'utf8' },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('RuaKitError: RuaKit requires a browser document.');
  expect(result.stderr).toMatch(/packages\/agent\/src\/runtime\.ts:\d+:\d+/);
});
