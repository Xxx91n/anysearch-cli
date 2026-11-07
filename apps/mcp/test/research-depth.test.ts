// #205: research_web executes the round count its model-facing schema
// promises — brief = 1, standard = 2, deep = 3 — while a `correct`
// sufficiency verdict still stops the loop early.
// Seam: real registered tool handler, invoked in-process with a counting
// retriever (external behavior: how many search calls the engine sees).

import { registerResearchWeb } from "../src/tools/research-web.tool.js";
import type { CompositionResult, Query } from "@anysearch-cli/kernel";
import type { FusedEnvelope, SufficiencySignal } from "@anysearch-cli/retriever";
import type { SessionStore } from "@anysearch-cli/store";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

const fakeSpan = {
  traceId: "t", spanId: "s",
  addEvent: () => { }, setAttributes: () => { },
  startSpan: async (_o: any, cb: any) => cb(fakeSpan),
  finish: () => { },
};

function sufficiency(verdict: SufficiencySignal["verdict"]): SufficiencySignal {
  return {
    verdict,
    agreement: { jaccardAtK: 0, rboAtK: 0 },
    volume: { uniqueResults: 0, uniqueDomains: 0, successfulProviders: 1 },
    spread: { rrfVariance: 0 },
  };
}

// verdictFor receives the 1-based call index so a test can turn the verdict
// `correct` on a chosen round (early stop) or keep it non-correct throughout.
function makeEngine(verdictFor: (call: number) => SufficiencySignal["verdict"]) {
  let calls = 0;
  const retriever = {
    search: async (_q: Query): Promise<FusedEnvelope> => {
      calls++;
      return {
        results: [],
        answers: [],
        metadata: {
          providersQueried: ["exa"],
          providersFailed: [],
          providersCancelled: [],
          elapsedMs: 1,
          sufficiency: sufficiency(verdictFor(calls)),
        },
      };
    },
  };
  const store = {
    createSession: async () => ({ id: "s", domain: "mcp", createdAt: "" }),
    append: async () => { }, searchFts5: async () => [], searchMemory: async () => [],
    saveResults: async () => { }, saveAnchor: async () => { }, getAnchors: async () => [],
  } as unknown as SessionStore;
  const eng = {
    retriever,
    store,
    observation: { recordOperation: async (_o: any, cb: any) => cb(fakeSpan) },
  } as unknown as CompositionResult;
  return { eng, calls: () => calls };
}

async function runResearch(
  verdictFor: (call: number) => SufficiencySignal["verdict"],
  args: Record<string, unknown>,
) {
  const { eng, calls } = makeEngine(verdictFor);
  let handler: ((a: unknown) => Promise<unknown>) | null = null;
  const fakeServer = { registerTool: (_n: string, _c: unknown, h: any) => { handler = h; } };
  registerResearchWeb(fakeServer as any, eng);
  const res = (await handler!(args)) as any;
  return { calls: calls(), res, doc: JSON.parse(res.content[0].text) };
}

async function main() {
  // Non-correct verdict: the configured round count is executed exactly.
  const nonCorrect = () => "ambiguous" as const;

  const brief = await runResearch(nonCorrect, { question: "q", depth: "brief" });
  assert(brief.calls === 1, "brief executes 1 retrieval round (got " + brief.calls + ")");
  assert(brief.doc.rounds === 1, "brief reports rounds: 1 in the result text");
  assert(brief.doc.depth === "brief", "brief result echoes depth");

  const standard = await runResearch(nonCorrect, { question: "q", depth: "standard" });
  assert(standard.calls === 2, "standard executes 2 retrieval rounds (got " + standard.calls + ")");
  assert(standard.doc.rounds === 2, "standard reports rounds: 2 in the result text");

  const deep = await runResearch(nonCorrect, { question: "q", depth: "deep" });
  assert(deep.calls === 3, "deep executes 3 retrieval rounds (got " + deep.calls + ")");
  assert(deep.doc.rounds === 3, "deep reports rounds: 3 in the result text");

  // No depth argument keeps the documented default of deep.
  const omitted = await runResearch(nonCorrect, { question: "q" });
  assert(omitted.calls === 3, "omitted depth defaults to deep = 3 rounds (got " + omitted.calls + ")");

  // A correct verdict still stops before the configured count.
  const deepCorrectFirst = await runResearch((c) => (c === 1 ? "correct" : "ambiguous"), { question: "q", depth: "deep" });
  assert(deepCorrectFirst.calls === 1, "deep stops after round 1 when the verdict is correct (got " + deepCorrectFirst.calls + ")");
  assert(deepCorrectFirst.doc.rounds === 1, "early-stopped deep reports rounds: 1");

  const deepCorrectSecond = await runResearch((c) => (c === 2 ? "correct" : "ambiguous"), { question: "q", depth: "deep" });
  assert(deepCorrectSecond.calls === 2, "deep stops after round 2 when the verdict turns correct (got " + deepCorrectSecond.calls + ")");

  const standardCorrectFirst = await runResearch((c) => (c === 1 ? "correct" : "ambiguous"), { question: "q", depth: "standard" });
  assert(standardCorrectFirst.calls === 1, "standard stops after round 1 when the verdict is correct (got " + standardCorrectFirst.calls + ")");

  console.log("--- mcp research_web depth tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
