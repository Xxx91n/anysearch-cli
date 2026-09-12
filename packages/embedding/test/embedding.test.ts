// ADR-0033 + ADR-0057 D4 (D-005): the DEFAULT suite is fully stubbed and offline-hermetic.
// The real-model (network) path lives in test/online/embedding.online.ts, which the default
// `test` glob (**/*.test.ts|mjs) deliberately does NOT match - see package.json test:online.
import assert from "node:assert";
import {
  embedText,
  cosineSimilarity,
  embeddingTelemetry,
  __setExtractorForTest,
  __resetEmbeddingState,
} from "../src/index";

// Deterministic stub extractor: FNV-1a hash per dimension -> L2-normalized unit vector.
// These assertions target WRAPPER logic (role prefixing, the normalize/pooling contract,
// the circuit breaker, telemetry, fail-open) - not model fidelity. The stub derives its
// vector FROM the input, so if the wrapper ever stopped prefixing the role, test 2 would
// fail rather than pass vacuously.
async function stubExtractor(
  input: string,
  _opts: { pooling: string; normalize: boolean }
): Promise<{ data: Float32Array }> {
  void _opts;
  const DIM = 8;
  const v = new Float32Array(DIM);
  for (let d = 0; d < DIM; d++) {
    let h = (2166136261 ^ Math.imul(d + 1, 16777619)) >>> 0;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    v[d] = (h / 4294967295) * 2 - 1;
  }
  let norm = 0;
  for (let d = 0; d < DIM; d++) norm += v[d] * v[d];
  norm = Math.sqrt(norm) || 1;
  for (let d = 0; d < DIM; d++) v[d] /= norm;
  return { data: v };
}

async function main(): Promise<void> {
  __resetEmbeddingState();
  __setExtractorForTest(stubExtractor);

  // 1. deterministic: same input -> same vector (cosine == 1)
  const a = await embedText("passage filler", "passage");
  const b = await embedText("passage filler", "passage");
  assert.ok(a && b, "embedder must produce vectors");
  assert.ok(cosineSimilarity(a, b) > 1 - 1e-6, "same input must give same vector");

  // 2. role prefix changes the vector (wrapper prefixes query:/passage: before the extractor)
  const q = await embedText("same body", "query");
  const p = await embedText("same body", "passage");
  assert.ok(q && p);
  assert.ok(cosineSimilarity(q, p) < 0.999999, "query/passage prefixes must differ");

  // 3. empty input -> null, no failure counted (wrapper short-circuit, extractor untouched)
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
  console.log("embedding.test: all assertions passed (stubbed, offline-hermetic)");
}

main().catch((e) => { console.error(e); process.exit(1); });
