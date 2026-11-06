// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { readFile, writeFile } from "node:fs/promises";

const prompt = await readFile(
  new URL("../../../docs/PROMPT.md", import.meta.url),
  "utf8",
);
await writeFile(
  new URL("../src/prompt.ts", import.meta.url),
  "// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT\n" +
    "// Generated from docs/PROMPT.md. do not edit directly.\n" +
    `export const systemPrompt: string = ${JSON.stringify(prompt.trim())};\n`,
);
