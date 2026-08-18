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
  ],
  // Native addons must stay external — bundling them breaks .node binary resolution.
  external: ["better-sqlite3"],
  target: "es2022",
});