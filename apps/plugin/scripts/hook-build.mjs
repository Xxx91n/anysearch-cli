// Build the hook bundles declared in package.json "exports".
//
// Design: one builder for both call sites, entries from `exports` — the esbuild
// options and the entry list exist once.
//
// Wipes the outdir first (esbuild never deletes files). Run after tsup: its
// `clean` already empties dist/hooks, so the wipe is a backstop.
//
// Design: `buildSync`, plus a check that every bundle is on disk, instead of
// `build` and hoping. esbuild's async API runs a service process that on
// Windows can outlive node, so a caller that exits right after the await hands
// a half-written dist/hooks to whoever reads it next — that is how the
// dsh-plugin tests lost core.cjs and server-token.cjs in CI (#490). The
// synchronous call blocks until the files are written, and the check names a
// short write here instead of leaving a missing-module error three steps later.
import { buildSync } from "esbuild";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
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
  buildSync({
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

  const missing = entryPoints
    .map((source) => join(outdir, relative(join(pluginRoot, "src/hooks"), source)).replace(/\.ts$/, ".cjs"))
    .filter((bundle) => !existsSync(bundle));
  if (missing.length > 0) {
    throw new Error(`build:hooks left ${missing.length} of ${entryPoints.length} bundles unwritten: ${missing.join(", ")}`);
  }
}
