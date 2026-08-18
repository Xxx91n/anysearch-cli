// Retroaererd Engine test (G009).
// Mock providers: verify fanout, RRF fusion, sufficiency gate, cross-engine verify.
// ponytail: no test framework, assert-based demo.

import { RetroaererdEngine, DEFAULT_GATE } from "../src/engine";
import type { SearchProvider, SearchRequest, NormalizedResult, ProviderEnvelope, FusedEnvelope } from "@anysearch/retriever";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

// Mock provider helper: returns controlled results with given URLs.
function mockProvider(id: string, urls: string[]): SearchProvider {
  return {
    id,
    modes: ["fast", "index", "deep", "answer"],
    async search(req: SearchRequest, signal: AbortSignal): Promise<ProviderEnvelope> {
      const results: NormalizedResult[] = urls.map((url, i) => ({
        url,
        title: id + " result " + i,
        snippet: "snippet " + i,
        source: id,
      }));
      return { provider: id, results, answers: [], elapsedMs: 10 };
    },
  };
}

// Mock provider that fails.
function mockFailingProvider(id: string): SearchProvider {
  return {
    id,
    modes: ["fast"],
    async search(): Promise<ProviderEnvelope> {
      throw new Error(id + " failed");
    },
  };
}

async function main() {
  // 1. Basic fanout + RRF fusion (2 providers, overlapping URLs).
  const engine1 = new RetroaererdEngine([
    mockProvider("tavily", ["https://example.com/a", "https://example.com/b", "https://example.com/c"]),
    mockProvider("exa", ["https://example.com/b", "https://example.com/d", "https://example.com/e"]),
  ]);
  const result1 = await engine1.search({ query: "test", mode: "fast" });

  assert(result1.results.length > 0, "fanout returns results");
  assert(result1.metadata.providersQueried.length === 2, "2 providers queried");
  assert(result1.metadata.providersFailed.length === 0, "0 providers failed");
  // b appears in both providers -> should rank first (RRF consensus).
  assert(result1.results[0].url.includes("example.com/b"), "consensus URL b ranks first");

  // 2. Three providers (all overlap on one URL).
  const engine2 = new RetroaererdEngine([
    mockProvider("p1", ["https://shared.com/x", "https://p1.com/1"]),
    mockProvider("p2", ["https://shared.com/x", "https://p2.com/2"]),
    mockProvider("p3", ["https://shared.com/x", "https://p3.com/3"]),
  ]);
  const result2 = await engine2.search({ query: "test", mode: "index" });
  assert(result2.metadata.providersQueried.length === 3, "3 providers queried");
  assert(result2.results[0].url.includes("shared.com/x"), "3-way consensus URL ranks first");

  // 3. Provider failure handling (1 fails, 2 succeed).
  const engine3 = new RetroaererdEngine([
    mockProvider("ok1", ["https://ok1.com/a", "https://ok1.com/b"]),
    mockProvider("ok2", ["https://ok2.com/c", "https://ok2.com/d"]),
    mockFailingProvider("fail1"),
  ]);
  const result3 = await engine3.search({ query: "test", mode: "fast" });
  assert(result3.metadata.providersQueried.length === 3, "3 providers queried");
  assert(result3.metadata.providersFailed.length === 1, "1 provider failed");
  assert(result3.metadata.providersFailed[0] === "fail1", "correct provider failed");
  assert(result3.results.length > 0, "results present despite 1 failure");

  // 4. No providers registered -> error.
  const engine4 = new RetroaererdEngine();
  let threw = false;
  try { await engine4.search({ query: "test", mode: "fast" }); } catch { threw = true; }
  assert(threw, "throws when no providers registered");

  // 5. All providers fail -> empty results, all failed.
  const engine5 = new RetroaererdEngine([
    mockFailingProvider("f1"),
    mockFailingProvider("f2"),
  ]);
  const result5 = await engine5.search({ query: "test", mode: "fast" });
  assert(result5.results.length === 0, "empty results when all fail");
  assert(result5.metadata.providersFailed.length === 2, "2 providers failed");

  // 6. ANSWER mode collects answers from providers.
  const engine6 = new RetroaererdEngine([{
    id: "answer-provider",
    modes: ["answer"],
    async search(): Promise<ProviderEnvelope> {
      return { provider: "answer-provider", results: [{ url: "https://ans.com", title: "A", snippet: "S", source: "answer-provider" }], answers: ["42"], elapsedMs: 5 };
    },
  }]);
  const result6 = await engine6.search({ query: "meaning of life", mode: "answer" });
  assert(result6.answers.length === 1, "answer collected");
  assert(result6.answers[0] === "42", "answer content correct");

  // 7. DEFAULT_GATE values.
  assert(DEFAULT_GATE.minProviders === 2, "default gate minProviders = 2");
  assert(DEFAULT_GATE.minResults === 5, "default gate minResults = 5");
  assert(DEFAULT_GATE.minDomains === 3, "default gate minDomains = 3");
  assert(DEFAULT_GATE.crossEngineVerify === true, "default gate crossEngineVerify = true");

  // 8. URL normalization (tracking params stripped).
  const engine8 = new RetroaererdEngine([
    mockProvider("p1", ["https://example.com/page?utm_source=taboola&id=1"]),
    mockProvider("p2", ["https://example.com/page?id=1"]),
  ]);
  const result8 = await engine8.search({ query: "test", mode: "fast" });
  // utm_source stripped, both URLs normalize same -> 1 unique result (RRF consensus).
  assert(result8.results.length === 1, "URL normalization strips utm_source, dedup to 1");

  // 9. Query.providers filtering — only call specified providers.
  const engine9 = new RetroaererdEngine([
    mockProvider("alpha", ["https://alpha.com/1", "https://alpha.com/2"]),
    mockProvider("beta", ["https://beta.com/1", "https://beta.com/2"]),
    mockProvider("gamma", ["https://gamma.com/1", "https://gamma.com/2"]),
  ]);
  const result9 = await engine9.search({ query: "test", mode: "fast", providers: ["alpha", "gamma"] });
  assert(result9.metadata.providersQueried.length === 2, "Query.providers filters to 2");
  assert(result9.metadata.providersQueried.includes("alpha"), "alpha queried");
  assert(result9.metadata.providersQueried.includes("gamma"), "gamma queried");
  assert(!result9.metadata.providersQueried.includes("beta"), "beta NOT queried");

  // 10. RetroaererdEngine satisfies RetrieverPort (interface check).
  const port: import("../src/ports").RetrieverPort = engine1;
  assert(typeof port.search === "function", "engine satisfies RetrieverPort");

  console.log("--- RetroaererdEngine tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
