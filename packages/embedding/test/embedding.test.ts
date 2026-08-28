// ADR-0033 acceptance: deterministic vectors, role prefixing, circuit breaker (n=3).
import assert from "node:assert";
import {
  embedText,
  cosineSimilarity,
  embeddingTelemetry,
  __setExtractorForTest,
  __resetEmbeddingState,
} from "../src/index";

async function main(): Promise<void> {
  __resetEmbeddingState();

  // 1. deterministic: same input -> same vector (cosine == 1)
  const a = await embedText("passage filler", "passage");
  const b = await embedText("passage filler", "passage");
  assert.ok(a && b, "embedder must produce vectors");
  assert.ok(cosineSimilarity(a, b) > 1 - 1e-6, "same input must give same vector");

  // 2. role prefix changes the vector
  const q = await embedText("same body", "query");
  const p = await embedText("same body", "passage");
  assert.ok(q && p);
  assert.ok(cosineSimilarity(q, p) < 0.999999, "query/passage prefixes must differ");

  // 3. empty input -> null, no failure counted
  const before = embeddingTelemetry().failures;
  assert.strictEqual(await embedText("   ", "passage"), null);
  assert.strictEqual(embeddingTelemetry().failures, before);

  // 4. circuit breaker: 3 consecutive failures open the circuit; further calls are free nulls
  __resetEmbeddingState();
  __setExtractorForTest(async () => { throw new Error("boom"); });
  await embedText("x", "passage");
  await embedText("x", "passage");
  await embedText("x", "passage");
  let tel = embeddingTelemetry();
  assert.strictEqual(tel.circuitOpen, true, "circuit must open after 3 failures");
  assert.strictEqual(tel.failures, 3);
  await embedText("x", "passage"); // circuit open: no new failure recorded
  tel = embeddingTelemetry();
  assert.strictEqual(tel.failures, 3, "open circuit must not invoke extractor");

  // 5. recovery: single success resets the failure streak
  __resetEmbeddingState();
  __setExtractorForTest(async () => { throw new Error("boom"); });
  await embedText("x", "passage");
  __setExtractorForTest(async (input) => { void input; return { data: new Float32Array([1, 0]) }; });
  const r = await embedText("x", "passage");
  assert.ok(r instanceof Float32Array, "healthy extractor returns a vector");

  __resetEmbeddingState();
  console.log("embedding.test: all assertions passed");
}

main().catch((e) => { console.error(e); process.exit(1); });
