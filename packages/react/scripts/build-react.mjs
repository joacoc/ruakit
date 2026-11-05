// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

// Bundle UI dependencies so a linked installation cannot load their workspace React peers.
// The browser engine stays separate; React and its renderer always belong to the host.
const result = await build({
  entryPoints: ["index.tsx", "lib/controlled.ts"].map((name) =>
    fileURLToPath(new URL(`../src/${name}`, import.meta.url)),
  ),
  outbase: fileURLToPath(new URL("../src", import.meta.url)),
  outdir: fileURLToPath(new URL("../dist", import.meta.url)),
  bundle: true,
  format: "esm",
  platform: "neutral",
  mainFields: ["module", "main"],
  target: "es2022",
  jsx: "automatic",
  sourcemap: true,
  minify: true,
  keepNames: true,
  external: [
    "react",
    "react/*",
    "react-dom",
    "react-dom/*",
    "@ruakit/agent",
    "*.css",
  ],
  legalComments: "linked",
  banner: {
    js: '"use client";\n// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT',
  },
  metafile: true,
  footer: {
    js: "// Bundled dependency licenses: see THIRD-PARTY-LICENSES.txt.",
  },
});

// Preserve the complete licenses even when upstream modules omit legal comments.
const packageRoots = new Set();
const marker = `${path.sep}node_modules${path.sep}`;

for (const input of Object.keys(result.metafile.inputs)) {
  const absolute = path.resolve(input);
  const offset = absolute.lastIndexOf(marker);

  if (offset >= 0) {
    const prefix = absolute.slice(0, offset + marker.length);
    const parts = absolute.slice(prefix.length).split(path.sep);
    packageRoots.add(
      path.join(prefix, ...parts.slice(0, parts[0].startsWith("@") ? 2 : 1)),
    );
  }
}

const licenses = [];
for (const root of [...packageRoots].sort()) {
  const manifest = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );

  let license;
  for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt"]) {
    try {
      license = await readFile(path.join(root, name), "utf8");
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  if (!license)
    throw new Error(`Missing bundled dependency license: ${manifest.name}`);

  licenses.push(`${manifest.name}@${manifest.version}\n\n${license}`);
}

await writeFile(
  new URL("../dist/THIRD-PARTY-LICENSES.txt", import.meta.url),
  `${licenses.join("\n\n---\n\n")}\n`,
);
