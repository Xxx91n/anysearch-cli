import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf8"));

export default defineConfig({
  entry: ["src/index.ts"],
  // ESM: pi-coding-agent exports only an `import` entry, so the MCP server
  // that links the kernel must be an ES module too.
  format: ["esm"],
  target: "es2022",
  platform: "node",
  sourcemap: false,
  clean: true,
  dts: true,
  // See apps/cli/tsup.config.ts: every third-party package stays a real import
  // and is declared in this app's own dependencies. Bundling CJS helpers into
  // ESM breaks on their dynamic `require("util")`.
  skipNodeModulesBundle: true,
  define: {
    __PACKAGE_VERSION__: JSON.stringify(pkg.version),
  },
  noExternal: [
    "@anysearch-cli/kernel",
    "@anysearch-cli/plugin",
    "@anysearch-cli/retriever",
    "@anysearch-cli/store",
    "@sinclair/typebox",
  ],
  // The PI SDK stays external: the published package declares it as a real
  // dependency, so one copy is shared with the host. Native deps stay external
  // too (bundling crashes the onnx runtime binding).
  external: [
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-coding-agent",
    // ponytail: migrated SDK v1 -> v2 split packages.
    // stale `@modelcontextprotocol/sdk` external removed; the two v2 packages
    // are listed explicitly here for clarity (they would also be externalized
    // automatically because they are dependencies, but explicit > implicit).
    "@modelcontextprotocol/node",
    "@modelcontextprotocol/server",
    "express",
    "zod",
    "better-sqlite3",
    "@huggingface/transformers",
    "@anysearch-cli/embedding",
    "onnxruntime-node",
    "sharp",
  ],
});
