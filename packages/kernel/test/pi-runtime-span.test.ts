// R62 D-011 (T7): PiAgentRuntimeOptions.span pass-through — the caller
// observation span reaches every search Query inside the agent loop, so the
// engine's retrieval.domain_filter.pre/post audit events + anysearch.outcome
// dimension land inside the caller's span events_json (ans_chat = third
// retrieval surface). Assertion shape mirrors domain-filter.test.ts §4.
// Seam: createSearchTool is a pure builder — testable without the Agent loop.

import { RetroaererdEngine } from "../src/engine";
import { createSearchTool } from "../src/pi-runtime";
import type { SearchProvider, SearchRequest, NormalizedResult, ProviderEnvelope } from "@anysearch/retriever";
import type { RetrievalObservationSink } from "../src/ports";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

function stubProvider(id: string, urls: string[], capable: boolean): SearchProvider {
  const p: SearchProvider = {
    id,
    modes: ["fast"],
    async search(_req: SearchRequest): Promise<ProviderEnvelope> {
      const results: NormalizedResult[] = urls.map((url, i) => ({
        url, title: id + " r" + i, snippet: "s" + i, source: id,
      }));
      return { provider: id, results, answers: [], elapsedMs: 5 };
    },
  };
  if (capable) (p as { domainFilterSupported?: boolean }).domainFilterSupported = true;
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

const policy = { allow: ["a.com", "b.com"], deny: [], policyVersion: "pv-span" };

async function main() {
  // 1. span threads into Query — engine emits dual audit events on the caller span.
  const eng = new RetroaererdEngine(
    [stubProvider("cap", ["https://evil.com/1"], false)],
    { urlPolicy: () => policy, domainName: "docs" },
  );
  const s = fakeSink();
  const tool = createSearchTool(eng, s.sink);
  const out = await tool.execute("tc-span-1", { query: "tokio joinset" });
  assert(!!out, "tool executed");
  const pre = s.events.find((e) => e.name === "retrieval.domain_filter.pre");
  const post = s.events.find((e) => e.name === "retrieval.domain_filter.post");
  assert(!!pre, "retrieval.domain_filter.pre event on caller span");
  assert(!!post, "retrieval.domain_filter.post event on caller span");
  assert(pre?.attributes?.["anysearch.policy_version"] === "pv-span", "pre event carries policy_version");
  assert(s.attrs["anysearch.outcome"] === "abstain", "outcome dimension = abstain (all arrivals gated)");

  // 2. No span -> Query.span undefined -> no events (opt-in wiring, no ambient side effects).
  const s2 = fakeSink();
  const tool2 = createSearchTool(eng);
  await tool2.execute("tc-span-2", { query: "x" });
  assert(s2.events.length === 0, "no span opt => engine emits nothing ambiently");

  // 3. Surviving result path: in-domain hit => outcome answer, post-gate keeps it.
  const eng3 = new RetroaererdEngine(
    [stubProvider("cap", ["https://a.com/ok", "https://evil.com/x"], false)],
    { urlPolicy: () => policy, domainName: "docs" },
  );
  const s3 = fakeSink();
  const tool3 = createSearchTool(eng3, s3.sink);
  await tool3.execute("tc-span-3", { query: "y" });
  assert(s3.attrs["anysearch.outcome"] === "answer", "outcome dimension = answer when a result survives");
  const post3 = s3.events.find((e) => e.name === "retrieval.domain_filter.post");
  assert(!!post3, "post event emitted on answer path too");

  console.log("--- pi-runtime span pass-through: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}
main();
