// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Toolbar } from '../dist/lib/controlled.js';

it.each(['index.js', 'lib/controlled.js'])('preserves the Next.js client boundary in %s', async (entry) => {
  const bundle = await readFile(new URL(`../dist/${entry}`, import.meta.url), 'utf8');
  expect(bundle).toMatch(/^"use client";/);
});

it('ships a controlled toolbar without agent orchestration', async () => {
  const bundle = await readFile(new URL('../dist/lib/controlled.js', import.meta.url), 'utf8');
  expect(bundle).not.toContain('@ruakit/agent');
  expect(bundle).not.toContain('createRuntime');
  const html = renderToString(
    createElement(Toolbar, {
      prompt: '',
      placeholder: 'Ask',
      request: { status: 'idle', message: 'Ready' },
      onPromptChange() {},
      onSubmit() {},
      onCancel() {},
      onAnswer() {},
      onStartOver() {},
    }),
  );
  expect(html).toContain('Open Rua');
});

it('ships the bundled UI licenses and original CSS sources for debugging', async () => {
  const licenses = await readFile(new URL('../dist/THIRD-PARTY-LICENSES.txt', import.meta.url), 'utf8');
  expect(licenses).toContain('@heroicons/react@');
  expect(licenses).toContain('MIT License');
  const stylesheetMap = JSON.parse(await readFile(new URL('../dist/styles.css.map', import.meta.url), 'utf8'));
  expect(stylesheetMap.sources).toContain('../src/styles.css');
  expect(stylesheetMap.sourcesContent.join('')).toContain('.ruakit-toolbar');
});
