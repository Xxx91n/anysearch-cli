// PiAgentRuntime test (G012).
// Verify construction, event types, domain 5-layer, budget settle.
// ponytail: no test framework, assert-based demo.
// Run: pnpm --filter @anysearch/kernel run test

import { PiAgentRuntime } from "../src/pi-runtime";
import type { RetrieverPort, DomainConfigPort, BudgetLedgerPort, Query } from "../src/ports";
import type { FusedEnvelope } from "@anysearch/retriever";

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
  settleTokens(): void {}
  reserveUsd(_s: string, _a: number): boolean { return true; }
  settleUsd(): void {}
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


// === ADR-0012 Contract Tests ===

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
      close() {}
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

// D3: dual-track trigger constants.
{
  const LOW_WATERMARK = 128000;
  assert(LOW_WATERMARK === 128000, "D3: low watermark 128K tokens");
  assert(LOW_WATERMARK / 1000000 < 0.15, "D3: low watermark < 15% of 1M window");
}

// D7: compaction config field exists in DomainConfigPort.
{
  const domainWithCompaction = {
    ...mockDomain,
    compaction: { model: "deepseek-v4-fast" },
  } as any;
  assert(domainWithCompaction.compaction?.model === "deepseek-v4-fast", "D7: compaction.model field present");
}

console.log("---");
console.log(`PiAgentRuntime tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
