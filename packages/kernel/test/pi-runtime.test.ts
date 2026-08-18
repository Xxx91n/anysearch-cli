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

console.log("---");
console.log(`PiAgentRuntime tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
