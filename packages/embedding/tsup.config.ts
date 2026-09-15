import { defineConfig } from "tsup";

// R63 T2 (D-005): publish-only build — dev resolves src/index.ts via exports; the packed
// tarball's manifest is rewritten by publishConfig.exports to dist/index.js, so plain-node
// consumers never see a .ts entry. transformers stays external (dynamic import in src,
// and bundling the onnx binding crashes — ADR-0033).
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  outDir: "dist",
  target: "es2022",
  platform: "node",
  sourcemap: false,
  clean: true,
  external: ["@huggingface/transformers", "onnxruntime-node", "sharp"],
});
