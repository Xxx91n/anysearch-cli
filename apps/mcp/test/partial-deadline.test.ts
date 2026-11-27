// #651 — both MCP search tools say when the pool was cut short and what
// budget the call ran on. `partial` and `deadlineMs` ride in the text half and
// in `structuredContent`; `partial` comes from the engine's arm lists (any
// completed round for research_web, the one fanout for search_web), and
// `deadlineMs` is the same resolved budget the engine ran with.
//
// Test setup: real registered handlers, in-process, over a fake
// CompositionResult (no providers, no network, no LLM).
// ponytail: no test framework, assert-based demo.

import { registerSearchWeb } from "../src/tools/search-web.tool.js";
import { registerResearchWeb } from "../src/tools/research-web.tool.js";
import type { CompositionResult, Query } from "@anysearch-cli/kernel";
import type { FusedEnvelope } from "@anysearch-cli/retriever";
import type { SessionStore } from "@anysearch-cli/store";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

const fakeSpan: any = {
  traceId: "t",
  spanId: "s",
  addEvent: () => {},
  setAttributes: () => {},
  startSpan: async (_o: any, cb: any) => cb(fakeSpan),
  finish: () => {},
};

function makeEngine(envelopes: FusedEnvelope[], requestTimeoutMs?: number): CompositionResult {
  let i = 0;
  return {
    retriever: { search: async (_q: Query) => envelopes[Math.min(i++, envelopes.length - 1)] },
    store: {
      createSession: async (d: string) => ({ id: "s", domain: d, createdAt: "" }),
      saveResults: async () => {},
    } as unknown as SessionStore,
    observation: { recordOperation: async (_o: any, cb: any) => cb(fakeSpan) },
    providerBuildErrors: {},
    ...(requestTimeoutMs !== undefined ? { requestTimeoutMs } : {}),
  } as unknown as CompositionResult;
}

function captureHandlers(eng: CompositionResult) {
  const handlers: Record<string, any> = {};
  const server = {
    registerTool: (name: string, _def: unknown, h: unknown) => { handlers[name] = h; },
  } as any;
  registerSearchWeb(server, eng);
  registerResearchWeb(server, eng);
  return handlers;
}

function envelope(over: { providersCancelled?: string[]; outcome?: FusedEnvelope["metadata"]["outcome"]; results?: any[] }): FusedEnvelope {
  return {
    results: (over.results ?? []) as FusedEnvelope["results"],
    answers: [],
    metadata: {
      providersQueried: ["anysearch"],
      providersFailed: [],
      providersCancelled: over.providersCancelled ?? [],
      elapsedMs: 1,
      outcome: over.outcome ?? "empty",
    },
  };
}

async function main() {
  // 1. search_web, one arm cut: partial is true and the budget travels whole.
  {
    const cut = envelope({ providersCancelled: ["anysearch"], outcome: "cancelled" });
    const res = await captureHandlers(makeEngine([cut], 500)).search_web({ query: "q" });
    assert(res?.isError !== true, "1: a cut search is not an error");
    assert(res?.structuredContent?.partial === true, "1: structuredContent says the pool was cut");
    assert(res?.structuredContent?.deadlineMs === 500, "1: structuredContent carries the budget the engine used");
    const doc = JSON.parse(String(res?.content?.[0]?.text));
    assert(doc.partial === true, "1: text half carries partial too");
    assert(doc.deadlineMs === 500, "1: text half carries deadlineMs too");
  }

  // 2. search_web, nothing cut: partial is still present, and false.
  {
    const whole = envelope({});
    const res = await captureHandlers(makeEngine([whole], 8000)).search_web({ query: "q" });
    assert(res?.structuredContent?.partial === false, "2: a complete pool reads partial=false, never a missing key");
    assert(res?.structuredContent?.deadlineMs === 8000, "2: the budget is not assumed to be the default");
  }

  // 3. research_web: the last completed round was cut, so the call says so.
  {
    const cut = envelope({ providersCancelled: ["anysearch"], outcome: "cancelled" });
    const res = await captureHandlers(makeEngine([cut], 500)).research_web({ question: "q", depth: "brief" });
    assert(res?.isError !== true, "3: a cut research call is not an error");
    assert(res?.structuredContent?.partial === true, "3: research_web says the pool was cut");
    assert(res?.structuredContent?.deadlineMs === 500, "3: research_web carries the engine's per-round budget");
    const doc = JSON.parse(String(res?.content?.[0]?.text));
    assert(doc.partial === true, "3: text half agrees on partial");
    assert(doc.deadlineMs === 500, "3: text half agrees on deadlineMs");
  }

  // 4. research_web: an early round cut, the last round whole. The merged pool
  // is still short, so the call reports partial — even though the last round's
  // arm list (the one on the wire) is empty.
  {
    const round1 = envelope({
      providersCancelled: ["b"],
      results: [{ title: "one", url: "https://example.com/1", source: "anysearch" }],
    });
    const round2 = envelope({
      results: [{ title: "two", url: "https://example.com/2", source: "anysearch" }],
    });
    const res = await captureHandlers(makeEngine([round1, round2], 3000)).research_web({ question: "q", depth: "standard" });
    assert(res?.structuredContent?.partial === true, "4: one cut round makes the whole call partial");
    assert(res?.structuredContent?.deadlineMs === 3000, "4: the budget is the engine's per-round budget");
    assert(
      JSON.stringify(res?.structuredContent?.providersCancelled) === JSON.stringify([]),
      "4: the arm list is still last-round only, so partial and the list answer different questions",
    );
  }

  // 5. A hand-built CompositionResult without the budget field: the surface
  // still reports a number (the engine's default), never a dropped key.
  {
    const whole = envelope({});
    const res = await captureHandlers(makeEngine([whole])).search_web({ query: "q" });
    assert(res?.structuredContent?.deadlineMs === 4000, "5: a missing budget falls back to the engine default");
    const doc = JSON.parse(String(res?.content?.[0]?.text));
    assert(doc.deadlineMs === 4000, "5: the text half keeps the key too");
  }

  // 6. The CompositionResult omitted the budget, but the engine it holds ran a
  // different one. Report the engine's number, never the default.
  {
    const whole = envelope({});
    const eng = makeEngine([whole]);
    (eng as any).retriever.requestTimeoutMs = 8000;
    const res = await captureHandlers(eng).research_web({ question: "q", depth: "brief" });
    assert(res?.structuredContent?.deadlineMs === 8000, "6: the engine's own budget wins over the default");
  }

  console.log("--- mcp partial/deadline tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
