// PI session record continuity and honest accounting (#258).
//
// Three behaviours this ticket owes:
//   R1 the same anysearch sessionId resumes the same PI record across runtime
//      instances (what a restart looks like), and a different handle does not
//      inherit that history;
//   R2 the done event reports calls, tokens, cache and cost, and names the
//      dimensions the provider never reported instead of zero-filling them;
//   R3 the declared 1M-class window reaches the PI session (requests, context
//      reporting) and an invalid declaration fails fast rather than degrading
//      silently to 128K.
//
// Run: pnpm --filter @anysearch-cli/kernel run test

import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStore } from "@anysearch-cli/store";
import { parseContextWindow } from "../src/llm-init";
import { accumulateUsage, emptyUsageTotals, piSessionKey, PiAgentRuntime, toRunUsage } from "../src/pi-runtime";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

// A provider stream that reports (or omits) usage. `usage === null` is the
// "provider stayed silent" shape, which must surface as MISSING.
function reply(text: string, usage: any = null) {
  const message: any = {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "probe",
    model: "probe-model",
    stopReason: "stop",
    timestamp: Date.now(),
    ...(usage ? { usage } : {}),
  };
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: { ...message, content: [] } };
      yield { type: "text_delta", contentIndex: 0, delta: text, partial: message };
      yield { type: "done", reason: "stop", message };
    },
    result: async () => message,
  };
}

function provider(text: string, usage: any = null) {
  const calls: any[] = [];
  const fn = (_model: any, context: any, options: any) => {
    calls.push({ context, options });
    return reply(text, usage);
  };
  return { fn, calls };
}

const domain: any = {
  sources: { enabled: [] },
  prompts: [{ name: "system", content: "RESUME-PROBE: answer briefly." }],
  skills: { active: ["search"] },
  hooks: { toolWhitelist: ["search"] },
  rag: { adapter: "none" },
};
const model: any = {
  id: "probe-model", name: "probe-model", api: "openai-completions", provider: "probe",
  contextWindow: 200000, maxTokens: 4096, reasoning: false, input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

class NoopRetriever {
  async search(q: any) {
    return { query: String(q.query), mode: "fast", results: [], answers: [], metadata: {} } as any;
  }
}

function textOf(context: any): string {
  return JSON.stringify((context?.messages ?? []).map((m: any) => ({
    role: m?.role,
    text: typeof m?.content === "string" ? m.content : (m?.content ?? []).map((c: any) => c?.text ?? "").join(""),
  })));
}

async function drain(run: AsyncIterable<any>) {
  const events: any[] = [];
  for await (const e of run) events.push(e);
  return events;
}

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), "ans-258-resume-"));
  const piDir = join(workDir, "pi-sessions");
  const store = new SqliteSessionStore(join(workDir, "anysearch.db"));

  try {
    // ---------- R1 resume across runtime instances ----------
    {
      const session = await store.createSession("chat");
      const first = provider("FIRST-ANSWER");
      const r1 = new PiAgentRuntime({
        retriever: new NoopRetriever() as any,
        domain, model, streamFn: first.fn as any,
        store, sessionId: session.id, piSessionDir: piDir,
        getApiKey: async () => "probe-key",
      });
      const firstEvents = await drain(r1.run("FIRST-QUESTION-MARKER"));
      assert(firstEvents.some((e) => e.type === "done"), "R1: the first run completes");

      // A second runtime instance is exactly what a process restart looks like.
      const second = provider("SECOND-ANSWER");
      const r2 = new PiAgentRuntime({
        retriever: new NoopRetriever() as any,
        domain, model, streamFn: second.fn as any,
        store, sessionId: session.id, piSessionDir: piDir,
        getApiKey: async () => "probe-key",
      });
      const secondEvents = await drain(r2.run("SECOND-QUESTION-MARKER"));
      assert(secondEvents.some((e) => e.type === "done"), "R1: the resumed run completes");

      const resumedRequest = textOf(second.calls[0]?.context);
      assert(resumedRequest.includes("FIRST-QUESTION-MARKER"),
        "R1: the resumed run's request carries the first turn's question");
      assert(resumedRequest.includes("SECOND-QUESTION-MARKER"),
        "R1: the resumed run's request carries the new question");

      const files = readdirSync(piDir).filter((f) => f.endsWith(".jsonl"));
      assert(files.length === 1, "R1: one session handle keeps one PI record (got " + files.length + ")");
      const jsonl = readFileSync(join(piDir, files[0]!), "utf8");
      assert(jsonl.includes("FIRST-QUESTION-MARKER") && jsonl.includes("SECOND-QUESTION-MARKER"),
        "R1: one append-only record holds both turns");

      // A different handle must not inherit that history.
      const other = await store.createSession("chat");
      const third = provider("OTHER-ANSWER");
      const r3 = new PiAgentRuntime({
        retriever: new NoopRetriever() as any,
        domain, model, streamFn: third.fn as any,
        store, sessionId: other.id, piSessionDir: piDir,
        getApiKey: async () => "probe-key",
      });
      await drain(r3.run("OTHER-QUESTION-MARKER"));
      assert(!textOf(third.calls[0]?.context).includes("FIRST-QUESTION-MARKER"),
        "R1: a different session handle does not inherit another session's transcript");
      assert(readdirSync(piDir).filter((f) => f.endsWith(".jsonl")).length === 2,
        "R1: each session handle gets its own record file");
      assert(piSessionKey(session.id) !== piSessionKey(other.id),
        "R1: the record key is derived from the handle, not shared");
    }

    // ---------- R2 honest accounting ----------
    {
      const session = await store.createSession("chat");
      const reported = provider("ANSWER", {
        input: 1200, output: 80, cacheRead: 400, cacheWrite: 0,
        totalTokens: 1680, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.012 },
      });
      const r = new PiAgentRuntime({
        retriever: new NoopRetriever() as any,
        domain, model, streamFn: reported.fn as any,
      });
      const events = await drain(r.run("usage reported"));
      const done = events.find((e) => e.type === "done");
      assert(done?.usage?.assistantCalls === 1, "R2: the reported assistant call is counted");
      assert(done?.usage?.inputTokens === 1200 && done?.usage?.outputTokens === 80,
        "R2: input and output tokens match the provider report");
      assert(done?.usage?.cacheReadTokens === 400, "R2: cache reads are carried separately");
      assert(done?.usage?.totalTokens === 1680, "R2: the run total matches the provider's totalTokens");
      assert(Math.abs((done?.usage?.costUsd ?? 0) - 0.012) < 1e-9, "R2: cost comes from the provider, not a local table");
      assert(Array.isArray(done?.usage?.missing) && done!.usage!.missing.length === 0,
        "R2: nothing is reported missing when the provider answered every dimension (got " + JSON.stringify(done?.usage?.missing) + ")");

      // PI 1.5.1 normalizes a provider message into a complete Usage object, so
      // an in-run check cannot distinguish "reported zero" from "not reported".
      // The honesty contract therefore lives in the accounting helpers: a
      // dimension that never arrived is named, never rendered as free.
      {
        const totals = emptyUsageTotals();
        accumulateUsage(totals, {
          role: "assistant",
          usage: { input: 100, output: 10, totalTokens: 110 },
        });
        const silent = toRunUsage(totals, 0, 0, 0);
        assert(silent.assistantCalls === 1, "R2: the call itself is still counted");
        assert(silent.missing.includes("cache usage"), "R2: absent cache figures are named (got " + JSON.stringify(silent.missing) + ")");
        assert(silent.missing.includes("cost"), "R2: absent cost is named instead of resting at 0");
        assert(!silent.missing.includes("assistant usage"), "R2: a reported call is not reported missing");
      }

      // Nothing reported at all: every dimension is named.
      {
        const none = toRunUsage(emptyUsageTotals(), 0, 0, 0);
        assert(none.missing.includes("assistant usage"), "R2: a run with no usage names the missing assistant usage");
        assert(none.missing.includes("cost"), "R2: a run with no usage names the missing cost");
      }

      // Compaction that returned no usage is named too.
      {
        const totals = emptyUsageTotals();
        accumulateUsage(totals, {
          role: "assistant",
          usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { total: 0 } },
        });
        const withCompaction = toRunUsage(totals, 1, 0, 0);
        assert(withCompaction.compactionCalls === 1, "R2: the compaction call is counted separately");
        assert(withCompaction.missing.includes("compaction usage"),
          "R2: a compaction call without usage is named (got " + JSON.stringify(withCompaction.missing) + ")");
      }
    }

    // ---------- R3 declared window ----------    {
      const session = await store.createSession("chat");
      const p = provider("WINDOW-ANSWER", {
        input: 100, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 110,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      });
      const r = new PiAgentRuntime({
        retriever: new NoopRetriever() as any,
        domain, model, streamFn: p.fn as any,
        contextWindow: 1048000,
      });
      const events = await drain(r.run("window probe"));
      const done = events.find((e) => e.type === "done");
      assert(done?.context?.window === 1048000,
        "R3: the declared 1048000 window is what PI reports (got " + JSON.stringify(done?.context) + ")");
      assert(done?.context?.window !== 128000,
        "R3: the declared window is not silently downgraded to 128K");
    }

    // An invalid declaration fails fast instead of degrading.
    {
      let threw = false;
      try { parseContextWindow("1048000abc"); } catch { threw = true; }
      assert(threw, "R3: a non-numeric window declaration throws");
      let threwNegative = false;
      try { parseContextWindow("-1"); } catch { threwNegative = true; }
      assert(threwNegative, "R3: a negative window declaration throws");
      assert(parseContextWindow(undefined) === undefined,
        "R3: an unset window stays unknown rather than becoming a number");
      assert(parseContextWindow("1048000") === 1048000, "R3: a valid declaration parses to its real value");
    }

    // A model without a declared window keeps its own catalogue window: nothing
    // is promoted to 1M behind the user's back.
    {
      const session = await store.createSession("chat");
      const p = provider("CATALOG-ANSWER", {
        input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      });
      const r = new PiAgentRuntime({
        retriever: new NoopRetriever() as any,
        domain, model, streamFn: p.fn as any,
      });
      const events = await drain(r.run("catalog window"));
      const done = events.find((e) => e.type === "done");
      assert(done?.context?.window === 200000,
        "R3: without a declaration the model's own window is used (got " + JSON.stringify(done?.context) + ")");
    }
  } finally {
    try { store.close?.(); } catch { /* already closed */ }
    try { rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
  }

  console.log("\nPI session resume/usage/window tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("PI session resume test threw:", e);
  process.exit(1);
});
