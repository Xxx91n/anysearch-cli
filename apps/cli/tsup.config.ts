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
  external: ["better-sqlite3"],
  target: "es2022",
});
