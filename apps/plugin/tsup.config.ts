import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server/index.ts"],
  format: ["cjs"],
  target: "es2022",
  platform: "node",
  sourcemap: false,
  clean: true,
  dts: false,
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
