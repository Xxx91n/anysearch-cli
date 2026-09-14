import { defineConfig } from "tsup";

export default defineConfig({
  // ponytail: two entries — src/index.ts (side-effect-free barrel re-export,
  // referenced by package.json "main"/"exports") and src/server/index.ts
  // (long-running HTTP server, side-effect on import, only used via bin spawn).
  // Collapsing both into one entry made require('@anysearch/plugin') launch
  // an HTTP server and crash on EADDRINUSE.
  entry: ["src/index.ts", "src/server/index.ts"],
  format: ["cjs"],
  target: "es2022",
  platform: "node",
  sourcemap: false,
  clean: true,
  dts: false,
  // ponytail: package.json main/exports point to ./dist/index.cjs (including the
  // "./hooks/*" subpaths). tsup would default to .js for cjs when package.json has
  // no "type": "module", so force .cjs extension to keep exports consistent.
  outExtension() {
    return { js: ".cjs" };
  },
  noExternal: [
    "@anysearch/kernel",
    "@anysearch/retriever",
    "@anysearch/store",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@sinclair/typebox",
  ],
  // ponytail: also drop stale v1 sdk/zod/express externals (already removed from
  // dependencies in ADR-0018 R16-1; leaving them here misleads future maintainers
  // and would silently externalize if someone re-imported them later).
  external: [
    "better-sqlite3",
    "@anysearch/embedding",
  ],
});
