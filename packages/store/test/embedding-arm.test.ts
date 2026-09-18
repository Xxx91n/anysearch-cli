// ADR-0063 (R62 T3) / R62 D-002: guarded optional-embedding arm — when
// @anysearch-cli/embedding is absent from the install closure the vector arm
// degrades to a legal FTS-only state: embedText ≡ null, telemetry reports
// absent:true with zero counters, writes stay fail-open (pendingVectors
// accounting), and nothing throws. cosineSimilarity stays inlined pure math.

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { embedText, embeddingModelId, armTelemetry, cosineSimilarity, __setEmbeddingModuleForTest, __importEmbeddingFallbackForTest } from "../src/embedding-arm";
import { SqliteSessionStore } from "../src/session-store";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; } else { failed++; console.error("FAIL: " + msg); }
}

const dir = mkdtempSync(join(tmpdir(), "ans-embedding-arm-"));
async function main() {
  // 1. Guard seam — arm forced absent (package not in the install closure).
  __setEmbeddingModuleForTest(null);
  assert((await embedText("hello", "query")) === null, "absent arm => embedText null");
  const tel = await armTelemetry();
  assert(tel.absent === true && tel.loads === 0 && tel.embeds === 0 && tel.failures === 0 && tel.circuitOpen === false,
    "absent telemetry = zero counters + absent flag");
  assert((await embeddingModelId()) === "unavailable", "absent arm => model id unavailable");

  // 2. Write path stays fail-open — adjudicate accepts, embedWrite records pendingVector.
  const store = new SqliteSessionStore(join(dir, "arm.db"));
  const session = await store.createSession("arm-absent");
  const res = await store.adjudicateMemory(session.id, [{
    url: "https://example.com/a", title: "alpha memory", snippet: "embedded or not, the write lands",
    source: "user", evidence: 0.9,
  }]);
  assert(res.length === 1 && (res[0].action === "accept" || res[0].action === "supersede"),
    "write accepted with arm absent");
  const vt = await store.vectorTelemetry();
  assert(vt.absent === true, "store vectorTelemetry reports arm absent");
  assert(vt.pendingVectors === 1 && vt.writes === 0, "absent arm => pendingVector recorded, no vector write");
  assert(vt.embeds === 0 && vt.failures === 0, "absent arm => package telemetry zeros");

  // 3. FTS recall unaffected — FTS-only degrade is functional, not silent.
  await store.append(session.id, { role: "user", content: "alpha memory content" });
  const hits = await store.searchFts5(session.id, "alpha");
  assert(hits.length >= 1, "FTS5 recall works with arm absent");
  store.close();

  // 4. Stub module proves delegation when the arm IS present (no real transformers).
  __setEmbeddingModuleForTest({
    embedText: async () => new Float32Array(384).fill(0.5),
    embeddingTelemetry: () => ({ loads: 1, embeds: 1, failures: 0, circuitOpen: false }),
    EMBEDDING_MODEL_ID: "test-model",
  } as never);
  assert((await embedText("x", "query"))?.length === 384, "present arm delegates embedText");
  assert((await armTelemetry()).absent === false && (await armTelemetry()).embeds === 1, "present arm telemetry passthrough");
  assert((await embeddingModelId()) === "test-model", "model id passthrough");

  // 5. R71 T1 (ADR-0072): sibling-root fallback — pnpm-style isolated global
  // node_modules roots. <tmp>/global/v11/<hashA>/node_modules/@anysearch-cli/cli
  // holds the invoked entry; <hashB>/node_modules/@anysearch-cli/embedding is the
  // sibling package that bare-specifier resolution cannot reach.
  const g = join(dir, "global", "v11");
  const cliDist = join(g, "aaaaaaaa", "node_modules", "@anysearch-cli", "cli", "dist");
  const embDir = join(g, "bbbbbbbb", "node_modules", "@anysearch-cli", "embedding");
  mkdirSync(cliDist, { recursive: true });
  mkdirSync(join(embDir, "dist"), { recursive: true });
  writeFileSync(join(cliDist, "index.js"), "// cli entry (argv[1] anchor)");
  writeFileSync(join(embDir, "package.json"), JSON.stringify({
    name: "@anysearch-cli/embedding", version: "0.0.5", type: "module",
    exports: { ".": "./dist/index.js" },
  }));
  writeFileSync(join(embDir, "dist", "index.js"),
    'export const EMBEDDING_MODEL_ID = "stub-e5";\n' +
    'export function embedText() { return Promise.resolve(new Float32Array(3).fill(1)); }\n' +
    'export function embeddingTelemetry() { return { loads: 1, embeds: 1, failures: 0, circuitOpen: false }; }\n' +
    'export function cosineSimilarity() { return 1; }\n');
  const fb = await __importEmbeddingFallbackForTest([join(cliDist, "index.js")]);
  assert(fb !== null && (fb.EMBEDDING_MODEL_ID as string) === "stub-e5",
    "sibling-root fallback resolves the stub embedding package");
  // Negative: an anchor with no embedding in its ancestor chain must not return
  // the stub (a real embedding elsewhere on this box is a legal resolve — the
  // contract is 'any reachable copy', never 'the stub specifically').
  const fb2 = await __importEmbeddingFallbackForTest([join(dir, "lonely", "index.js")]);
  assert(fb2 === null || (fb2.EMBEDDING_MODEL_ID as string) !== "stub-e5",
    "empty anchor does not resolve the synthetic stub");

  // 6. cosineSimilarity — inlined pure math, no package dependency.
  const a = new Float32Array([1, 0, 0]);
  assert(cosineSimilarity(a, a) === 1, "cosine identical = 1");
  assert(cosineSimilarity(a, new Float32Array([0, 1, 0])) === 0, "cosine orthogonal = 0");
  assert(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([1, 0, 9])) === 1, "cosine uses min length");
}

main().then(() => {
  __setEmbeddingModuleForTest("auto");
  rmSync(dir, { recursive: true, force: true });
  console.log("--- embedding-arm tests: " + passed + " passed, " + failed + " failed ---");
  process.exit(failed > 0 ? 1 : 0);
}).catch((e) => {
  __setEmbeddingModuleForTest("auto");
  rmSync(dir, { recursive: true, force: true });
  console.error("embedding-arm test crashed: " + (e?.stack ?? e));
  process.exit(1);
});
