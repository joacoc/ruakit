// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
import { readdir } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const sourceDirectory = path.resolve("src");
const outputDirectory = path.resolve("dist");

async function emittedFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await emittedFiles(filename)));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      files.push(
        path.join(
          outputDirectory,
          path.relative(sourceDirectory, filename).replace(/\.tsx?$/, ".js"),
        ),
      );
    }
  }
  return files;
}

await build({
  entryPoints: await emittedFiles(sourceDirectory),
  outbase: outputDirectory,
  outdir: outputDirectory,
  allowOverwrite: true,
  bundle: false,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  minify: true,
  keepNames: true,
  sourcemap: true,
  legalComments: "inline",
  banner: {
    js: "// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0",
  },
});
