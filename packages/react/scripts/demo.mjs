// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const directory = fileURLToPath(new URL("../", import.meta.url));
const options = {
  absWorkingDir: directory,
  entryPoints: ["src/demo.tsx"],
  outdir: "results/demo",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  mainFields: ["browser", "module", "main"],
  sourcemap: true,
  logLevel: "info",
};

if (process.argv.includes("--build")) {
  await build(options);
} else {
  const preview = await context(options);
  await preview.watch();
  const { port } = await preview.serve({
    servedir: directory,
    host: "127.0.0.1",
    port: Number(process.env.RUAKIT_DEMO_PORT ?? 4318),
  });
  console.log(`\nRua component demos: http://127.0.0.1:${port}\n`);
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
      await preview.dispose();
      process.exit(0);
    });
  }
}
