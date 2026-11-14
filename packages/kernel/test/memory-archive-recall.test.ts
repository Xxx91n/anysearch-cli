// #259 — ans_chat's internal search reaches the research archive, and a later
// session can recall it.
//
// Before this ticket the internal search tool only handed results to the model
// for that one turn: nothing wrote them into `retrieval_results`, so a later
// call (same session or another) had nothing to recall and had to search again.
// The sufficiency gate's bounded reround had the same gap.
//
// Covered here, against the REAL kernel runtime and the REAL SQLite store with a
// scripted provider (no network, no LLM key):
//
//   A1 a search inside ans_chat is written to the archive, under its session
//   A2 a SECOND session (different handle, fresh runtime) recalls that material
//      through the product path, without searching again
//   A3 the archive adapter decides recall: a `none` domain injects no archive
//      material (#104 AC2 / #130 boundary kept)
//   A4 the recall block carries provenance and content-trust framing
//   A5 a row invalidated after the write is not recalled as current fact
//   A6 a cancelled search indexes nothing
//   A7 the sufficiency reround archives its NEW results only, leaving the
//      outer search's row live and written exactly once
//
// Run: pnpm --filter @anysearch-cli/kernel run test

import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStore } from "@anysearch-cli/store";
import { PiAgentRuntime } from "../src/pi-runtime";
import { readMessageText } from "../src/message-text";

// kernel does not depend on better-sqlite3 directly; it arrives with the store.
// Resolving it from the store's install keeps this test from declaring a
// dependency the kernel package does not own, which is what would happen if it
// imported the package by name. The connection is typed structurally for the
// same reason: kernel has no better-sqlite3 type dependency to import.
interface RawStatement { run(...params: unknown[]): unknown; }
interface RawConnection { prepare(sql: string): RawStatement; close(): void }
const requireFromStore = createRequire(import.meta.url.replace(/test[\\/].*$/, "node_modules/@anysearch-cli/store/package.json"));
const DatabaseCtor = requireFromStore("better-sqlite3") as new (path: string) => RawConnection;

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

const SHARED_FACT = "ARCHIVE-FACT-259: the chronicle records a proxy on port 8080.";

function domainWith(adapter: string): any {
  return {
    sources: { enabled: ["tavily"] },
    prompts: [{ name: "system", content: "ARCHIVE-PROBE: research assistant." }],
    skills: { active: ["search"] },
    hooks: { toolWhitelist: ["search"] },
    rag: { adapter },
  };
}

const model: any = {
  id: "probe-model", name: "probe-model", api: "openai-completions", provider: "probe",
  contextWindow: 200000, maxTokens: 4096, reasoning: false, input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

function assistantMessage(content: any[], stopReason: string, totalTokens = 300) {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "probe",
    model: "probe-model",
    usage: {
      input: Math.max(0, totalTokens - 10), output: 10, cacheRead: 0, cacheWrite: 0,
      totalTokens, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

function streamOf(message: any) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: { ...message, content: [] } };
      for (const block of message.content) {
        if (block?.type === "text" && block.text) {
          yield { type: "text_delta", contentIndex: 0, delta: block.text, partial: message };
        }
      }
      yield { type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message };
    },
    result: async () => message,
  };
}

interface CallRecord { kind: string; text: string }

// PI's own summarizer is a separate provider call; detecting it by its system
// prompt keeps the scripted provider honest about which call is which.
function scriptedProvider(decide: (ctx: { turn: number; context: any }) => any) {
  const calls: CallRecord[] = [];
  let mainTurn = 0;
  const fn = (_model: any, context: any, _options: any) => {
    const system = (typeof context?.systemPrompt === "string" ? context.systemPrompt : "") +
      (context?.messages ?? []).filter((m: any) => m?.role === "system")
        .map((m: any) => JSON.stringify(m?.sections ?? {}) + (typeof m?.content === "string" ? m.content : "")).join("");
    const kind = system.includes("context summarization assistant") ? "summary" : "main";
    let reply: any;
    if (kind === "summary") {
      reply = assistantMessage([{ type: "text", text: "SUMMARY-259: condensed history." }], "stop", 100);
    } else {
      reply = decide({ turn: mainTurn, context });
      mainTurn++;
    }
    calls.push({ kind, text: JSON.stringify((context?.messages ?? []).map((m: any) => ({
      role: m?.role, text: readMessageText(m)?.text ?? "",
    }))) });
    return streamOf(reply);
  };
  return { fn, calls, mainCalls: () => calls.filter((c) => c.kind === "main") };
}

class ArchiveRetriever {
  calls: string[] = [];
  constructor(private readonly snippet = SHARED_FACT, private readonly url = "https://archive-259.example/fact") {}
  async search(q: any) {
    this.calls.push(String(q.query));
    return {
      query: String(q.query), mode: q.mode ?? "fast",
      results: [{ url: this.url, title: "Archive probe source", snippet: this.snippet, source: "tavily", score: 1 }],
      answers: [],
      metadata: { providersQueried: ["tavily"], providersFailed: [], providersCancelled: [], elapsedMs: 1 },
    } as any;
  }
}

async function drain(run: AsyncIterable<any>) {
  const events: any[] = [];
  for await (const e of run) events.push(e);
  return events;
}

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), "ans-259-archive-"));
  const dbPath = join(workDir, "anysearch.db");
  const store = new SqliteSessionStore(dbPath);
  // A second connection for the test-only invalidation in A5. `dbQuery` only
  // runs queries, and the product deliberately has no "invalidate this row"
  // call — adding one just to drive a test would invent a product surface.
  // Note this connection WRITES (unlike the read-only diagnostics connections
  // in the store's coldstart-race test): the write is the point of A5, and it
  // is confined to this temp database.
  const raw = new DatabaseCtor(dbPath);

  try {
    // ---------- A1 + A2: a search writes, another session recalls ----------
    {
      const writer = await store.createSession("chat");
      const retriever = new ArchiveRetriever();
      const searchProvider = scriptedProvider(({ turn }) =>
        turn === 0
          ? assistantMessage([{ type: "toolCall", id: "s1", name: "search", arguments: { query: "archive probe fact" } }], "toolUse", 300)
          : assistantMessage([{ type: "text", text: "WRITER-DONE" }], "stop", 100));
      const writerRuntime = new PiAgentRuntime({
        retriever: retriever as any,
        domain: domainWith("none"),
        model,
        streamFn: searchProvider.fn as any,
        store,
        sessionId: writer.id,
      });
      const writerEvents = await drain(writerRuntime.run("look up the archive probe fact"));
      const archiveRows = store.dbQuery<any>(
        "SELECT id, session_id, url, snippet FROM retrieval_results WHERE snippet LIKE '%ARCHIVE-FACT-259%'",
      );
      assert(archiveRows.length >= 1,
        "A1: the internal search indexed its results into retrieval_results (rows=" + archiveRows.length + ")");
      assert(archiveRows.every((r) => r.session_id === writer.id),
        "A1: the row is recorded under the searching session's handle");
      assert(retriever.calls.length >= 1, "A1: the search actually ran");
      assert(writerEvents.some((e) => e.type === "done"), "A1: the writing run completed");
      // A9: the row id the search archived travels to the MODEL, inside the
      // tool result. This is what lets a summary later name the exact version
      // it read instead of guessing by URL — and it has to be in the request,
      // because that JSON is the only place `distillGap` can recover it.
      //
      // The id sits inside a doubly-encoded JSON string (the envelope is a
      // string field of the tool result), so the assertion strips the escaping
      // before matching rather than trying to count backslashes.
      const archivedId = archiveRows[0]!.id as number;
      const modelSawRowId = searchProvider.calls
        .filter((c) => c.kind === "main")
        .some((c) => c.text.replace(/\\/g, "").includes('"archiveRowId":' + archivedId));
      assert(modelSawRowId,
        "A9: the archived row id reaches the model's tool result (id=" + archivedId + ")");

      // A DIFFERENT session, fresh runtime, archive adapter on. Its prompt must
      // carry the material the first session found, and it must not need to
      // search to get it.
      const reader = await store.createSession("chat");
      const readerRetriever = new ArchiveRetriever("SHOULD-NOT-BE-SEARCHED", "https://reader-259.example/x");
      const readerProvider = scriptedProvider(() =>
        assistantMessage([{ type: "text", text: "READER-ANSWER" }], "stop", 100));
      const readerRuntime = new PiAgentRuntime({
        retriever: readerRetriever as any,
        domain: domainWith("fts"),
        model,
        streamFn: readerProvider.fn as any,
        store,
        sessionId: reader.id,
      });
      const readerEvents = await drain(readerRuntime.run("archive probe source chronicle proxy"));
      const readerPrompt = readerProvider.mainCalls()[0]?.text ?? "";
      assert(readerRetriever.calls.length === 0,
        "A2: the second session answered without searching (calls=" + readerRetriever.calls.length + ")");
      assert(readerPrompt.includes("ARCHIVE-FACT-259"),
        "A2: material written by the FIRST session reached the second session's model request");
      assert(readerEvents.some((e) => e.type === "done"), "A2: the reading run completed");
      assert(reader.id !== writer.id, "A2: the two runs really are different sessions");
    }

    // ---------- A3: `none` does not get the archive read ----------
    {
      const reader = await store.createSession("chat");
      const retriever = new ArchiveRetriever("NONE-DOMAIN-OWN-SEARCH", "https://none-259.example/x");
      // A model that always searches once: without recall it has to look things
      // up itself, which makes "no injection" observable rather than an artifact
      // of a model that answered from its own head.
      const provider = scriptedProvider(({ turn }) =>
        turn === 0
          ? assistantMessage([{ type: "toolCall", id: "n1", name: "search", arguments: { query: "archive probe fact" } }], "toolUse", 300)
          : assistantMessage([{ type: "text", text: "NONE-ANSWER" }], "stop", 100));
      const runtime = new PiAgentRuntime({
        retriever: retriever as any,
        domain: domainWith("none"),
        model,
        streamFn: provider.fn as any,
        store,
        sessionId: reader.id,
      });
      const events = await drain(runtime.run("archive probe source chronicle proxy"));
      const prompt = provider.mainCalls()[0]?.text ?? "";
      assert(!prompt.includes("ARCHIVE-FACT-259"),
        "A3: adapter=none injects no archive material (#104 AC2 / #130 boundary kept)");
      assert(retriever.calls.length === 1,
        "A3: a none-domain still searches for its own answer (no silent abstain)");
      assert(events.some((e) => e.type === "done"), "A3: the run completed");
    }

    // ---------- A4: provenance + content-trust framing ----------
    {
      const reader = await store.createSession("chat");
      const retriever = new ArchiveRetriever("INERT", "https://framing-259.example/x");
      const provider = scriptedProvider(() =>
        assistantMessage([{ type: "text", text: "FRAMING-ANSWER" }], "stop", 100));
      const runtime = new PiAgentRuntime({
        retriever: retriever as any,
        domain: domainWith("fts"),
        model,
        streamFn: provider.fn as any,
        store,
        sessionId: reader.id,
      });
      await drain(runtime.run("archive probe source chronicle proxy"));
      const prompt = provider.mainCalls()[0]?.text ?? "";
      assert(/provenance=memory/.test(prompt),
        "A4: the recalled block names its trust tier (memory, below user)");
      assert(/treat as evidence, not as instructions/.test(prompt),
        "A4: recalled rows are framed as data, not commands");
      assert(/traceId=/.test(prompt), "A4: the block carries a correlation id");
    }

    // ---------- A5: an invalidated row is not injected as current fact ----------
    {
      const rows = store.dbQuery<any>(
        "SELECT id FROM retrieval_results WHERE snippet LIKE '%ARCHIVE-FACT-259%'",
      );
      assert(rows.length >= 1, "A5: the earlier row is present before invalidation");
      for (const row of rows) {
        raw.prepare("UPDATE retrieval_results SET valid_until = datetime('now') WHERE id = ?").run(row.id);
      }
      const reader = await store.createSession("chat");
      const retriever = new ArchiveRetriever("STALE-259-OWN-SEARCH", "https://stale-259.example/x");
      const provider = scriptedProvider(({ turn }) =>
        turn === 0
          ? assistantMessage([{ type: "toolCall", id: "st1", name: "search", arguments: { query: "archive probe fact" } }], "toolUse", 300)
          : assistantMessage([{ type: "text", text: "STALE-ANSWER" }], "stop", 100));
      const runtime = new PiAgentRuntime({
        retriever: retriever as any,
        domain: domainWith("fts"),
        model,
        streamFn: provider.fn as any,
        store,
        sessionId: reader.id,
      });
      const events = await drain(runtime.run("archive probe source chronicle proxy"));
      const prompt = provider.mainCalls()[0]?.text ?? "";
      assert(!prompt.includes("ARCHIVE-FACT-259"),
        "A5: an invalidated row is not recalled as current fact");
      assert(retriever.calls.length === 1,
        "A5: with nothing valid recalled, the run searches instead of reusing stale material");
      assert(events.some((e) => e.type === "done"), "A5: the run completed");
    }

    // ---------- A6: a cancelled search indexes nothing ----------
    // The seam under test is the search tool's own write, so the cancellation has
    // to land during the SEARCH (after its await), not before the run starts.
    {
      const session = await store.createSession("chat");
      const before = store.dbQuery<any>("SELECT COUNT(*) AS n FROM retrieval_results")[0].n as number;
      const retriever = new ArchiveRetriever("CANCELLED-259-FACT", "https://cancel-259.example/x");
      const abort = new AbortController();
      const provider = scriptedProvider(({ turn }) =>
        turn === 0
          ? assistantMessage([{ type: "toolCall", id: "c1", name: "search", arguments: { query: "cancelled probe" } }], "toolUse", 300)
          : assistantMessage([{ type: "text", text: "SHOULD-NOT-REACH" }], "stop", 100));
      // Abort as soon as the search starts, then let it finish: an abort during
      // the fanout is exactly the window the write guard has to cover.
      const slowRetriever = {
        calls: 0,
        async search(q: any) {
          this.calls++;
          abort.abort("probe cancellation");
          return retriever.search(q);
        },
      };
      const runtime = new PiAgentRuntime({
        retriever: slowRetriever as any,
        domain: domainWith("none"),
        model,
        streamFn: provider.fn as any,
        store,
        sessionId: session.id,
        signal: abort.signal,
      });
      const events = await Promise.race([
        drain(runtime.run("a question nobody will wait for")),
        new Promise<any[] | null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ]);
      const after = store.dbQuery<any>("SELECT COUNT(*) AS n FROM retrieval_results")[0].n as number;
      assert(slowRetriever.calls >= 1, "A6: the search really was in flight when the abort landed");
      assert(!(events ?? []).some((e: any) => e.type === "done"),
        "A6: a cancelled run reports no completed summary");
      assert(after === before,
        "A6: a search cancelled mid-flight writes no archive row (before " + before + ", after " + after + ")");
    }

    // ---------- A7: the reround archives its NEW results only ----------
    // The gate's reround is a second internal search. It must reach the archive
    // too, and it must not re-archive the outer search's rows: `saveResults`
    // supersedes per URL, so writing the whole merged set would close the live
    // predecessor of every URL the search tool just wrote.
    {
      const session = await store.createSession("chat");
      let outerCalls = 0;
      const retriever = {
        calls: [] as string[],
        async search(q: any) {
          this.calls.push(String(q.query));
          const first = outerCalls === 0;
          outerCalls++;
          return {
            query: String(q.query), mode: q.mode ?? "fast",
            results: [{
              url: first ? "https://reround-259.example/outer" : "https://reround-259.example/fresh",
              title: "Reround probe source",
              snippet: first ? "REROUND-OUTER-259" : "REROUND-NEW-259",
              source: "tavily", score: 1,
            }],
            answers: [],
            // A non-"correct" verdict is what makes the gate run a reround.
            metadata: {
              providersQueried: ["tavily"], providersFailed: [], providersCancelled: [], elapsedMs: 1,
              sufficiency: { verdict: "insufficient", mvs: { verdict: "insufficient" } },
            },
          } as any;
        },
      };
      const provider = scriptedProvider(({ turn, context }) => {
        // The gate asks for a gap query in its own provider call; answer with a
        // real query so the reround actually starts.
        if (JSON.stringify(context?.messages ?? []).includes("search sufficiency evaluator")) {
          return assistantMessage([{ type: "text", text: "reround gap query" }], "stop", 100);
        }
        if (turn === 0) {
          return assistantMessage([{ type: "toolCall", id: "r1", name: "search", arguments: { query: "reround probe" } }], "toolUse", 300);
        }
        return assistantMessage([{ type: "text", text: "REROUND-DONE" }], "stop", 100);
      });
      const runtime = new PiAgentRuntime({
        retriever: retriever as any,
        domain: { ...domainWith("none"), compaction: { sufficiencyMaxRerounds: 1 } },
        model,
        streamFn: provider.fn as any,
        store,
        sessionId: session.id,
      });
      const events = await drain(runtime.run("reround probe question"));
      // The gate's turn work is awaited inside the turn, but settle any tail
      // before sampling the archive.
      await new Promise((r) => setTimeout(r, 1500));
      const rows = store.dbQuery<any>(
        "SELECT id, url, snippet, valid_until FROM retrieval_results WHERE snippet LIKE '%REROUND-%259%' ORDER BY id",
      );
      const liveRows = rows.filter((r) => r.valid_until === null);
      assert(events.some((e) => e.type === "done"), "A7: the run completed");
      assert(retriever.calls.length >= 2,
        "A7: the gate really rerounded (calls=" + retriever.calls.length + ")");
      assert(rows.some((r) => String(r.snippet).includes("REROUND-NEW-259")),
        "A7: the reround's fresh results reached the archive");
      assert(liveRows.some((r) => String(r.snippet).includes("REROUND-OUTER-259")),
        "A7: the outer search's row is still the LIVE one (the reround did not supersede it)");
      assert(rows.filter((r) => String(r.snippet).includes("REROUND-OUTER-259")).length === 1,
        "A7: the outer result was archived exactly once, not re-written by the reround");
    }

    // ---------- A8: a reround returning results AFTER the stop writes nothing ----------
    // The hole CodeRabbit reported on #272: the search returns anyway, and the
    // archive callback re-reads a mutable runtime field that an abort has just
    // cleared — so the write would go through. Driven at the gate level because
    // the ordering is only controllable there: the gap search parks, the signal
    // aborts, then the search returns its results.
    {
      const session = await store.createSession("chat");
      const before = store.dbQuery<any>("SELECT COUNT(*) AS n FROM retrieval_results")[0].n as number;
      const abort = new AbortController();
      let releaseGap: () => void = () => {};
      const gapParked = new Promise<void>((resolve) => { releaseGap = resolve; });
      let gapStarted = false;
      const retriever = {
        async search(q: any) {
          gapStarted = true;
          await gapParked;
          // Fire the stop here: the results below already exist, so only the
          // write guard can keep them out of the archive.
          abort.abort("probe cancellation");
          return {
            query: String(q.query), mode: "fast",
            results: [{
              url: "https://late-reround-259.example/fresh",
              title: "Late reround probe",
              snippet: "LATE-REROUND-259",
              source: "tavily", score: 1,
            }],
            answers: [],
            metadata: {
              providersQueried: ["tavily"], providersFailed: [], providersCancelled: [], elapsedMs: 1,
            },
          } as any;
        },
      };
      const provider = scriptedProvider(({ context }) => {
        // A real gap query, so the reround actually starts.
        if (JSON.stringify(context?.messages ?? []).includes("search sufficiency evaluator")) {
          return assistantMessage([{ type: "text", text: "reround gap query" }], "stop", 100);
        }
        return assistantMessage([{ type: "text", text: "outer" }], "stop", 100);
      });
      const runtime = new PiAgentRuntime({
        retriever: retriever as any,
        domain: { ...domainWith("none"), compaction: { sufficiencyMaxRerounds: 1 } },
        model,
        streamFn: provider.fn as any,
        store,
        sessionId: session.id,
      });
      const gate: any = (runtime as any).gate;
      // The outer tool result the gate looks for: a wrapped envelope whose
      // verdict is not "correct", which is what makes it reround.
      const outerEnvelope = {
        query: "late reround probe",
        mode: "fast",
        results: [{ url: "https://late-reround-259.example/outer", title: "outer", snippet: "OUTER" }],
        metadata: { sufficiency: { verdict: "insufficient", mvs: { verdict: "insufficient" } } },
      };
      const messages = [
        { role: "user", content: "late reround question" },
        { role: "assistant", content: [{ type: "toolCall", id: "lr1", name: "search", arguments: { query: "late reround probe" } }] },
        {
          role: "toolResult",
          toolCallId: "lr1",
          content: [{ type: "text", text: JSON.stringify({ schema: "anysearch://schemas/retrieval-content/1", snippet: JSON.stringify(outerEnvelope) }) }],
        },
      ];
      const evaluation = gate.evaluate(messages, abort.signal) as Promise<any>;
      const deadline = Date.now() + 8000;
      while (!gapStarted && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      assert(gapStarted, "A8: the reround search really started, so the write window was open");
      // Let the parked search finish. The stop is fired from the search itself,
      // microseconds before it returns, so the post-search check still sees
      // "not aborted" and only the write guard can stop the row.
      releaseGap();
      await evaluation;
      await new Promise((r) => setTimeout(r, 500));
      const lateRows = store.dbQuery<any>(
        "SELECT url FROM retrieval_results WHERE url LIKE '%late-reround-259.example/fresh%'",
      );
      assert(lateRows.length === 0,
        "A8: reround results returned after the stop were not archived");
    }

  } finally {
    try { raw.close(); } catch { /* already closed */ }
    try { store.close?.(); } catch { /* already closed */ }
    try { rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
  }

  console.log("\n#259 archive recall tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
