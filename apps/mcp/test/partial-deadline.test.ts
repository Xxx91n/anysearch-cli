// #651 — both MCP search tools say when the pool was cut short and what
// budget the call ran on. `partial` and `deadlineMs` ride in the text half and
// in `structuredContent`; both values come from the engine's envelope, so the
// tools never re-derive a default or re-judge the arm lists.
//
// Test setup: real registered handlers, in-process, over a fake
// CompositionResult (no providers, no network, no LLM).
// ponytail: no test framework, assert-based demo.

import { registerSearchWeb } from "../src/tools/search-web.tool.js";
import { registerResearchWeb } from "../src/tools/research-web.tool.js";
import type { CompositionResult, Query } from "@anysearch-cli/kernel";
import type { FusedEnvelope, SearchOutcome } from "@anysearch-cli/retriever";
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

function makeEngine(envelope: FusedEnvelope): CompositionResult {
  return {
    retriever: { search: async (_q: Query) => envelope },
    store: {
      createSession: async (d: string) => ({ id: "s", domain: d, createdAt: "" }),
      saveResults: async () => {},
    } as unknown as SessionStore,
    observation: { recordOperation: async (_o: any, cb: any) => cb(fakeSpan) },
    providerBuildErrors: {},
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

function envelope(over: { providersCancelled?: string[]; deadlineMs?: number; outcome?: SearchOutcome }): FusedEnvelope {
  return {
    results: [],
    answers: [],
    metadata: {
      providersQueried: ["anysearch"],
      providersFailed: [],
      providersCancelled: over.providersCancelled ?? [],
      elapsedMs: 1,
      ...(over.deadlineMs !== undefined ? { deadlineMs: over.deadlineMs } : {}),
      outcome: over.outcome ?? "empty",
    },
  };
}

async function main() {
  // 1. search_web, one arm cut: partial is true and the budget travels whole.
  {
    const cut = envelope({ providersCancelled: ["anysearch"], deadlineMs: 500, outcome: "cancelled" });
    const res = await captureHandlers(makeEngine(cut)).search_web({ query: "q" });
    assert(res?.isError !== true, "1: a cut search is not an error");
    assert(res?.structuredContent?.partial === true, "1: structuredContent says the pool was cut");
    assert(res?.structuredContent?.deadlineMs === 500, "1: structuredContent carries the budget the engine used");
    const doc = JSON.parse(String(res?.content?.[0]?.text));
    assert(doc.partial === true, "1: text half carries partial too");
    assert(doc.deadlineMs === 500, "1: text half carries deadlineMs too");
  }

  // 2. search_web, nothing cut: partial is still present, and false.
  {
    const whole = envelope({ deadlineMs: 8000, outcome: "empty" });
    const res = await captureHandlers(makeEngine(whole)).search_web({ query: "q" });
    assert(res?.structuredContent?.partial === false, "2: a complete pool reads partial=false, never a missing key");
    assert(res?.structuredContent?.deadlineMs === 8000, "2: the budget is not assumed to be the default");
  }

  // 3. research_web: the last completed round was cut, so the call says so.
  {
    const cut = envelope({ providersCancelled: ["anysearch"], deadlineMs: 500, outcome: "cancelled" });
    const res = await captureHandlers(makeEngine(cut)).research_web({ question: "q", depth: "brief" });
    assert(res?.isError !== true, "3: a cut research call is not an error");
    assert(res?.structuredContent?.partial === true, "3: research_web says the pool was cut");
    assert(res?.structuredContent?.deadlineMs === 500, "3: research_web carries the round's budget");
    const doc = JSON.parse(String(res?.content?.[0]?.text));
    assert(doc.partial === true, "3: text half agrees on partial");
    assert(doc.deadlineMs === 500, "3: text half agrees on deadlineMs");
  }

  console.log("--- mcp partial/deadline tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
