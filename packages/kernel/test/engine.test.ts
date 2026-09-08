// Retroaererd Engine test (G009).
// Mock providers: verify fanout, RRF fusion, sufficiency gate, cross-engine verify.
// ponytail: no test framework, assert-based demo.

import { RetroaererdEngine, DEFAULT_GATE, computeSufficiency } from "../src/engine";
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
  // ADR-0022 D3/D4: provenance in metadata, not in answers[]; fail-open marker.
  assert(result6.metadata.providerAnswers?.length === 1, "providerAnswers collected");
  assert(result6.metadata.providerAnswers?.[0].provider === "answer-provider", "providerAnswers attribution");
  assert(result6.metadata.providerAnswers?.[0].text === "42", "providerAnswers text");
  // ADR-0022 D2 round-47 fix: verified=false marker MUST be on the contract item (consumer layer trusts contract).
  assert(result6.metadata.providerAnswers?.[0].verified === false, "providerAnswers verified=false locked");
  assert(result6.metadata.answersAvailable === true, "answersAvailable true when answers present");
  // ADR-0022 D2: answers must NOT inflate sufficiency — sufficiency computed from results only.
  // With a single provider + single result the verdict cannot be promoted by answers.
  assert(result6.metadata.sufficiency?.volume.uniqueResults === 1, "sufficiency ignores answers (uniqueResults=1)");

  // 6b. ADR-0022 D4 (round-47): capability-based answersAvailable — false when no queried provider declares mode:answer.
  // Build a fast-only mock on the spot (mockProvider() declares all modes by default).
  const fastOnly: import("@anysearch/retriever").SearchProvider = {
    id: "fast-only",
    modes: ["fast"],
    async search() {
      return { provider: "fast-only", results: [{ url: "https://x.example", title: "t", snippet: "s", source: "fast-only" }], answers: [], elapsedMs: 5 };
    },
  };
  const engine6b = new RetroaererdEngine([fastOnly]);
  const result6b = await engine6b.search({ query: "q", mode: "answer" });
  assert(result6b.answers.length === 0, "no answers returned when provider lacks mode:answer");
  assert(result6b.metadata.providerAnswers?.length === 0, "providerAnswers empty");
  // Round-47 fix: answersAvailable is a CAPABILITY marker (provider.modes), not output.
  assert(result6b.metadata.answersAvailable === false, "answersAvailable false when no provider advertises answer capability");

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


  // 11. computeSufficiency: correct verdict when all gates pass.
  const results11 = [
    { url: "https://a.com/1", title: "A1", snippet: "S", source: "tavily" },
    { url: "https://b.com/2", title: "B2", snippet: "S", source: "exa" },
    { url: "https://c.com/3", title: "C3", snippet: "S", source: "tavily" },
    { url: "https://d.com/4", title: "D4", snippet: "S", source: "exa" },
    { url: "https://e.com/5", title: "E5", snippet: "S", source: "tavily" },
  ] as any[];
  const providerLists11 = [
    ["https://a.com/1", "https://c.com/3", "https://e.com/5", "https://shared.com/x"],
    ["https://b.com/2", "https://d.com/4", "https://shared.com/x"],
  ];
  const suff11 = computeSufficiency(results11, providerLists11, DEFAULT_GATE);
  assert(suff11.control.sufficiencyPassed === true, "D7: gate passes with 2 providers, 5 results, 5 domains");
  assert(suff11.mvs.verdict === "correct", "D3: verdict correct when all providers have results and gate passes");
  assert(typeof suff11.mvs.agreement.jaccardAtK === "number", "D3: jaccardAtK is number");
  assert(typeof suff11.mvs.agreement.rboAtK === "number", "D3: rboAtK is number");
  assert(suff11.mvs.volume.uniqueResults === 5, "D3: volume.uniqueResults = 5");
  assert(suff11.mvs.volume.uniqueDomains === 5, "D3: volume.uniqueDomains = 5");
  assert(suff11.mvs.volume.successfulProviders === 2, "D3: volume.successfulProviders = 2");
  assert(typeof suff11.mvs.spread.rrfVariance === "number", "D3: spread.rrfVariance is number");

  // 12. computeSufficiency: incorrect verdict when no results.
  const suff12 = computeSufficiency([], [], DEFAULT_GATE);
  assert(suff12.mvs.verdict === "incorrect", "D3: verdict incorrect when no providers have results");
  assert(suff12.control.sufficiencyPassed === false, "D7: gate fails with 0 providers");
  assert(suff12.mvs.volume.successfulProviders === 0, "D3: 0 successful providers");

  // 13. computeSufficiency: ambiguous verdict when partial results.
  const results13 = [
    { url: "https://a.com/1", title: "A1", snippet: "S", source: "tavily" },
  ] as any[];
  const suff13 = computeSufficiency(results13, [["https://a.com/1"]], DEFAULT_GATE);
  assert(suff13.mvs.verdict === "ambiguous", "D3: verdict ambiguous when 1 provider, 1 result (below gate)");
  assert(suff13.control.sufficiencyPassed === false, "D7: gate fails with 1 provider");

  // 14. computeSufficiency: MVSS agreement signals computed correctly.
  const providerLists14 = [
    ["url1", "url2", "url3"],
    ["url1", "url2", "url4"],
  ];
  const suff14 = computeSufficiency(
    [{ url: "url1", title: "T", snippet: "S", source: "p1" }] as any[],
    providerLists14,
    { minProviders: 1, minResults: 1, minDomains: 1, crossEngineVerify: false }
  );
  assert(suff14.mvs.agreement.jaccardAtK > 0, "D3: jaccardAtK > 0 when providers share URLs");
  assert(suff14.mvs.agreement.rboAtK > 0, "D3: rboAtK > 0 when providers share URLs");

  // 15. computeSufficiency: perProvider scores attached when provided.
  const suff15 = computeSufficiency(
    [{ url: "url1", title: "T", snippet: "S", source: "p1" }] as any[],
    [["url1"]],
    { minProviders: 1, minResults: 1, minDomains: 1, crossEngineVerify: false },
    [],
    { tavily: [0.9, 0.8], exa: [0.7] }
  );
  assert(suff15.mvs.perProvider !== undefined, "D3: perProvider attached when scores provided");
  assert(suff15.mvs.perProvider!.tavily.length === 2, "D3: perProvider.tavily has 2 scores");
  assert(suff15.mvs.spread.scoreScale !== undefined, "D3: scoreScale present when scores provided");
  assert(suff15.mvs.spread.scoreScale!.min === 0.7, "D3: scoreScale.min = 0.7");
  assert(suff15.mvs.spread.scoreScale!.max === 0.9, "D3: scoreScale.max = 0.9");

  // 16. engine.search() returns metadata.sufficiency (D3/D7 integration).
  const engine16 = new RetroaererdEngine([
    mockProvider("tavily", ["https://a.com/1", "https://b.com/2", "https://c.com/3"]),
    mockProvider("exa", ["https://a.com/1", "https://d.com/4", "https://e.com/5"]),
  ]);
  const result16 = await engine16.search({ query: "test", mode: "fast" });
  assert(result16.metadata.sufficiency !== undefined, "D3/D7: metadata.sufficiency is populated");
  assert(result16.metadata.sufficiency!.verdict === "correct", "D3: verdict correct with 5 results, 5 domains, 2 providers");
  assert(result16.metadata.sufficiency!.volume.successfulProviders === 2, "D3: 2 successful providers in metadata");

  // 17. ADR-0051 D1/D2: injected calibration flows into claim classification.
  const answerProvider: SearchProvider = {
    id: "ans",
    modes: ["answer"],
    async search(): Promise<ProviderEnvelope> {
      return {
        provider: "ans",
        results: [{ url: "https://ex.com/a", title: "T", snippet: "Exercise is good for health.", source: "ans" }],
        answers: ["Exercise is good for health."],
        elapsedMs: 5,
      };
    },
  };
  // Legacy floor: fused = 0.35 + 0.15 = 0.5 < 0.6 -> uncertain.
  const plain = await new RetroaererdEngine([answerProvider]).search({ query: "health", mode: "answer" });
  assert(plain.attribution?.claims[0]?.label === "uncertain", "legacy floor yields uncertain", );
  // Calibrated: identity beta, supported threshold 0.4; measured fused ~0.44 -> supported.
  const calibrated = await new RetroaererdEngine([answerProvider], {
    attributionCalibration: { params: { a: 1, b: 1, c: 0 }, thresholds: { supported: 0.4, unsupported: 0.2, degraded: false } },
  }).search({ query: "health", mode: "answer" });
  assert(calibrated.attribution?.claims[0]?.label === "supported", "active calibration yields supported");
  // Degraded calibration keeps the legacy floor.
  const degraded = await new RetroaererdEngine([answerProvider], {
    attributionCalibration: { params: { a: 1, b: 1, c: 0 }, thresholds: { supported: 0.6, unsupported: 0.6, degraded: true } },
  }).search({ query: "health", mode: "answer" });
  assert(degraded.attribution?.claims[0]?.label === "uncertain", "degraded calibration falls back to legacy floor");

  console.log("--- RetroaererdEngine tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
