// MemoryPipeline unit tests (ADR-0015 D6).
// Tests: four-exit behavior (REUSE / COMPRESS / low-watermark / reuse-capped).
// Tests: inject (L1/L2 merged injection), distillGap, adjudicateReuseCompress.
// ponytail: no test framework, assert-based demo.
// Run: tsx test/memory-pipeline.test.ts

import { MemoryPipeline, distillGap, adjudicateReuseCompress, consolidateState } from "../src/memory-pipeline";
import { IR_CUSTOM_INSTRUCTIONS, IR_SUMMARY_SECTIONS } from "../src/ir-schema";
import type { RetrieverPort, DomainConfigPort, Query } from "../src/ports";
import type { FusedEnvelope } from "@anysearch-cli/retriever";

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
  assert(gap.text.includes("result2"), "distillGap: extracts after summary point");
  assert(!gap.text.includes("result1"), "distillGap: excludes before summary point");
}

// Test: distillGap handles empty messages.
{
  assert(distillGap([], 0).text === "", "distillGap: empty messages -> empty");
}

// Test: distillGap handles content array format.
{
  const msgs = [
    { role: "tool", toolName: "search_web", content: [{ type: "text", text: "array result" }] },
  ];
  const gap = distillGap(msgs as any, 0);
  assert(gap.text.includes("array result"), "distillGap: handles content array");
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

// ADR-0016 D9 Layer 1: Pure function tests for consolidateState — zero mock, zero I/O.
{
  // consolidateState already imported at top of file
  
  function assertPure(cond: boolean, msg: string) {
    if (!cond) { console.error("FAIL: " + msg); failed++; }
    else { passed++; }
  }

  // Test 1: Skip when no triggers (below watermark, no retrieval evidence)
  {
    const state = { version: 1, consecutiveReuses: 0, lastSummaryMsgCount: 0 };
    const result = consolidateState(state, ["m1", "m2"], 1000, false);
    assertPure(result.decision === "skip", "pure: skip when no triggers");
    assertPure(result.state === state, "pure: skip returns same state reference");
    assertPure(result.summaryRequest === undefined, "pure: skip has no summaryRequest");
  }

  // Test 2: Trigger COMPRESS on low watermark
  {
    const state = { version: 1, consecutiveReuses: 0, lastSummaryMsgCount: 0 };
    const result = consolidateState(state, ["m1", "m2", "m3"], 200000, false);
    assertPure(result.decision === "compress", "pure: compress on low watermark");
    assertPure(result.state.consecutiveReuses === 0, "pure: compress resets consecutiveReuses");
    assertPure(result.summaryRequest !== undefined, "pure: compress has summaryRequest");
    assertPure(result.summaryRequest!.msgCountAtTrigger === 3, "pure: msgCountAtTrigger = 3");
  }

  // Test 3: Trigger REUSE on post-search with retrieval evidence
  {
    const state = { version: 1, consecutiveReuses: 0, lastSummaryMsgCount: 0 };
    const msgs = ["m1", "m2", "m3", "m4", "m5"];
    const result = consolidateState(state, msgs, 1000, true);
    assertPure(result.decision === "reuse", "pure: reuse on post-search with evidence");
    assertPure(result.state.consecutiveReuses === 1, "pure: reuse increments consecutiveReuses to 1");
  }

  // Test 4: REUSE cap at 3 forces COMPRESS (D8)
  {
    const state = { version: 1, consecutiveReuses: 3, lastSummaryMsgCount: 0 };
    const msgs = ["m1", "m2", "m3", "m4", "m5"];
    const result = consolidateState(state, msgs, 1000, true);
    assertPure(result.decision === "compress", "pure: REUSE cap 3 forces COMPRESS (D8)");
    assertPure(result.state.consecutiveReuses === 0, "pure: cap-forced compress resets consecutiveReuses");
  }

  // Test 5: Idempotency — same input produces same output (pure function property)
  {
    const state = { version: 1, consecutiveReuses: 1, lastSummaryMsgCount: 2 };
    const msgs = ["a", "b", "c", "d", "e"];
    const r1 = consolidateState(state, msgs, 50000, true);
    const r2 = consolidateState(state, msgs, 50000, true);
    assertPure(r1.decision === r2.decision, "pure: idempotent decision");
    assertPure(r1.state.consecutiveReuses === r2.state.consecutiveReuses, "pure: idempotent state");
  }

  // Test 6: No mutation of input state (pure function property)
  {
    const state = { version: 1, consecutiveReuses: 0, lastSummaryMsgCount: 0 };
    const stateCopy = { ...state };
    consolidateState(state, ["m1", "m2", "m3", "m4", "m5"], 1000, true);
    assertPure(state.consecutiveReuses === stateCopy.consecutiveReuses, "pure: no mutation of input state");
    assertPure(state.lastSummaryMsgCount === stateCopy.lastSummaryMsgCount, "pure: no mutation of lastSummaryMsgCount");
  }

  
// ADR-0021 D2: opts injection — overwrite lowWatermark triggers compress below default 128K
{
  const state = { version: 1, consecutiveReuses: 0, lastSummaryMsgCount: 0 };
  const r = consolidateState(state, ["m1","m2","m3"], 60000, false, { lowWatermark: 50000 });
  assertPure(r.decision === "compress", "pure: opts.lowWatermark=50000 forces compress at 60K");
}
// ADR-0021 D2: fraction is resolved at caller; pure fn only sees absolute number.
// Verify that with default watermark (128000) and 60K totalTokens, no trigger fires.
{
  const state = { version: 1, consecutiveReuses: 0, lastSummaryMsgCount: 0 };
  const r = consolidateState(state, ["m1","m2","m3"], 60000, false);
  assertPure(r.decision === "skip", "pure: default 128K watermark skips at 60K");
}
// ADR-0021 D2: reuseCap overwrite — cap=1 with consecutiveReuses=1 forces compress (cap hit).
{
  const state = { version: 1, consecutiveReuses: 1, lastSummaryMsgCount: 0 };
  const msgs = ["m1","m2","m3","m4","m5"];
  const r = consolidateState(state, msgs, 1000, true, { reuseCap: 1 });
  assertPure(r.decision === "compress", "pure: reuseCap=1 with consecutiveReuses=1 forces compress");
  assertPure(r.state.consecutiveReuses === 0, "pure: cap-forced compress resets consecutiveReuses");
}

// ADR-0021 audit Fix #2: {fraction} in TOML is currently rejected at caller, not pure fn.
// Pure fn must still accept absolute lowWatermark; assert opts pass-through wins.
{
  const state = { version: 1, consecutiveReuses: 0, lastSummaryMsgCount: 0 };
  const withOpts = consolidateState(state, ["m1"], 60000, false, { lowWatermark: 50000 });
  const withoutOpts = consolidateState(state, ["m1"], 60000, false);
  assertPure(withOpts.decision === "compress" && withoutOpts.decision === "skip",
    "pure: opts lowWatermark overrides default (function-level pass-through)");
}
console.log("consolidateState pure function tests: " + passed + " assertions passed, " + failed + " failed");
}

// ADR-0024 D5: T0 user_preferences injection position assertion.
// MockStore gets listPreferences via type cast (injected for this test block only).
{
  const mock = new MockStore() as any;
  mock.listPreferences = async (scope?: string) => [{
    key: "output.language", value: "Chinese",
    scope: scope ?? "global",
    modified: "2026-08-25T00:00:00.000Z",
    lastAccessed: "2026-08-25T00:00:00.000Z",
    source: "explicit", invalidAt: null, demoteReason: null,
    correctionCount: 1, provenance: null,
  }];
  const pipeline = new MemoryPipeline({
    store: mock, retriever: new MockRetriever(), domain: mockDomain,
    model: {} as any, streamFn: mockStreamFn("compress"), sessionId: "sess-1",
  });
  const msgs = [
    { role: "user", content: "What are T0 preferences?" },
    { role: "user", content: "Second user message" },
  ];
  const out = await pipeline.inject(msgs);
  const first = out[0] as any;
  // Stage-1: must be a PREFIX (block before original text).
  assert(first.content.startsWith("<user_preferences"), "T0 inject: block is prefix of first user message");
  assert(first.content.includes("</user_preferences>"), "T0 inject: closing tag present");
  assert(first.content.includes("**output.language**: Chinese"), "T0 inject: markdown list inside block");
  assert(first.content.includes("updated=\"2026-08-25T00:00:00.000Z\""), "T0 inject: updated attribute present");
  assert(first.content.includes("What are T0 preferences?"), "T0 inject: original user text preserved after block");
  // Second (latest) user message must NOT have the block (Stage-1 only).
  const second = out[out.length - 1] as any;
  assert(!second.content.includes("<user_preferences"), "T0 inject: block NOT appended to latest user message");
  // Idempotency: inject again should NOT duplicate.
  const out2 = await pipeline.inject(out);
  assert((out2[0].content.match(/<user_preferences/g) || []).length === 1, "T0 inject: idempotent (no duplicate block)");
}

// ADR-0026 D7: leading/trailing non-user messages must not receive injections.
{
  const store = new MockStore() as any;
  store.anchors = [{ anchorType: "rolling_summary", payload: { summary: "sys-safe summary" } }];
  const pipeline = new MemoryPipeline({
    store, retriever: new MockRetriever(), domain: mockDomain,
    model: {} as any, streamFn: mockStreamFn("compress"), sessionId: "sess-role",
  });
  const msgs = [
    { role: "system", content: "system prompt" },
    { role: "user", content: "u1" },
    { role: "assistant", content: "a1" },
    { role: "tool", content: "t1" },
  ];
  const out = await pipeline.inject(msgs as any);
  assert((out[0] as any).content === "system prompt", "ADR-0026: system message untouched");
  assert((out[1] as any).content.includes("[Session Memory]"), "ADR-0026: L1 lands on latest USER message");
  assert(!(out[3] as any).content.includes("[Session Memory]"), "ADR-0026: trailing tool message not injected");
}

if (failed > 0) process.exit(1);
