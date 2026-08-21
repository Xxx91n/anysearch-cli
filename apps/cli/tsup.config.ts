import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  dts: true,
  outDir: "dist",
  noExternal: [
    "@anysearch/retriever",
    "@anysearch/retriever/providers",
    "@anysearch/store",
    "@anysearch/kernel",
    "@sinclair/typebox",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
  ],
  external: ["better-sqlite3"],
  target: "es2022",
});
