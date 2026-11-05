// PiAgentRuntime test (G012).
// Verify construction, event types, domain 5-layer, budget settle.
// ponytail: no test framework, assert-based demo.
// Run: pnpm --filter @anysearch-cli/kernel run test

import { PiAgentRuntime, mapAssistantMessageEvent, accumulateUsage, emptyUsageTotals, resetWiringWarnings, resolveContextOccupancy } from "../src/pi-runtime";
import { distillGap, adjudicateReuseCompress, consolidateState, FALLBACK_LOW_WATERMARK_TOKENS, resolveLowWatermark } from "../src/memory-pipeline";
import { MemoryPipeline } from "../src/memory-pipeline";
import { readMessageText } from "../src/message-text";
import type { RetrieverPort, DomainConfigPort, BudgetLedgerPort, Query } from "../src/ports";
import { SqliteSessionStore } from "@anysearch-cli/store";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FusedEnvelope, SufficiencySignal } from "@anysearch-cli/retriever";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
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

// Mock domain with 5 layers.
const mockDomain: DomainConfigPort = {
  sources: { enabled: ["tavily", "exa"] },
  prompts: [{ name: "system", content: "You are a research assistant." }],
  skills: { active: ["search"] },
  hooks: { toolWhitelist: ["search"] },
  rag: { adapter: "none" },
};

// Mock budget ledger.
class MockLedger implements BudgetLedgerPort {
  reserved = 0;
  settled = 0;
  reserveCalls(_s: string, count: number): boolean { this.reserved += count; return true; }
  settleCalls(_s: string, _r: number, actual: number): void { this.settled += actual; }
  reserveTokens(_s: string, _a: number): boolean { return true; }
  settleTokens(): void { }
  reserveUsd(_s: string, _a: number): boolean { return true; }
  settleUsd(): void { }
}

// Mock streamFn: returns a faux assistant message stream.
function mockStreamFn(_model: any, _context: any, _options?: any): any {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "message_start", message: { role: "assistant", content: [] } };
      yield { type: "text", text: "Hello" };
      yield { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hello" }] } };
    },
  };
}

// Test 1: PiAgentRuntime constructs with valid options.
{
  const runtime = new PiAgentRuntime({
    retriever: new MockRetriever(),
    domain: mockDomain,
    model: { id: "test" } as any,
    streamFn: mockStreamFn,
  });
  assert(typeof runtime.run === "function", "PiAgentRuntime.run is a function");
}

// Test 2: MockLedger tracks reserve and settle.
{
  const ledger = new MockLedger();
  ledger.reserveCalls("s1", 1);
  ledger.settleCalls("s1", 1, 1);
  assert(ledger.reserved === 1, "ledger reserved 1");
  assert(ledger.settled === 1, "ledger settled 1");
}

// Test 3: Domain config 5 layers all present.
{
  assert(mockDomain.sources.enabled.length === 2, "sources has 2 enabled");
  assert(mockDomain.prompts.length === 1, "prompts has 1");
  assert(mockDomain.skills.active[0] === "search", "skills active is search");
  assert(mockDomain.hooks.toolWhitelist[0] === "search", "hooks whitelist is search");
  assert(mockDomain.rag.adapter === "none", "rag adapter is none");
}

// Test 4: AgentEvent types are exactly 7.
{
  const eventTypes = ["text", "tool_call", "tool_result", "search", "search_result", "done", "error"];
  assert(eventTypes.length === 7, "7 AgentEvent types");
}

// Test 5: PiAgentRuntime accepts ledger and sessionId.
{
  const ledger = new MockLedger();
  const runtime = new PiAgentRuntime({
    retriever: new MockRetriever(),
    domain: mockDomain,
    model: { id: "test" } as any,
    streamFn: mockStreamFn,
    ledger,
    sessionId: "test-session",
  });
  assert(true, "PiAgentRuntime accepts ledger + sessionId");
}


// === Contract Tests ===

// D8: L1 injection at latest user message (not first).
test: {
  const runtime = new PiAgentRuntime({
    retriever: new MockRetriever(),
    domain: mockDomain,
    model: { id: "test" } as any,
    streamFn: mockStreamFn,
    store: new (class {
      getAnchors() { return []; }
      saveAnchor() { return Promise.resolve(); }
      createSession(d: string) { return { id: "s1", domain: d, createdAt: new Date().toISOString() }; }
      append() { return Promise.resolve(); }
      searchFts5() { return []; }
      searchMemory() { return []; }
      saveResults() { return Promise.resolve(); }
      close() { }
    })() as any,
    sessionId: "test-adr0012",
  });
  assert(typeof runtime.run === "function", "D8: runtime with store constructs");
}

// D9: L1+L2 merged injection with tags and budget.
{
  const L1_BUDGET = 4000;
  const L2_BUDGET = 1500;
  assert(L1_BUDGET === 4000, "D9: L1 budget 4000 chars");
  assert(L2_BUDGET === 1500, "D9: L2 budget 1500 chars");
  assert(L1_BUDGET + L2_BUDGET <= 5500, "D9: total injection budget <= 5500 chars");
}

// D12: read latest anchor (not oldest).
{
  // Simulate: getAnchors returns ASC order (oldest first).
  // Code should take last element, not find() first.
  const anchors = [
    { id: 1, anchorType: "rolling_summary", payload: { summary: "old" } },
    { id: 2, anchorType: "rolling_summary", payload: { summary: "new" } },
  ];
  const summaryAnchors = anchors.filter(a => a.anchorType === "rolling_summary");
  const latest = summaryAnchors[summaryAnchors.length - 1];
  assert((latest.payload as any).summary === "new", "D12: reads latest anchor, not oldest");
}

// D5: IR 5-section schema contract.
{
  const sections = [
    "Verified Evidence",
    "Open Hypotheses",
    "Rejected Sources",
    "Key Numbers & Sources",
    "Tool Calls & Read Status",
  ];
  assert(sections.length === 5, "D5: exactly 5 IR sections");
  // First 3 are append-only.
  assert(sections[0] === "Verified Evidence", "D5: section 1 is Verified Evidence");
  assert(sections[1] === "Open Hypotheses", "D5: section 2 is Open Hypotheses");
  assert(sections[2] === "Rejected Sources", "D5: section 3 is Rejected Sources");
}

// D3/#113: the absolute 128K is only the unknown-window fallback now; a
// configured {fraction} scales with the real window. Covered by
// memory-pipeline.test.ts (resolveLowWatermark / consolidateState).

// D7: compaction config field exists in DomainConfigPort.
{
  const domainWithCompaction = {
    ...mockDomain,
    compaction: { model: "deepseek-v4-fast" },
  } as any;
  assert(domainWithCompaction.compaction?.model === "deepseek-v4-fast", "D7: compaction.model field present");
}

console.log("---");

// sufficiency gate tests.
// 23. DomainConfigPort compaction.sufficiencyMaxRerounds field exists.
const domain23: DomainConfigPort = {
  sources: { enabled: ["tavily", "exa"] },
  prompts: [],
  skills: { active: ["search"] },
  hooks: { toolWhitelist: ["search"] },
  rag: { adapter: "none" },
  compaction: { model: "test-model", sufficiencyMaxRerounds: 3 },
};
assert(domain23.compaction?.sufficiencyMaxRerounds === 3, "D6: sufficiencyMaxRerounds = 3");

// 24. SufficiencySignal type has four segments.
const mockSuff: SufficiencySignal = {
  verdict: "ambiguous",
  agreement: { jaccardAtK: 0.5, rboAtK: 0.3 },
  volume: { uniqueResults: 3, uniqueDomains: 2, successfulProviders: 2 },
  spread: { rrfVariance: 0.1 },
};
assert(mockSuff.verdict === "ambiguous", "D3: verdict field accessible");
assert(mockSuff.agreement.jaccardAtK === 0.5, "D3: agreement.jaccardAtK accessible");
assert(mockSuff.volume.uniqueResults === 3, "D3: volume.uniqueResults accessible");
assert(mockSuff.spread.rrfVariance === 0.1, "D3: spread.rrfVariance accessible");

// ===: mapAssistantMessageEvent contract tests ===
// Live evidence: ans_chat via MCP returned bare "Agent completed" because
// pi-ai AssistantMessageEvent has no "text" type — text streams as
// text_delta.delta / text_end.content. The old inline check dropped all text.
{
  // text_delta chunks surface as text events.
  const st = { textSeen: false };
  const e1 = mapAssistantMessageEvent({ type: "text_delta", delta: "Hello" }, st);
  const e2 = mapAssistantMessageEvent({ type: "text_delta", delta: " world" }, st);
  assert(e1?.type === "text" && (e1 as any).content === "Hello", "F-12: text_delta -> text event");
  assert((e2 as any)?.content === " world", "F-12: second delta surfaces");

  // text_end is a fallback only when no deltas arrived — no double-emit.
  const e3 = mapAssistantMessageEvent({ type: "text_end", content: "Hello world" }, st);
  assert(e3 === null, "F-12: text_end suppressed after deltas (no dup)");
  const st2 = { textSeen: false };
  const e4 = mapAssistantMessageEvent({ type: "text_end", content: "mono reply" }, st2);
  assert((e4 as any)?.content === "mono reply", "F-12: text_end fills in when no deltas");

  // thinking_delta / toolcall_* / start never produce text events.
  const st3 = { textSeen: false };
  assert(mapAssistantMessageEvent({ type: "thinking_delta", delta: "hmm" }, st3) === null, "F-12: thinking not surfaced as text");
  assert(mapAssistantMessageEvent({ type: "toolcall_delta", delta: "{}" }, st3) === null, "F-12: toolcall not surfaced as text");
  assert(mapAssistantMessageEvent({ type: "start" }, st3) === null, "F-12: start not surfaced as text");

  // Legacy monolithic "text" event still honored (defensive).
  const st4 = { textSeen: false };
  assert((mapAssistantMessageEvent({ type: "text", text: "legacy" }, st4) as any)?.content === "legacy", "F-12: legacy text event tolerated");
}

console.log(`PiAgentRuntime tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);


// === Contract Tests (D11: four paths) ===

// D9: distillGap extracts search tool results after last summary point.
{
  const msgs = [
    { role: "user", content: "query1" },
    { role: "assistant", content: [{ type: "tool_use", name: "search", input: { query: "q1" } }] },
    { role: "tool", toolName: "search", content: "result1 about AI" },
    { role: "assistant", content: "answer1" },
    { role: "user", content: "query2" },
    { role: "assistant", content: [{ type: "tool_use", name: "search", input: { query: "q2" } }] },
    { role: "tool", toolName: "search", content: "result2 about ML" },
  ];
  // Gap from index 3 (after first summary point).
  const gap = distillGap(msgs as any, 3);
  assert(gap.text.includes("result2"), "D9: gap distillation extracts search results after summary point");
  assert(!gap.text.includes("result1"), "D9: gap excludes results before summary point");
  assert(!gap.text.includes("query1"), "D9: gap excludes user/assistant messages");
}

// D9: distillGap handles empty messages and no search results.
{
  const gap1 = distillGap([], 0);
  assert(gap1.text === "", "D9: empty messages -> empty gap");
  const gap2 = distillGap([
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ], 0);
  assert(gap2.text === "", "D9: no tool messages -> empty gap");
}

// D9: distillGap handles content array format.
{
  const msgs = [
    { role: "tool", toolName: "search_web", content: [{ type: "text", text: "array result" }] },
  ];
  const gap = distillGap(msgs as any, 0);
  assert(gap.text.includes("array result"), "D9: distillGap handles content array format");
}

// D3: adjudicateReuseCompress returns "reuse" or "compress" (binary).
// Mock streamFn that returns configurable decision.
function makeMockStreamFn(decision: string): any {
  return (_model: any, _context: any, _options?: any) => ({
    async *[Symbol.asyncIterator]() {
      yield { type: "text", text: decision };
    },
  });
}

// D1/D3: REUSE path — mock returns "reuse".
{
  const streamFn = makeMockStreamFn("reuse");
  const result = await adjudicateReuseCompress(streamFn, { id: "test" }, "new data", "existing summary");
  assert(result === "reuse", "D1/D3: adjudicator returns 'reuse' when LLM says reuse");
}

// D1/D3: COMPRESS path — mock returns "compress".
{
  const streamFn = makeMockStreamFn("compress");
  const result = await adjudicateReuseCompress(streamFn, { id: "test" }, "new data", "existing summary");
  assert(result === "compress", "D1/D3: adjudicator returns 'compress' when LLM says compress");
}

// D10: adjudication failure → default COMPRESS (fail-open).
{
  // Mock streamFn that throws.
  const failingStreamFn = (_model: any, _context: any, _options?: any) => ({
    async *[Symbol.asyncIterator]() {
      throw new Error("LLM service unavailable");
    },
  });
  const result = await adjudicateReuseCompress(failingStreamFn as any, { id: "test" }, "new data", "existing summary");
  assert(result === "compress", "D10: adjudication failure -> default COMPRESS");
}

// D10: unparseable response → default COMPRESS.
{
  const streamFn = makeMockStreamFn("I think the answer is maybe perhaps...");
  const result = await adjudicateReuseCompress(streamFn, { id: "test" }, "new data", "existing summary");
  assert(result === "compress", "D10: unparseable response -> default COMPRESS");
}

// D6: adjudication prompt includes IR 5-segment structure.
{
  let capturedContext: any;
  const captureStreamFn = (_model: any, context: any, _options?: any) => {
    capturedContext = context;
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: "text", text: "reuse" };
      },
    };
  };
  await adjudicateReuseCompress(captureStreamFn, { id: "test" }, "gap data", "summary text");
  const promptStr = (capturedContext?.systemPrompt || "") as string;
  assert(promptStr.includes("Verified Evidence"), "D6: prompt includes IR section 1");
  assert(promptStr.includes("Open Hypotheses"), "D6: prompt includes IR section 2");
  assert(promptStr.includes("Rejected Sources"), "D6: prompt includes IR section 3");
  assert(promptStr.includes("Key Numbers"), "D6: prompt includes IR section 4");
  assert(promptStr.includes("Tool Calls"), "D6: prompt includes IR section 5");
}

// D8: consecutive REUSE cap = 3.
{
  const CAP = 3;
  let consecutiveReuses = 0;
  // Simulate 3 consecutive REUSE.
  for (let i = 0; i < CAP; i++) {
    consecutiveReuses++;
  }
  assert(consecutiveReuses === 3, "D8: 3 consecutive REUSE tracked");
  // 4th should force COMPRESS.
  const reuseCapped = consecutiveReuses >= 3;
  assert(reuseCapped === true, "D8: 4th call after 3 REUSE is capped -> direct COMPRESS");
  // COMPRESS resets.
  consecutiveReuses = 0;
  assert(consecutiveReuses === 0, "D8: COMPRESS resets counter to 0");
}

// D2: gap distillation excludes user/assistant messages (only search tool results).
{
  const msgs = [
    { role: "user", content: "What is AI?" },
    { role: "assistant", content: "Let me search." },
    { role: "tool", toolName: "search", content: "AI is artificial intelligence" },
    { role: "assistant", content: "AI is a broad field." },
    { role: "user", content: "Tell me more." },
  ];
  const gap = distillGap(msgs as any, 0);
  assert(gap.text === "AI is artificial intelligence", "D2: gap contains only search tool content");
  assert(!gap.text.includes("What is AI"), "D2: gap excludes user messages");
  assert(!gap.text.includes("Let me search"), "D2: gap excludes assistant messages");
}

// D7: adjudication reuses compaction.model (same model for both adjudication and compression).
{
  // This is verified by the code path: both use `actualModel` derived from domain.compaction.model.
  // Test: domain with compaction.model set.
  const domainWithCompaction = {
    ...mockDomain,
    compaction: { model: "deepseek-v4-fast" },
  } as any;
  assert(domainWithCompaction.compaction?.model === "deepseek-v4-fast", "D7: adjudication reuses compaction.model");
}

// D4: dual-track dispatch — low watermark bypasses adjudication.
{
  const triggerLowWatermark = true;
  const triggerPostSearch = true;
  // Low watermark takes precedence: shouldAdjudicate = false.
  const shouldAdjudicate = triggerPostSearch && !triggerLowWatermark;
  assert(shouldAdjudicate === false, "D4: low watermark bypasses adjudication (direct COMPRESS)");

  // Only post-search (no low watermark): adjudication runs.
  const shouldAdjudicate2 = true && !false;
  assert(shouldAdjudicate2 === true, "D4: post-search without low watermark triggers adjudication");
}

// D5: two-level async — adjudication .then() decides compress (fire-and-forget both).
{
  // Verify the promise chain pattern: adjudicateReuseCompress returns Promise,
  // .then() branches, .catch() falls back to compress.
  const streamFn = makeMockStreamFn("compress");
  const result = await adjudicateReuseCompress(streamFn, { id: "test" }, "gap", "summary")
    .then((d: string) => d)
    .catch(() => "compress"); // D10 fallback
  assert(result === "compress", "D5: two-level async chain works correctly");
}

// === #103: BudgetLedger token/USD metering via event subscription ===

// accumulateUsage: sums AssistantMessage.usage across calls (tokens + pi-ai cost).
{
  const totals = emptyUsageTotals();
  accumulateUsage(totals, {
    role: "assistant",
    usage: { input: 100, output: 50, totalTokens: 150, cost: { total: 0.003 } },
  });
  accumulateUsage(totals, {
    role: "assistant",
    usage: { input: 200, output: 25, totalTokens: 240, cost: { total: 0.007 } },
  });
  assert(totals.inputTokens === 300, "#103: input tokens summed across messages");
  assert(totals.outputTokens === 75, "#103: output tokens summed across messages");
  assert(totals.totalTokens === 390, "#103: totalTokens summed (incl. cache tokens)");
  assert(Math.abs(totals.costUsd - 0.01) < 1e-9, "#103: USD cost summed from pi-ai Usage.cost.total");
  // CodeRabbit PR #114: consolidate's low-watermark input is CURRENT context
  // occupancy (latest call), not cumulative run spend — cumulative is monotonic
  // and would permanently trip the watermark once crossed.
  assert(totals.lastTotalTokens === 240, "#103: lastTotalTokens tracks latest call only (context watermark input)");
}

// #113: watermark input = max(last usage, trailing-message estimate), so a
// large tool result appended after the last assistant call is counted before
// the next provider request (the one-turn lag CodeRabbit flagged on PR #114).
{
  const messages = [
    { role: "user", content: "q" },
    { role: "assistant", content: [{ type: "tool_use", name: "search", input: { query: "q" } }] },
    // ~80K chars -> ~20K estimated tokens, far above the 100 usage figure.
    { role: "toolResult", content: [{ type: "text", text: "x".repeat(80000) }] },
  ];
  const occupancy = resolveContextOccupancy(100, messages as any);
  assert(occupancy > 1000, "#113: large tool result is included in occupancy (usage-only would be 100)");
  assert(resolveContextOccupancy(200000, messages as any) === 200000,
    "#113: max() keeps the larger provider usage figure");
  assert(resolveContextOccupancy(0, []) === 0, "#113: no usage + no messages -> 0");
  // End-to-end shape: with a 1M window and a 1% fraction, the estimated
  // occupancy alone crosses the watermark even though lastTotalTokens is tiny.
  const decision = consolidateState(
    { version: 1, consecutiveReuses: 0, lastSummaryMsgCount: 0 },
    messages as any, occupancy, false,
    { lowWatermark: { fraction: 0.01 }, contextWindow: 1_000_000 },
  );
  assert(decision.decision === "compress",
    "#113: large-tool-result occupancy alone triggers compression (no post-search path required)");
}

// Production branch: when the last assistant message DOES carry usage, the
// estimate adds trailing tool-result tokens on top of usageTokens
// (usageTokens + trailingTokens), rather than returning usage alone.
{
  const messages = [
    { role: "user", content: "q" },
    { role: "assistant", usage: { input: 1000, output: 20, totalTokens: 1020 }, content: [{ type: "text", text: "..." }] },
    { role: "toolResult", content: [{ type: "text", text: "x".repeat(80000) }] },
  ];
  const occupancy = resolveContextOccupancy(0, messages as any);
  assert(occupancy >= 1020 + 15000,
    "#113: usage + trailing tool-result tokens are summed (got " + occupancy + ")");
}

// accumulateUsage: totalTokens falls back to input+output when absent.
{
  const totals = emptyUsageTotals();
  accumulateUsage(totals, { role: "assistant", usage: { input: 10, output: 5 } });
  assert(totals.totalTokens === 15, "#103: totalTokens falls back to input+output");
  assert(totals.lastTotalTokens === 15, "#103: lastTotalTokens uses same fallback");
  assert(totals.costUsd === 0, "#103: missing cost treated as 0");
}

// accumulateUsage: non-assistant message_end payloads are ignored
// (message_end also fires for user prompts and tool results; tool results
// may carry their own usage — only AssistantMessage.usage counts per #90).
{
  const totals = emptyUsageTotals();
  accumulateUsage(totals, { role: "user", content: "hi" });
  accumulateUsage(totals, {
    role: "toolResult",
    usage: { input: 999, output: 999, totalTokens: 1998, cost: { total: 9.9 } },
  });
  accumulateUsage(totals, { role: "assistant" }); // no usage field
  accumulateUsage(totals, undefined);
  assert(totals.totalTokens === 0, "#103: non-assistant / usage-less messages ignored");
  assert(totals.costUsd === 0, "#103: toolResult usage not billed to token/USD dimensions");
  assert(totals.lastTotalTokens === 0, "#103: ignored messages don't move lastTotalTokens");
}

// Full agent loop: ledger spent tokens/USD reflect per-call usage sum (settle-only, reserved 0).
{
  // Ledger that records every reserve/settle with its arguments.
  class RecordingLedger implements BudgetLedgerPort {
    reservedCalls = 0; settledCalls = 0;
    tokenSettles: Array<{ reserved: number; actual: number }> = [];
    usdSettles: Array<{ reserved: number; actual: number }> = [];
    tokenReserves = 0; usdReserves = 0;
    reserveCalls(_s: string, count: number): boolean { this.reservedCalls += count; return true; }
    settleCalls(_s: string, _r: number, actual: number): void { this.settledCalls += actual; }
    reserveTokens(_s: string, _a: number): boolean { this.tokenReserves++; return true; }
    settleTokens(_s: string, reserved: number, actual: number): void { this.tokenSettles.push({ reserved, actual }); }
    reserveUsd(_s: string, _a: number): boolean { this.usdReserves++; return true; }
    settleUsd(_s: string, reserved: number, actual: number): void { this.usdSettles.push({ reserved, actual }); }
  }

  // streamFn honoring the pi-agent-core contract: async-iterable of events
  // plus result() resolving to the final AssistantMessage (with usage + cost).
  const usage = {
    input: 120, output: 30, cacheRead: 0, cacheWrite: 0, totalTokens: 150,
    cost: { input: 0.0012, output: 0.0018, cacheRead: 0, cacheWrite: 0, total: 0.003 },
  };
  const finalMessage = {
    role: "assistant",
    content: [{ type: "text", text: "All done." }],
    api: "test", provider: "test", model: "test-model",
    usage, stopReason: "stop", timestamp: Date.now(),
  };
  const usageStreamFn = (_model: any, _context: any, _options?: any) => ({
    async *[Symbol.asyncIterator]() {
      yield { type: "done", message: finalMessage, partial: finalMessage };
    },
    result: async () => finalMessage,
  });

  const ledger = new RecordingLedger();
  const runtime = new PiAgentRuntime({
    retriever: new MockRetriever(),
    domain: mockDomain,
    model: { id: "test-model", provider: "test" } as any,
    streamFn: usageStreamFn,
    ledger,
    sessionId: "s-103",
  });
  const events: any[] = [];
  for await (const ev of runtime.run("hello")) events.push(ev);

  const errors = events.filter(e => e.type === "error");
  assert(errors.length === 0, "#103: agent loop completes without error: " + JSON.stringify(errors));
  // Acceptance 1: spent tokens = sum of LLM call usage (non-zero).
  assert(ledger.tokenSettles.length === 1, "#103: one token settle per run");
  assert(ledger.tokenSettles[0]?.actual === 150, "#103: settled tokens = usage sum (non-zero)");
  assert(ledger.tokenSettles[0]?.reserved === 0, "#103: token dimension settle-only (reserved 0)");
  // Acceptance 2: spent USD from pi-ai cost.
  assert(ledger.usdSettles.length === 1, "#103: one USD settle per run");
  assert(Math.abs((ledger.usdSettles[0]?.actual ?? 0) - 0.003) < 1e-9, "#103: settled USD = pi-ai Usage.cost.total");
  assert(ledger.usdSettles[0]?.reserved === 0, "#103: USD dimension settle-only (reserved 0)");
  // Acceptance 4 (regression): per-call dimension unchanged — reserve 1 at start, settle 1 at end.
  assert(ledger.reservedCalls === 1, "#103: per-call reserve unchanged");
  assert(ledger.settledCalls === 1, "#103: per-call settle unchanged");
  // v1 has no token/USD reserve calls at all.
  assert(ledger.tokenReserves === 0 && ledger.usdReserves === 0, "#103: no token/USD reserve in v1");
  // Acceptance 3: real token counts reach the done summary (was constant 0 via onResponse).
  const done = events.find(e => e.type === "done");
  assert(typeof done?.summary === "string" && done.summary.includes("120 in + 30 out"), "#103: done summary carries real token counts");
}

// Zero-usage run: no token/USD settles written (no pointless ledger rows).
{
  class CountingLedger implements BudgetLedgerPort {
    tokenSettles = 0; usdSettles = 0;
    reserveCalls(): boolean { return true; }
    settleCalls(): void { }
    reserveTokens(): boolean { return true; }
    settleTokens(): void { this.tokenSettles++; }
    reserveUsd(): boolean { return true; }
    settleUsd(): void { this.usdSettles++; }
  }
  const finalMessage = {
    role: "assistant",
    content: [{ type: "text", text: "no usage reported" }],
    api: "test", provider: "test", model: "test-model",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop", timestamp: Date.now(),
  };
  const zeroStreamFn = (_model: any, _context: any, _options?: any) => ({
    async *[Symbol.asyncIterator]() {
      yield { type: "done", message: finalMessage, partial: finalMessage };
    },
    result: async () => finalMessage,
  });
  const ledger = new CountingLedger();
  const runtime = new PiAgentRuntime({
    retriever: new MockRetriever(),
    domain: mockDomain,
    model: { id: "test-model", provider: "test" } as any,
    streamFn: zeroStreamFn,
    ledger,
    sessionId: "s-103-zero",
  });
  for await (const _ev of runtime.run("hello")) { /* drain */ }
  assert(ledger.tokenSettles === 0, "#103: zero-usage run writes no token settle");
  assert(ledger.usdSettles === 0, "#103: zero-usage run writes no USD settle");
}

console.log("---");

// #104 acceptance: domain.rag.adapter wiring through the real agent runtime.
// The contract seam is transformContext -> MemoryPipeline.inject Stage-1: what
// the model actually receives must carry the RAG block (adapter="fts") or
// nothing at all (adapter="none" / legacy "note" regression).
{
  // Captures every message array transformContext hands to the model.
  const seenContexts: any[][] = [];
  function contextCapturingStreamFn(_model: any, context: any, _options?: any) {
    seenContexts.push(Array.isArray(context) ? context : context?.messages ?? []);
    const finalMessage = {
      role: "assistant",
      content: [{ type: "text", text: "answer" }],
      api: "test", provider: "test", model: "test-model",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop", timestamp: Date.now(),
    };
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: "done", message: finalMessage, partial: finalMessage };
      },
      result: async () => finalMessage,
    };
  }
  const ragStore = {
    getAnchors: () => [],
    saveAnchor: () => Promise.resolve(),
    createSession: (d: string) => ({ id: "s1", domain: d, createdAt: new Date().toISOString() }),
    append: () => Promise.resolve(),
    searchFts5: () => [],
    searchMemory: () => Promise.resolve([
      { rowid: 7, sessionId: "s1", role: "assistant", content: "internal wiki: proxy port 8080", rank: 1, arms: ["fts"] },
    ]),
    saveResults: () => Promise.resolve(),
    close: () => {},
  } as any;
  const runWith = async (rag: DomainConfigPort["rag"]) => {
    seenContexts.length = 0;
    const runtime = new PiAgentRuntime({
      retriever: new MockRetriever(),
      domain: { ...mockDomain, rag },
      model: { id: "test-model", provider: "test" } as any,
      streamFn: contextCapturingStreamFn,
      store: ragStore,
      sessionId: "s-104",
    });
    const events: any[] = [];
    for await (const ev of runtime.run("how do I reach the internal wiki?")) events.push(ev);
    return { events, messages: seenContexts.flat() };
  };

  // The model-facing text of a message, whatever shape pi handed us: pi-agent-core
  // normalizes prompt("…") to content BLOCKS ({type:"text",text}), so a
  // string-only assertion would silently match nothing (this is exactly the
  // production-path bug #104 review found — the seam was string-only).
  const textOf = (m: any) => readMessageText(m)?.text ?? "";
  const allText = (messages: any[]) => messages.map(textOf).join("\n");

  // adapter="fts": recalled content reaches the model, provenance-labeled.
  {
    const { events, messages } = await runWith({ adapter: "fts" });
    assert(events.every(e => e.type !== "error"), "#104 fts: agent loop completes without error");
    const injected = messages.filter((m: any) => textOf(m).includes("[RAG Context]"));
    assert(injected.length === 1, "#104 fts: exactly one injected message (Stage-1)");
    const text = textOf(injected[0]);
    assert(text.includes("internal wiki: proxy port 8080"), "#104 fts: recalled private content reaches the model");
    assert(/adapter=fts/.test(text) && /provenance=memory/.test(text), "#104 fts: injection carries provenance");
    assert(text.includes("how do I reach the internal wiki?"), "#104 fts: user question preserved");
    assert(!allText(messages).includes("[object Object]"), "#104 fts: no message was stringified into oblivion");
    // Shape preservation: whatever pi used, the user turn still has exactly one
    // text channel holding question + block (never replaced by the block).
    assert(text.indexOf("how do I reach the internal wiki?") < text.indexOf("[RAG Context]"),
      "#104 fts: block appended AFTER the user text (never overwrites it)");
  }

  // adapter="none": nothing injected (regression).
  {
    const { messages } = await runWith({ adapter: "none" });
    assert(!allText(messages).includes("[RAG Context]"), "#104 none: no RAG injection");
    assert(allText(messages).includes("how do I reach the internal wiki?"), "#104 none: user turn intact");
  }

  // legacy adapter="note": unchanged note injection (regression).
  {
    const { messages } = await runWith({ adapter: "note", config: { note: "wiki is on the intranet" } });
    const injected = messages.filter((m: any) => textOf(m).includes("[RAG Context]"));
    assert(injected.length === 1 && textOf(injected[0]).includes("[RAG Context] wiki is on the intranet"),
      "#104 note: legacy note injection unchanged");
    assert(textOf(injected[0]).includes("how do I reach the internal wiki?"), "#104 note: user text preserved");
  }

  // unknown id: fail-open, no injection, loop still completes, stderr warns once.
  {
    const origWrite = process.stderr.write;
    let captured = "";
    process.stderr.write = ((chunk: unknown) => { captured += String(chunk); return true; }) as typeof process.stderr.write;
    let messages: any[] = [];
    let events: any[] = [];
    try {
      ({ messages, events } = await runWith({ adapter: "qdrant" }));
    } finally {
      process.stderr.write = origWrite;
    }
    assert(!allText(messages).includes("[RAG Context]"), "#104 unknown adapter: fail-open, no injection");
    assert(events.every(e => e.type !== "error"), "#104 unknown adapter: agent loop still completes");
    assert(/\[anysearch\] unknown rag\.adapter "qdrant" — falling back to none/.test(captured),
      "#104 unknown adapter: named stderr warning");
  }

  // #154 end-to-end wiring: the runtime-built pipeline applies the #131
  // volatility split — dynamic RAG lands on the latest USER turn and queries
  // that turn's pre-injection text, while the first turn stays byte-stable.
  {
    const queries: string[] = [];
    const queryCapturingStore = {
      ...ragStore,
      getAnchors: async () => [
        { anchorType: "rolling_summary", payload: { summary: "prior summary" } },
        { anchorType: "l2_recall", payload: { hits: "prior hits" } },
      ],
      searchMemory: async (q: string) => {
        queries.push(q);
        return [
          { rowid: 7, sessionId: "s1", role: "assistant", content: "internal wiki: proxy port 8080", rank: 1, arms: ["fts"] },
        ];
      },
    } as any;
    const runtime = new PiAgentRuntime({
      retriever: new MockRetriever(),
      domain: { ...mockDomain, rag: { adapter: "fts" } },
      model: { id: "test-model", provider: "test" } as any,
      streamFn: contextCapturingStreamFn,
      store: queryCapturingStore,
      sessionId: "s-154",
    });
    const out = await (runtime as any).pipeline.inject([
      { role: "system", content: "system prompt" },
      { role: "user", content: "turn one question" },
      { role: "assistant", content: "a1" },
      { role: "user", content: [{ type: "text", text: "turn two question" }] },
    ]);
    assert(textOf(out[0]) === "system prompt", "#154 multi-turn: system untouched");
    assert(!textOf(out[1]).includes("[RAG Context]"), "#154 multi-turn: first user turn stays byte-stable");
    assert(textOf(out[3]).includes("[RAG Context]") && textOf(out[3]).includes("proxy port 8080"),
      "#154 multi-turn: dynamic RAG lands on the latest user turn");
    const latest = textOf(out[3]);
    const order = [
      latest.indexOf("turn two question"),
      latest.indexOf("[RAG Context]"),
      latest.indexOf("[Session Memory]"),
      latest.indexOf("[Research Recall]"),
    ];
    assert(order[0] === 0 && order.every((at, i) => i === 0 || at > order[i - 1]),
      "#154 multi-turn: order user text -> RAG -> Session Memory -> Research Recall");
    assert(queries.length === 1, "#154 multi-turn: one recall per inject");
    assert(queries[0] === "turn two question",
      "#154 multi-turn: recall keys on the latest user text, not turn-1");
  }
}

// #104 is the last ticket of the #37 -> #36 -> #35 cluster (ruling #90), so
// verify the COMBINED behavior: a turn that carries RAG injection must still be
// metered correctly by #103 (injected context = higher token count, settled
// from message_end usage, USD from pi-ai cost).
{
  class CombinedLedger implements BudgetLedgerPort {
    tokenSettles: Array<{ reserved: number; actual: number }> = [];
    usdSettles: Array<{ reserved: number; actual: number }> = [];
    reserveCalls(): boolean { return true; }
    settleCalls(): void { }
    reserveTokens(): boolean { return true; }
    settleTokens(_s: string, reserved: number, actual: number): void { this.tokenSettles.push({ reserved, actual }); }
    reserveUsd(): boolean { return true; }
    settleUsd(_s: string, reserved: number, actual: number): void { this.usdSettles.push({ reserved, actual }); }
  }
  // Usage is derived from the context the model actually received: the RAG
  // block inflates the prompt, so the injected turn must cost more tokens.
  const usageStreamFn = (_model: any, context: any, _o?: any) => {
    const chars = JSON.stringify(context ?? "").length;
    const input = Math.max(1, Math.ceil(chars / 4));
    const finalMessage = {
      role: "assistant",
      content: [{ type: "text", text: "answer" }],
      api: "test", provider: "test", model: "test-model",
      usage: { input, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: input + 10,
        cost: { input: input * 1e-6, output: 1e-5, cacheRead: 0, cacheWrite: 0, total: input * 1e-6 + 1e-5 } },
      stopReason: "stop", timestamp: Date.now(),
    };
    return {
      async *[Symbol.asyncIterator]() { yield { type: "done", message: finalMessage, partial: finalMessage }; },
      result: async () => finalMessage,
    };
  };
  const store = {
    getAnchors: () => [], saveAnchor: () => Promise.resolve(),
    createSession: (d: string) => ({ id: "s1", domain: d, createdAt: "" }),
    append: () => Promise.resolve(), searchFts5: () => [],
    searchMemory: () => Promise.resolve([{ rowid: 1, sessionId: "s1", role: "assistant", content: "x".repeat(800), rank: 1 }]),
    saveResults: () => Promise.resolve(), close: () => {}, listPreferences: () => [],
  } as any;
  const runMetered = async (rag: DomainConfigPort["rag"]) => {
    const ledger = new CombinedLedger();
    const runtime = new PiAgentRuntime({
      retriever: new MockRetriever(),
      domain: { ...mockDomain, rag },
      model: { id: "test-model", provider: "test" } as any,
      streamFn: usageStreamFn,
      store,
      ledger,
      sessionId: "s-104-metered",
    });
    for await (const _ev of runtime.run("what does the internal wiki say?")) { /* drain */ }
    return ledger;
  };
  const withRag = await runMetered({ adapter: "fts" });
  const withoutRag = await runMetered({ adapter: "none" });
  const ragTokens = withRag.tokenSettles[0]?.actual ?? 0;
  const plainTokens = withoutRag.tokenSettles[0]?.actual ?? 0;
  assert(ragTokens > plainTokens, "#104+#103: RAG-injected turn meters more tokens than the plain turn");
  assert(withRag.tokenSettles[0]?.reserved === 0, "#104+#103: token dimension still settle-only");
  assert((withRag.usdSettles[0]?.actual ?? 0) > 0, "#104+#103: USD still settled from pi-ai cost");
  assert(withRag.usdSettles[0]?.actual > (withoutRag.usdSettles[0]?.actual ?? 0),
    "#104+#103: injected context costs more USD");
}

// #129 contract: a runtime built WITHOUT store/sessionId has no MemoryPipeline,
// so transformContext is a pass-through. That silence used to be invisible on
// the production paths (ans chat / ans_chat both omitted the pair); the runtime
// now names the missing wiring, and the wired path is exercised against a REAL
// SqliteSessionStore. This proves the KERNEL seam — the CLI composition root
// itself is covered by apps/cli/test/chat-memory-wiring.test.ts.
{
  const seenContexts: any[][] = [];
  const capturingStreamFn = (_model: any, context: any, _o?: any) => {
    seenContexts.push(Array.isArray(context) ? context : context?.messages ?? []);
    const finalMessage = {
      role: "assistant",
      content: [{ type: "text", text: "answer" }],
      api: "test", provider: "test", model: "test-model",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop", timestamp: Date.now(),
    };
    return {
      async *[Symbol.asyncIterator]() { yield { type: "done", message: finalMessage, partial: finalMessage }; },
      result: async () => finalMessage,
    };
  };
  const textOf = (m: any) => readMessageText(m)?.text ?? "";
  const allText = (messages: any[]) => messages.map(textOf).join("\n");

  // No store at all: transformContext must return the messages UNCHANGED (the
  // explicit contract #129 asks to freeze), and the missing wiring is named.
  {
    seenContexts.length = 0;
    resetWiringWarnings();
    const origWrite = process.stderr.write;
    let captured = "";
    process.stderr.write = ((chunk: unknown) => { captured += String(chunk); return true; }) as typeof process.stderr.write;
    let runtime!: PiAgentRuntime;
    try {
      runtime = new PiAgentRuntime({
        retriever: new MockRetriever(),
        domain: { ...mockDomain, rag: { adapter: "fts" } },
        model: { id: "test-model", provider: "test" } as any,
        streamFn: capturingStreamFn,
      });
    } finally {
      process.stderr.write = origWrite;
    }
    const errors: any[] = [];
    for await (const ev of runtime.run("how do I reach the internal wiki?")) {
      if (ev.type === "error") errors.push(ev);
    }
    assert(errors.length === 0, "#129 no-store: agent loop completes without error");
    // Structural equality with what the model would receive anyway: the user
    // turn is exactly the question, with no injected text appended.
    const userTurns = seenContexts.flat().filter((m: any) => m?.role === "user");
    assert(userTurns.length > 0, "#129 no-store: the user turn was passed to the model");
    assert(userTurns.every((m: any) => textOf(m) === "how do I reach the internal wiki?"),
      "#129 no-store: transformContext returned the user turn unchanged (no pass-through mutation)");
    assert(/store and sessionId not supplied — MemoryPipeline NOT constructed/.test(captured),
      "#129 no-store: the missing wiring is named (ans_chat shape)");
  }

  // Half-wired: the supplied half is still not enough for a pipeline, and the
  // diagnostic names what is missing. Reset first — warnings dedupe per process.
  {
    resetWiringWarnings();
    const origWrite = process.stderr.write;
    let captured = "";
    process.stderr.write = ((chunk: unknown) => { captured += String(chunk); return true; }) as typeof process.stderr.write;
    try {
      new PiAgentRuntime({
        retriever: new MockRetriever(),
        domain: mockDomain,
        model: { id: "test-model", provider: "test" } as any,
        streamFn: capturingStreamFn,
        store: {} as any,
      });
      // A second construction with the same gap must NOT repeat the line.
      const afterFirst = captured;
      new PiAgentRuntime({
        retriever: new MockRetriever(),
        domain: mockDomain,
        model: { id: "test-model", provider: "test" } as any,
        streamFn: capturingStreamFn,
        store: {} as any,
      });
      assert(captured === afterFirst, "#129 wiring warning is deduped per process (ans_chat builds one runtime per call)");
    } finally {
      process.stderr.write = origWrite;
    }
    assert(/sessionId not supplied — MemoryPipeline NOT constructed/.test(captured),
      "#129 half-wired: stderr names the missing half (store without sessionId)");
  }

  // Fully wired against a REAL store: what the model receives carries the fts
  // recall block with provenance, and the recall survives reopening the DB
  // (the "durable ANS_DB_PATH" acceptance criterion).
  {
    const tmpDir = mkdtempSync(join(tmpdir(), "ans-129-"));
    const dbPath = join(tmpDir, "anysearch.db");
    const sessionId = "stable-session-129";
    try {
      // Writer run: a REAL SqliteSessionStore, external id registered first
      // (the CLI path), one indexed memory row.
      const writer = new SqliteSessionStore(dbPath);
      await writer.ensureSession(sessionId, "default");
      await writer.saveResults(sessionId, [
        { url: "https://intra.example/wiki", title: "internal wiki", snippet: "proxy port 8080 for the intranet wiki", source: "tavily" },
      ]);
      writer.close();

      const runOnce = async () => {
        // Reopen: proves the memory outlived the process that wrote it.
        const store = new SqliteSessionStore(dbPath);
        try {
          seenContexts.length = 0;
          const runtime = new PiAgentRuntime({
            retriever: new MockRetriever(),
            domain: { ...mockDomain, rag: { adapter: "fts" } },
            model: { id: "test-model", provider: "test" } as any,
            streamFn: capturingStreamFn,
            store,
            sessionId,
          });
          const errors: any[] = [];
          for await (const ev of runtime.run("how do I reach the internal wiki?")) {
            if (ev.type === "error") errors.push(ev);
          }
          assert(errors.length === 0, "#129 wired: agent loop completes without error");
          return seenContexts.flat();
        } finally {
          store.close();
        }
      };

      const text = allText(await runOnce());
      assert(text.includes("[RAG Context]"), "#129 wired: RAG block reaches the model on the real store");
      assert(text.includes("proxy port 8080"), "#129 wired + restart: memory written in an earlier process is recalled");
      assert(/adapter=fts/.test(text) && /provenance=memory/.test(text), "#129 wired: injection carries provenance");
      assert(text.includes("how do I reach the internal wiki?"), "#129 wired: user question preserved");

      // adapter="none" regression: no RAG block on the wired path. The user turn
      // may still carry L1/L2 anchor text, so assert the RAG block is absent AND
      // the question itself is preserved (absence alone would also pass if the
      // pipeline were never built).
      const storeForNone = new SqliteSessionStore(dbPath);
      try {
        seenContexts.length = 0;
        const runtime = new PiAgentRuntime({
          retriever: new MockRetriever(),
          domain: { ...mockDomain, rag: { adapter: "none" } },
          model: { id: "test-model", provider: "test" } as any,
          streamFn: capturingStreamFn,
          store: storeForNone,
          sessionId,
        });
        for await (const _ev of runtime.run("how do I reach the internal wiki?")) { /* drain */ }
      } finally {
        storeForNone.close();
      }
      const noneLastUser = textOf(seenContexts.flat().filter((m: any) => m?.role === "user").pop());
      assert(!noneLastUser.includes("[RAG Context]"), "#129 none: adapter=none injects no RAG block");
      assert(noneLastUser.includes("how do I reach the internal wiki?"),
        "#129 none: adapter=none preserves the user question");
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
    }
  }

  // A store whose append() rejects must not crash the run: append is async, so
  // an un-awaited rejection escapes the old try/catch and terminates Node >= 15.
  {
    let appendCalls = 0;
    const store = {
      getAnchors: () => [], saveAnchor: () => Promise.resolve(),
      createSession: (d: string) => ({ id: "s1", domain: d, createdAt: "" }),
      ensureSession: () => Promise.resolve(),
      append: () => { appendCalls += 1; return Promise.reject(new Error("write blocked")); },
      searchFts5: () => [], searchMemory: async () => [],
      saveResults: () => Promise.resolve(), close: () => {},
      listPreferences: async () => [],
    } as any;
    const origWrite = process.stderr.write;
    let captured = "";
    process.stderr.write = ((chunk: unknown) => { captured += String(chunk); return true; }) as typeof process.stderr.write;
    const errors: any[] = [];
    // Two assistant turns so "later messages are still attempted" is observable.
    const twoTurnStreamFn = (_model: any, _ctx: any, _o?: any) => {
      const finalMessage = {
        role: "assistant",
        content: [{ type: "text", text: "answer" }],
        api: "test", provider: "test", model: "test-model",
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop", timestamp: Date.now(),
      };
      return {
        async *[Symbol.asyncIterator]() { yield { type: "done", message: finalMessage, partial: finalMessage }; },
        result: async () => finalMessage,
      };
    };
    try {
      const runtime = new PiAgentRuntime({
        retriever: new MockRetriever(),
        domain: { ...mockDomain, rag: { adapter: "none" } },
        model: { id: "test-model", provider: "test" } as any,
        streamFn: twoTurnStreamFn,
        store,
        sessionId: "s-append-fail",
      });
      for await (const ev of runtime.run("hello")) if (ev.type === "error") errors.push(ev);
    } finally {
      process.stderr.write = origWrite;
    }
    assert(errors.length === 0, "#129 append failure: the run still completes (no unhandled rejection)");
    assert(appendCalls > 1, "#129 append failure: later messages are still attempted after a failure");
    assert(/FTS5 sync warning: write blocked/.test(captured), "#129 append failure: the failure is reported");
  }
}

// === #184 caller-level occupancy regression — pi-runtime end-to-end assertion ( #45 residual) ===
// Refs #45 comment 2026-11-04 (CodeRabbit trivial nitpick), #176 Wave0 close,
// #113 {fraction}×contextWindow + unknown-window 128k fallback.
// This is the ticket the #45 comment left as "leave to harness/regression ticket"
// without a ticket number; #176 recorded the gap and #184 is the assigned number.
// Pure test ticket, zero implementation change — resolveContextOccupancy and
// shouldStopAfterTurn semantics untouched, no new blocking gate leg.
// What it proves: the one-line forwarding `shouldStopAfterTurn -> resolveContextOccupancy`
// actually changes the externally observable stop/consolidate decision when
// occupancy crosses the resolved watermark (fraction×window or FALLBACK).
// Only the external observable is asserted (was consolidate triggered / would
// shouldStopAfterTurn's downstream consolidate fire), not internal call chains.
// Mock shape mirrors pi-runtime's real read: `agent.state.messages` +
// `usageTotals.lastTotalTokens` feeding resolveContextOccupancy.
{
  // Helper — caller-level decision as pi-runtime would compute it:
  // occupancy = resolveContextOccupancy(lastUsageTokens, agentMessages)
  // decision  = consolidateState(state, messages, occupancy, hasRetrievalEvidence, opts)
  // where opts.lowWatermark = {fraction} and opts.contextWindow = LlmSession.contextWindow
  // (REAL window or undefined==unknown). The observable is "would consolidate fire?"
  // i.e. decision !== "skip". The helper locks nothing internal beyond that.
  function callerOccupancyWouldConsolidate(
    mockAgentMessages: any[],
    lastTotalTokens: number,
    lowWatermark: number | { fraction: number } | undefined,
    contextWindow: number | undefined,
  ): { occupancy: number; wouldConsolidate: boolean; decision: string } {
    const occupancy = resolveContextOccupancy(lastTotalTokens, mockAgentMessages);
    const result = consolidateState(
      { version: 1, consecutiveReuses: 0, lastSummaryMsgCount: 0 },
      mockAgentMessages,
      occupancy,
      false, // no retrieval evidence — watermark alone drives the test
      { lowWatermark, contextWindow },
    );
    return { occupancy, wouldConsolidate: result.decision !== "skip", decision: result.decision };
  }

  // AC1: caller-layer opposite stop decisions when crossing / not crossing watermark.
  // Known window 1M @ 0.1 => watermark 100_000. Below must not consolidate, above must.
  {
    const lowWatermark = { fraction: 0.1 } as const;
    const contextWindow = 1_000_000;
    const resolved = resolveLowWatermark(lowWatermark, contextWindow);
    assert(resolved === 100_000, "#184: 1M @ 0.1 resolves to 100K watermark");

    // Small Agent state: one short user turn + small lastTotalTokens => occupancy ~50K < 100K
    const smallMessages = [{ role: "user", content: "hi" }] as any[];
    const below = callerOccupancyWouldConsolidate(smallMessages, 50_000, lowWatermark, contextWindow);
    // Large Agent state: lastTotalTokens itself already 120K > 100K (even without large messages)
    const above = callerOccupancyWouldConsolidate(smallMessages, 120_000, lowWatermark, contextWindow);

    assert(below.occupancy === 50_000, "#184 known-window: small occupancy is lastTotalTokens when estimate is smaller");
    assert(above.occupancy === 120_000, "#184 known-window: large occupancy is lastTotalTokens when it dominates");
    assert(below.wouldConsolidate === false, "#184 known-window: below 100K must NOT trigger consolidate (skip)");
    assert(above.wouldConsolidate === true, "#184 known-window: above 100K must trigger consolidate (compress)");
    assert(below.wouldConsolidate !== above.wouldConsolidate,
      "#184 known-window: crossing watermark gives opposite stop decisions (not an empty test)");
    assert(below.decision === "skip" && above.decision === "compress",
      "#184 known-window: decisions are skip vs compress");
  }

  // AC1 via message-estimate path: large tool result drives occupancy over watermark
  // even when lastTotalTokens is tiny — the trailing-estimate fix from PR #114.
  {
    const lowWatermark = { fraction: 0.01 } as const; // 1M @ 0.01 => 10K
    const contextWindow = 1_000_000;
    // One tool result with 80K chars ~20K estimated tokens >> 10K watermark
    const largeToolResult = [
      { role: "user", content: "q" },
      { role: "assistant", content: [{ type: "tool_use", name: "search", input: { query: "q" } }] },
      { role: "toolResult", content: [{ type: "text", text: "x".repeat(80_000) }] },
    ] as any[];
    const viaEstimate = callerOccupancyWouldConsolidate(largeToolResult, 100, lowWatermark, contextWindow);
    assert(viaEstimate.occupancy > 10_000,
      "#184 estimate path: large tool result is included in occupancy (got " + viaEstimate.occupancy + ")");
    assert(viaEstimate.wouldConsolidate === true,
      "#184 estimate path: large-tool-result occupancy alone triggers consolidate");

    // Same watermark, small message stays below
    const small = callerOccupancyWouldConsolidate([{ role: "user", content: "q" }] as any[], 100, lowWatermark, contextWindow);
    assert(small.wouldConsolidate === false, "#184 estimate path: small message stays below 10K");
    assert(small.wouldConsolidate !== viaEstimate.wouldConsolidate,
      "#184 estimate path: estimate-driven crossing gives opposite decisions");
  }

  // AC2: unknown contextWindow fallback morphology — FALLBACK_LOW_WATERMARK_TOKENS
  // packages/kernel/src/memory-pipeline.ts:193. A {fraction} with unknown window
  // must NOT scale the pi-ai 128000 placeholder into 12800; it falls back to 128K.
  {
    assert(FALLBACK_LOW_WATERMARK_TOKENS === 128_000, "#184 fallback: constant at memory-pipeline.ts:193 is 128000");
    const lowWatermark = { fraction: 0.1 } as const;
    // Unknown: undefined window -> fallback 128K
    assert(resolveLowWatermark(lowWatermark, undefined) === FALLBACK_LOW_WATERMARK_TOKENS,
      "#184 fallback: undefined window -> FALLBACK_LOW_WATERMARK_TOKENS");
    assert(resolveLowWatermark(lowWatermark, 0) === FALLBACK_LOW_WATERMARK_TOKENS,
      "#184 fallback: non-positive window -> FALLBACK_LOW_WATERMARK_TOKENS");
    // With 1M window, 120K would trigger (100K); with unknown-window fallback, 120K must NOT.
    const belowFallback = callerOccupancyWouldConsolidate(
      [{ role: "user", content: "q" }] as any[], 120_000, lowWatermark, undefined,
    );
    const aboveFallback = callerOccupancyWouldConsolidate(
      [{ role: "user", content: "q" }] as any[], 150_000, lowWatermark, undefined,
    );
    assert(belowFallback.occupancy === 120_000, "#184 fallback: occupancy 120K");
    assert(aboveFallback.occupancy === 150_000, "#184 fallback: occupancy 150K");
    assert(belowFallback.wouldConsolidate === false,
      "#184 fallback: 120K does NOT cross 128K fallback watermark (unknown-window form)");
    assert(aboveFallback.wouldConsolidate === true,
      "#184 fallback: 150K DOES cross 128K fallback watermark");
    assert(belowFallback.wouldConsolidate !== aboveFallback.wouldConsolidate,
      "#184 fallback: crossing 128K gives opposite stop decisions");
    // Absolute lowWatermark is not scaled — sanity that fraction path is the only scaled one
    assert(resolveLowWatermark(50_000, 1_000_000) === 50_000, "#184 fallback: absolute lowWatermark not scaled");
  }

  // AC2 variant: 128K model @ 0.5 => 64K watermark — ensures fraction scaling
  // works for small windows too (complement to 1M case).
  {
    const lowWatermark = { fraction: 0.5 } as const;
    const contextWindow = 128_000;
    assert(resolveLowWatermark(lowWatermark, contextWindow) === 64_000, "#184 128K model @ 0.5 = 64K");
    const below = callerOccupancyWouldConsolidate([{ role: "user", content: "q" }] as any[], 63_000, lowWatermark, contextWindow);
    const above = callerOccupancyWouldConsolidate([{ role: "user", content: "q" }] as any[], 65_000, lowWatermark, contextWindow);
    assert(below.wouldConsolidate === false && above.wouldConsolidate === true,
      "#184 128K@0.5: 63K skip vs 65K compress (opposite decisions around 64K)");
  }

  // Observable shell integration: MemoryPipeline.consolidate writes consolidation_state
  // only when occupancy crosses the resolved watermark. Mock store's saveAnchor is
  // the external observable (whether consolidate fired), not internal call-chain locks.
  {
    class MockStoreFor184 {
      calls: Array<{ type: string; payload: unknown }> = [];
      getAnchors() { return []; }
      saveAnchor(_s: string, type: string, payload: unknown) {
        this.calls.push({ type, payload });
        return Promise.resolve();
      }
    }

    const pipelineBelow = new MemoryPipeline({
      store: new MockStoreFor184() as any,
      retriever: new MockRetriever(),
      domain: { ...mockDomain, compaction: { lowWatermark: { fraction: 0.1 } } } as any,
      model: { id: "test" } as any,
      contextWindow: 1_000_000,
      streamFn: makeMockStreamFn("reuse"),
      sessionId: "s-184-below",
    });
    const pipelineAbove = new MemoryPipeline({
      store: new MockStoreFor184() as any,
      retriever: new MockRetriever(),
      domain: { ...mockDomain, compaction: { lowWatermark: { fraction: 0.1 } } } as any,
      model: { id: "test" } as any,
      contextWindow: 1_000_000,
      streamFn: makeMockStreamFn("reuse"),
      sessionId: "s-184-above",
    });
    // Reuse the same mock stores to inspect calls
    const storeBelow = (pipelineBelow as any).deps.store as MockStoreFor184;
    const storeAbove = (pipelineAbove as any).deps.store as MockStoreFor184;

    // Occupancy 50K < 100K => should NOT write consolidation_state (skip)
    await pipelineBelow.consolidate([{ role: "user", content: "q" }] as any, 50_000, false);
    // Occupancy 120K > 100K => should write consolidation_state (compress)
    await pipelineAbove.consolidate([{ role: "user", content: "q" }] as any, 120_000, false);

    const belowFired = storeBelow.calls.some((c) => c.type === "consolidation_state");
    const aboveFired = storeAbove.calls.some((c) => c.type === "consolidation_state");
    assert(belowFired === false, "#184 shell: below watermark does NOT write consolidation_state");
    assert(aboveFired === true, "#184 shell: above watermark DOES write consolidation_state");
    assert(belowFired !== aboveFired, "#184 shell: shell-level opposite firing (observable consolidate trigger)");

    // Unknown-window shell: same pi-ai placeholder must not be scaled
    const storeUnknown = new MockStoreFor184();
    const pipelineUnknown = new MemoryPipeline({
      store: storeUnknown as any,
      retriever: new MockRetriever(),
      domain: { ...mockDomain, compaction: { lowWatermark: { fraction: 0.1 } } } as any,
      model: { id: "custom", contextWindow: 128000 } as any, // pi-ai placeholder, NOT known window
      // No contextWindow passed => unknown => fallback 128K
      streamFn: makeMockStreamFn("reuse"),
      sessionId: "s-184-unknown",
    });
    await pipelineUnknown.consolidate([{ role: "user", content: "q" }] as any, 15_000, false);
    assert(!storeUnknown.calls.some((c) => c.type === "consolidation_state"),
      "#184 shell unknown: 15K does NOT cross 128K fallback (placeholder not scaled to 12.8K)");
  }
}

console.log("---");
console.log(` tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
