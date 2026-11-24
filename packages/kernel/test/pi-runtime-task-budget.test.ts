// #302 — a task-scoped budget bills the run to its own task.
//
// One chat execution is one task: the run's reserve/settle routes to the task
// id, the internal searches carry the scope, and the session form stays
// untouched for callers that have not migrated (MCP ans_chat, #303). A
// declared-but-failed establishment, and a rejected call quota, stop the run
// before any provider call — the replacements the spec lists for the old
// fail-open/soft-gate expectations (T4).
//
// Run: pnpm --filter @anysearch-cli/kernel run test

import { PiAgentRuntime } from "../src/pi-runtime";
import type { RetrieverPort, DomainConfigPort, BudgetLedgerPort, Query } from "../src/ports";
import { SqliteSessionStore } from "@anysearch-cli/store";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FusedEnvelope } from "@anysearch-cli/retriever";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

const mockDomain: DomainConfigPort = {
  sources: { enabled: ["tavily", "exa"] },
  prompts: [{ name: "system", content: "You are a research assistant." }],
  skills: { active: ["search"] },
  hooks: { toolWhitelist: ["search"] },
  rag: { adapter: "none" },
};

// A ledger that records every call with the scope id it was billed to — the
// test's core question is WHICH scope the runtime charged.
class ScopeLedger implements BudgetLedgerPort {
  reserves: Array<{ scope: string; dim: "tokens" | "usd" | "calls"; amount: number }> = [];
  settles: Array<{ scope: string; dim: "tokens" | "usd" | "calls"; reserved: number; actual: number }> = [];
  refuseCalls = false;
  reserveCalls(scope: string, count: number): boolean { this.reserves.push({ scope, dim: "calls", amount: count }); return !this.refuseCalls; }
  settleCalls(scope: string, reserved: number, actual: number): void { this.settles.push({ scope, dim: "calls", reserved, actual }); }
  reserveTokens(scope: string, amount: number): boolean { this.reserves.push({ scope, dim: "tokens", amount }); return true; }
  settleTokens(scope: string, reserved: number, actual: number): void { this.settles.push({ scope, dim: "tokens", reserved, actual }); }
  reserveUsd(scope: string, amount: number): boolean { this.reserves.push({ scope, dim: "usd", amount }); return true; }
  settleUsd(scope: string, reserved: number, actual: number): void { this.settles.push({ scope, dim: "usd", reserved, actual }); }
}

// A retriever that records the scopes its queries carried.
class ScopeRetriever implements RetrieverPort {
  queries: Array<{ sessionId?: string; taskBudget?: { taskId: string } }> = [];
  async search(q: Query): Promise<FusedEnvelope> {
    this.queries.push({ sessionId: q.sessionId, taskBudget: q.taskBudget ? { taskId: q.taskBudget.taskId } : undefined });
    return { query: q.query, mode: "fast", results: [] } as any;
  }
}

// One-shot provider stream reporting usage, mirroring pi-runtime.test.ts's
// #103 fixture so the settle assertions compare against the same shape.
function usageStreamFn(totalTokens: number, costUsd: number) {
  const finalMessage = {
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    api: "test", provider: "test", model: "test-model",
    usage: {
      input: totalTokens - 30, output: 30, cacheRead: 0, cacheWrite: 0, totalTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: costUsd },
    },
    stopReason: "stop", timestamp: Date.now(),
  };
  return (_model: any, _context: any, _options?: any) => ({
    async *[Symbol.asyncIterator]() {
      yield { type: "done", message: finalMessage, partial: finalMessage };
    },
    result: async () => finalMessage,
  });
}

// Counting how many times the provider stream function was invoked — "no new
// controlled call" is the assertion the stop paths must prove.
function countingStreamFn(inner: any): { fn: any; calls: () => number } {
  let calls = 0;
  const fn = (model: any, context: any, options?: any) => {
    calls++;
    return inner(model, context, options);
  };
  return { fn, calls: () => calls };
}

function noopStore(): any {
  return {
    getAnchors: () => [],
    saveAnchor: () => Promise.resolve(),
    createSession: (d: string) => ({ id: "s-noop", domain: d, createdAt: "" }),
    ensureSession: () => Promise.resolve(),
    append: () => Promise.resolve(),
    searchFts5: () => [],
    searchMemory: () => Promise.resolve([]),
    searchMemoryMulti: () => Promise.resolve([]),
    saveResults: () => Promise.resolve(),
    listPreferences: () => [],
    close: () => {},
  };
}

async function main() {
  // --- 1. The task scope owns the run's whole bill; the session ledger untouched ---
  {
    const taskLedger = new ScopeLedger();
    const sessionLedger = new ScopeLedger();
    const stream = countingStreamFn(usageStreamFn(150, 0.003));
    const runtime = new PiAgentRuntime({
      retriever: new ScopeRetriever(),
      domain: mockDomain,
      model: { id: "test-model", provider: "test" } as any,
      streamFn: stream.fn,
      store: noopStore(),
      ledger: sessionLedger,
      sessionId: "s-302",
      taskBudget: { taskId: "t-302-a", ledger: taskLedger },
    });
    const events: any[] = [];
    for await (const ev of runtime.run("hello")) events.push(ev);
    assert(events.filter(e => e.type === "error").length === 0, "task-budgeted run completes without error");
    const taskScopes = new Set<string>([...taskLedger.reserves, ...taskLedger.settles].map(r => r.scope));
    assert(taskScopes.size === 1 && taskScopes.has("t-302-a"),
      "every reserve/settle bills the task id (got " + JSON.stringify([...taskScopes]) + ")");
    const tokenSettle = taskLedger.settles.find(s => s.dim === "tokens");
    assert(tokenSettle !== undefined && tokenSettle.actual === 150,
      "the run's tokens settle on the task ledger by actuals");
    const usdSettle = taskLedger.settles.find(s => s.dim === "usd");
    assert(usdSettle !== undefined && Math.abs(usdSettle.actual - 0.003) < 1e-9,
      "the run's USD settles on the task ledger (settle-only)");
    const callSettle = taskLedger.settles.find(s => s.dim === "calls");
    assert(callSettle !== undefined && callSettle.actual === 1, "the run's call settles on the task ledger");
    assert(sessionLedger.reserves.length === 0 && sessionLedger.settles.length === 0,
      "the session ledger is not billed at all — the conversation's history is untouched");
    assert(stream.calls() === 1, "exactly one provider call was made");
  }

  // --- 2. Internal searches carry the task scope (engine bills the task) ---
  {
    const retriever = new ScopeRetriever();
    const runtime = new PiAgentRuntime({
      retriever,
      domain: mockDomain,
      model: { id: "m" } as any,
      streamFn: usageStreamFn(10, 0),
      store: noopStore(),
      sessionId: "s-302-scoped",
      taskBudget: { taskId: "t-302-b", ledger: new ScopeLedger() },
    });
    // The scoped retriever is the runtime's one choke for every internal
    // search (agent tool, sufficiency reround, pipeline recall); driving it
    // directly proves the scope rides along, which is what routes the
    // engine's per-call budget to the task.
    const scoped = (runtime as any).scopedRetriever as RetrieverPort;
    await scoped.search({ query: "inner" } as Query);
    assert(retriever.queries.length === 1, "the scoped retriever forwards the search");
    assert(retriever.queries[0]?.sessionId === "s-302-scoped",
      "the session handle still rides along (context keys on the session)");
    assert(retriever.queries[0]?.taskBudget?.taskId === "t-302-b",
      "the task budget scope rides along (the engine bills the task, not the session)");
    // And the same wiring without a session still routes the task scope — a
    // task-wired runtime with no memory context must not silently fall back
    // to billing the conversation.
    const retriever2 = new ScopeRetriever();
    const runtime2 = new PiAgentRuntime({
      retriever: retriever2,
      domain: mockDomain,
      model: { id: "m" } as any,
      streamFn: usageStreamFn(10, 0),
      taskBudget: { taskId: "t-302-c", ledger: new ScopeLedger() },
    });
    const scoped2 = (runtime2 as any).scopedRetriever as RetrieverPort;
    await scoped2.search({ query: "inner" } as Query);
    assert(retriever2.queries[0]?.taskBudget?.taskId === "t-302-c",
      "a task-wired runtime without a session still carries the task scope");
  }

  // --- 3. Declared but failed to establish: the run stops before any controlled call ---
  {
    const sessionLedger = new ScopeLedger();
    const stream = countingStreamFn(usageStreamFn(150, 0.003));
    const runtime = new PiAgentRuntime({
      retriever: new ScopeRetriever(),
      domain: mockDomain,
      model: { id: "m" } as any,
      streamFn: stream.fn,
      store: noopStore(),
      ledger: sessionLedger,
      sessionId: "s-302-fault",
      taskBudgetFault: "task budget establishment failed: probe",
    });
    const events: any[] = [];
    for await (const ev of runtime.run("hello")) events.push(ev);
    const errors = events.filter(e => e.type === "error");
    assert(errors.length === 1 && /Task budget not established: task budget establishment failed/.test(errors[0].message),
      "a declared-but-failed budget yields one structured error naming the reason");
    assert(events.some(e => e.type === "done") === false, "no done event — the run never completed");
    assert(stream.calls() === 0, "no provider call was made (no new controlled calls)");
    assert(sessionLedger.reserves.length === 0,
      "no reservation was taken — failing open to unmetered is exactly what must not happen");
  }

  // --- 4. A rejected call quota under the task form stops the run (S5/T4) ---
  {
    const taskLedger = new ScopeLedger();
    taskLedger.refuseCalls = true;
    const stream = countingStreamFn(usageStreamFn(150, 0.003));
    const runtime = new PiAgentRuntime({
      retriever: new ScopeRetriever(),
      domain: mockDomain,
      model: { id: "m" } as any,
      streamFn: stream.fn,
      store: noopStore(),
      ledger: new ScopeLedger(),
      sessionId: "s-302-callcap",
      taskBudget: { taskId: "t-302-callcap", ledger: taskLedger },
    });
    const events: any[] = [];
    for await (const ev of runtime.run("hello")) events.push(ev);
    const errors = events.filter(e => e.type === "error");
    assert(errors.length === 1 && /Call budget exhausted/.test(errors[0].message),
      "the rejected call reserve is a structured stop, not a silent unbilled run");
    assert(events.some(e => e.type === "done") === false, "no done event");
    assert(stream.calls() === 0, "no provider call was made");
    // The token reservation taken before the call gate must be released with
    // zero spend: the run never started, so zero is the honest actual — not a
    // phantom reservation left behind.
    const tokenSettles = taskLedger.settles.filter(s => s.dim === "tokens");
    assert(tokenSettles.length === 1 && tokenSettles[0].reserved > 0 && tokenSettles[0].actual === 0,
      "the token reservation is released with zero spend (got " + JSON.stringify(tokenSettles) + ")");
    assert(taskLedger.settles.some(s => s.dim === "calls" && s.actual === 1) === false,
      "the refused call is not billed as a completed call");
  }

  // --- 4b. The CLI's real consumption shape: return AT the error event ---
  //
  // The CLI handler does `case "error": return 1` — it never drains the
  // generator, so code after a yielded error never runs. Case 4 above reads
  // the whole stream; this case breaks out exactly where the CLI does, which
  // is the consumer shape the cleanup-before-yield reordering exists for.
  {
    const taskLedger = new ScopeLedger();
    taskLedger.refuseCalls = true;
    const stream = countingStreamFn(usageStreamFn(150, 0.003));
    const runtime = new PiAgentRuntime({
      retriever: new ScopeRetriever(),
      domain: mockDomain,
      model: { id: "m" } as any,
      streamFn: stream.fn,
      store: noopStore(),
      ledger: new ScopeLedger(),
      sessionId: "s-302-early-return",
      taskBudget: { taskId: "t-302-early-return", ledger: taskLedger },
    });
    let sawError = false;
    let errorMessage = "";
    for await (const ev of runtime.run("hello")) {
      if (ev.type === "error") { sawError = true; errorMessage = ev.message; break; }
    }
    assert(sawError && /Call budget exhausted/.test(errorMessage),
      "the early-return consumer still sees the call-budget error (got " + errorMessage + ")");
    // The whole point: cleanup ran BEFORE the error was yielded, so walking
    // away at the error leaves no phantom reservation on the task's row.
    const tokenSettles = taskLedger.settles.filter(s => s.dim === "tokens");
    assert(tokenSettles.length === 1 && tokenSettles[0].reserved > 0 && tokenSettles[0].actual === 0,
      "an early-return consumer leaves the token reservation already released (got " + JSON.stringify(tokenSettles) + ")");
    assert(taskLedger.reserves.some(r => r.dim === "tokens" && r.scope === "t-302-early-return"),
      "the reservation history is kept (honest record), just zero-settled");
    assert(stream.calls() === 0, "no provider call was made for a consumer that walked away");
  }

  // --- 5. A rejected call quota under the SESSION form stays the soft gate (#178 preserved) ---
  {
    const sessionLedger = new ScopeLedger();
    sessionLedger.refuseCalls = true;
    const stream = countingStreamFn(usageStreamFn(150, 0.003));
    const runtime = new PiAgentRuntime({
      retriever: new ScopeRetriever(),
      domain: mockDomain,
      model: { id: "m" } as any,
      streamFn: stream.fn,
      store: noopStore(),
      ledger: sessionLedger,
      sessionId: "s-302-soft",
    });
    const events: any[] = [];
    for await (const ev of runtime.run("hello")) events.push(ev);
    assert(events.some(e => e.type === "done"), "the session form keeps #178's soft gate: the run still completes");
    assert(stream.calls() === 1, "the session form still makes its provider call");
    assert(sessionLedger.settles.some(s => s.dim === "calls") === false,
      "the refused call is not billed (the soft gate's contract, unchanged)");
  }

  // --- 6. The memory pipeline's summary spend settles on the task's budget ---
  {
    const dir = mkdtempSync(join(tmpdir(), "ans-302-tasksettle-"));
    const store = new SqliteSessionStore(join(dir, "anysearch.db"));
    try {
      const session = await store.createSession("chat");
      const taskLedger = new ScopeLedger();
      const message = {
        role: "assistant",
        content: [{ type: "text", text: "SUMMARY: condensed history." }],
        api: "openai-completions", provider: "probe", model: "probe-model",
        usage: {
          input: 900, output: 100, cacheRead: 200, cacheWrite: 0, totalTokens: 1200,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, totalFromProvider: false },
        },
        stopReason: "stop", timestamp: Date.now(),
      };
      const summaryStream = () => ({
        async *[Symbol.asyncIterator]() {
          yield { type: "start", partial: { ...message, content: [] } };
          yield { type: "text_delta", contentIndex: 0, delta: "SUMMARY: condensed history.", partial: message };
          yield { type: "done", reason: "stop", message };
        },
        result: async () => message,
      });
      const runtime = new PiAgentRuntime({
        retriever: { search: async () => ({}) } as any,
        domain: { sources: { enabled: [] }, prompts: [], skills: { active: ["search"] }, hooks: { toolWhitelist: ["search"] }, rag: { adapter: "none" } } as any,
        model: { id: "probe-model", api: "openai-completions", provider: "probe", contextWindow: 200000 } as any,
        streamFn: summaryStream as any,
        models: { getModel: () => undefined } as any,
        store,
        sessionId: session.id,
        getApiKey: async () => "probe-key",
        taskBudget: { taskId: "t-302-memory", ledger: taskLedger },
      });
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
      await runtime.flushMemory();
      const tokenSettles = taskLedger.settles.filter(s => s.dim === "tokens" && s.actual > 0);
      assert(tokenSettles.length >= 1 && tokenSettles.every(s => s.scope === "t-302-memory"),
        "the summary spend settles on the TASK ledger (got " + JSON.stringify(tokenSettles) + ")");
      // The tail is not lost at flush end: the summary's tokens are on the same
      // task row the main run reserved against (both scopes are the task id).
      const mainRun = new ScopeLedger();
      for await (const _ev of new PiAgentRuntime({
        retriever: { search: async () => ({}) } as any,
        domain: { sources: { enabled: [] }, prompts: [], skills: { active: ["search"] }, hooks: { toolWhitelist: ["search"] }, rag: { adapter: "none" } } as any,
        model: { id: "m" } as any,
        streamFn: usageStreamFn(150, 0) as any,
        taskBudget: { taskId: "t-302-bare", ledger: mainRun },
      }).run("bare")) { /* drain */ }
      const bareTokenSettle = mainRun.settles.find(s => s.dim === "tokens");
      assert(bareTokenSettle?.scope === "t-302-bare" && bareTokenSettle.actual === 150,
        "a store-less task run still bills and settles its own task (compaction-free path)");
    } finally {
      try { store.close?.(); } catch { /* already closed */ }
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
    }
  }

  // --- 7. #303: the late settlement window is bounded, and says which happened ---
  //
  // A cancelled run whose provider stream never closed books its real figure
  // later (#188), on the same task row. The host waits a bounded window before
  // closing the task and needs a yes/no answer, because the stream may never
  // end. Driving the drain directly pins both halves; whether pi-agent-core
  // settles an aborted prompt at all differs per platform, which is why the
  // scheduling itself is not asserted here.
  {
    const runtime = new PiAgentRuntime({
      retriever: new ScopeRetriever(),
      domain: mockDomain,
      model: { id: "m" } as any,
      streamFn: usageStreamFn(150, 0) as any,
      taskBudget: { taskId: "t-303-late", ledger: new ScopeLedger() },
    });

    // Nothing scheduled: waiting is a no-op, no false "still running".
    assert(await runtime.drainLateSettlement(50) === "settled",
      "drain: no late settlement reports settled at once");

    // A tail that never ends: the window closes and the answer says "not yet".
    const stuck = new Promise<void>(() => { /* never settles */ });
    (runtime as any).lateSettlement = stuck;
    const t0 = Date.now();
    const stuckResult = await runtime.drainLateSettlement(60);
    const elapsed = Date.now() - t0;
    assert(stuckResult === "still-running",
      "drain: a stream that never ends reports still-running, not settled");
    // No absolute upper bound: "not hung" is the runner's job
    // (--test-timeout=30000 fails the file if the drain never returns). This
    // 60ms wait took 2230ms under c8 on CI and 6088ms on a loaded check-build
    // runner — a fixed cap is a flake factory (#479). The lower bound still
    // proves the drain waited the window instead of returning early.
    assert(elapsed >= 50,
      "drain: the wait covered the caller's window (took " + elapsed + " ms)");
    assert((runtime as any).lateSettlement === stuck,
      "drain: a window that closed first keeps the tail — forgetting it would report settled for spend still in flight");
    assert(await runtime.drainLateSettlement(20) === "still-running",
      "drain: the same unanswered tail still reports still-running on a second call");

    // A tail whose write blew up: not "settled" — the spend was never booked.
    (runtime as any).lateSettlement = Promise.reject(new Error("probe late write failed"));
    assert(await runtime.drainLateSettlement(200) === "failed",
      "drain: a rejected late write reports failed, not settled");
    assert((runtime as any).lateSettlement === undefined,
      "drain: the rejected tail is cleared too");

    // A tail that lands inside the window: settled, and the handle is cleared.
    let release: () => void = () => {};
    const landing = new Promise<void>((resolve) => { release = resolve; });
    (runtime as any).lateSettlement = landing;
    const waiting = runtime.drainLateSettlement(2000);
    release();
    assert(await waiting === "settled", "drain: a tail that lands inside the window reports settled");
    assert((runtime as any).lateSettlement === undefined,
      "drain: a cleared tail is not waited on twice");
  }

  console.log("\npi-runtime task-budget tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("pi-runtime task-budget test threw:", e);
  process.exit(1);
});
