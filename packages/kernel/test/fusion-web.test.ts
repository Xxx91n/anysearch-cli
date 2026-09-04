// ADR-0045 D2/D3 (r118 impl): WebFusion provenance snapshot + weight consumption mutation pair.
import { RetroaererdEngine } from "../src/engine";
import { rrfRank, FUSION_REGISTRY, SCORE_KIND, assertFusionProvenance } from "@anysearch/retriever";
import type { SearchProvider, ProviderEnvelope, NormalizedResult } from "@anysearch/retriever";

let passed = 0;
let failed = 0;
function assert(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error("FAIL: " + label); }
}

function mockProvider(id: string, urls: string[], score?: number): SearchProvider {
  return {
    id,
    modes: ["fast"],
    async search(): Promise<ProviderEnvelope> {
      const results: NormalizedResult[] = urls.map((url, i) => ({
        url, title: id + " " + i, snippet: "s" + i, source: id,
        ...(score !== undefined ? { extra: { score } } : {}),
      }));
      return { provider: id, results, answers: [], elapsedMs: 1 };
    },
  };
}

async function main() {
  // 1. Provenance snapshot: six-field common shape + nativeScores extension.
  const engine = new RetroaererdEngine([
    mockProvider("tavily", ["https://t.dev/a", "https://t.dev/b"], 0.9),
    mockProvider("exa", ["https://e.dev/c"], 0.4),
  ]);
  const env = await engine.search({ query: "q", mode: "fast" });
  const fusion = env.metadata.fusion;
  assert("fusion snapshot present", !!fusion);
  if (fusion) {
    // validator accepted the runtime snapshot (positive member of the provenance pair)
    let ok = true;
    try { assertFusionProvenance(fusion); } catch { ok = false; }
    assert("snapshot passes assertFusionProvenance", ok);
    assert("instance web + scoreKind", fusion.instance === "web" && fusion.scoreKind === SCORE_KIND);
    assert("labels = contributing providers", JSON.stringify(fusion.labels) === JSON.stringify(["tavily", "exa"]));
    assert("lists parallel + pre-truncation urls", fusion.lists[0]!.length === 2 && fusion.lists[1]!.length === 1);
    assert("equal-weight null model from registry", fusion.weights.every((w) => w === 1));
    assert("native scores snapshotted, not fused", fusion.nativeScores.tavily?.["t.dev/a"] === 0.9 && fusion.nativeScores.exa?.["e.dev/c"] === 0.4);
    // fusedIds equal an independent registry-driven recomputation
    const ref = rrfRank(fusion.lists, FUSION_REGISTRY.k_fusion.web, fusion.weights);
    assert("fusedIds == recomputation", JSON.stringify(fusion.fusedIds) === JSON.stringify(ref));
  }

  // 2. Weight overlay mutation pair: equal weights tie (insertion order), boost flips order.
  const mk = (w?: Record<string, number>) => new RetroaererdEngine([
    mockProvider("p1", ["https://one.dev/x"]),
    mockProvider("p2", ["https://two.dev/y"]),
  ], w ? { sourceWeights: w } : undefined);
  const base = await mk().search({ query: "q", mode: "fast" });
  assert("equal weights default", base.results[0]!.url.includes("one.dev")); // stable tie order
  const boosted = await mk({ p2: 5 }).search({ query: "q", mode: "fast" });
  assert("weight overlay flips order (weight is consumed)", boosted.results[0]!.url.includes("two.dev"));
  assert("same fused k consumed in both runs",
    base.metadata.fusion!.weights[0] === 1 && boosted.metadata.fusion!.weights[1] === 5);

  // 3. Failed provider: fail-open runtime semantics — list excluded, provenance stays consistent.
  const partial = await new RetroaererdEngine([
    mockProvider("tavily", ["https://t.dev/a"]),
    { id: "exa", modes: ["fast"], async search(): Promise<ProviderEnvelope> { throw new Error("boom"); } },
  ]).search({ query: "q", mode: "fast" });
  assert("failed provider fail-open", partial.metadata.providersFailed.includes("exa") && partial.results.length === 1);
  assert("provenance excludes failed provider", partial.metadata.fusion!.labels.join(",") === "tavily");

  console.log(`fusion-web tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
