// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('type-checks context inference, identity requirements and compatibility through public exports', () => {
  const program = ts.createProgram(
    [fileURLToPath(new URL('./request-types.fixture.tsx', import.meta.url))],
    {
      strict: true,
      exactOptionalPropertyTypes: true,
      noUncheckedIndexedAccess: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
  );
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const messages = diagnostics.map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  );
  expect(messages).toEqual([]);
});
