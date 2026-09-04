// ADR-0045 D2 (r118 impl): MemoryFusion registry consumption + sources.weights validation pairs.
// - k_fusion.memory / weights.memory consumed by session-store (recomputation equality).
// - ROR_WINDOW consumes registry ror_window (mutation test anchor — no dead registration).
// - sources.weights: valid pass / illegal fail-fast (negative pair members).
import { SqliteSessionStore } from "../src/session-store";
import { loadDomainFromString } from "../src/domain-loader";
import { ROR_WINDOW, ROR_CLIP } from "../src/eval/runner";
import { FUSION_REGISTRY, rrfRank } from "@anysearch/retriever";

let passed = 0;
let failed = 0;
function assert(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error("FAIL: " + label); }
}

async function main() {
  // 1. MemoryFusion registry consumption: provenance snapshot matches registry-driven recompute.
  const store = new SqliteSessionStore(":memory:");
  const session = await store.createSession("code");
  await store.saveResults(session.id, [
    { url: "https://example.com/1", title: "alpha bravo doc", snippet: "alpha bravo charlie delta", source: "tavily" },
    { url: "https://example.com/2", title: "unrelated", snippet: "nothing here", source: "exa" },
  ]);
  const hits = await store.searchMemory("alpha bravo");
  assert("searchMemory returns hits", hits.length > 0);
  const prov = store.lastArmProvenance;
  assert("provenance captured", prov !== null);
  if (prov) {
    assert("provenance instance label", prov.instance === "memory");
    assert("provenance scoreKind rank_fusion", prov.scoreKind === "rank_fusion");
    assert("provenance labels/lists/weights parallel", prov.labels.length === prov.lists.length && prov.weights.length === prov.labels.length);
    assert("FTS anchor weight from registry", prov.weights[0] === FUSION_REGISTRY.weights.memory.fts);
    for (const w of prov.weights.slice(1)) assert("side-arm weight from registry", w === FUSION_REGISTRY.weights.memory.entity);
    // Behavior anchor: fusedIds equal an independent registry-driven recomputation.
    const ref = prov.lists.length === 1 ? prov.lists[0]! : rrfRank(prov.lists, FUSION_REGISTRY.k_fusion.memory, [...prov.weights]);
    assert("fusedIds == registry k_fusion.memory recomputation", JSON.stringify(prov.fusedIds) === JSON.stringify(ref));
  }

  // 2. runner ROR_WINDOW / ROR_CLIP consume the registered ror_window.
  assert("ROR_WINDOW === registry ror_window", ROR_WINDOW === FUSION_REGISTRY.ror_window);
  assert("ROR_CLIP === ror_window + 1", ROR_CLIP === FUSION_REGISTRY.ror_window + 1);

  // 3. sources.weights validation pairs (fail-fast config errors).
  const toml = (weights: string) => `
name = "fusion-test"
[sources]
enabled = ["tavily", "exa", "anysearch"]
weights = { ${weights} }
[rag]
adapter = "none"
[hooks]
toolWhitelist = ["a"]
[skills]
active = []
`;
  // positive member: valid weights resolve and are carried.
  const ok = loadDomainFromString(toml("tavily = 2.0"));
  assert("valid sources.weights carried", ok.sources.weights?.tavily === 2.0);
  // negative members: each illegal shape must throw with a sources.weights message.
  for (const [label, w] of [
    ["zero weight", "tavily = 0.0"],
    ["negative weight", "exa = -1.5"],
    ["unknown provider id", "bing = 1.0"],
  ] as const) {
    let threw = false;
    try { loadDomainFromString(toml(w)); } catch (e) {
      threw = e instanceof Error && e.message.includes("sources.weights");
    }
    assert("illegal weights fail fast: " + label, threw);
  }
  // absent weights: no field, no error (default equal-weight path stays).
  const none = loadDomainFromString(toml(''));
  // empty inline table is legal TOML but carries no keys — still fine
  assert("no weights -> no field or empty", none.sources.weights === undefined || Object.keys(none.sources.weights).length === 0);

  console.log(`fusion-registry-memory tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
