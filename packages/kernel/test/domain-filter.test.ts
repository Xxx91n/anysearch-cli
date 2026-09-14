// ADR-0062 D2/D3 (T2): kernel post-filter authoritative gate + dual audit events
// + first-class abstain marker + outcome:abstain dimension.
// Seam: RetroaererdEngine.search() with stub providers, injected per-request
// urlPolicy resolver, and a fake observation sink capturing span events.
// ponytail: no test framework, assert-based demo.

import { RetroaererdEngine } from "../src/engine";
import type { SearchProvider, SearchRequest, NormalizedResult, ProviderEnvelope } from "@anysearch/retriever";
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

  console.log("--- domain-filter engine tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
