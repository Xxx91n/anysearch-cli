import { defineConfig, type Options } from "tsup";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pluginBuildOptions } from "../plugin/tsup.config";

const pkg = JSON.parse(readFileSync("./package.json", "utf8"));

const cli: Options & { noExternal: string[] } = {
  entry: ["src/index.ts"],
  // ESM: pi-coding-agent exports only an `import` entry and its config module
  // reads import.meta.url when loaded, so a CJS bundle cannot load it at all.
  format: ["esm"],
  dts: true,
  outDir: "dist",
  platform: "node",
  target: "es2022",
  // Only workspace packages are inlined. Every third-party package stays a real
  // import and is declared in this app's own dependencies: bundling CJS helpers
  // like form-data into ESM breaks on their dynamic `require("util")`.
  skipNodeModulesBundle: true,
  define: {
    __PACKAGE_VERSION__: JSON.stringify(pkg.version),
  },
  esbuildOptions(options) {
    // The plugin's public default export is its built CJS barrel. Product
    // builds must resolve the source, even when that barrel is absent or old.
    options.alias = { ...options.alias, "@anysearch-cli/plugin": resolve("../plugin/src/index.ts") };
  },
  noExternal: [
    "@anysearch-cli/retriever",
    "@anysearch-cli/retriever/providers",
    "@anysearch-cli/store",
    "@anysearch-cli/kernel",
    "@anysearch-cli/plugin",
    "@sinclair/typebox",
  ],
  // The PI SDK stays external: the published package declares it as a real
  // dependency, so one copy is shared with the host instead of inlining a
  // large ESM graph into the CLI bundle. Native/ESM deps stay external too
  // (bundling crashes the onnx runtime binding).
  external: [
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-coding-agent",
    "better-sqlite3",
    "@huggingface/transformers",
    "onnxruntime-node",
    "sharp",
    "@anysearch-cli/embedding",
  ],
};

// Design: the complete product builds the existing entry sources into its own
// package. Independent processes share one installed product, not sibling apps.
// The CLI build is uncached in turbo.json: it also reads MCP source outside this
// package and stamps the current Git commit. A cached package-local hash cannot
// establish either input, and must not produce a partial or wrongly stamped app.
export default defineConfig([
  cli,
  {
    ...cli,
    entry: ["../mcp/src/index.ts"],
    outDir: "mcp/dist",
    clean: true,
    dts: false,
    noExternal: cli.noExternal,
  },
  {
    ...pluginBuildOptions,
    entry: ["../plugin/src/index.ts", "../plugin/src/server/index.ts"],
    outDir: "plugin/dist",
  },
]);
