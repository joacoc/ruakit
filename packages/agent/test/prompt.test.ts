// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { systemPrompt } from '@ruakit/agent';

it('exports the maintained prompt through the main package entry point', async () => {
  const markdown = await readFile(new URL('../../../docs/PROMPT.md', import.meta.url), 'utf8');
  expect(systemPrompt).toBe(markdown.trim());
});
