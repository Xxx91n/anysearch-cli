import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  target: "es2022",
  platform: "node",
  sourcemap: false,
  clean: true,
  dts: true,
  // Bundle ESM-only packages into CJS to avoid ERR_PACKAGE_PATH_NOT_EXPORTED.
  noExternal: [
    "@anysearch/kernel",
    "@anysearch/retriever",
    "@anysearch/store",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@sinclair/typebox",
  ],
  external: [
    "@modelcontextprotocol/sdk",
    "express",
    "zod",
    "better-sqlite3",
  ],
});
