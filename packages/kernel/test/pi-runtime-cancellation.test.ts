// #211 acceptance — PiAgentRuntime honors a caller cancellation signal.
//
//   - A stub stream function that never resolves still ends the run when the
//     caller signal aborts (agent.abort + generator wakeup).
//   - A pre-aborted signal starts no provider call and reserves no budget.
//   - A cancelled run skips the completion path: no FTS message sync, no
//     memory consolidation/anchor write, no "Agent completed" summary, and the
//     budget settles through the abort release rather than the zero-usage
//     completion settlement.
//
// Test setup: the runtime's public run() generator with an injected never-settling
// stream. No test framework (repo convention: assert-based, run via
// `node --import tsx --test`).

import { PiAgentRuntime, createSearchTool } from "../src/pi-runtime";
import type { AgentEvent } from "../src/runtime";
import type { BudgetLedgerPort, DomainConfigPort, RetrieverPort, Query } from "../src/ports";
import type { FusedEnvelope } from "@anysearch-cli/retriever";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error("FAIL: " + msg);
  }
}

class MockRetriever implements RetrieverPort {
  calls = 0;
  async search(q: Query): Promise<FusedEnvelope> {
    this.calls++;
    return { query: q.query, mode: q.mode || "fast", results: [], answers: [] } as any;
  }
}

const mockDomain: DomainConfigPort = {
  sources: { enabled: ["tavily"] },
  prompts: [{ name: "system", content: "You are a research assistant." }],
  skills: { active: ["search"] },
  hooks: { toolWhitelist: ["search"] },
  rag: { adapter: "none" },
  budget: { outputReserveTokens: 2048 },
};

const model = { id: "test-model", provider: "test" } as any;

/** A stream function that never settles: the hang #211 is about. */
function neverResolvingStream(onCall: (signal?: AbortSignal) => void) {
  return (_model: any, _context: any, options?: { signal?: AbortSignal }) => {
    onCall(options?.signal);
    return new Promise(() => { /* never settles on purpose */ });
  };
}

// Timeout for "the runtime got as far as calling the provider". This is a
// liveness wait, not a timing assertion: under `turbo run test --concurrency=2`
// the machine runs several packages at once and a cold tsx transform can take
// well over the old 2s. A 2s cap made this file fail on CI for reasons that had
// nothing to do with cancellation, so it is 15s — far above any real startup,
// still bounded if the runtime truly never starts.
const STREAM_START_TIMEOUT_MS = 15_000;

async function waitFor(predicate: () => boolean, label: string, timeoutMs = STREAM_START_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("timed out waiting for " + label);
}

/**
 * Wait for the run to end, bounded by the liveness budget.
 *
 * The timer is cleared when the race settles: an uncleared 15s timer would keep
 * the test process alive after a passing assertion (the old 2s value made that
 * harmless, the new one would not).
 */
async function settleWithTimeout(done: Promise<unknown>, timeoutMs = STREAM_START_TIMEOUT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([done, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Collect events until the generator ends; returns the events and a settled flag. */
function consume(runtime: PiAgentRuntime, input: string) {
  const events: AgentEvent[] = [];
  let settled = false;
  const done = (async () => {
    for await (const ev of runtime.run(input)) events.push(ev);
    settled = true;
  })();
  return { events, done, settled: () => settled };
}

async function main() {
  // ---- 1. A never-resolving stream ends when the caller signal aborts ----
  {
    const caller = new AbortController();
    let streamCalls = 0;
    let streamSignal: AbortSignal | undefined;
    const runtime = new PiAgentRuntime({
      retriever: new MockRetriever(),
      domain: mockDomain,
      model,
      streamFn: neverResolvingStream((signal) => { streamCalls++; streamSignal = signal; }),
      signal: caller.signal,
    });
    const consumed = consume(runtime, "hello");

    await waitFor(() => streamCalls === 1, "the stub stream to start");
    const abortedAt = Date.now();
    caller.abort("client cancelled");
    await settleWithTimeout(consumed.done);

    assert(consumed.settled(), "1: run ended after the caller signal aborted a never-resolving stream");
    // The point is that cancellation does not wait for the stalled stream; the
    // bar is "well under the liveness timeout", not a wall-clock budget that a
    // loaded CI box can miss while behaving correctly.
    assert(Date.now() - abortedAt < STREAM_START_TIMEOUT_MS / 2,
      "1: cancellation does not wait for the stalled stream");
    assert(streamCalls === 1, "1: no extra provider call after cancellation");
    assert(streamSignal?.aborted === true,
      "1: the stream function's active signal is already aborted after cancellation");
    assert(!consumed.events.some((e) => e.type === "done"),
      "1: a cancelled run emits no completion summary");
  }

  // ---- 2. Pre-aborted caller: no provider call, no reservation ----
  {
    const caller = new AbortController();
    caller.abort("cancelled before run");
    let streamCalls = 0;
    let tokenReserves = 0;
    let callReserves = 0;
    const ledger: BudgetLedgerPort = {
      reserveCalls: () => { callReserves++; return true; },
      settleCalls: () => { },
      reserveTokens: () => { tokenReserves++; return true; },
      settleTokens: () => { },
      reserveUsd: () => true,
      settleUsd: () => { },
    };
    const runtime = new PiAgentRuntime({
      retriever: new MockRetriever(),
      domain: mockDomain,
      model,
      streamFn: neverResolvingStream(() => { streamCalls++; }),
      signal: caller.signal,
      store: noopStore(),
      sessionId: "pre-aborted-session",
      ledger,
    });
    const events: AgentEvent[] = [];
    for await (const ev of runtime.run("hello")) events.push(ev);

    assert(streamCalls === 0, "2: a pre-aborted signal starts no provider call");
    assert(tokenReserves === 0 && callReserves === 0,
      "2: a pre-aborted signal reserves no token/call budget");
    assert(events.length === 0, "2: a pre-aborted run emits no events");
  }

  // ---- 3. Cancelled run skips completion writes and completion settlement ----
  {
    const caller = new AbortController();
    let streamCalls = 0;
    let streamSignal: AbortSignal | undefined;
    let appends = 0;
    let anchors = 0;
    const tokenSettles: Array<{ reserved: number; actual: number }> = [];
    const callSettles: Array<{ reserved: number; actual: number }> = [];
    let usdSettles = 0;
    const store = {
      ...noopStore(),
      append: () => { appends++; return Promise.resolve(); },
      saveAnchor: () => { anchors++; return Promise.resolve(); },
    };
    const ledger: BudgetLedgerPort = {
      reserveCalls: () => true,
      settleCalls: (_s: string, reserved: number, actual: number) => {
        callSettles.push({ reserved, actual });
      },
      reserveTokens: () => true,
      settleTokens: (_s: string, reserved: number, actual: number) => {
        tokenSettles.push({ reserved, actual });
      },
      reserveUsd: () => true,
      settleUsd: () => { usdSettles++; },
    };
    const runtime = new PiAgentRuntime({
      retriever: new MockRetriever(),
      domain: mockDomain,
      model,
      streamFn: neverResolvingStream((signal) => { streamCalls++; streamSignal = signal; }),
      signal: caller.signal,
      store: store as any,
      sessionId: "cancelled-session",
      ledger,
    });
    const consumed = consume(runtime, "hello");

    await waitFor(() => streamCalls === 1, "the stub stream to start");
    caller.abort("client cancelled");
    await settleWithTimeout(consumed.done);
    // Give a late completion write a chance to (wrongly) land.
    await new Promise((r) => setTimeout(r, 30));

    assert(consumed.settled(), "3: the cancelled run ended");
    assert(streamSignal?.aborted === true,
      "3: the stalled stream's active signal is aborted after cancellation");
    assert(!consumed.events.some((e) => e.type === "done"),
      "3: no completed summary for a cancelled chat");
    assert(appends === 0, "3: a cancelled chat does not sync messages into the session store");
    assert(anchors === 0, "3: a cancelled chat writes no memory anchor");
    assert(usdSettles === 0, "3: a cancelled chat settles no USD spend as a completed run");
    assert(callSettles.length === 1 && callSettles[0].actual === 1,
      "3: the started provider call is released once through the abort contract");
    assert(tokenSettles.length === 1,
      "3: the reservation is released exactly once on cancellation");
    const settle = tokenSettles[0];
    assert(settle.reserved > 0 && settle.actual === settle.reserved,
      "3: cancellation settles through the conservative abort release, not the zero-usage completion path");
  }

  // ---- 4. The internal search tool forwards the agent-run signal ----
  {
    const caller = new AbortController();
    const seen: Array<AbortSignal | undefined> = [];
    const retriever: RetrieverPort = {
      async search(q: Query): Promise<FusedEnvelope> {
        seen.push(q.signal);
        return { query: q.query, mode: q.mode || "fast", results: [], answers: [] } as any;
      },
    };
    const tool = createSearchTool(retriever);
    await tool.execute("search-call", { query: "forwarded" }, caller.signal);
    caller.abort("cancelled after the tool call");
    assert(seen.length === 1, "4: the internal search tool queried the retriever once");
    assert(seen[0] === caller.signal && seen[0]?.aborted === true,
      "4: the retriever receives the agent run signal and it aborts with the caller");
  }

  // ---- 5. A turn that completes after cancellation writes no anchor ----
  {
    const caller = new AbortController();
    let streamCalls = 0;
    let streamSignal: AbortSignal | undefined;
    let finished = 0;
    let appends = 0;
    let anchors = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const finalMessage = {
      role: "assistant",
      content: [{ type: "text", text: "late answer" }],
      api: "test", provider: "test", model: "test-model",
      usage: {
        input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop", timestamp: Date.now(),
    };
    const streamFn = (_m: any, _c: any, options?: { signal?: AbortSignal }) => {
      streamCalls++;
      streamSignal = options?.signal;
      return {
        async *[Symbol.asyncIterator]() {
          await gate;
          yield { type: "done", message: finalMessage, partial: finalMessage };
        },
        result: async () => { finished++; return finalMessage; },
      };
    };
    const store = {
      ...noopStore(),
      append: () => { appends++; return Promise.resolve(); },
      saveAnchor: () => { anchors++; return Promise.resolve(); },
    };
    const runtime = new PiAgentRuntime({
      retriever: new MockRetriever(),
      // Force the cold-path decision past the watermark, so the anchor write
      // would happen if shouldStopAfterTurn did not stop on the abort signal.
      domain: { ...mockDomain, compaction: { lowWatermark: 1 } },
      model,
      streamFn,
      signal: caller.signal,
      store: store as any,
      sessionId: "post-cancel-turn",
    });
    const consumed = consume(runtime, "hello");

    await waitFor(() => streamCalls === 1, "the gated stream to start");
    caller.abort("cancel before the turn finished");
    release();
    await settleWithTimeout(consumed.done);
    // The agent loop continues in the background after the generator returns;
    // wait for the late turn to reach shouldStopAfterTurn, then give the cold
    // path time to (wrongly) write.
    await waitFor(() => finished > 0, "the post-cancel turn to finish");
    await new Promise((r) => setTimeout(r, 200));

    assert(streamSignal?.aborted === true, "5: the late turn's signal is aborted");
    assert(anchors === 0, "5: a turn completing after cancellation writes no consolidation anchor");
    assert(appends === 0, "5: a turn completing after cancellation performs no FTS sync");
  }

  console.log("--- kernel pi-runtime cancellation tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
