// #260 — consolidation usage and cost honesty (spec D4, test T1/T2).
//
// The seam makes real provider calls outside the agent loop, so it must:
//   - reserve before the call and settle after it (the cap is real),
//   - stop with a typed refusal when the cap rejects, instead of spending on,
//   - report tokens/cache separately, and
//   - never label an unknown dollar figure as free.
//
// A custom endpoint (baseUrl + api) carries an all-zero price table; that is
// the "unknown" case this file pins. A catalog model with real prices is the
// "price-estimate" case. A server-sent price is the "provider-reported" case.
// Run: pnpm --filter @anysearch-cli/kernel run test

import {
  createConsolidationSeams,
  isConsolidationBudgetError,
  resolveConsolidationMetering,
} from "../src/consolidation";
import type { BudgetLedgerPort } from "../src/ports";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

type UsageShape = {
  input?: number; output?: number; cacheRead?: number; cacheWrite?: number;
  totalTokens?: number; cost?: { total?: number; totalFromProvider?: boolean };
};

/**
 * A fake LLM session: `streamFn` yields one text delta and a done event whose
 * message carries the usage this case wants to exercise.
 */
function fakeSession(opts: {
  text?: string;
  usage?: UsageShape;
  priceTable?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
}) {
  const model = {
    id: "fake-model",
    name: "fake-model",
    api: "openai-completions",
    provider: "fake",
    baseUrl: "http://127.0.0.1:1/v1",
    reasoning: false,
    input: ["text"],
    cost: {
      input: opts.priceTable?.input ?? 0,
      output: opts.priceTable?.output ?? 0,
      cacheRead: opts.priceTable?.cacheRead ?? 0,
      cacheWrite: opts.priceTable?.cacheWrite ?? 0,
    },
    contextWindow: 128000,
    maxTokens: 8192,
  };
  const streamFn = () => {
    const events = [
      { type: "text_delta", delta: opts.text ?? "Summary text." },
      ...(opts.usage ? [{ type: "done", message: { role: "assistant", content: [], usage: opts.usage } }] : []),
    ];
    return (async function* () { for (const e of events) yield e; })();
  };
  return { model, streamFn, apiKey: "fake-key" } as never;
}

type LedgerCall = { kind: "reserve" | "settle"; dimension: "token" | "call" | "usd"; amount: number; actual?: number };

function recordingLedger(opts: { rejectCall?: boolean; rejectTokens?: boolean } = {}) {
  const calls: LedgerCall[] = [];
  const ledger: BudgetLedgerPort & { calls: LedgerCall[] } = {
    reserveCalls: (_id: string, count: number) => {
      if (opts.rejectCall) return false;
      calls.push({ kind: "reserve", dimension: "call", amount: count });
      return true;
    },
    reserveTokens: (_id: string, amount: number) => {
      if (opts.rejectTokens) return false;
      calls.push({ kind: "reserve", dimension: "token", amount });
      return true;
    },
    reserveUsd: () => true,
    settleCalls: (_id: string, _r: number, actual: number) => {
      calls.push({ kind: "settle", dimension: "call", amount: actual });
    },
    settleTokens: (_id: string, reserved: number, actual: number) => {
      calls.push({ kind: "settle", dimension: "token", amount: reserved, actual });
    },
    settleUsd: (_id: string, _reserved: number, actual: number) => {
      calls.push({ kind: "settle", dimension: "usd", amount: actual });
    },
    calls,
  };
  return ledger;
}

async function main() {
  // --- 1. unknown price: a custom endpoint's zero price table is not "free" ---
  {
    const ledger = recordingLedger();
    const seams = createConsolidationSeams(
      fakeSession({
        text: "Alpha uses Beta for builds.",
        usage: { input: 100, output: 20, totalTokens: 120, cost: { total: 0.012 } },
      }),
      { budget: { sessionId: "s1", ledger } },
    );
    const out = await seams.summarize([{ title: "t", snippet: "s", url: "https://ex.com/a" }]);
    assert(out === "Alpha uses Beta for builds.", "summarize returns the model text");

    const u = seams.usage;
    assert(u.calls === 1, "one call is counted (got " + u.calls + ")");
    assert(u.inputTokens === 100 && u.outputTokens === 20 && u.totalTokens === 120, "tokens are summed from the provider usage");
    assert(u.costBasis === "unknown", "a zero price table gives costBasis=unknown (got " + u.costBasis + ")");
    assert(u.costUsd === 0, "the unknown dollar figure stays 0 and is NOT presented as a real price");
    assert(u.missing.some((m) => /cost/i.test(m)), "the unknown cost is named in missing[]");
    assert(u.missing.some((m) => /cache/i.test(m)), "cache usage that never arrived is named in missing[]");

    // Reserve-before, settle-after, on both dimensions.
    const reserves = ledger.calls.filter((c) => c.kind === "reserve");
    const settles = ledger.calls.filter((c) => c.kind === "settle");
    assert(reserves.length === 2, "a call reserves both the call count and tokens (got " + reserves.length + ")");
    assert(reserves.some((c) => c.dimension === "call" && c.amount === 1), "the call reserve is one call");
    assert(reserves.some((c) => c.dimension === "token" && c.amount > 0), "the token reserve is positive");
    const tokenSettle = settles.find((c) => c.dimension === "token");
    assert(tokenSettle !== undefined && tokenSettle.actual === 120, "the token settle books the actual provider total (got " + (tokenSettle && tokenSettle.actual) + ")");
  }

  // --- 2. price table present but no server price: an estimate, not a bill ---
  {
    const seams = createConsolidationSeams(
      fakeSession({
        usage: { input: 1000, output: 100, totalTokens: 1100, cost: { total: 0.05, totalFromProvider: false } },
        priceTable: { input: 0.001, output: 0.002 },
      }),
    );
    await seams.summarize([{ title: "t", snippet: "s", url: "https://ex.com/a" }]);
    assert(seams.usage.costBasis === "price-estimate", "a rate-card figure is an estimate (got " + seams.usage.costBasis + ")");
    assert(seams.usage.costUsd === 0.05, "the estimate is reported as an estimate, with its number");
  }

  // --- 3. server-sent price: provider-reported ---
  {
    const seams = createConsolidationSeams(
      fakeSession({
        usage: { input: 500, output: 50, cacheRead: 400, totalTokens: 550, cost: { total: 0.02, totalFromProvider: true } },
        priceTable: { input: 0.001, output: 0.002 },
      }),
    );
    await seams.summarize([{ title: "t", snippet: "s", url: "https://ex.com/a" }]);
    assert(seams.usage.costBasis === "provider-reported", "a server price is provider-reported (got " + seams.usage.costBasis + ")");
    assert(seams.usage.cacheReadTokens === 400, "a non-zero cache read is reported");
    assert(!seams.usage.missing.some((m) => /cache/i.test(m)), "reported cache usage is not listed as missing");
    assert(seams.usage.missing.length === 0, "a fully reported call names no gaps (got " + JSON.stringify(seams.usage.missing) + ")");
  }

  // --- 4. no usage block at all: named, never zero-filled as if reported ---
  {
    const seams = createConsolidationSeams(fakeSession({ text: "text only" }));
    const out = await seams.summarize([{ title: "t", snippet: "s", url: "https://ex.com/a" }]);
    assert(out === "text only", "text still comes back without usage");
    assert(seams.usage.calls === 1, "the call is still counted");
    assert(seams.usage.missing.some((m) => /usage/i.test(m)), "a missing usage block is named");
    assert(seams.usage.costBasis === "unknown", "no usage and no price leaves the cost unknown (got " + seams.usage.costBasis + ")");
  }

  // --- 5. never called: not-called, and nothing pretends it spent ---
  {
    const seams = createConsolidationSeams(fakeSession({}));
    assert(seams.usage.calls === 0, "a seam that was never used reports zero calls");
    assert(seams.usage.costBasis === "not-called", "no call is not-called, not unknown (got " + seams.usage.costBasis + ")");
  }

  // --- 6. a rejected call reserve stops the call before any provider work ---
  {
    const ledger = recordingLedger({ rejectCall: true });
    const seams = createConsolidationSeams(fakeSession({}), { budget: { sessionId: "s1", ledger } });
    let thrown: unknown;
    try {
      await seams.summarize([{ title: "t", snippet: "s", url: "https://ex.com/a" }]);
    } catch (e) { thrown = e; }
    assert(isConsolidationBudgetError(thrown), "a rejected call cap raises the typed budget refusal");
    assert(ledger.calls.length === 0, "a rejected reserve records no spend (got " + ledger.calls.length + ")");
    assert(seams.usage.calls === 0, "a refused call is not counted as a made call");
  }

  // --- 6b. a call that reported no usage still books its reservation ---
  {
    // Settling 0 would let a silent provider evade the token cap entirely and
    // read as a free call; the reserved estimate is the only number there is.
    const ledger = recordingLedger();
    const seams = createConsolidationSeams(fakeSession({ text: "text, no usage block" }), {
      budget: { sessionId: "s1", ledger },
    });
    const out = await seams.summarize([{ title: "t", snippet: "s", url: "https://ex.com/a" }]);
    assert(out === "text, no usage block", "the text still comes back");
    const tokenSettle = ledger.calls.find((c) => c.kind === "settle" && c.dimension === "token");
    assert(
      tokenSettle !== undefined && tokenSettle.actual !== undefined && tokenSettle.actual > 0,
      "an unreported call books its reserved estimate, not 0 (got " + JSON.stringify(tokenSettle) + ")",
    );
    assert(seams.usage.missing.some((m) => /usage/i.test(m)), "and the gap is still named in the usage report");
  }

  // --- 7. a rejected token reserve releases the call reservation ---
  {
    const ledger = recordingLedger({ rejectTokens: true });
    const seams = createConsolidationSeams(fakeSession({}), { budget: { sessionId: "s1", ledger } });
    let thrown: unknown;
    try {
      await seams.summarize([{ title: "t", snippet: "s", url: "https://ex.com/a" }]);
    } catch (e) { thrown = e; }
    assert(isConsolidationBudgetError(thrown), "a rejected token cap raises the typed budget refusal");
    // The call reservation succeeded before the token reserve rejected, so it
    // must be given back. Booking it as a completed call would charge a call
    // that never ran; leaving it held would leak reserved_calls for the rest of
    // the session, and a healthy run would later read as exhausted.
    const callSettle = ledger.calls.find((c) => c.kind === "settle" && c.dimension === "call");
    assert(
      callSettle !== undefined && callSettle.amount === 0,
      "the held call reservation is released (settleCalls 0), not booked as a completed call (got " + JSON.stringify(callSettle) + ")",
    );
    assert(seams.usage.calls === 0, "no call is counted when the token reserve refused it");
  }

  // --- 8. classify stays deterministic and free ---
  {
    const seams = createConsolidationSeams(fakeSession({}));
    const verdict = seams.classify("Alpha uses Beta for builds.", [
      { title: "Alpha note", snippet: "Alpha uses Beta for builds.", url: "https://ex.com/alpha" },
    ]);
    assert(verdict.label === "supported" || verdict.label === "uncertain", "classify returns a real verdict label");
    assert(seams.usage.calls === 0, "classify makes no model call, so it adds no usage");
  }

  // --- 9. the metering rule is one decision, not two ---
  {
    const makeStore = (opts: { caps?: boolean; fail?: boolean }) => {
      const calls: string[] = [];
      return {
        calls,
        store: {
          ensureSession: async (id: string) => { calls.push("ensure:" + id); if (opts.fail) throw new Error("boom"); },
          initBudget: (id: string) => { calls.push("init:" + id); },
          clearBudgetCaps: (id: string) => { calls.push("clear:" + id); },
          createBudgetLedger: () => recordingLedger(),
        },
      };
    };

    // A memory-list scope has no owning session: unmetered, and no row is touched.
    {
      const s = makeStore({ caps: true });
      const m = await resolveConsolidationMetering({
        store: s.store, scope: { by: "memory", sessionIds: [] },
        domain: { budget: {} }, toCaps: () => ({}), domainLabel: "c",
      });
      assert(!m.metered && m.reason === "no-scope-session", "a memory scope is unmetered (got " + JSON.stringify(m) + ")");
      assert(s.calls.length === 0, "an unmetered scope registers nothing");
    }

    // Several owners cannot share one run's spend.
    {
      const s = makeStore({ caps: true });
      const m = await resolveConsolidationMetering({
        store: s.store, scope: { by: "session", sessionIds: ["a", "b"] },
        domain: { budget: {} }, toCaps: () => ({}), domainLabel: "c",
      });
      assert(!m.metered && m.reason === "several-scope-sessions", "several owners are unmetered");
    }

    // No declared [budget]: nothing to charge against.
    {
      const s = makeStore({ caps: false });
      const m = await resolveConsolidationMetering({
        store: s.store, scope: { by: "session", sessionIds: ["a"] },
        domain: {}, toCaps: () => ({}), domainLabel: "c",
      });
      assert(!m.metered && m.reason === "no-declared-caps", "a domain without [budget] is unmetered");
      assert(s.calls.includes("clear:a"), "the stale row is released so no cap is implied");
    }

    // Declared caps + one session: metered, and the caps are registered.
    {
      const s = makeStore({ caps: true });
      const m = await resolveConsolidationMetering({
        store: s.store, scope: { by: "session", sessionIds: ["a"] },
        domain: { budget: {} }, toCaps: () => ({ tokenCap: 10 }), domainLabel: "c",
      });
      assert(m.metered === true, "one session with declared caps is metered");
      assert(s.calls.includes("ensure:a") && s.calls.includes("init:a"), "the row is registered before the caps");
    }

    // Setup failure: unmetered with a reason, never a thrown error.
    {
      const s = makeStore({ caps: true, fail: true });
      const warned: string[] = [];
      const m = await resolveConsolidationMetering({
        store: s.store, scope: { by: "session", sessionIds: ["a"] },
        domain: { budget: {} }, toCaps: () => ({}), domainLabel: "c", warn: (w) => warned.push(w),
      });
      assert(!m.metered && m.reason === "budget-setup-failed", "a setup fault reports unmetered, not a failure");
      assert(warned.length === 1, "the fault is named once (got " + JSON.stringify(warned) + ")");
    }
  }

  // --- 10. a failed stream does not become a summary ---
  {
    // pi-ai can end a stream with an `error` event after emitting text deltas.
    // Persisting those deltas would store a truncated answer as knowledge.
    const failing = {
      model: { id: "m", name: "m", api: "openai-completions", provider: "p", baseUrl: "http://x", reasoning: false,
        input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 8192 },
      streamFn: () => (async function* () {
        yield { type: "text_delta", delta: "half an answer" };
        yield { type: "error", reason: "error", error: { message: "upstream died" } };
      })(),
      apiKey: "k",
    } as never;
    const seams = createConsolidationSeams(failing);
    const out = await seams.summarize([{ title: "t", snippet: "s", url: "https://ex.com/a" }]);
    assert(out === null, "a failed stream yields no summary (got " + JSON.stringify(out) + ")");
    assert(seams.usage.calls === 1, "the attempt is still counted");
  }

  // --- 11. a server-sent price reaches the USD ledger dimension ---
  {
    const ledger = recordingLedger();
    const seams = createConsolidationSeams(
      fakeSession({
        usage: { input: 100, output: 10, totalTokens: 110, cost: { total: 0.02, totalFromProvider: true } },
        priceTable: { input: 0.001, output: 0.002 },
      }),
      { budget: { sessionId: "s1", ledger } },
    );
    await seams.summarize([{ title: "t", snippet: "s", url: "https://ex.com/a" }]);
    const usd = ledger.calls.find((c) => c.kind === "settle" && c.dimension === "usd");
    assert(usd !== undefined && usd.amount === 0.02, "the provider price settles on the USD dimension (got " + JSON.stringify(usd) + ")");
  }

  // --- 12. an unknown price does not invent a USD figure ---
  {
    const ledger = recordingLedger();
    const seams = createConsolidationSeams(
      fakeSession({ usage: { input: 100, output: 10, totalTokens: 110, cost: { total: 0.5 } } }),
      { budget: { sessionId: "s1", ledger } },
    );
    await seams.summarize([{ title: "t", snippet: "s", url: "https://ex.com/a" }]);
    const usd = ledger.calls.find((c) => c.kind === "settle" && c.dimension === "usd");
    assert(usd === undefined, "a rate-card guess is not booked as a server price (got " + JSON.stringify(usd) + ")");
    assert(seams.usage.costBasis === "unknown", "and the cost basis says unknown");
  }

  // --- 13. a missing usage block names the cost gap too ---
  {
    const seams = createConsolidationSeams(fakeSession({ text: "text only" }));
    await seams.summarize([{ title: "t", snippet: "s", url: "https://ex.com/a" }]);
    assert(
      seams.usage.missing.some((m) => /cost/i.test(m)),
      "no usage means no price, so the cost gap is named (got " + JSON.stringify(seams.usage.missing) + ")",
    );
  }

  console.log("consolidation-usage: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

await main();
