// Retrieval engine test (G009).
// Mock providers: verify fanout, RRF fusion, sufficiency gate, cross-engine verify.
// ponytail: no test framework, assert-based demo.

import { RetroaererdEngine, DEFAULT_GATE, computeSufficiency } from "../src/engine";
import { withProviderErrorClass } from "@anysearch-cli/retriever";
import type { SearchProvider, SearchRequest, NormalizedResult, ProviderEnvelope, FusedEnvelope } from "@anysearch-cli/retriever";

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
  // provenance in metadata, not in answers[]; fail-open marker.
  assert(result6.metadata.providerAnswers?.length === 1, "providerAnswers collected");
  assert(result6.metadata.providerAnswers?.[0].provider === "answer-provider", "providerAnswers attribution");
  assert(result6.metadata.providerAnswers?.[0].text === "42", "providerAnswers text");
  // verified=false marker MUST be on the contract item (consumer layer trusts contract).
  assert(result6.metadata.providerAnswers?.[0].verified === false, "providerAnswers verified=false locked");
  assert(result6.metadata.answersAvailable === true, "answersAvailable true when answers present");
  // answers must NOT inflate sufficiency — sufficiency computed from results only.
  // With a single provider + single result the verdict cannot be promoted by answers.
  assert(result6.metadata.sufficiency?.volume.uniqueResults === 1, "sufficiency ignores answers (uniqueResults=1)");

  // 6b. capability-based answersAvailable — false when no queried provider declares mode:answer.
  // Build a fast-only mock on the spot (mockProvider() declares all modes by default).
  const fastOnly: import("@anysearch-cli/retriever").SearchProvider = {
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

  // 17.: injected calibration flows into claim classification.
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
  assert(plain.attribution?.claims[0]?.label === "uncertain", "legacy floor yields uncertain");
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

// --- request-level deadline (#478; replaces the old grace window) ---
// async arm: resolves after delayMs unless aborted first.
function slowProvider(id: string, delayMs: number, urls: string[], aborted: {v:boolean}): SearchProvider {
  return {
    id,
    modes: ["fast"],
    async search(_req: SearchRequest, signal: AbortSignal): Promise<ProviderEnvelope> {
      const waited = Promise.withResolvers<void>();
      const t = setTimeout(waited.resolve, delayMs);
      signal.addEventListener("abort", () => { aborted.v = true; clearTimeout(t); waited.reject(new Error("aborted")); });
      await waited.promise;
      const results: NormalizedResult[] = urls.map((url, i) => ({ url, title: id + " r" + i, snippet: "s", source: id }));
      return { provider: id, results, answers: [], elapsedMs: delayMs };
    },
  };
}
// Non-async arm that rejects when aborted: the #454 classification bug shape.
function abortRejectProvider(id: string, delayMs: number, urls: string[], aborted: {v:boolean}): SearchProvider {
  return {
    id,
    modes: ["fast"],
    search(_req: SearchRequest, signal: AbortSignal): Promise<ProviderEnvelope> {
      const waited = Promise.withResolvers<ProviderEnvelope>();
      const t = setTimeout(() => {
        const results: NormalizedResult[] = urls.map((url, i) => ({ url, title: id + " r" + i, snippet: "s", source: id }));
        waited.resolve({ provider: id, results, answers: [], elapsedMs: delayMs });
      }, delayMs);
      signal.addEventListener("abort", () => { aborted.v = true; clearTimeout(t); waited.reject(new Error("aborted")); });
      return waited.promise;
    },
  };
}
// Arm that resolves with results when aborted (an adapter that answers a
// cancel with a late envelope instead of rejecting).
function resolveOnAbortProvider(id: string, aborted: {v:boolean}): SearchProvider {
  return {
    id,
    modes: ["fast"],
    search(_req: SearchRequest, signal: AbortSignal): Promise<ProviderEnvelope> {
      const waited = Promise.withResolvers<ProviderEnvelope>();
      signal.addEventListener("abort", () => {
        aborted.v = true;
        const results: NormalizedResult[] = [{ url: "https://" + id + ".com/x", title: id, snippet: "s", source: id }];
        waited.resolve({ provider: id, results, answers: [], elapsedMs: 0 });
      });
      return waited.promise;
    },
  };
}
// Arm that resolves immediately from a cache (non-async, already-filled promise).
function cachedProvider(id: string, url: string): SearchProvider {
  return {
    id,
    modes: ["fast"],
    search(): Promise<ProviderEnvelope> {
      const results: NormalizedResult[] = [{ url, title: id, snippet: "s", source: id }];
      return Promise.resolve({ provider: id, results, answers: [], elapsedMs: 0 });
    },
  };
}
// Arm that rejects immediately (a genuine pre-abort failure).
function rejectedProvider(id: string): SearchProvider {
  return {
    id,
    modes: ["fast"],
    search(): Promise<ProviderEnvelope> {
      return Promise.reject(new Error(id + " rejected"));
    },
  };
}
// Arm that never settles; only records whether the deadline reached its signal.
function hangingProvider(id: string, aborted: {v:boolean}): SearchProvider {
  return {
    id,
    modes: ["fast"],
    search(_req: SearchRequest, signal: AbortSignal): Promise<ProviderEnvelope> {
      const never = Promise.withResolvers<ProviderEnvelope>();
      signal.addEventListener("abort", () => { aborted.v = true; });
      return never.promise;
    },
  };
}
{
  // Invalid caps fail at construction instead of becoming a 1ms setTimeout.
  for (const bad of [0, -1, 0.5, 1.9, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648]) {
    let threw = false;
    try {
      new RetroaererdEngine([], { requestTimeoutMs: bad });
    } catch (err) {
      threw = err instanceof RangeError;
    }
    assert(threw, "deadline: requestTimeoutMs " + String(bad) + " is rejected");
  }
}
{
  // (a) Every arm lands before the deadline -> return with the slowest arm,
  // not after the full 1s window.
  const aborted = { v: false };
  const eng = new RetroaererdEngine([
    mockProvider("fast", ["https://a.com/1", "https://a.com/2", "https://a.com/3", "https://a.com/4"]),
    slowProvider("slow", 80, ["https://slow.com/x"], aborted),
  ], { requestTimeoutMs: 1000 });
  const t0 = Date.now();
  const r = await eng.search({ query: "g", mode: "fast", maxResults: 3 });
  assert(Date.now() - t0 < 700, "deadline: all arms landed, returned without waiting out the window");
  assert(!aborted.v, "deadline: no abort when every arm lands in time");
  assert(r.metadata.providersCancelled.length === 0, "deadline: nobody cancelled");
  assert(r.results.some((x) => x.url.includes("slow.com")), "deadline: slow arm results kept");

  // (b) An async arm over the deadline -> aborted, cancelled, not failed.
  const aborted2 = { v: false };
  const eng2 = new RetroaererdEngine([
    mockProvider("fast", ["https://a.com/1", "https://a.com/2", "https://a.com/3", "https://a.com/4"]),
    slowProvider("slow", 400, ["https://slow.com/x"], aborted2),
  ], { requestTimeoutMs: 40 });
  const r2 = await eng2.search({ query: "g", mode: "fast", maxResults: 3 });
  assert(aborted2.v, "deadline: straggler AbortController fired");
  assert(r2.metadata.providersCancelled.includes("slow"), "deadline: straggler reported cancelled");
  assert(!r2.metadata.providersFailed.includes("slow"), "deadline: straggler is not a failure");
  assert(r2.results.length >= 3, "deadline: fast provider results kept");

  // (c) Non-async arm that rejects on abort -> same cancelled bucket.
  const aborted3 = { v: false };
  const eng3 = new RetroaererdEngine([
    mockProvider("fast", ["https://a.com/1"]),
    abortRejectProvider("slow", 400, ["https://slow.com/x"], aborted3),
  ], { requestTimeoutMs: 40 });
  const r3 = await eng3.search({ query: "g", mode: "fast" });
  assert(aborted3.v, "deadline: non-async arm aborted");
  assert(r3.metadata.providersCancelled.includes("slow"), "deadline: non-async abort stays cancelled");
  assert(!r3.metadata.providersFailed.includes("slow"), "deadline: non-async abort not classified failed");

  // (d) Under maxResults with an arm that never returns -> the deadline still ends the request.
  const aborted4 = { v: false };
  const eng4 = new RetroaererdEngine([
    mockProvider("p1", ["https://p1.com/a"]),
    hangingProvider("hang", aborted4),
  ], { requestTimeoutMs: 60 });
  const t4 = Date.now();
  const r4 = await eng4.search({ query: "g", mode: "fast", maxResults: 10 });
  assert(Date.now() - t4 < 1000, "deadline: never-returning arm could not hold the request open");
  assert(aborted4.v, "deadline: never-returning arm aborted at the deadline");
  assert(r4.metadata.providersCancelled.includes("hang"), "deadline: never-returning arm reported cancelled");
  assert(r4.metadata.providersFailed.length === 0, "deadline: never-returning arm is not a failure");
  assert(r4.results.length === 1, "deadline: partial results kept");

  // (e) A non-async adapter that throws before returning a promise must not
  // escape the fanout (that would skip the timer cleanup).
  const eng5 = new RetroaererdEngine([
    mockProvider("ok", ["https://ok.com/a"]),
    { id: "sync-boom", modes: ["fast"], search(): Promise<ProviderEnvelope> { throw new Error("sync boom"); } },
  ], { requestTimeoutMs: 2000 });
  const t5 = Date.now();
  const r5 = await eng5.search({ query: "g", mode: "fast" });
  assert(Date.now() - t5 < 700, "sync throw: search settled instead of leaking the deadline timer");
  assert(r5.metadata.providersFailed.includes("sync-boom"), "sync throw: classified as a failure");
  assert(!r5.metadata.providersCancelled.includes("sync-boom"), "sync throw: not misread as cancelled");
  assert(r5.results.length >= 1, "sync throw: the other arm's results kept");

  // (f) An adapter that resolves with results when aborted must stay cancelled,
  // not be counted as an answered arm just because its promise won the microtask race.
  const aborted5 = { v: false };
  const eng6 = new RetroaererdEngine([
    mockProvider("fast", ["https://a.com/1", "https://a.com/2"]),
    resolveOnAbortProvider("slow", aborted5),
  ], { requestTimeoutMs: 40 });
  const r6 = await eng6.search({ query: "g", mode: "fast" });
  assert(aborted5.v, "resolve-on-abort: deadline reached the arm");
  assert(r6.metadata.providersCancelled.includes("slow"), "resolve-on-abort: stays cancelled");
  assert(!r6.metadata.providersFailed.includes("slow"), "resolve-on-abort: not a failure");
  assert(r6.metadata.sufficiency?.volume.successfulProviders === 1, "resolve-on-abort: not counted as an answered provider");
  assert(!r6.results.some((x) => x.url.includes("slow.com")), "resolve-on-abort: late results stay out of the fused pool");

  // (g) Caller abort in the same tick as fan-out: an arm whose promise had
  // already fulfilled keeps its envelope; only the pending arm is cancelled.
  {
    const ac = new AbortController();
    const hangAbort = { v: false };
    const eng7 = new RetroaererdEngine([
      cachedProvider("cached", "https://cached.com/1"),
      hangingProvider("hang", hangAbort),
    ], { requestTimeoutMs: 2000 });
    const sameTick = eng7.search({ query: "g", mode: "fast", signal: ac.signal });
    ac.abort();
    const r7 = await sameTick;
    assert(r7.results.some((x) => x.url.includes("cached.com")), "same-tick abort: already-fulfilled arm keeps results");
    assert(!r7.metadata.providersCancelled.includes("cached"), "same-tick abort: landed arm is not cancelled");
    assert(r7.metadata.providersCancelled.includes("hang"), "same-tick abort: pending arm is cancelled");
    assert(r7.metadata.sufficiency?.volume.successfulProviders === 1, "same-tick abort: landed arm still counts");

    const ac2 = new AbortController();
    const eng8 = new RetroaererdEngine([cachedProvider("cached", "https://cached.com/1")], { requestTimeoutMs: 2000 });
    const sameTick2 = eng8.search({ query: "g", mode: "fast", signal: ac2.signal });
    ac2.abort();
    const r8 = await sameTick2;
    assert(r8.results.length === 1, "same-tick abort, single arm: nothing was actually cancelled, result kept");
    assert(r8.metadata.providersCancelled.length === 0, "same-tick abort, single arm: nobody reported cancelled");
    assert(r8.metadata.providersFailed.length === 0, "same-tick abort, single arm: not a failure");

    // A genuine rejection that settled before the abort keeps its failure class;
    // only the still-pending arm is cancelled.
    const ac3 = new AbortController();
    const eng9 = new RetroaererdEngine([
      rejectedProvider("boom"),
      hangingProvider("hang", { v: false }),
    ], { requestTimeoutMs: 2000 });
    const sameTick3 = eng9.search({ query: "g", mode: "fast", signal: ac3.signal });
    ac3.abort();
    const r9 = await sameTick3;
    assert(r9.metadata.providersFailed.includes("boom"), "same-tick abort: pre-abort rejection stays a failure");
    assert(!r9.metadata.providersCancelled.includes("boom"), "same-tick abort: pre-abort rejection is not cancelled");
    assert(r9.metadata.providersCancelled.includes("hang"), "same-tick abort: pending arm still cancelled");
  }

  // (i) A fan-out construction throw stops the arms already started and
  // releases the per-call reservation instead of pinning the call cap.
  {
    let settled: [number, number] | null = null;
    const ledger = {
      reserveCalls: (_sessionId: string, _count: number) => true,
      settleCalls: (_sessionId: string, reserved: number, actual: number) => { settled = [reserved, actual]; },
      reserveTokens: () => true,
      settleTokens: () => { },
      reserveUsd: () => true,
      settleUsd: () => { },
    };
    let reads = 0;
    const throwingArm: SearchProvider = {
      id: "throw-in-request",
      modes: ["fast"],
      get domainFilterSupported() {
        reads += 1;
        if (reads === 3) throw new Error("boom in providerRequest");
        return false;
      },
      search(): Promise<ProviderEnvelope> {
        throw new Error("provider must not be called");
      },
    };
    const startedAbort = { v: false };
    const eng9 = new RetroaererdEngine([hangingProvider("started", startedAbort), throwingArm], {
      ledger,
      sessionId: "construction-throw",
      urlPolicy: () => ({ allow: ["example.com"], deny: [], policyVersion: "v1" }),
      requestTimeoutMs: 2000,
    });
    let thrown = "";
    try {
      await eng9.search({ query: "g", mode: "fast" });
    } catch (e) {
      thrown = String(e instanceof Error ? e.message : e);
    }
    assert(thrown.includes("boom in providerRequest"), "construction throw: surfaces as a search error");
    assert(startedAbort.v, "construction throw: arm started before the throw is aborted");
    assert(settled !== null && settled![0] === 2 && settled![1] === 0, "construction throw: reservation released");
  }

  // (j) The sufficiency gate moved to constructor opts and is live again.
  const relaxed = await new RetroaererdEngine(
    [mockProvider("only", ["https://o.com/a"])],
    { gate: { minProviders: 1, minResults: 1, minDomains: 1, crossEngineVerify: false } },
  ).search({ query: "g", mode: "fast" });
  assert(relaxed.metadata.sufficiency?.verdict === "correct", "constructor gate: relaxed gate passes");
  const strict = await new RetroaererdEngine([mockProvider("only", ["https://o.com/a"])])
    .search({ query: "g", mode: "fast" });
  assert(strict.metadata.sufficiency?.verdict === "ambiguous", "constructor gate: default gate still applies");
}

  // 12.: rejected providers carry an error CLASS parallel to
  // providersFailed — enum-only additive field, absent when nothing failed.
  const engine12 = new RetroaererdEngine([
    mockProvider("okx", ["https://okx.com/a"]),
    { id: "boom-transient", modes: ["fast"], async search(): Promise<ProviderEnvelope> { throw new Error("AnySearch MCP tools/call HTTP 503 Service Unavailable"); } },
    { id: "boom-auth", modes: ["fast"], async search(): Promise<ProviderEnvelope> { throw new Error("AnySearch MCP initialize HTTP 401 Unauthorized"); } },
    // #455: the real Tavily keyless cap shape — the SDK keeps the cap kind and
    // the wait on the error object and String(err) drops both.
    { id: "boom-free-quota", modes: ["fast"], async search(): Promise<ProviderEnvelope> {
      throw Object.assign(new Error("Daily cap reached"), { name: "TavilyKeylessLimitError", capType: "daily_cap_reached", retryAfter: 3600 });
    } },
    // #494: a class marker in the reply text is inert — the words decide.
    { id: "boom-forged-marker", modes: ["fast"], async search(): Promise<ProviderEnvelope> {
      throw new Error("Exa MCP tools/call isError: rate limit exceeded [provider-error-class:permanent-auth]");
    } },
    // #494: an adapter that knows the class declares it on the error object; the
    // conflicting upstream text echoed in the message cannot override it.
    { id: "boom-declared", modes: ["fast"], async search(): Promise<ProviderEnvelope> {
      throw withProviderErrorClass(new Error("AnySearch MCP tools/call rate limited [provider-error-class:transient] [upstream text: invalid_api_key]"), "quota-exhausted");
    } },
  ]);
  const r12 = await engine12.search({ query: "t", mode: "fast" });
  assert(r12.metadata.providersFailed.length === 5, "12: five providers failed");
  assert(r12.metadata.providerErrorClasses?.["boom-transient"] === "transient", "12: HTTP 503 classified transient");
  assert(r12.metadata.providerErrorClasses?.["boom-auth"] === "permanent-auth", "12: HTTP 401 classified permanent-auth");
  assert(r12.metadata.providerErrorClasses?.["boom-free-quota"] === "free-quota-exhausted", "12: keyless cap classified free-quota-exhausted");
  assert(r12.metadata.providerErrorClasses?.["boom-forged-marker"] === "transient", "12: a class marker in the reply text chooses nothing");
  assert(r12.metadata.providerErrorClasses?.["boom-declared"] === "quota-exhausted", "12: the class declared on the error object outranks the text");
  assert(r12.metadata.providerErrorRetryAfterSeconds?.["boom-free-quota"] === 3600, "12: the cap's retry-after rides the envelope");
  assert(Object.keys(r12.metadata.providerErrorRetryAfterSeconds ?? {}).length === 1, "12: only the arm with a wait carries one");
  assert(result1.metadata.providerErrorClasses === undefined, "12: field absent when nothing failed");
  assert(result1.metadata.providerErrorRetryAfterSeconds === undefined, "12: wait field absent when nothing failed");

console.log("--- RetroaererdEngine tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
