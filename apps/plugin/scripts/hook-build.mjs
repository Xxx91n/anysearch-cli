// Build the hook bundles declared in package.json "exports".
//
// Design: one builder for both call sites, entries from `exports` — the esbuild
// options and the entry list exist once.
//
// Wipes the outdir first (esbuild never deletes files). Run after tsup: its
// `clean` already empties dist/hooks, so the wipe is a backstop.
import { build } from "esbuild";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { NATIVE_EXTERNALS } from "./externals.mjs";

export async function buildHookBundles({ pluginRoot, outdir }) {
  const manifest = JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf8"));
  const entryPoints = Object.entries(manifest.exports)
    .filter(([name]) => name.startsWith("./hooks/"))
    .map(([name, entry]) => {
      const types = typeof entry === "string" ? undefined : entry?.types;
      if (typeof types !== "string") {
        throw new Error(`package.json exports["${name}"] needs an object with a string "types" path`);
      }
      const sourcePath = types.replace(/^\.\//, "");
      if (!sourcePath.startsWith("src/hooks/")) {
        throw new Error(`package.json exports["${name}"] must live under src/hooks/ so outbase keeps its path: ${types}`);
      }
      return resolve(pluginRoot, sourcePath);
    });

  rmSync(outdir, { recursive: true, force: true });
  await build({
    entryPoints,
    bundle: true,
    platform: "node",
    format: "cjs",
    outdir,
    outbase: join(pluginRoot, "src/hooks"),
    outExtension: { ".js": ".cjs" },
    banner: { js: "#!/usr/bin/env node" },
    external: NATIVE_EXTERNALS,
  });
}
