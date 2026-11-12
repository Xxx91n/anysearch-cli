// Memory-summary spend settles on the budget ledger (#258).
//
// The memory pipeline's own summary calls are real provider calls made on this
// session's behalf. They are background work, so they are still in flight when
// the run ends; flushMemory() drains them and then settles what they cost.
// Reporting the spend without settling it would leave part of a session's
// consumption off the ledger, which is exactly what D4 forbids.
//
// Run: pnpm --filter @anysearch-cli/kernel run test

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStore } from "@anysearch-cli/store";
import { PiAgentRuntime } from "../src/pi-runtime";
import type { BudgetLedgerPort } from "../src/ports";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

const domain: any = {
  sources: { enabled: [] },
  prompts: [],
  skills: { active: ["search"] },
  hooks: { toolWhitelist: ["search"] },
  rag: { adapter: "none" },
};

// A ledger that only records what was settled, so this case proves the
// settlement path without a real budget row getting in the way.
function recordingLedger() {
  const settled: Array<{ kind: "token" | "usd"; reserved: number; actual: number }> = [];
  const ledger: BudgetLedgerPort & { settled: typeof settled } = {
    reserveTokens: () => true,
    reserveCalls: () => true,
    reserveUsd: () => true,
    settleTokens: (_id: string, reserved: number, actual: number) => { settled.push({ kind: "token", reserved, actual }); },
    settleCalls: () => {},
    settleUsd: (_id: string, reserved: number, actual: number) => { settled.push({ kind: "usd", reserved, actual }); },
    settled,
  };
  return ledger;
}

// The pipeline's summarizer reads the transcript and answers with text. Its
// reported usage is what must reach the ledger.
function summaryStream() {
  const message = {
    role: "assistant",
    content: [{ type: "text", text: "SUMMARY: condensed history." }],
    api: "openai-completions",
    provider: "probe",
    model: "probe-model",
    usage: {
      input: 900, output: 100, cacheRead: 200, cacheWrite: 0, totalTokens: 1200,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, totalFromProvider: false },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
  return () => ({
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: { ...message, content: [] } };
      yield { type: "text_delta", contentIndex: 0, delta: "SUMMARY: condensed history.", partial: message };
      yield { type: "done", reason: "stop", message };
    },
    result: async () => message,
  });
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "ans-258-memsettle-"));
  const store = new SqliteSessionStore(join(dir, "anysearch.db"));
  try {
    const session = await store.createSession("chat");
    const ledger = recordingLedger();
    const runtime = new PiAgentRuntime({
      retriever: { search: async () => ({}) } as any,
      domain,
      model: { id: "probe-model", api: "openai-completions", provider: "probe", contextWindow: 200000 } as any,
      streamFn: summaryStream() as any,
      // The compression path only fires when a summary model is available;
      // this case is about settlement, not about model resolution.
      models: { getModel: () => undefined } as any,
      store,
      sessionId: session.id,
      ledger,
      getApiKey: async () => "probe-key",
    });

    // Drive the pipeline's own summary path directly: this case is about what
    // flushMemory settles, not about how a turn decides to compress.
    const pipeline = (runtime as any).pipeline;
    assert(!!pipeline, "the runtime built a memory pipeline for this session");
    await pipeline.consolidate(
      [
        { role: "assistant", content: [{ type: "tool_use", name: "search", input: { query: "probe query" } }] },
        { role: "user", content: "plenty of material" },
        { role: "user", content: "plenty of material" },
      ] as any,
      900_000,
      true,
    );

    const beforeFlush = runtime.getMemoryUsage();
    assert(beforeFlush !== null, "summary usage is readable before the drain");

    await runtime.flushMemory();

    const reported = runtime.getMemoryUsage()!;
    const tokenSettle = ledger.settled.filter((s) => s.kind === "token" && s.actual > 0);
    const usdSettle = ledger.settled.filter((s) => s.kind === "usd" && s.actual > 0);
    assert(reported.calls >= 1, "the summary call was accounted (calls=" + reported.calls + ")");
    assert(reported.totalTokens > 0, "the summary call's tokens were accounted");
    assert(reported.costSource === "estimated",
      "a rate-card summary price is labelled estimated (got " + reported.costSource + ")");
    assert(reported.missing.includes("summary cost (estimated)"),
      "the estimated summary cost is named in missing (got " + JSON.stringify(reported.missing) + ")");
    assert(tokenSettle.length >= 1,
      "flushMemory settled the summary tokens on the ledger (settles=" + JSON.stringify(tokenSettle) + ")");

    // Idempotent: a second flush must not bill the same spend twice.
    const tokensBefore = tokenSettle.reduce((n, s) => n + s.actual, 0);
    await runtime.flushMemory();
    const tokensAfter = ledger.settled.filter((s) => s.kind === "token").reduce((n, s) => n + s.actual, 0);
    assert(tokensAfter === tokensBefore,
      "a repeated flush adds no delta (before " + tokensBefore + ", after " + tokensAfter + ")");

    // A runtime with no pipeline has nothing to settle and must not throw.
    const bare = new PiAgentRuntime({
      retriever: { search: async () => ({}) } as any,
      domain,
      model: { id: "probe-model" } as any,
      streamFn: summaryStream() as any,
    });
    await bare.flushMemory();
    assert(bare.getMemoryUsage() === null, "a runtime with no pipeline reports no summary usage");
  } finally {
    try { store.close?.(); } catch { /* already closed */ }
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
  }

  console.log("\nmemory summary settlement tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("memory summary settlement test threw:", e);
  process.exit(1);
});
