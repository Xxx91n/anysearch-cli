// #214 acceptance — AnySearch request_id stays in observation data only.
//
// A provider envelope carrying diagnostics.requestId travels through the real
// engine and the registered search_web handler: the observation span records
// `retrieval.provider.diagnostic`, while the tool's content and
// structuredContent stay free of the id.
//
// No test framework (repo convention: assert-based, run via
// `node --import tsx --test`). Offline only: no providers, no LLM network.

import { RetroaererdEngine } from "@anysearch-cli/kernel";
import type { CompositionResult } from "@anysearch-cli/kernel";
import type { SearchProvider, SearchRequest, ProviderEnvelope } from "@anysearch-cli/retriever";
import type { SessionStore } from "@anysearch-cli/store";
import { registerSearchWeb } from "../src/tools/search-web.tool.js";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error("FAIL: " + msg);
  }
}

const diagnosticsProvider: SearchProvider = {
  id: "anysearch",
  modes: ["fast"],
  async search(_req: SearchRequest): Promise<ProviderEnvelope> {
    return {
      provider: "anysearch",
      results: [{ url: "https://example.com/hit", title: "hit", snippet: "s", source: "anysearch" }],
      answers: [],
      elapsedMs: 4,
      diagnostics: { requestId: "req-diag-observed" },
    };
  },
};

const okStore = {
  createSession: async (d: string) => ({ id: "s", domain: d, createdAt: "" }),
  append: async () => {},
  searchFts5: async () => [],
  searchMemory: async () => [],
  saveResults: async () => {},
  saveAnchor: async () => {},
  getAnchors: async () => [],
} as unknown as SessionStore;

type Handler = (args: unknown) => Promise<any>;

async function main() {
  const events: Array<{ name: string; attributes: any }> = [];
  const span = {
    traceId: "t",
    spanId: "s",
    addEvent: (name: string, attributes: any) => { events.push({ name, attributes }); },
    setAttributes: () => {},
    startSpan: async (_o: any, cb: any) => cb(span),
    finish: () => {},
  };

  const eng = {
    retriever: new RetroaererdEngine([diagnosticsProvider]),
    store: okStore,
    // observeTool wraps the handler in recordOperation and hands the span to
    // the engine; this fake passes our capturing span through.
    observation: { recordOperation: async (_o: any, cb: any) => cb(span) },
  } as unknown as CompositionResult;

  let handler: Handler | null = null;
  const fakeServer = {
    registerTool: (name: string, _config: unknown, h: Handler) => {
      if (name === "search_web") handler = h;
    },
  };
  registerSearchWeb(fakeServer as any, eng);
  assert(handler !== null, "search_web handler registered");

  const res = (await handler!({ query: "example" })) as any;
  assert(res?.isError !== true, "clean search is not an error result");

  const diag = events.find((e) => e.name === "retrieval.provider.diagnostic");
  assert(!!diag, "observation span records retrieval.provider.diagnostic");
  assert(diag?.attributes["anysearch.provider"] === "anysearch", "event names the provider");
  assert(diag?.attributes["anysearch.provider.request_id"] === "req-diag-observed", "event carries request_id");

  const text = res?.content?.[0]?.text ?? "";
  assert(!text.includes("req-diag-observed"), "request_id absent from tool content");
  assert(!JSON.stringify(res?.structuredContent ?? {}).includes("req-diag-observed"), "request_id absent from structuredContent");
  assert(!JSON.stringify(res).includes("req-diag-observed"), "request_id absent from the whole tool result");

  console.log("--- mcp provider-diagnostics tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
