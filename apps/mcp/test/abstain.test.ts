// ADR-0062 D3 (T3): MCP structuredContent.abstain contract — first-class
// abstain surfaces with isError absent (false) and the full marker fields.
// Seam: real registered tool handler, invoked in-process with a mock engine.
// ponytail: no test framework, assert-based demo.

import { registerSearchWeb } from "../src/tools/search-web.tool.js";
import type { CompositionResult, Query } from "@anysearch/kernel";
import type { FusedEnvelope } from "@anysearch/retriever";
import type { SessionStore } from "@anysearch/store";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

const abstainEnvelope: FusedEnvelope = {
  results: [],
  answers: [],
  metadata: {
    providersQueried: ["exa"],
    providersFailed: [],
    providersCancelled: [],
    elapsedMs: 5,
    abstain: {
      abstain: true,
      reason: "domain_filter_empty",
      domain: "docs",
      preFiltered: 7,
      postFiltered: 0,
      gate: "post",
    },
  },
};

const fakeSpan = {
  traceId: "t", spanId: "s",
  addEvent: () => {}, setAttributes: () => {},
  startSpan: async (_o: any, cb: any) => cb(fakeSpan),
  finish: () => {},
};

const eng = {
  retriever: { search: async (_q: Query) => abstainEnvelope },
  store: {
    createSession: async () => ({ id: "s", domain: "mcp", createdAt: "" }),
    append: async () => {}, searchFts5: async () => [], searchMemory: async () => [],
    saveResults: async () => {}, saveAnchor: async () => {}, getAnchors: async () => [],
  } as unknown as SessionStore,
  observation: { recordOperation: async (_o: any, cb: any) => cb(fakeSpan) },
} as unknown as CompositionResult;

async function main() {
  let handler: ((args: unknown) => Promise<unknown>) | null = null;
  const fakeServer = { registerTool: (_n: string, _c: unknown, h: any) => { handler = h; } };
  registerSearchWeb(fakeServer as any, eng);
  assert(handler !== null, "search_web handler registered");

  const res = (await handler!({ query: "tokio JoinSet" })) as any;
  // Contract: isError absent/false — abstain is a successful policy result.
  assert(res.isError !== true, "isError is not true on abstain");
  const sc = res.structuredContent;
  assert(sc?.abstain?.abstain === true, "structuredContent.abstain.abstain === true");
  assert(sc.abstain.reason === "domain_filter_empty", "abstain reason");
  assert(sc.abstain.domain === "docs", "abstain domain");
  assert(sc.abstain.preFiltered === 7 && sc.abstain.postFiltered === 0, "pre/post counts");
  assert(sc.abstain.gate === "post", "gate field");
  assert(Array.isArray(res.content) && typeof res.content[0]?.text === "string", "text content present");
  const doc = JSON.parse(res.content[0].text);
  assert(doc.abstain?.abstain === true, "text summary also carries the abstain marker");

  console.log("--- mcp abstain contract tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
