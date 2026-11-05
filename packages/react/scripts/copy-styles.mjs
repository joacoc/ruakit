// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
import { copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

await build({
  entryPoints: [fileURLToPath(new URL("../src/styles.css", import.meta.url))],
  outfile: fileURLToPath(new URL("../dist/styles.css", import.meta.url)),
  minify: true,
  sourcemap: true,
  legalComments: "linked",
});

await copyFile(
  new URL("../src/styles.d.ts", import.meta.url),
  new URL("../dist/styles.d.ts", import.meta.url),
);
