import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf8"));

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  target: "es2022",
  platform: "node",
  sourcemap: false,
  clean: true,
  dts: true,
  define: {
    __PACKAGE_VERSION__: JSON.stringify(pkg.version),
  },
  // Bundle ESM-only packages into CJS to avoid ERR_PACKAGE_PATH_NOT_EXPORTED.
  noExternal: [
    "@anysearch/kernel",
    "@anysearch/plugin",
    "@anysearch/retriever",
    "@anysearch/store",
    "@sinclair/typebox",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
  ],
  // ADR-0033: native/ESM deps stay external (bundling crashes the onnx runtime binding).
  external: [
    // ponytail: ADR-0018 R16-1 migrated SDK v1 -> v2 split packages.
    // stale `@modelcontextprotocol/sdk` external removed; the two v2 packages
    // are listed explicitly here for clarity (they would also be externalized
    // automatically because they are dependencies, but explicit > implicit).
    "@modelcontextprotocol/node",
    "@modelcontextprotocol/server",
    "express",
    "zod",
    "better-sqlite3",
    "@huggingface/transformers",
    "@anysearch/embedding",
    "onnxruntime-node",
    "sharp",
  ],
});
