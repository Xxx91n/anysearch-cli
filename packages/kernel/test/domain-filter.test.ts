// kernel post-filter authoritative gate + dual audit events
// + first-class abstain marker + outcome:abstain dimension.
// Test setup: RetroaererdEngine.search() with stub providers, injected per-request
// urlPolicy resolver, and a fake observation sink capturing span events.
// ponytail: no test framework, assert-based demo.

import { RetroaererdEngine } from "../src/engine";
import type { SearchProvider, SearchRequest, NormalizedResult, ProviderEnvelope } from "@anysearch-cli/retriever";
import type { RetrievalObservationSink } from "../src/ports";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

function mockProvider(id: string, urls: string[], capable: boolean): SearchProvider {
  const p: SearchProvider = {
    id,
    modes: ["fast"],
    async search(req: SearchRequest): Promise<ProviderEnvelope> {
      (p as any).lastReq = req;
      const results: NormalizedResult[] = urls.map((url, i) => ({
        url, title: id + " r" + i, snippet: "s" + i, source: id,
      }));
      return { provider: id, results, answers: [], elapsedMs: 5 };
    },
  };
  if (capable) (p as any).domainFilterSupported = true;
  return p;
}

function fakeSink() {
  const events: Array<{ name: string; attributes: any }> = [];
  const attrs: Record<string, unknown> = {};
  const sink: RetrievalObservationSink = {
    addEvent: (name, attributes) => { events.push({ name, attributes }); },
    setAttributes: (a) => { Object.assign(attrs, a); },
  };
  return { sink, events, attrs };
}

const policy = { allow: ["a.com", "b.com"], deny: ["bad.a.com"], policyVersion: "pv1" };
const resolvePolicy = () => policy;

async function main() {
  // 1. Out-of-domain results are dropped by the authoritative post-gate.
  const cap = mockProvider("cap", ["https://a.com/1", "https://evil.com/x", "https://b.com/2"], true);
  const eng = new RetroaererdEngine([cap], { urlPolicy: resolvePolicy, domainName: "docs" });
  const s1 = fakeSink();
  const r1 = await eng.search({ query: "q", mode: "fast", span: s1.sink });
  assert(r1.results.every((r) => /a\.com|b\.com/.test(r.url)), "post-gate: only in-domain results survive");
  assert(r1.results.length === 2, "post-gate kept 2 in-domain results (got " + r1.results.length + ")");
  assert(r1.metadata.abstain === undefined, "no abstain marker when results survive");

  // 2. Deny wins: bad.a.com matches the allow suffix rule but deny overrides.
  const cap2 = mockProvider("cap", ["https://bad.a.com/x", "https://a.com/ok"], true);
  const eng2 = new RetroaererdEngine([cap2], { urlPolicy: resolvePolicy, domainName: "docs" });
  const r2 = await eng2.search({ query: "q", mode: "fast" });
  assert(r2.results.length === 1 && r2.results[0].url.includes("a.com/ok"), "deny wins over allow-suffix match");

  // 3. All results out-of-domain -> first-class abstain marker on the envelope.
  const cap3 = mockProvider("cap", ["https://evil.com/1", "https://tokio.rs/2"], true);
  const eng3 = new RetroaererdEngine([cap3], { urlPolicy: resolvePolicy, domainName: "docs" });
  const s3 = fakeSink();
  const r3 = await eng3.search({ query: "q", mode: "fast", span: s3.sink });
  assert(r3.results.length === 0, "abstain: zero results survive");
  const ab = r3.metadata.abstain;
  assert(ab?.abstain === true, "metadata.abstain.abstain === true");
  assert(ab?.reason === "domain_filter_empty", "abstain reason = domain_filter_empty");
  assert(ab?.domain === "docs", "abstain carries domain name");
  assert(ab?.preFiltered === 2, "preFiltered = results that reached the gate (got " + ab?.preFiltered + ")");
  assert(ab?.postFiltered === 0, "postFiltered = survivors (got " + ab?.postFiltered + ")");
  assert(ab?.gate === "post", "gate=post when post-gate dropped all arrivals (got " + ab?.gate + ")");

  // 4. Dual audit events on the caller span: pre (send-down negotiation) + post (gate counts).
  const pre = s3.events.find((e) => e.name === "retrieval.domain_filter.pre");
  const post = s3.events.find((e) => e.name === "retrieval.domain_filter.post");
  assert(!!pre, "pre event emitted");
  assert(!!post, "post event emitted");
  assert(pre?.attributes?.["anysearch.policy_version"] === "pv1", "pre event carries policy_version");
  const sent = pre?.attributes?.["anysearch.domain_filter.sent"] as string[] | undefined;
  assert(Array.isArray(sent) && sent.includes("cap"), "pre event lists providers that got includeDomains");
  assert(post?.attributes?.["anysearch.domain_filter.pre"] === 2, "post event: pre count = 2");
  assert(post?.attributes?.["anysearch.domain_filter.post"] === 0, "post event: post count = 0");
  assert(post?.attributes?.["anysearch.outcome"] === "abstain", "post event: outcome=abstain dimension");
  assert(s3.attrs["anysearch.outcome"] === "abstain", "span attribute outcome=abstain (criterion 6 dimension)");

  // 5. Capability negotiation: capable provider receives includeDomains; incapable does not.
  const capP = mockProvider("cap", ["https://a.com/1"], true);
  const incapP = mockProvider("incap", ["https://a.com/2", "https://evil.com/9"], false);
  const eng5 = new RetroaererdEngine([capP, incapP], { urlPolicy: resolvePolicy, domainName: "docs" });
  const s5 = fakeSink();
  const r5 = await eng5.search({ query: "q", mode: "fast", span: s5.sink });
  const capReq = (capP as any).lastReq as SearchRequest;
  const incapReq = (incapP as any).lastReq as SearchRequest;
  assert(capReq.includeDomains?.join(",") === "a.com,b.com", "capable provider got canonical includeDomains");
  assert(incapReq.includeDomains === undefined, "incapable provider did NOT get includeDomains");
  const pre5 = s5.events.find((e) => e.name === "retrieval.domain_filter.pre");
  const degraded = pre5?.attributes?.["anysearch.domain_filter.degraded"] as string[] | undefined;
  assert(Array.isArray(degraded) && degraded.includes("incap"), "pre event lists degraded post-filter-only providers");
  assert(r5.results.every((r) => !r.url.includes("evil.com")), "incapable provider out-of-domain still caught by post-gate");

  // 6. In-domain pass-through: zero dropped, outcome=answer, no abstain.
  const s6 = fakeSink();
  const r6 = await eng5.search({ query: "q", mode: "fast", span: s6.sink });
  assert(s6.attrs["anysearch.outcome"] === "answer", "outcome=answer on surviving results");

  // 7. No policy resolver -> legacy behavior (no events, no abstain, no filtering).
  const eng7 = new RetroaererdEngine([mockProvider("m", ["https://anything.com/x"], false)]);
  const s7 = fakeSink();
  const r7 = await eng7.search({ query: "q", mode: "fast", span: s7.sink });
  assert(r7.results.length === 1, "no policy: results untouched");
  assert(s7.events.length === 0, "no policy: no domain_filter events");
  assert(r7.metadata.abstain === undefined, "no policy: no abstain marker");

  // 8. Cold domain: providers return zero results while policy active -> abstain.
  const eng8 = new RetroaererdEngine([mockProvider("empty", [], true)], { urlPolicy: resolvePolicy, domainName: "docs" });
  const r8 = await eng8.search({ query: "q", mode: "fast" });
  assert(r8.metadata.abstain?.abstain === true, "cold-domain zero-result => abstain (criterion 4)");
  assert(r8.metadata.abstain?.preFiltered === 0, "cold-domain preFiltered=0");
  assert(r8.metadata.abstain?.gate === "pre", "cold-domain gate=pre (zero arrivals)");

  // 9. span absent -> events skipped silently, abstain marker still set.
  const r9 = await eng3.search({ query: "q", mode: "fast" });
  assert(r9.metadata.abstain?.abstain === true, "no span: abstain marker still set");

  // ---- Zero-result outcomes (issue #514): the verdict, the marker and the
  // audit dimension are one judgment, written once. A zero-result search is an
  // abstain only when the domain policy is the evidence-backed reason.

  const failing = (id: string): SearchProvider => ({
    id,
    modes: ["fast"],
    async search(): Promise<ProviderEnvelope> {
      throw new Error("ECONNREFUSED upstream down");
    },
  });
  const answeringWithNothing = (id: string): SearchProvider => ({
    id,
    modes: ["fast"],
    async search(): Promise<ProviderEnvelope> {
      return { provider: id, results: [], answers: [], elapsedMs: 1 };
    },
  });

  // 10. Every queried arm failed while the policy is on -> failed, and no
  //     abstain marker. This is the #460 defect that used to read as a refusal.
  {
    const eng = new RetroaererdEngine([failing("dead")], { urlPolicy: resolvePolicy, domainName: "docs" });
    const s10 = fakeSink();
    const r10 = await eng.search({ query: "q", mode: "fast", span: s10.sink });
    assert(r10.results.length === 0, "10: all-failed search returns zero results");
    assert(r10.metadata.outcome === "failed", "10: all-failed => outcome failed (got " + r10.metadata.outcome + ")");
    assert(r10.metadata.abstain === undefined, "10: all-failed writes no abstain marker");
    assert(s10.attrs["anysearch.outcome"] === "failed", "10: span records outcome=failed");
    const post10 = s10.events.find((e) => e.name === "retrieval.domain_filter.post");
    assert(post10?.attributes?.["anysearch.outcome"] === "failed", "10: post event carries the same verdict");
    assert(post10?.attributes?.["anysearch.providers.failed_count"] === 1, "10: post event counts the failed arm");
    assert(post10?.attributes?.["anysearch.providers.cancelled_count"] === 0, "10: post event counts cancelled arms (0)");
  }

  // 11. All arms cut off. Two ways an arm is cancelled: it never settles, or it
  //     resolves only after our abort (the #481 pin). Both are `cancelled`,
  //     neither writes a marker, and the resolved-after-abort arm is NOT counted
  //     as one that answered.
  {
    const abandonedSearch = async (onAbort: "hang" | "resolve") => {
      let startedResolve: () => void = () => { };
      const started = new Promise<void>((r) => { startedResolve = r; });
      const slow: SearchProvider = {
        id: "slow",
        modes: ["fast"],
        async search(_req: SearchRequest, signal: AbortSignal): Promise<ProviderEnvelope> {
          startedResolve();
          return new Promise<ProviderEnvelope>((resolve) => {
            signal.addEventListener("abort", () => {
              if (onAbort === "resolve") {
                resolve({
                  provider: "slow",
                  results: [{ url: "https://a.com/after-abort", title: "late", snippet: "s", source: "slow" }],
                  answers: [],
                  elapsedMs: 1,
                });
              }
            }, { once: true });
          });
        },
      };
      const engine = new RetroaererdEngine([slow], { urlPolicy: resolvePolicy, domainName: "docs" });
      const sink = fakeSink();
      const caller = new AbortController();
      const search = engine.search({ query: "q", mode: "fast", signal: caller.signal, span: sink.sink });
      // The arm holds the engine's per-arm signal by the time this resolves.
      await started;
      caller.abort("caller went away");
      return { result: await search, sink };
    };

    const hung = await abandonedSearch("hang");
    assert(hung.result.metadata.outcome === "cancelled", "11: aborted arm that never settles => cancelled (got " + hung.result.metadata.outcome + ")");
    assert(hung.result.metadata.abstain === undefined, "11: cancelled writes no abstain marker");
    assert(hung.result.metadata.providersCancelled.includes("slow"), "11: the arm is named cancelled");
    assert(hung.sink.attrs["anysearch.outcome"] === "cancelled", "11: span records outcome=cancelled");

    const late = await abandonedSearch("resolve");
    assert(late.result.metadata.outcome === "cancelled", "11: an arm that resolves only after the abort is cancelled too (got " + late.result.metadata.outcome + ")");
    assert(late.result.metadata.abstain === undefined, "11: a post-abort resolve writes no abstain marker");
    assert(late.result.results.length === 0, "11: a post-abort resolve contributes no results (#481)");
    assert(late.result.metadata.providersCancelled.includes("slow"), "11: a post-abort resolve is named cancelled (#481)");
  }

  // 12. One arm answered with nothing, another failed: neither an abstain nor a
  //     fault — `empty`, and the failed arm is named.
  {
    const eng = new RetroaererdEngine([answeringWithNothing("quiet"), failing("dead")], { urlPolicy: resolvePolicy, domainName: "docs" });
    const s12 = fakeSink();
    const r12 = await eng.search({ query: "q", mode: "fast", span: s12.sink });
    assert(r12.metadata.outcome === "empty", "12: empty + failed => empty (got " + r12.metadata.outcome + ")");
    assert(r12.metadata.abstain === undefined, "12: empty + failed writes no abstain marker");
    assert(r12.metadata.providersFailed.includes("dead"), "12: the failed arm is still named");
    const post12 = s12.events.find((e) => e.name === "retrieval.domain_filter.post");
    assert(post12?.attributes?.["anysearch.providers.failed_count"] === 1, "12: the event separates this empty from a clean one");
  }

  // 13. A provider answer with zero results is an answer, not an abstain.
  {
    const answered: SearchProvider = {
      id: "exa",
      modes: ["fast", "answer"],
      async search(): Promise<ProviderEnvelope> {
        return { provider: "exa", results: [], answers: ["a provider-written answer"], elapsedMs: 1 };
      },
    };
    const eng = new RetroaererdEngine([answered], { urlPolicy: resolvePolicy, domainName: "docs" });
    const s13 = fakeSink();
    const r13 = await eng.search({ query: "q", mode: "fast", span: s13.sink });
    assert(r13.metadata.outcome === "answer", "13: answers-only => answer (got " + r13.metadata.outcome + ")");
    assert(r13.metadata.abstain === undefined, "13: answers-only writes no abstain marker");
    assert(r13.answers.length === 1, "13: the answer survives");
  }

  // 14. Partial cancellation with results: the results are the verdict, the
  //     cut-off arm is named beside them. The deadline is shrunk so the slow arm
  //     is cut off deterministically.
  {
    const quick = mockProvider("quick", ["https://a.com/1"], true);
    const slow: SearchProvider = {
      id: "slow",
      modes: ["fast"],
      async search(): Promise<ProviderEnvelope> {
        return new Promise<ProviderEnvelope>(() => { });
      },
    };
    const eng = new RetroaererdEngine([quick, slow], { urlPolicy: resolvePolicy, domainName: "docs", requestTimeoutMs: 40 });
    const s14 = fakeSink();
    const r14 = await eng.search({ query: "q", mode: "fast", span: s14.sink });
    assert(r14.results.length === 1, "14: the fast arm's result survives");
    assert(r14.metadata.outcome === "answer", "14: results with a cut-off arm => answer (got " + r14.metadata.outcome + ")");
    assert(r14.metadata.providersCancelled.includes("slow"), "14: the cut-off arm is named cancelled");
    assert(s14.attrs["anysearch.outcome"] === "answer", "14: span records the same answer");
  }

  console.log("--- domain-filter engine tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
