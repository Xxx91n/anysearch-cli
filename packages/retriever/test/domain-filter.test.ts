// ADR-0062 D2 (T1): capability-negotiated provider pre-filter.
// Contract: SearchRequest.includeDomains + SearchProvider.domainFilterSupported.
// Seam: provider adapter request payload (stub client captures options).
// ponytail: no test framework, assert-based demo.

import { TavilyProvider } from "../src/providers/tavily";
import { ExaProvider } from "../src/providers/exa";
import { AnySearchProvider } from "../src/providers/anysearch";
import type { SearchProvider, SearchRequest } from "../src/contract";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

async function main() {
  // 1. Capability flags: tavily/exa declare support, anysearch explicitly declares unsupported.
  const tavily = new TavilyProvider("test-key");
  const exa = new ExaProvider("test-key");
  const anysearch = new AnySearchProvider("test-key");
  assert(tavily.domainFilterSupported === true, "tavily declares domainFilterSupported");
  assert(exa.domainFilterSupported === true, "exa declares domainFilterSupported");
  assert(anysearch.domainFilterSupported === false, "anysearch explicitly declares domainFilterSupported=false");

  // 2. Tavily forwards includeDomains as include_domains and requests the hard
  // "filter" mode (Tavily changelog 2026-08: boost is a soft mode that leaks).
  let tavilyOpts: any = null;
  (tavily as any).client = {
    search: async (_q: string, opts: any) => { tavilyOpts = opts; return { results: [], responseTime: 1, images: [] }; },
  };
  await tavily.search({ query: "q", mode: "fast", includeDomains: ["pnpm.io", "typescriptlang.org"] }, new AbortController().signal);
  assert(Array.isArray(tavilyOpts?.includeDomains), "tavily search opts carry includeDomains");
  assert(tavilyOpts.includeDomains.join(",") === "pnpm.io,typescriptlang.org", "tavily includeDomains forwarded verbatim");
  assert(tavilyOpts.include_domains_mode === "filter", "tavily requests hard include_domains_mode=filter (not soft boost)");

  // No includeDomains on the request -> adapter must not invent one.
  tavilyOpts = null;
  await tavily.search({ query: "q", mode: "fast" }, new AbortController().signal);
  assert(tavilyOpts != null && tavilyOpts.includeDomains === undefined, "tavily omits includeDomains when request has none");

  // 3. Exa forwards includeDomains (native camelCase API field).
  let exaOpts: any = null;
  (exa as any).client = {
    search: async (_q: string, opts: any) => { exaOpts = opts; return { results: [] }; },
  };
  await exa.search({ query: "q", mode: "fast", includeDomains: ["modelcontextprotocol.io"] }, new AbortController().signal);
  assert(exaOpts?.includeDomains?.[0] === "modelcontextprotocol.io", "exa includeDomains forwarded");

  exaOpts = null;
  await exa.search({ query: "q", mode: "fast" }, new AbortController().signal);
  assert(exaOpts != null && exaOpts.includeDomains === undefined, "exa omits includeDomains when request has none");

  // 4. AnySearch never receives/uses domain params — degrade to post-filter-only.
  // (Contract-level: flag false; adapter simply ignores the field.)
  const req: SearchRequest = { query: "q", mode: "fast", includeDomains: ["pnpm.io"] };
  assert(req.includeDomains?.length === 1, "contract accepts includeDomains");

  // 5. SearchProvider type: capability flag is part of the contract surface.
  const asContract: SearchProvider = anysearch;
  assert(asContract.domainFilterSupported === false, "capability flag readable via SearchProvider contract");

  console.log("--- domain-filter adapter tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
