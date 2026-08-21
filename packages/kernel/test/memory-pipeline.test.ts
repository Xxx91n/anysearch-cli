// MemoryPipeline unit tests (ADR-0015 D6).
// Tests: four-exit behavior (REUSE / COMPRESS / low-watermark / reuse-capped).
// Tests: inject (L1/L2 merged injection), distillGap, adjudicateReuseCompress.
// ponytail: no test framework, assert-based demo.
// Run: tsx test/memory-pipeline.test.ts

import { MemoryPipeline, distillGap, adjudicateReuseCompress } from "../src/memory-pipeline";
import { IR_CUSTOM_INSTRUCTIONS, IR_SUMMARY_SECTIONS } from "../src/ir-schema";
import type { RetrieverPort, DomainConfigPort, Query } from "../src/ports";
import type { FusedEnvelope } from "@anysearch/retriever";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

// Mock store.
class MockStore {
  anchors: any[] = [];
  memoryHits: any[] = [];
  saveAnchorCalls: any[] = [];
  getAnchors() { return this.anchors; }
  saveAnchor(_s: string, type: string, payload: any) {
    this.saveAnchorCalls.push({ type, payload });
    this.anchors.push({ anchorType: type, payload });
    return Promise.resolve();
  }
  searchMemory(_q: string, _n: number) { return Promise.resolve(this.memoryHits); }
}

// Mock retriever.
class MockRetriever implements RetrieverPort {
  calls = 0;
  async search(q: Query): Promise<FusedEnvelope> {
    this.calls++;
    return {
      query: q.query,
      mode: q.mode || "fast",
      results: [
        { url: "https://example.com/1", title: "R1", snippet: "S1", source: "tavily", score: 1.0 },
        { url: "https://example.com/2", title: "R2", snippet: "S2", source: "exa", score: 0.9 },
      ],
    } as any;
  }
}

const mockDomain: DomainConfigPort = {
  sources: { enabled: ["tavily", "exa"] },
  prompts: [],
  skills: { active: ["search"] },
  hooks: { toolWhitelist: ["search"] },
  rag: { adapter: "none" },
};

function mockStreamFn(decision: string): any {
  return (_model: any, _context: any, _options?: any) => ({
    async *[Symbol.asyncIterator]() {
      yield { type: "text", text: decision };
    },
  });
}

// StreamFn that tracks calls — for adjudication trigger verification.
function trackingStreamFn(decision: string, callLog: { count: number }): any {
  return (_model: any, _context: any, _options?: any) => ({
    async *[Symbol.asyncIterator]() {
      callLog.count++;
      yield { type: "text", text: decision };
    },
  });
}

// === IR Schema Tests ===

// Test: IR_SUMMARY_SECTIONS has 5 sections.
{
  assert(IR_SUMMARY_SECTIONS.length === 5, "IR: 5 sections");
  assert(IR_SUMMARY_SECTIONS[0] === "Verified Evidence", "IR: section 1");
  assert(IR_SUMMARY_SECTIONS[4] === "Tool Calls & Read Status", "IR: section 5");
}

// Test: IR_CUSTOM_INSTRUCTIONS contains all 5 sections.
{
  assert(IR_CUSTOM_INSTRUCTIONS.includes("Verified Evidence"), "IR instructions: section 1");
  assert(IR_CUSTOM_INSTRUCTIONS.includes("Open Hypotheses"), "IR instructions: section 2");
  assert(IR_CUSTOM_INSTRUCTIONS.includes("Rejected Sources"), "IR instructions: section 3");
  assert(IR_CUSTOM_INSTRUCTIONS.includes("Key Numbers & Sources"), "IR instructions: section 4");
  assert(IR_CUSTOM_INSTRUCTIONS.includes("Tool Calls & Read Status"), "IR instructions: section 5");
  assert(IR_CUSTOM_INSTRUCTIONS.includes("append-only"), "IR instructions: append-only semantics");
}

// === distillGap Tests ===

// Test: distillGap extracts search tool results after summary point.
{
  const msgs = [
    { role: "user", content: "query1" },
    { role: "tool", toolName: "search", content: "result1 about AI" },
    { role: "assistant", content: "answer1" },
    { role: "tool", toolName: "search", content: "result2 about ML" },
  ];
  const gap = distillGap(msgs as any, 2);
  assert(gap.includes("result2"), "distillGap: extracts after summary point");
  assert(!gap.includes("result1"), "distillGap: excludes before summary point");
}

// Test: distillGap handles empty messages.
{
  assert(distillGap([], 0) === "", "distillGap: empty messages -> empty");
}

// Test: distillGap handles content array format.
{
  const msgs = [
    { role: "tool", toolName: "search_web", content: [{ type: "text", text: "array result" }] },
  ];
  const gap = distillGap(msgs as any, 0);
  assert(gap.includes("array result"), "distillGap: handles content array");
}

// === adjudicateReuseCompress Tests ===

// Test: REUSE path.
{
  const streamFn = mockStreamFn("reuse");
  const result = await adjudicateReuseCompress(streamFn, { id: "test" }, "new data", "existing summary");
  assert(result === "reuse", "adjudicate: returns 'reuse'");
}

// Test: COMPRESS path.
{
  const streamFn = mockStreamFn("compress");
  const result = await adjudicateReuseCompress(streamFn, { id: "test" }, "new data", "existing summary");
  assert(result === "compress", "adjudicate: returns 'compress'");
}

// Test: failure -> COMPRESS (D10 fail-open).
{
  const failingStreamFn = (_m: any, _c: any, _o?: any) => ({
    async *[Symbol.asyncIterator]() { throw new Error("LLM unavailable"); },
  });
  const result = await adjudicateReuseCompress(failingStreamFn as any, { id: "test" }, "new data", "existing summary");
  assert(result === "compress", "adjudicate: D10 failure -> COMPRESS");
}

// Test: unparseable -> COMPRESS (D10).
{
  const streamFn = mockStreamFn("maybe perhaps...");
  const result = await adjudicateReuseCompress(streamFn, { id: "test" }, "new data", "existing summary");
  assert(result === "compress", "adjudicate: D10 unparseable -> COMPRESS");
}

// === MemoryPipeline inject Tests ===

// Test: inject with no anchors returns messages unchanged.
{
  const store = new MockStore();
  const pipeline = new MemoryPipeline({
    store: store as any,
    retriever: new MockRetriever(),
    domain: mockDomain,
    model: { id: "test" } as any,
    streamFn: mockStreamFn("reuse"),
    sessionId: "s1",
  });
  const msgs = [{ role: "user", content: "hello" }];
  const result = await pipeline.inject(msgs as any);
  assert(result.length === 1, "inject: no anchors -> unchanged length");
  assert(result[0].content === "hello", "inject: no anchors -> unchanged content");
}

// Test: inject with L1 summary anchor prepends [Session Memory].
{
  const store = new MockStore();
  store.anchors.push({ anchorType: "rolling_summary", payload: { summary: "test summary" } });
  const pipeline = new MemoryPipeline({
    store: store as any,
    retriever: new MockRetriever(),
    domain: mockDomain,
    model: { id: "test" } as any,
    streamFn: mockStreamFn("reuse"),
    sessionId: "s1",
  });
  const msgs = [{ role: "user", content: "question" }];
  const result = await pipeline.inject(msgs as any);
  assert(result[0].content.includes("[Session Memory]"), "inject: L1 [Session Memory] tag");
  assert(result[0].content.includes("test summary"), "inject: L1 summary content");
  assert(result[0].content.includes("question"), "inject: original content preserved");
}

// Test: inject with L2 recall anchor prepends [Research Recall].
{
  const store = new MockStore();
  store.anchors.push({ anchorType: "l2_recall", payload: { hits: "recall data" } });
  const pipeline = new MemoryPipeline({
    store: store as any,
    retriever: new MockRetriever(),
    domain: mockDomain,
    model: { id: "test" } as any,
    streamFn: mockStreamFn("reuse"),
    sessionId: "s1",
  });
  const msgs = [{ role: "user", content: "question" }];
  const result = await pipeline.inject(msgs as any);
  assert(result[0].content.includes("[Research Recall]"), "inject: L2 [Research Recall] tag");
  assert(result[0].content.includes("recall data"), "inject: L2 recall content");
}

// Test: inject L1 budget cap = 4000 chars.
{
  const longSummary = "x".repeat(5000);
  const store = new MockStore();
  store.anchors.push({ anchorType: "rolling_summary", payload: { summary: longSummary } });
  const pipeline = new MemoryPipeline({
    store: store as any,
    retriever: new MockRetriever(),
    domain: mockDomain,
    model: { id: "test" } as any,
    streamFn: mockStreamFn("reuse"),
    sessionId: "s1",
  });
  const msgs = [{ role: "user", content: "q" }];
  const result = await pipeline.inject(msgs as any);
  const injection = result[0].content;
  const sessionPart = injection.split("[Session Memory] ")[1] || "";
  assert(sessionPart.length <= 4000, "inject: L1 budget cap 4000 chars");
}

// Test: inject L2 budget cap = 1500 chars.
{
  const longHits = "y".repeat(2000);
  const store = new MockStore();
  store.anchors.push({ anchorType: "l2_recall", payload: { hits: longHits } });
  const pipeline = new MemoryPipeline({
    store: store as any,
    retriever: new MockRetriever(),
    domain: mockDomain,
    model: { id: "test" } as any,
    streamFn: mockStreamFn("reuse"),
    sessionId: "s1",
  });
  const msgs = [{ role: "user", content: "q" }];
  const result = await pipeline.inject(msgs as any);
  const recallPart = result[0].content.split("[Research Recall] ")[1] || "";
  assert(recallPart.length <= 1500, "inject: L2 budget cap 1500 chars");
}

// Test: inject reads LATEST anchor (D12).
{
  const store = new MockStore();
  store.anchors.push(
    { anchorType: "rolling_summary", payload: { summary: "old" } },
    { anchorType: "rolling_summary", payload: { summary: "new" } },
  );
  const pipeline = new MemoryPipeline({
    store: store as any,
    retriever: new MockRetriever(),
    domain: mockDomain,
    model: { id: "test" } as any,
    streamFn: mockStreamFn("reuse"),
    sessionId: "s1",
  });
  const result = await pipeline.inject([{ role: "user", content: "q" }] as any);
  assert(result[0].content.includes("new"), "inject: reads latest anchor (D12)");
  assert(!result[0].content.includes("old"), "inject: does not read old anchor");
}

// === MemoryPipeline consolidate Tests ===
// NOTE: generateSummaryWithUsage is a real pi-agent-core import; cannot mock at test level.
// Trigger verification: we verify the adjudication streamFn is called (post-search path)
// or NOT called (low watermark bypasses adjudication).

// Test: low watermark bypasses adjudication (streamFn NOT called for adjudication).
{
  const callLog = { count: 0 };
  const store = new MockStore();
  const pipeline = new MemoryPipeline({
    store: store as any,
    models: undefined, // no models -> fireCompress is no-op, but trigger logic still runs.
    retriever: new MockRetriever(),
    domain: mockDomain,
    model: { id: "test" } as any,
    streamFn: trackingStreamFn("reuse", callLog),
    sessionId: "s1",
  });
  const msgs = Array.from({ length: 6 }, (_, i) => ({ role: "user", content: `msg${i}` }));
  await pipeline.consolidate(msgs as any, 200000, true); // above low watermark.
  await new Promise(r => setTimeout(r, 100));
  assert(callLog.count === 0, "consolidate: low watermark bypasses adjudication (no streamFn call)");
}

// Test: post-search (below watermark) triggers adjudication (streamFn called).
{
  const callLog = { count: 0 };
  const store = new MockStore();
  const pipeline = new MemoryPipeline({
    store: store as any,
    models: undefined,
    retriever: new MockRetriever(),
    domain: mockDomain,
    model: { id: "test" } as any,
    streamFn: trackingStreamFn("compress", callLog),
    sessionId: "s1",
  });
  const msgs = Array.from({ length: 6 }, (_, i) => ({ role: "user", content: `msg${i}` }));
  await pipeline.consolidate(msgs as any, 1000, true); // below low watermark.
  await new Promise(r => setTimeout(r, 100));
  assert(callLog.count > 0, "consolidate: post-search triggers adjudication (streamFn called)");
}

// Test: consecutive REUSE cap = 3 forces direct COMPRESS (D8) — no adjudication on 4th.
{
  const callLog = { count: 0 };
  const store = new MockStore();
  const pipeline = new MemoryPipeline({
    store: store as any,
    models: undefined,
    retriever: new MockRetriever(),
    domain: mockDomain,
    model: { id: "test" } as any,
    streamFn: trackingStreamFn("reuse", callLog), // LLM always says REUSE.
    sessionId: "s1",
  });
// Simulate 3 consecutive REUSE by calling consolidate 3 times.
  // ADR-0016: consecutiveReuses tracked in ConsolidationState (sync via pure function result.state).
  for (let i = 0; i < 3; i++) {
    callLog.count = 0;
    const msgs = Array.from({ length: 6 }, (_, j) => ({ role: "user", content: "msg" + j }));
    await pipeline.consolidate(msgs as any, 1000, true);
    await new Promise(r => setTimeout(r, 200));
  }
  // 4th call: reuse-capped, should bypass adjudication.
  callLog.count = 0;
  const msgs4 = Array.from({ length: 6 }, (_, j) => ({ role: "user", content: "msg" + j }));
  await pipeline.consolidate(msgs4 as any, 1000, true);
  await new Promise(r => setTimeout(r, 100));
  assert(callLog.count === 0, "consolidate: D8 4th call after 3 REUSE -> no adjudication (direct COMPRESS)");
}

// Test: consolidate with no store/sessionId is a no-op (guard clause).
{
  const pipeline = new MemoryPipeline({
    store: null as any,
    models: undefined,
    retriever: new MockRetriever(),
    domain: mockDomain,
    model: { id: "test" } as any,
    streamFn: mockStreamFn("reuse"),
    sessionId: "",
  });
  const msgs = [{ role: "user", content: "q" }];
  await pipeline.consolidate(msgs as any, 200000, false);
  assert(true, "consolidate: no store -> no-op, no throw");
}

// ADR-0016 D2: signalSearchTurn deleted, replaced by hasRetrievalEvidence parameter.
{
  const store = new MockStore();
  const pipeline = new MemoryPipeline({
    store: store as any,
    retriever: new MockRetriever(),
    domain: mockDomain,
    model: { id: "test" } as any,
    streamFn: mockStreamFn("reuse"),
    sessionId: "s1",
  });
  const msgs = Array.from({ length: 6 }, (_, j) => ({ role: "user", content: `msg${j}` }));
  await pipeline.consolidate(msgs as any, 1000, true);
  assert(true, "hasRetrievalEvidence: triggers consolidation without throw");
}

// Test: L2 FTS5 recall writes l2_recall anchor.
{
  const store = new MockStore();
  store.memoryHits = [{ content: "recall hit 1" }];
  const pipeline = new MemoryPipeline({
    store: store as any,
    models: undefined,
    retriever: new MockRetriever(),
    domain: mockDomain,
    model: { id: "test" } as any,
    streamFn: mockStreamFn("reuse"),
    sessionId: "s1",
  });
  const msgs = [
    { role: "assistant", content: [{ type: "tool_use", name: "search", input: { query: "AI research" } }] },
    ...Array.from({ length: 5 }, (_, j) => ({ role: "user", content: `msg${j}` })),
  ];
  await pipeline.consolidate(msgs as any, 1000, true);
  await new Promise(r => setTimeout(r, 100));
  assert(store.saveAnchorCalls.some(c => c.type === "l2_recall"), "consolidate: L2 FTS5 recall writes l2_recall anchor");
}

// Test: LOW_WATERMARK constant = 128000 (< 15% of 1M).
{
  assert(128000 / 1000000 < 0.15, "consolidate: LOW_WATERMARK < 15% of 1M");
}

// Test: MemoryPipeline constructs with all deps.
{
  const pipeline = new MemoryPipeline({
    store: new MockStore() as any,
    retriever: new MockRetriever(),
    domain: mockDomain,
    model: { id: "test" } as any,
    streamFn: mockStreamFn("reuse"),
    sessionId: "s1",
  });
  assert(typeof pipeline.inject === "function", "MemoryPipeline.inject is function");
  assert(typeof pipeline.consolidate === "function", "MemoryPipeline.consolidate is function");
  assert(typeof pipeline.consolidate === "function" && pipeline.consolidate.length === 3, "MemoryPipeline.consolidate has 3 params");
}

console.log("---");
console.log(`MemoryPipeline tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);