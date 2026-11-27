// #653 — MCP structuredContent says what each answered arm took.
//
// What this pins:
//   - search_web: providerElapsedMs passes through keyed by provider id, and
//     a cut arm has no key (not 0, not null);
//   - research_web: the last completed round's table, never a union across
//     rounds — a leg that answered in round 1 does not ride into round 2's map;
//   - the text half (content[0].text) carries the same map as structuredContent.
//
// Test setup: the real registered handlers, invoked in-process with a mock
// engine. Same shape as abstain.test.ts.

import { registerSearchWeb } from "../src/tools/search-web.tool.js";
import { registerResearchWeb } from "../src/tools/research-web.tool.js";
import type { CompositionResult } from "@anysearch-cli/kernel";
import type { FusedEnvelope } from "@anysearch-cli/retriever";
import type { SessionStore } from "@anysearch-cli/store";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

const fakeSpan = {
  traceId: "t", spanId: "s",
  addEvent: () => {}, setAttributes: () => {},
  startSpan: async (_o: any, cb: any) => cb(fakeSpan),
  finish: () => {},
};

function envelope(fields: { elapsed: Record<string, number>; cancelled?: string[]; url: string }): FusedEnvelope {
  return {
    results: [{ url: fields.url, title: "t", snippet: "s", source: "exa" }],
    answers: [],
    metadata: {
      providersQueried: ["exa", "tavily"],
      providersFailed: [],
      providersCancelled: fields.cancelled ?? [],
      providerElapsedMs: fields.elapsed,
      elapsedMs: 40,
      outcome: "answer",
    },
  };
}

function engineWith(search: () => Promise<FusedEnvelope>): CompositionResult {
  return {
    retriever: { search },
    store: {
      createSession: async () => ({ id: "s", domain: "mcp", createdAt: "" }),
      append: async () => {}, searchFts5: async () => [], searchMemory: async () => [],
      saveResults: async () => {}, saveAnchor: async () => {}, getAnchors: async () => [],
    } as unknown as SessionStore,
    observation: { recordOperation: async (_o: any, cb: any) => cb(fakeSpan) },
  } as unknown as CompositionResult;
}

function handlerOf(register: (server: any, eng: CompositionResult) => void, eng: CompositionResult): any {
  let handler: any = null;
  register({ registerTool: (_n: string, _c: unknown, h: any) => { handler = h; } } as any, eng);
  assert(handler !== null, register.name + " registered a handler");
  return handler;
}

async function main() {
  // search_web: the answered arm's own 37ms is what both halves carry; the arm
  // cut at the deadline is named but has no elapsed key.
  {
    const handler = handlerOf(registerSearchWeb, engineWith(async () =>
      envelope({ elapsed: { exa: 37 }, cancelled: ["tavily"], url: "https://example.com/a" })));
    const res = (await handler({ query: "q" })) as any;
    assert(res.isError !== true, "search_web: a partial pool is a success");
    assert(JSON.stringify(res.structuredContent?.providerElapsedMs) === JSON.stringify({ exa: 37 }),
      "search_web: structuredContent carries the answered arm's ms; got " + JSON.stringify(res.structuredContent?.providerElapsedMs));
    assert(!Object.hasOwn(res.structuredContent?.providerElapsedMs ?? {}, "tavily"),
      "search_web: the cut arm has no key");
    const doc = JSON.parse(res.content[0].text);
    assert(JSON.stringify(doc.providerElapsedMs) === JSON.stringify({ exa: 37 }),
      "search_web: the text half agrees; got " + JSON.stringify(doc.providerElapsedMs));
  }

  // research_web: round 1 answers with exa, round 2 answers with tavily and cuts
  // exa. The map is round 2's, so exa is gone even though it answered earlier.
  {
    const rounds = [
      envelope({ elapsed: { exa: 5 }, url: "https://example.com/1" }),
      envelope({ elapsed: { tavily: 12 }, cancelled: ["exa"], url: "https://example.com/2" }),
    ];
    let call = 0;
    const handler = handlerOf(registerResearchWeb, engineWith(async () =>
      rounds[Math.min(call++, rounds.length - 1)]));
    const res = (await handler({ question: "q", depth: "standard" })) as any;
    assert(res.isError !== true, "research_web: merged results are a success");
    const doc = JSON.parse(res.content[0].text);
    assert(doc.rounds === 2, "research_web: both rounds ran; got " + doc.rounds);
    assert(JSON.stringify(res.structuredContent?.providerElapsedMs) === JSON.stringify({ tavily: 12 }),
      "research_web: structuredContent is the last round's table; got " + JSON.stringify(res.structuredContent?.providerElapsedMs));
    assert(!Object.hasOwn(res.structuredContent?.providerElapsedMs ?? {}, "exa"),
      "research_web: an earlier round's arm does not ride into the last round's map");
    assert(JSON.stringify(doc.providerElapsedMs) === JSON.stringify({ tavily: 12 }),
      "research_web: the text half agrees; got " + JSON.stringify(doc.providerElapsedMs));
  }

  console.log("--- mcp providerElapsedMs contract tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
