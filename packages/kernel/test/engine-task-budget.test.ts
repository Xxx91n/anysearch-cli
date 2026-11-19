// #302 — the engine bills a task-scoped search to the task's own budget.
//
// A chat run hands its internal searches a TaskBudgetScope; the engine's
// per-call reserve→settle then lands on the task id, NOT on the construction-
// time session ledger — one execution's searches belong to that execution.
// The sufficiency anchor write stays session-scoped either way: anchors are
// conversation context, the budget is this run's quota.
//
// Run: pnpm --filter @anysearch-cli/kernel run test

import { RetroaererdEngine } from "../src/engine";
import { isTaskBudgetRejectedError } from "../src/budget-error";
import type { BudgetLedgerPort } from "../src/ports";
import type { SearchProvider, SearchRequest, NormalizedResult, ProviderEnvelope } from "@anysearch-cli/retriever";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

function mockProvider(id: string, urls: string[]): SearchProvider {
  return {
    id,
    modes: ["fast", "index", "deep", "answer"],
    async search(req: SearchRequest, _signal: AbortSignal): Promise<ProviderEnvelope> {
      const results: NormalizedResult[] = urls.map((url, i) => ({
        url,
        title: id + " result " + i,
        snippet: "snippet " + i,
        source: id,
      }));
      return { provider: id, results, answers: [], elapsedMs: 10 };
    },
  };
}

// Records every reserve/settle with the scope id it was billed to.
class ScopeLedger implements BudgetLedgerPort {
  reserves: Array<{ scope: string; dim: "calls" | "tokens" | "usd"; amount: number }> = [];
  settles: Array<{ scope: string; dim: "calls" | "tokens" | "usd"; reserved: number; actual: number }> = [];
  refuseCalls = false;
  reserveCalls(scope: string, count: number): boolean { this.reserves.push({ scope, dim: "calls", amount: count }); return !this.refuseCalls; }
  settleCalls(scope: string, reserved: number, actual: number): void { this.settles.push({ scope, dim: "calls", reserved, actual }); }
  reserveTokens(scope: string, amount: number): boolean { this.reserves.push({ scope, dim: "tokens", amount }); return true; }
  settleTokens(scope: string, reserved: number, actual: number): void { this.settles.push({ scope, dim: "tokens", reserved, actual }); }
  reserveUsd(scope: string, amount: number): boolean { this.reserves.push({ scope, dim: "usd", amount }); return true; }
  settleUsd(scope: string, reserved: number, actual: number): void { this.settles.push({ scope, dim: "usd", reserved, actual }); }
}

async function main() {
  const anchorWrites: Array<{ sessionId: string; type: string }> = [];

  // --- 1. Task-scoped search: the per-call budget lands on the task id ---
  {
    const taskLedger = new ScopeLedger();
    const sessionLedger = new ScopeLedger();
    const engine = new RetroaererdEngine(
      [
        mockProvider("tavily", ["https://example.com/a", "https://example.com/b"]),
        mockProvider("exa", ["https://other.org/c", "https://third.net/d"]),
      ],
      {
        sessionId: "s-engine",
        ledger: sessionLedger,
        anchors: { saveAnchor: (sid, type) => { anchorWrites.push({ sessionId: sid, type }); return Promise.resolve(); } },
      },
    );
    await engine.search({
      query: "task scoped",
      mode: "fast",
      sessionId: "s-engine",
      taskBudget: { taskId: "t-engine", ledger: taskLedger },
    });
    assert(taskLedger.reserves.length === 1 && taskLedger.reserves[0].dim === "calls"
      && taskLedger.reserves[0].scope === "t-engine",
      "the per-call reserve bills the task id (got " + JSON.stringify(taskLedger.reserves) + ")");
    assert(taskLedger.settles.length === 1 && taskLedger.settles[0].scope === "t-engine",
      "the per-call settle releases on the same task id");
    // 2 providers -> perCallEstimate 2 reserved, 2 actual (both answered).
    assert(taskLedger.settles[0].reserved === 2 && taskLedger.settles[0].actual === 2,
      "the task settle releases the exact estimate it reserved");
    assert(sessionLedger.reserves.length === 0 && sessionLedger.settles.length === 0,
      "the construction-time session ledger is not billed when a task scope is present");
    // The anchor write stays session-scoped: context keys on the session.
    assert(anchorWrites.length === 1 && anchorWrites[0].sessionId === "s-engine"
      && anchorWrites[0].type === "sufficiency",
      "the sufficiency anchor stays session-scoped under a task budget");
  }

  // --- 2. No task scope: the session form is unchanged (regression guard) ---
  {
    const sessionLedger = new ScopeLedger();
    const engine = new RetroaererdEngine(
      [mockProvider("solo", ["https://solo.com/x"])],
      { sessionId: "s-session-form", ledger: sessionLedger },
    );
    await engine.search({ query: "session form", mode: "fast", sessionId: "s-session-form" });
    assert(sessionLedger.reserves.length === 1 && sessionLedger.reserves[0].scope === "s-session-form",
      "without a task scope the reserve bills the session id, unchanged");
    assert(sessionLedger.settles.length === 1 && sessionLedger.settles[0].scope === "s-session-form",
      "the settle releases on the session id, unchanged");
  }

  // --- 3. A task cap is enforced on the task row: refusal is the same hard stop ---
  {
    const taskLedger = new ScopeLedger();
    taskLedger.refuseCalls = true;
    const engine = new RetroaererdEngine(
      [mockProvider("solo", ["https://solo.com/y"])],
      { ledger: new ScopeLedger() },
    );
    let threw: unknown;
    try {
      await engine.search({
        query: "capped",
        mode: "fast",
        taskBudget: { taskId: "t-capped", ledger: taskLedger },
      });
    } catch (e) { threw = e; }
    assert(threw instanceof Error && /Budget exceeded: per-call cap reached/.test(threw.message),
      "an exhausted task call cap refuses the search with the existing error");
    // #304: the refusal is a typed stop, so the CLI and the MCP search tools can
    // name it without matching the message text.
    assert(isTaskBudgetRejectedError(threw),
      "the refusal is the typed budget stop the hosts branch on");
    assert(taskLedger.settles.length === 0,
      "the refused task search is not settled — it never ran");
  }

  console.log("\nengine task-budget tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("engine task-budget test threw:", e);
  process.exit(1);
});
