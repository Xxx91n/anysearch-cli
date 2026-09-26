// R83 T1 / ADR-0084 D-003..D-006: vertical-domain passthrough — kernel routing
// + audit event semantics. Mirrors domain-filter.test.ts: stub providers with a
// verticalDomainSupported bit, fake observation sink capturing span events.
// Acceptance anchors covered: query-vs-repo wholesale replace, capability
// negotiation sent/degraded, vertical.pre attrs (5 keys, params_keys not
// values, independent trigger), no vertical.post, fail-first degrade.

import { RetroaererdEngine } from "../src/engine";
import type { SearchProvider, SearchRequest, NormalizedResult, ProviderEnvelope } from "@anysearch-cli/retriever";
import type { RetrievalObservationSink } from "../src/ports";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

function mockProvider(id: string, urls: string[], verticalCapable: boolean, throws?: boolean): SearchProvider {
  const p: SearchProvider = {
    id,
    modes: ["fast"],
    async search(req: SearchRequest): Promise<ProviderEnvelope> {
      (p as any).lastReq = req;
      if (throws) throw new Error(id + " upstream isError (invalid vertical combination)");
      const results: NormalizedResult[] = urls.map((url, i) => ({
        url, title: id + " r" + i, snippet: "s" + i, source: id,
        ...(req.vertical ? { extra: { vertical: { domain: req.vertical.domain, ...(req.vertical.subDomain ? { subDomain: req.vertical.subDomain } : {}) } } } : {}),
      }));
      return { provider: id, results, answers: [], elapsedMs: 5 };
    },
  };
  if (verticalCapable) (p as any).verticalDomainSupported = true;
  return p;
}

function fakeSink() {
  const events: Array<{ name: string; attributes: any }> = [];
  const sink: RetrievalObservationSink = {
    addEvent: (name, attributes) => { events.push({ name, attributes }); },
    setAttributes: () => { },
  };
  return { sink, events };
}

const repoV = () => ({ domain: "finance", subDomain: "calendar" });

async function main() {
  // 1. Repo-level default reaches capable providers; incapable fan out general.
  const cap = mockProvider("cap", ["https://x.com/1"], true);
  const incap = mockProvider("incap", ["https://x.com/2"], false);
  const eng1 = new RetroaererdEngine([cap, incap], { repoVertical: repoV });
  const s1 = fakeSink();
  const r1 = await eng1.search({ query: "q", mode: "fast", span: s1.sink });
  assert((cap as any).lastReq?.vertical?.domain === "finance", "capable provider receives repo vertical");
  assert((cap as any).lastReq?.vertical?.subDomain === "calendar", "subDomain passes through");
  assert((incap as any).lastReq?.vertical === undefined, "incapable provider gets no vertical (general fanout, not abstain)");
  const pre1 = s1.events.find(e => e.name === "retrieval.vertical.pre");
  assert(!!pre1, "vertical.pre emitted when repo default resolves");
  assert(pre1?.attributes["anysearch.vertical.domain"] === "finance", "attr domain=finance");
  assert(pre1?.attributes["anysearch.vertical.sub_domain"] === "calendar", "attr sub_domain");
  assert(pre1?.attributes["anysearch.vertical.source"] === "repo", "attr source=repo");
  assert(JSON.stringify(pre1?.attributes["anysearch.vertical.sent"]) === '["cap"]', "sent=[cap]");
  assert(JSON.stringify(pre1?.attributes["anysearch.vertical.degraded"]) === '["incap"]', "degraded=[incap]");
  assert(!s1.events.some(e => e.name === "retrieval.vertical.post"), "no vertical.post event (D-005)");
  assert(!s1.events.some(e => e.name === "retrieval.domain_filter.pre"), "domain_filter.pre untouched (fires only when host policy active)");
  assert(r1.results.length === 2, "both arms contributed results");

  // 2. Query-level whole-replace: verticalDomain=Y beats repo X, params ride query-level.
  const cap2 = mockProvider("cap", ["https://x.com/1"], true);
  const eng2 = new RetroaererdEngine([cap2], { repoVertical: repoV });
  const s2 = fakeSink();
  await eng2.search({
    query: "q", mode: "fast", span: s2.sink,
    vertical: { domain: "it_tech", subDomain: "changelog", params: { symbol: "MSFT", region: "us" } },
  });
  const req2 = (cap2 as any).lastReq;
  assert(req2?.vertical?.domain === "it_tech", "query-level domain wins over repo (wholesale replace)");
  assert(req2?.vertical?.subDomain === "changelog", "query-level subDomain (not repo's calendar — no deep-merge)");
  assert(req2?.vertical?.params?.symbol === "MSFT", "query-level params pass through");
  const pre2 = s2.events.find(e => e.name === "retrieval.vertical.pre");
  assert(pre2?.attributes["anysearch.vertical.source"] === "query", "attr source=query");
  assert(pre2?.attributes["anysearch.vertical.domain"] === "it_tech", "attr domain=it_tech");
  const pk = pre2?.attributes["anysearch.vertical.params_keys"];
  assert(Array.isArray(pk) && pk.includes("symbol") && pk.includes("region"), "params_keys lists key names");
  assert(!JSON.stringify(pre2?.attributes).includes("MSFT"), "params VALUES never enter audit attrs");

  // 3. Query-level alone (no repo) resolves; repo-level alone resolves.
  const eng3 = new RetroaererdEngine([mockProvider("cap", ["https://x.com/1"], true)]);
  const s3 = fakeSink();
  await eng3.search({ query: "q", mode: "fast", span: s3.sink, vertical: { domain: "travel" } });
  const pre3 = s3.events.find(e => e.name === "retrieval.vertical.pre");
  assert(pre3?.attributes["anysearch.vertical.source"] === "query", "query-only resolves (source=query)");
  assert(pre3?.attributes["anysearch.vertical.sub_domain"] === "", "absent subDomain -> empty-string attr");

  // 4. No vertical anywhere: no event, no req.vertical — clean zero-state.
  const cap4 = mockProvider("cap", ["https://x.com/1"], true);
  const eng4 = new RetroaererdEngine([cap4]);
  const s4 = fakeSink();
  await eng4.search({ query: "q", mode: "fast", span: s4.sink });
  assert(s4.events.filter(e => e.name === "retrieval.vertical.pre").length === 0, "no vertical -> no event");
  assert((cap4 as any).lastReq?.vertical === undefined, "no vertical -> provider request carries none");

  // 5. Fail-first degrade: capable provider throws (upstream rejected the
  // combination) — the arm degrades, the fused envelope still answers.
  const boom = mockProvider("cap", ["https://x.com/1"], true, true);
  const ok = mockProvider("ok", ["https://y.com/1"], false);
  const eng5 = new RetroaererdEngine([boom, ok], { repoVertical: repoV });
  const s5 = fakeSink();
  const r5 = await eng5.search({ query: "q", mode: "fast", span: s5.sink });
  assert(r5.metadata.providersFailed.includes("cap"), "throwing arm recorded in providersFailed (fail-first, not silent zero)");
  assert(r5.results.some(r => r.source === "ok"), "general-fanout arm still answers");
  const pre5 = s5.events.find(e => e.name === "retrieval.vertical.pre");
  assert(!!pre5, "vertical.pre still emitted (audit records the attempt)");

  // 6b. R84 T1 / A-04: params:{} canonicalizes to absent at the shared engine
  //     choke — wire carries no sub_domain_params, params_keys=[].
  const cap6b = mockProvider("cap", ["https://x.com/1"], true);
  const eng6b = new RetroaererdEngine([cap6b], { repoVertical: () => ({ domain: "finance", subDomain: "calendar", params: {} }) });
  const s6b = fakeSink();
  await eng6b.search({ query: "q", mode: "fast", span: s6b.sink });
  const req6b = (cap6b as any).lastReq;
  assert(req6b?.vertical?.domain === "finance", "6b domain routes");
  assert(req6b?.vertical?.subDomain === "calendar", "6b subDomain routes");
  assert(req6b?.vertical !== undefined && req6b.vertical.params === undefined, "6b params:{} -> absent on wire (A-04)");
  const pre6b = s6b.events.find(e => e.name === "retrieval.vertical.pre");
  assert(JSON.stringify(pre6b?.attributes["anysearch.vertical.params_keys"]) === "[]", "6b params_keys=[] after canonicalization");
  // non-object params (programmatic caller bypassing entry validation) also drop.
  const cap6c = mockProvider("cap", ["https://x.com/1"], true);
  const eng6c = new RetroaererdEngine([cap6c]);
  const s6c = fakeSink();
  await eng6c.search({ query: "q", mode: "fast", span: s6c.sink, vertical: { domain: "finance", params: "oops" as unknown as Record<string, unknown> } });
  assert((cap6c as any).lastReq?.vertical?.params === undefined, "6c non-object params -> absent on wire (A-04)");

  // 6. domain_filter.pre trigger unchanged: vertical active WITHOUT a url
  //    policy => only the vertical event fires (independent trigger).
  const s6 = fakeSink();
  const eng6 = new RetroaererdEngine([mockProvider("cap", ["https://a.com/1"], true)], {
    repoVertical: repoV,
    urlPolicy: () => ({ allow: [], deny: [], policyVersion: "pv0" }),
  });
  await eng6.search({ query: "q", mode: "fast", span: s6.sink });
  assert(s6.events.some(e => e.name === "retrieval.vertical.pre"), "vertical.pre fires");
  assert(!s6.events.some(e => e.name === "retrieval.domain_filter.pre"), "empty allow -> domain_filter.pre does NOT fire (trigger condition unchanged)");

  console.log("--- vertical-domain engine tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
