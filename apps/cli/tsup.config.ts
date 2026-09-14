import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf8"));

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  dts: true,
  outDir: "dist",
  define: {
    __PACKAGE_VERSION__: JSON.stringify(pkg.version),
  },
  noExternal: [
    "@anysearch/retriever",
    "@anysearch/retriever/providers",
    "@anysearch/store",
    "@anysearch/kernel",
    "@sinclair/typebox",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
  ],
  // ADR-0033: native/ESM deps stay external (bundling crashes the onnx runtime binding).
  external: ["better-sqlite3", "@huggingface/transformers", "onnxruntime-node", "sharp", "@anysearch/embedding"],
  target: "es2022",
});
