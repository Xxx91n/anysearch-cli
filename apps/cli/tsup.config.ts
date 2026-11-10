import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf8"));

export default defineConfig({
  entry: ["src/index.ts"],
  // ESM: pi-coding-agent exports only an `import` entry and its config module
  // reads import.meta.url when loaded, so a CJS bundle cannot load it at all.
  format: ["esm"],
  dts: true,
  outDir: "dist",
  platform: "node",
  target: "es2022",
  // ESM cannot inline CommonJS packages that use dynamic require (form-data,
  // axios helpers, ...). Only workspace packages are bundled; every other
  // dependency resolves from node_modules at runtime.
  skipNodeModulesBundle: true,
  define: {
    __PACKAGE_VERSION__: JSON.stringify(pkg.version),
  },
  noExternal: [
    "@anysearch-cli/retriever",
    "@anysearch-cli/retriever/providers",
    "@anysearch-cli/store",
    "@anysearch-cli/kernel",
    "@sinclair/typebox",
  ],
  // The PI SDK stays external: the published package declares it as a real
  // dependency, so one copy is shared with the host instead of inlining a
  // large ESM graph into the CLI bundle.
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
});
