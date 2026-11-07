// #214: upstream request_id capture seam — observation-only.
// A provider carrying ProviderEnvelope.diagnostics.requestId must land on the
// caller's observation span as retrieval.provider.diagnostic, and must never
// reach the fused envelope (results/metadata/JSON output).
// Mirrors vertical-domain.test.ts: stub providers + fake observation sink.

import { RetroaererdEngine } from "../src/engine";
import type { SearchProvider, SearchRequest, ProviderEnvelope } from "@anysearch-cli/retriever";
import type { RetrievalObservationSink } from "../src/ports";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

function mockProvider(id: string, diagnostics?: ProviderEnvelope["diagnostics"]): SearchProvider {
  return {
    id,
    modes: ["fast"],
    async search(_req: SearchRequest): Promise<ProviderEnvelope> {
      return {
        provider: id,
        results: [{ url: "https://example.com/a", title: id + " hit", snippet: "s", source: id }],
        answers: [],
        elapsedMs: 3,
        ...(diagnostics ? { diagnostics } : {}),
      };
    },
  };
}

function fakeSink() {
  const events: Array<{ name: string; attributes: any }> = [];
  const sink: RetrievalObservationSink = {
    addEvent: (name, attributes) => { events.push({ name, attributes }); },
    setAttributes: () => { },
  };
  return { sink, events };
}

async function main() {
  // 1. request_id is recorded on the observation span, never on the envelope.
  {
    const s = fakeSink();
    const eng = new RetroaererdEngine([mockProvider("anysearch", { requestId: "req-diag-1" })]);
    const env = await eng.search({ query: "q", mode: "fast", span: s.sink });
    const diag = s.events.find((e) => e.name === "retrieval.provider.diagnostic");
    assert(!!diag, "retrieval.provider.diagnostic event emitted");
    assert(diag?.attributes["anysearch.provider"] === "anysearch", "event names the provider");
    assert(diag?.attributes["anysearch.provider.request_id"] === "req-diag-1", "event carries request_id");
    assert(env.results.length === 1, "search still answers");
    assert(!JSON.stringify(env).includes("req-diag-1"), "request_id never enters the fused envelope");
    assert(!JSON.stringify(env.results).includes("req-diag-1"), "request_id never enters results");
  }

  // 2. No diagnostics -> no event (clean zero-state).
  {
    const s = fakeSink();
    const eng = new RetroaererdEngine([mockProvider("anysearch")]);
    await eng.search({ query: "q", mode: "fast", span: s.sink });
    assert(!s.events.some((e) => e.name === "retrieval.provider.diagnostic"), "absent diagnostics -> no event");
  }

  // 3. Empty ids are dropped at the engine seam (non-string shapes are rejected
  // earlier, at the provider extraction).
  {
    const s = fakeSink();
    const eng = new RetroaererdEngine([mockProvider("anysearch", { requestId: "" })]);
    await eng.search({ query: "q", mode: "fast", span: s.sink });
    assert(!s.events.some((e) => e.name === "retrieval.provider.diagnostic"), "empty request_id dropped");
  }

  // 4. No span supplied -> search still works (diagnostics have no side channel).
  {
    const eng = new RetroaererdEngine([mockProvider("anysearch", { requestId: "req-diag-2" })]);
    const env = await eng.search({ query: "q", mode: "fast" });
    assert(env.results.length === 1, "span-less search answers");
    assert(!JSON.stringify(env).includes("req-diag-2"), "span-less envelope still clean");
  }

  console.log("--- provider-diagnostics tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
