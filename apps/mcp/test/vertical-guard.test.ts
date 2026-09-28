// R88 T3 / ADR-0089 D2③: byte-identical golden for the require-domain
// guard on both MCP surfaces. The consolidation (a06 buildVerticalSpec)
// must not alter the error text by one byte — exact-string asserts are
// the assertion carrier (Pact Golden Rule: contract frozen by test, not
// by the implementation that happens to be live).
// Seam: real registered tool handlers, in-process mock engine (no network).

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

const emptyEnvelope: FusedEnvelope = {
  results: [],
  answers: [],
  metadata: { providersQueried: [], providersFailed: [], providersCancelled: [], elapsedMs: 1 },
};

const fakeSpan = {
  traceId: "t", spanId: "s",
  addEvent: () => {}, setAttributes: () => {},
  startSpan: async (_o: any, cb: any) => cb(fakeSpan),
  finish: () => {},
};

let lastQuery: Query | null = null;
const eng = {
  retriever: { search: async (q: Query) => { lastQuery = q; return emptyEnvelope; } },
  store: {
    createSession: async () => ({ id: "s", domain: "mcp", createdAt: "" }),
    append: async () => {}, searchFts5: async () => [], searchMemory: async () => [],
    saveResults: async () => {}, saveAnchor: async () => {}, getAnchors: async () => [],
  } as unknown as SessionStore,
  observation: { recordOperation: async (_o: any, cb: any) => cb(fakeSpan) },
} as unknown as CompositionResult;

async function main() {
  let swHandler: ((args: unknown) => Promise<unknown>) | null = null;
  let rwHandler: ((args: unknown) => Promise<unknown>) | null = null;
  const fakeServer = {
    registerTool: (n: string, _c: unknown, h: any) => {
      if (n === "search_web") swHandler = h;
      if (n === "research_web") rwHandler = h;
    },
  };
  registerSearchWeb(fakeServer as any, eng);
  registerResearchWeb(fakeServer as any, eng);
  assert(swHandler !== null && rwHandler !== null, "both tool handlers registered");

  // Golden: subDomain without domain → byte-exact error text, retriever untouched.
  let res = (await swHandler!({ query: "x", verticalSubDomain: "earnings" })) as any;
  assert(
    res.content?.[0]?.text === "search_web error: verticalSubDomain/verticalParams require verticalDomain",
    "search_web require-domain golden (subDomain only)",
  );
  assert(lastQuery === null, "search_web: retriever not called on guard failure");

  res = (await swHandler!({ query: "x", verticalParams: { k: "v" } })) as any;
  assert(
    res.content?.[0]?.text === "search_web error: verticalSubDomain/verticalParams require verticalDomain",
    "search_web require-domain golden (params only)",
  );

  res = (await rwHandler!({ question: "x", verticalSubDomain: "earnings" })) as any;
  assert(
    res.content?.[0]?.text === "research_web error: verticalSubDomain/verticalParams require verticalDomain",
    "research_web require-domain golden (subDomain only)",
  );
  assert(lastQuery === null, "research_web: retriever not called on guard failure");

  res = (await rwHandler!({ question: "x", verticalParams: { k: "v" } })) as any;
  assert(
    res.content?.[0]?.text === "research_web error: verticalSubDomain/verticalParams require verticalDomain",
    "research_web require-domain golden (params only)",
  );

  // Positive control: domain alone assembles a canonical vertical spec and
  // reaches the retriever with it.
  res = (await swHandler!({ query: "x", verticalDomain: "finance" })) as any;
  assert(lastQuery?.vertical?.domain === "finance", "search_web: canonical vertical reaches retriever");

  console.log("--- mcp vertical-guard golden tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
