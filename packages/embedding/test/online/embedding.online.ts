// ADR-0057 D4 (D-005): real-model embedding path - requires network + model download.
// NOT part of the default `test` script: the glob is **/*.test.ts|mjs, and this file is
// *.online.ts. Run explicitly via `pnpm -C packages/embedding test:online`, which supplies
// ANS_EMBEDDING_ONLINE=1 through --env-file (cross-platform, zero new dependencies).
import assert from "node:assert";
import { test } from "node:test";
import { embedText, cosineSimilarity, __resetEmbeddingState } from "../../src/index";

const ONLINE = process.env.ANS_EMBEDDING_ONLINE === "1";
const skip: string | false = ONLINE
  ? false
  : "set ANS_EMBEDDING_ONLINE=1 (real model: network + download required)";

test("real model: same input -> same vector", { skip }, async () => {
  __resetEmbeddingState();
  const a = await embedText("real-model determinism probe", "passage");
  const b = await embedText("real-model determinism probe", "passage");
  assert.ok(a && b, "real extractor must produce vectors (model available)");
  assert.ok(cosineSimilarity(a, b) > 1 - 1e-6, "real model same input must give same vector");
});

test("real model: query vs passage prefixes differ", { skip }, async () => {
  __resetEmbeddingState();
  const q = await embedText("shared body text", "query");
  const p = await embedText("shared body text", "passage");
  assert.ok(q && p, "real extractor must produce vectors (model available)");
  assert.ok(cosineSimilarity(q, p) < 0.999999, "e5 role prefixes must yield distinct vectors");
});

test("real model: empty input -> null (wrapper short-circuit)", { skip }, async () => {
  __resetEmbeddingState();
  assert.strictEqual(await embedText("   ", "passage"), null);
});
