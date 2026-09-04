// ADR-0045 D2 (r118 impl): fusion-registry fixture tests.
// Pair 1 (registry drift): pinned SHA-256 vs payload; tampered copy must mismatch.
// Single-consumer liveness: rrf primitive consumes the injected k (behavior changes with k).
import { FUSION_REGISTRY, FUSION_REGISTRY_SCHEMA, SCORE_KIND, REGISTERED_MEMORY_ARMS, REGISTERED_WEB_PROVIDERS, fusionRegistryHash, registryWeight, assertFusionProvenance } from "../src/fusion-registry";
import { rrfScores } from "../src/rrf";

let passed = 0;
let failed = 0;
function assert(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error("FAIL: " + label); }
}

// Pinned expected value — full 64-hex SHA-256 of the canonical payload (ADR-0044 D2 style).
// Any registry edit without a deliberate re-pin flips this test (registry drift detection).
const EXPECTED_FUSION_REGISTRY_SHA256 = "33caa6f52f64c156d6029dc9d4650ae92f4c0b8313e4beb97f0502d25081dbce";

// Shape: schema + all six registered fields + read-only algorithm enum.
assert("schema marker", FUSION_REGISTRY.schema === FUSION_REGISTRY_SCHEMA && FUSION_REGISTRY.schema === "anysearch/fusion-registry@1");
assert("k_fusion memory/web split", FUSION_REGISTRY.k_fusion.memory === 60 && FUSION_REGISTRY.k_fusion.web === 60);
assert("rank_window registered (was implicit default)", FUSION_REGISTRY.rank_window === 60);
assert("ror_window registered (was runner const)", FUSION_REGISTRY.ror_window === 60);
assert("weights.memory exact", JSON.stringify(FUSION_REGISTRY.weights.memory) === JSON.stringify({ fts: 1.0, entity: 0.5, vector: 0.5, relation: 0.5, semantic: 0.5 }));
assert("weights.web exact (equal-weight null model)", JSON.stringify(FUSION_REGISTRY.weights.web) === JSON.stringify({ exa: 1.0, tavily: 1.0, anysearch: 1.0 }));
assert("armAbsentSemantics registered", FUSION_REGISTRY.armAbsentSemantics === "conditional-activation-absent-arm-adds-no-list");
assert("algorithm read-only enum", FUSION_REGISTRY.algorithm.memory === "weighted-rrf" && FUSION_REGISTRY.algorithm.web === "rrf");
assert("provider/arm closed sets", REGISTERED_WEB_PROVIDERS.join(",") === "exa,tavily,anysearch" && REGISTERED_MEMORY_ARMS.join(",") === "fts,entity,vector,relation,semantic");

// Registry drift pair — positive: pin holds; negative: a tampered copy mismatches.
assert("pin hash matches (64-hex)", /^[0-9a-f]{64}$/.test(fusionRegistryHash(FUSION_REGISTRY)) && fusionRegistryHash(FUSION_REGISTRY) === EXPECTED_FUSION_REGISTRY_SHA256);
assert("tampered payload hash differs", fusionRegistryHash({ ...FUSION_REGISTRY, ror_window: 61 }) !== EXPECTED_FUSION_REGISTRY_SHA256);
assert("hash deterministic", fusionRegistryHash(FUSION_REGISTRY) === fusionRegistryHash(FUSION_REGISTRY));

// Deep-frozen: registry mutation attempt must throw (strict ESM) and leave values intact.
let threw = false;
try { (FUSION_REGISTRY as unknown as Record<string, unknown>).ror_window = 61; } catch { threw = true; }
assert("registry frozen (mutation throws, no silent drift)", threw && FUSION_REGISTRY.ror_window === 60);

// Single-consumer liveness (rank_window -> rrf primitive): behavior changes iff k changes.
const probe = rrfScores([["a"]], FUSION_REGISTRY.rank_window);
assert("rank_window consumed by rrf primitive", Math.abs(probe.get("a")! - 1 / (FUSION_REGISTRY.rank_window + 1)) < 1e-9);
assert("k mutation changes fusion behavior (liveness)", Math.abs(rrfScores([["a"]], FUSION_REGISTRY.rank_window + 1).get("a")! - probe.get("a")!) > 1e-9);

// registryWeight: fail-fast on unknown labels; known labels return registered values.
assert("registryWeight memory.entity", registryWeight("memory", "entity") === 0.5);
assert("registryWeight web.tavily", registryWeight("web", "tavily") === 1.0);
threw = false;
try { registryWeight("memory", "nope"); } catch { threw = true; }
assert("registryWeight unknown label fail-fast", threw);

// Provenance-missing pair — assertFusionProvenance accepts the six-field shape, rejects losses.
assertFusionProvenance({ instance: "web", labels: ["exa"], lists: [["u1"]], weights: [1], fusedIds: ["u1"], scoreKind: SCORE_KIND });
passed++; // reaching here = valid snapshot accepted
for (const [label, bad] of [
  ["missing scoreKind", { instance: "web", labels: ["exa"], lists: [["u1"]], weights: [1], fusedIds: ["u1"] }],
  ["wrong scoreKind", { instance: "web", labels: ["exa"], lists: [["u1"]], weights: [1], fusedIds: ["u1"], scoreKind: "confidence" }],
  ["non-parallel lists", { instance: "memory", labels: ["fts", "entity"], lists: [["1"]], weights: [1, 0.5], fusedIds: ["1"], scoreKind: SCORE_KIND }],
  ["bad instance", { instance: "merged", labels: [], lists: [], weights: [], fusedIds: [], scoreKind: SCORE_KIND }],
] as const) {
  let t = false;
  try { assertFusionProvenance(bad); } catch { t = true; }
  assert("provenance pair rejects: " + label, t);
}

console.log(`fusion-registry tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
