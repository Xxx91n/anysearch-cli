// Q2 probe —session/material persistence, resume, concurrency, interruption.
// Real kernel PiAgentRuntime + real SqliteSessionStore + real PI JSONL records;
// scripted provider (no network) so timing and content are controllable.
//
// Samples (shown before the run):
//   S1 same handle, two overlapping runs   -> serialized; the later run sees the
//      earlier run's finished assistant message.
//   S2 different handles, two runs         -> genuinely overlapped intervals.
//   S3 restart (fresh runtime + fresh store)-> same handle resumes history.
//   S4 research -> archive -> different handle recall (material, not message).
//   S5 interruption mid-run                -> no false success; material kept;
//      a later run on the same handle completes.
//   S6 compaction then restart             -> summary survives; originals in JSONL.
//   S7 two connections consolidate in parallel -> both rows land, no overwrite.
//
// Run: node --import tsx prototype/pi-esm-full-sdk/probe-q2.ts

import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "../../packages/store/src/session-store";
import { PiAgentRuntime } from "../../packages/kernel/src/pi-runtime";

const HERE = dirname(fileURLToPath(import.meta.url));
const findings: Array<{ id: string; question: string; pass: boolean; evidence: unknown }> = [];
function record(id: string, question: string, pass: boolean, evidence: unknown) {
  findings.push({ id, question, pass, evidence });
  console.log((pass ? "  ok   " : "  FAIL ") + id + " — " + question);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- scripted provider ----------

function assistantMessage(content: any[], stopReason: string, totalTokens = 400) {
  return {
    role: "assistant", content,
    api: "openai-completions", provider: "probe", model: "probe-model",
    usage: {
      input: Math.max(0, totalTokens - 10), output: 10, cacheRead: 0, cacheWrite: 0,
      totalTokens, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason, timestamp: Date.now(),
  };
}
function streamOf(message: any, delayMs = 0, hooks: { onRequest?: () => void; onDone?: () => void } = {}) {
  return {
    async *[Symbol.asyncIterator]() {
      hooks.onRequest?.();
      if (delayMs > 0) await sleep(delayMs);
      yield { type: "start", partial: { ...message, content: [] } };
      for (const block of message.content) {
        if (block?.type === "text" && block.text) {
          yield { type: "text_delta", contentIndex: 0, delta: block.text, partial: message };
        }
      }
      yield { type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message };
      hooks.onDone?.();
    },
    result: async () => message,
  };
}
function messageText(message: any): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map((c: any) => c?.text ?? (c?.type === "toolResult" ? JSON.stringify(c) : "")).join("\n");
  }
  return "";
}
function contextText(context: any): string {
  return JSON.stringify((context?.messages ?? []).map((m: any) => ({ role: m.role, text: messageText(m), sections: m?.sections })));
}

interface Call { kind: string; at: number; doneAt?: number; text: string }
function provider(label: string, plan: (ctx: { turn: number; context: any }) => any, opts: { delayMs?: number; hangAfter?: number } = {}) {
  const calls: Call[] = [];
  const fn = (_model: any, context: any, _options: any) => {
    const system = JSON.stringify((context?.messages ?? []).find((m: any) => m?.role === "system")?.sections ?? {}) +
      messageText((context?.messages ?? []).find((m: any) => m?.role === "system"));
    const kind = system.includes("context summarization assistant") ? "summary" : "main";
    let reply: any;
    if (kind === "summary") {
      reply = assistantMessage([{ type: "text", text: "SUMMARY-MARKER-Q2: compacted probe history." }], "stop", 100);
    } else {
      const mainTurn = calls.filter((c) => c.kind === "main").length;
      if (opts.hangAfter !== undefined && mainTurn >= opts.hangAfter) {
        const rec: Call = { kind, at: Date.now(), text: contextText(context) };
        calls.push(rec);
        return new Promise(() => { /* never settles */ });
      }
      reply = plan({ turn: mainTurn, context });
    }
    const rec: Call = { kind, at: Date.now(), text: contextText(context) };
    calls.push(rec);
    return streamOf(reply, opts.delayMs ?? 0, {
      onRequest: () => { rec.at = Date.now(); },
      onDone: () => { rec.doneAt = Date.now(); },
    });
  };
  return { label, fn, calls, mainCalls: () => calls.filter((c) => c.kind === "main") };
}

class ProbeRetriever {
  calls: string[] = [];
  constructor(private readonly snippet = "MATERIAL-Q2-FACT: the probe fact is 42.", private readonly url = "https://probe-q2.example/fact") {}
  async search(q: any) {
    this.calls.push(String(q.query));
    return {
      query: String(q.query), mode: q.mode ?? "fast",
      results: [{ url: this.url, title: "Probe Q2 source", snippet: this.snippet, source: "tavily", score: 1 }],
      answers: [],
      metadata: { providersQueried: [], providersFailed: [], providersCancelled: [], elapsedMs: 1 },
    } as any;
  }
}

const domain: any = {
  sources: { enabled: ["tavily"] },
  prompts: [{ name: "system", content: "PROBE-Q2-DOMAIN: probe research agent." }],
  skills: { active: ["search"] },
  hooks: { toolWhitelist: ["search"] },
  rag: { adapter: "none" },
};
const model: any = {
  id: "probe-model", name: "probe-model", api: "openai-completions", provider: "probe",
  contextWindow: 200000, maxTokens: 4096, reasoning: false, input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

async function drain(run: AsyncIterable<any>) {
  const events: any[] = [];
  for await (const e of run) events.push(e);
  return events;
}
function makeRuntime(sessionId: string | undefined, p: ReturnType<typeof provider>, extra: any = {}) {
  return new PiAgentRuntime({
    retriever: new ProbeRetriever() as any, domain, model, streamFn: p.fn as any, sessionId, ...extra,
  });
}
function jsonlFor(piDir: string) {
  const files = readdirSync(piDir).filter((f) => f.endsWith(".jsonl"));
  return files.map((f) => ({ file: f, text: readFileSync(join(piDir, f), "utf8") }));
}

const workDir = mkdtempSync(join(tmpdir(), "ans-q2-"));
const dbPath = join(workDir, "anysearch.db");
const piDir = join(workDir, "pi-sessions");
let store = new SqliteSessionStore(dbPath);

try {
  // ---------- S1 same handle: serialized; later run sees finished state ----------
  {
    const session = await store.createSession("chat");
    let aDoneAt = 0;
    const pA = provider("A", () => assistantMessage([{ type: "text", text: "A-DONE-MARKER" }], "stop", 100), { delayMs: 250 });
    const pB = provider("B", ({ context }) => assistantMessage(
      [{ type: "text", text: "B-SAW:" + (contextText(context).includes("A-DONE-MARKER") ? "A" : "MISSING") }], "stop", 100,
    ), { delayMs: 5 });
    const runtimeA = makeRuntime(session.id, pA, { store, piSessionDir: piDir });
    const runA = (async () => { const ev = await drain(runtimeA.run("A question")); aDoneAt = Date.now(); return ev; })();
    await sleep(40);
    const runB = (async () => drain(makeRuntime(session.id, pB, { store, piSessionDir: piDir }).run("B question")))();
    const [evA, evB] = await Promise.all([runA, runB]);
    const bFirst = pB.mainCalls()[0];
    const bText = contextText({ messages: [] }) + (bFirst?.text ?? "");
    record("S1", "same sessionId runs sequentially; the later run sees the earlier completed message",
      evA.some((e) => e.type === "done") && evB.some((e) => e.type === "done") &&
        bFirst !== undefined && bFirst.at >= aDoneAt &&
        bText.includes("A-DONE-MARKER") &&
        evB.some((e) => e.type === "text" && e.content.includes("B-SAW:A")),
      { aDoneAt, bFirstAt: bFirst?.at ?? null, serialized: (bFirst?.at ?? 0) >= aDoneAt,
        bRequestHasA: bText.includes("A-DONE-MARKER"),
        bSawA: evB.filter((e) => e.type === "text").map((e) => e.content).join("").slice(0, 120) });

    // ---------- S3 restart: fresh runtime + fresh store connection ----------
    const pRestart = provider("restart", () => assistantMessage([{ type: "text", text: "RESTART-OK" }], "stop", 100));
    store.close();
    store = new SqliteSessionStore(dbPath); // simulate a new process on the same files
    await store.ensureSession(session.id, "mcp");
    const evRestart = await drain(makeRuntime(session.id, pRestart, { store, piSessionDir: piDir }).run("restart question"));
    const restartRequest = pRestart.mainCalls()[0]?.text ?? "";
    const files = jsonlFor(piDir);
    record("S3", "after a restart the same handle resumes the same PI record and both prior answers",
      evRestart.some((e) => e.type === "done") &&
        restartRequest.includes("A-DONE-MARKER") && restartRequest.includes("B-SAW:A") &&
        files.length === 1,
      { files: files.map((f) => f.file), restartSeesA: restartRequest.includes("A-DONE-MARKER"),
        restartSeesB: restartRequest.includes("B-SAW:A"), done: evRestart.some((e) => e.type === "done") });
  }

  // ---------- S2 different handles: parallel ----------
  {
    const px = provider("X", () => assistantMessage([{ type: "text", text: "X-ANSWER" }], "stop", 100), { delayMs: 400 });
    const py = provider("Y", () => assistantMessage([{ type: "text", text: "Y-ANSWER" }], "stop", 100), { delayMs: 400 });
    const rx = makeRuntime(undefined, px);
    const ry = makeRuntime(undefined, py);
    const t0 = Date.now();
    const [ex, ey] = await Promise.all([drain(rx.run("X-QUESTION-MARKER")), drain(ry.run("Y-QUESTION-MARKER"))]);
    const xr = px.mainCalls()[0], yr = py.mainCalls()[0];
    const overlapMs = Math.max(0, Math.min(xr?.doneAt ?? 0, yr?.doneAt ?? 0) - Math.max(xr?.at ?? 0, yr?.at ?? 0));
    record("S2", "different sessions run in parallel (request/stream intervals overlap)",
      ex.some((e) => e.type === "done") && ey.some((e) => e.type === "done") && overlapMs > 150 &&
        !(xr?.text ?? "").includes("Y-QUESTION-MARKER") && !(yr?.text ?? "").includes("X-QUESTION-MARKER"),
      { overlapMs, wallMs: Date.now() - t0, xInterval: [xr?.at, xr?.doneAt], yInterval: [yr?.at, yr?.doneAt],
        crossTalk: { xHasY: (xr?.text ?? "").includes("Y-QUESTION-MARKER"), yHasX: (yr?.text ?? "").includes("X-QUESTION-MARKER") } });
  }

  // ---------- S4 research -> archive -> different handle recall ----------
  {
    const sMat = await store.createSession("chat");
    const pSearch = provider("mat", ({ turn }) =>
      turn === 0
        ? assistantMessage([{ type: "toolCall", id: "q2s", name: "search", arguments: { query: "probe fact 42" } }], "toolUse", 300)
        : assistantMessage([{ type: "text", text: "MAT-RESEARCH-DONE" }], "stop", 100));
    const retriever = new ProbeRetriever();
    // Low watermark forces this run's consolidation, which writes the l2_recall
    // anchor the next handle recalls from (same setting the earlier prototype used).
    const matDomain = { ...domain, compaction: { lowWatermark: 100, reuseCap: 3, sufficiencyMaxRerounds: 1 } };
    const rt1 = new PiAgentRuntime({
      retriever: retriever as any, store, sessionId: sMat.id, domain: matDomain, model,
      streamFn: pSearch.fn as any, piSessionDir: piDir, getApiKey: async () => "probe-key",
    });
    const ev1 = await drain(rt1.run("What is the probe fact? Search for it."));
    await rt1.flushMemory?.();

    // Continue the SAME handle (decision 4: the host threads sessionId) but with
    // a FRESH PI session dir, so injected text can only come from the DB archive,
    // never from PI's message record.
    const pRecall = provider("recall", () => assistantMessage([{ type: "text", text: "RECALL-ANSWER" }], "stop", 100));
    const rt2 = makeRuntime(sMat.id, pRecall, { store, piSessionDir: join(workDir, "pi-sessions-recall") });
    const ev2 = await drain(rt2.run("What is the probe fact 42?"));
    await rt2.flushMemory?.();
    const firstReq = pRecall.mainCalls()[0]?.text ?? "";
    const rows = store.dbQuery<any>("SELECT id, session_id, snippet FROM retrieval_results WHERE snippet LIKE '%MATERIAL-Q2-FACT%'");
    const matAnchors = store.dbQuery<any>("SELECT anchor_type, payload FROM resume_anchors WHERE session_id = ?", [sMat.id]);
    // Cross-handle retrieval surface (what the recall_memory tool exposes).
    const crossHandleHits = await store.searchMemory("probe fact 42", 5);
    record("S4", "research from one call is retrievable by the next call from the archive, and by other handles",
      ev1.some((e) => e.type === "done") && ev2.some((e) => e.type === "done") &&
        rows.length >= 1 && firstReq.includes("MATERIAL-Q2-FACT") &&
        !firstReq.includes("MAT-RESEARCH-DONE") &&
        crossHandleHits.some((h: any) => String(h.content ?? "").includes("MATERIAL-Q2-FACT")),
      { searchCalls: retriever.calls.length, archiveRows: rows.length,
        anchors: matAnchors.map((a: any) => ({ type: a.anchor_type, payload: String(a.payload).slice(0, 200) })),
        freshPiHistory: !firstReq.includes("MAT-RESEARCH-DONE"),
        recallRequestHasFact: firstReq.includes("MATERIAL-Q2-FACT"),
        recallRequestTags: ["[Research Recall]", "[Session Memory]", "[Recovery Digest]"].filter((t) => firstReq.includes(t)),
        crossHandleHits: crossHandleHits.length });
  }

  // ---------- S5 interruption: no false success; material kept; recoverable ----------
  {
    const sInt = await store.createSession("chat");
    const retriever = new ProbeRetriever("MATERIAL-Q2-INTERRUPTED: durable fact 7.", "https://probe-q2.example/interrupted");
    const pInt = provider("int", ({ turn }) =>
      turn === 0
        ? assistantMessage([{ type: "toolCall", id: "q2i", name: "search", arguments: { query: "durable fact 7" } }], "toolUse", 300)
        : assistantMessage([{ type: "text", text: "FAKE-SUCCESS-MARKER" }], "stop", 100), { hangAfter: 1 });
    const caller = new AbortController();
    const rtInt = new PiAgentRuntime({
      retriever: retriever as any, store, sessionId: sInt.id, domain, model,
      streamFn: pInt.fn as any, piSessionDir: piDir, getApiKey: async () => "probe-key",
      signal: caller.signal,
    });
    setTimeout(() => caller.abort("probe interruption"), 500);
    const intEvents = await Promise.race([
      drain(rtInt.run("durable fact 7 question")),
      sleep(5000).then(() => null),
    ]);
    const intDone = intEvents?.some((e) => e.type === "done") ?? null;
    const intText = (intEvents ?? []).filter((e) => e.type === "text").map((e) => e.content).join("");
    const files = jsonlFor(piDir);
    const interruptedJsonl = files.map((f) => f.text).join("\n");

    const pAfter = provider("after", () => assistantMessage([{ type: "text", text: "RECOVERED-ANSWER" }], "stop", 100));
    const rtAfter = makeRuntime(sInt.id, pAfter, { store, piSessionDir: piDir });
    const afterEvents = await drain(rtAfter.run("what durable fact did we learn?"));
    const afterReq = pAfter.mainCalls()[0]?.text ?? "";
    record("S5", "an interrupted run is not recorded as success, its material survives, and the handle recovers",
      intEvents !== null && intDone === false && !/FAKE-SUCCESS-MARKER/.test(intText) &&
        !/FAKE-SUCCESS-MARKER/.test(interruptedJsonl) &&
        afterEvents.some((e) => e.type === "done") &&
        afterReq.includes("MATERIAL-Q2-INTERRUPTED"),
      { settled: intEvents !== null, doneEvent: intDone, interruptedText: intText.slice(0, 120),
        fakeSuccessInJsonl: /FAKE-SUCCESS-MARKER/.test(interruptedJsonl),
        recovered: afterEvents.some((e) => e.type === "done"),
        recoveredRequestHasFact: afterReq.includes("MATERIAL-Q2-INTERRUPTED") });
  }

  // ---------- S6 compaction then restart ----------
  {
    const sComp = await store.createSession("chat");
    const pComp = provider("comp", ({ turn }) =>
      turn === 0
        ? assistantMessage([{ type: "toolCall", id: "q2c", name: "search", arguments: { query: "ORIGINAL-Q2-COMPACTION-MARKER" } }], "toolUse", 4000)
        : assistantMessage([{ type: "text", text: "COMPACTED-RUN-ANSWER" }], "stop", 4000));
    const rtComp = new PiAgentRuntime({
      retriever: new ProbeRetriever("ORIGINAL-Q2-TOOL-MARKER: evidence.") as any,
      store, sessionId: sComp.id, domain, model: { ...model, contextWindow: 2000 },
      streamFn: pComp.fn as any, piSessionDir: piDir, contextWindow: 2000,
      piCompaction: { reserveTokens: 500, keepRecentTokens: 60 }, getApiKey: async () => "probe-key",
    });
    const evComp = await drain(rtComp.run("ORIGINAL-Q2-COMPACTION-MARKER question"));
    const compDone = evComp.find((e) => e.type === "done");

    const pRestart = provider("comp-restart", () => assistantMessage([{ type: "text", text: "COMPACTION-RESTART-OK" }], "stop", 100));
    const evRestart = await drain(makeRuntime(sComp.id, pRestart, {
      store, piSessionDir: piDir, contextWindow: 2000, model: { ...model, contextWindow: 2000 },
    }).run("after compaction restart"));
    const req = pRestart.mainCalls()[0]?.text ?? "";
    const jsonl = jsonlFor(piDir).map((f) => f.text).join("\n");
    record("S6", "after compaction a fresh runtime resumes the compacted summary; originals remain in the PI record",
      compDone?.usage?.compactionCalls >= 1 &&
        evRestart.some((e) => e.type === "done") &&
        req.includes("SUMMARY-MARKER-Q2") &&
        jsonl.includes("ORIGINAL-Q2-COMPACTION-MARKER") && jsonl.includes("ORIGINAL-Q2-TOOL-MARKER"),
      { compactionCalls: compDone?.usage?.compactionCalls,
        restartHasSummary: req.includes("SUMMARY-MARKER-Q2"),
        jsonlHasOriginalQuery: jsonl.includes("ORIGINAL-Q2-COMPACTION-MARKER"),
        jsonlHasOriginalTool: jsonl.includes("ORIGINAL-Q2-TOOL-MARKER") });
  }

  // ---------- S7 two connections consolidate in parallel ----------
  {
    const storeB = new SqliteSessionStore(dbPath);
    const sC1 = await store.createSession("chat");
    const sC2 = await storeB.createSession("chat");
    // One entity key for all three episodes; URL stays distinct on purpose.
    const episode = (sessionId: string, host: string, fact: string, n: number) => ({
      url: "https://" + host + "/item/" + n, entity: "https://" + host + "/item",
      title: "C" + host, snippet: fact + " episode " + n, source: "tavily", score: 1,
    });
    await store.saveResults(sC1.id, [1, 2, 3].map((n) => episode(sC1.id, "c1.example", "C1-FACT: one session's conclusion", n)));
    await storeB.saveResults(sC2.id, [1, 2, 3].map((n) => episode(sC2.id, "c2.example", "C2-FACT: the other session's conclusion", n)));

    // Overlap the plan phase: each summarize seam waits until both are inside.
    let arrived = 0;
    let release!: () => void;
    const both = new Promise<void>((r) => { release = r; });
    const summarize = async (eps: any[]) => {
      arrived++;
      if (arrived === 2) release();
      await Promise.race([both, sleep(2000)]);
      const text = eps.map((e) => e.snippet).join(" ");
      return text.includes("C1-FACT")
        ? "ALPHA protocol requires blue calibration on the eastern rig."
        : "OMEGA schedule favors green maintenance on the western rig.";
    };
    const classify = () => ({ label: "supported" as const, confidence: 0.9 });
    store.setConsolidationSeams?.({ summarize, classify });
    storeB.setConsolidationSeams?.({ summarize, classify });
    const t0 = Date.now();
    const [r1, r2] = await Promise.all([
      store.consolidateMemory!({ sessionIds: [sC1.id] }),
      storeB.consolidateMemory!({ sessionIds: [sC2.id] }),
    ]);
    const live = store.dbQuery<any>("SELECT id, content, source_episode_ids, valid_until FROM semantic_memories WHERE content LIKE 'ALPHA protocol%' OR content LIKE 'OMEGA schedule%'");
    const full = { ...r1, ...r2, updates: undefined, semanticIds: undefined } as any;
    const ep1 = store.dbQuery<any>("SELECT id, session_id, archived, superseded_by FROM retrieval_results WHERE session_id = ?", [sC1.id]);
    const ep2 = store.dbQuery<any>("SELECT id, session_id, archived, superseded_by FROM retrieval_results WHERE session_id = ?", [sC2.id]);
    storeB.close();
    record("S7", "two connections consolidate different sessions in parallel without overwriting either result",
      r1.add === 1 && r2.add === 1 && live.length === 2 &&
        live.every((r) => r.valid_until === null) &&
        live.some((r) => r.content.startsWith("ALPHA protocol")) &&
        live.some((r) => r.content.startsWith("OMEGA schedule")) &&
        ep1.length === 3 && ep2.length === 3 && ep1.every((r) => r.session_id === sC1.id) && ep2.every((r) => r.session_id === sC2.id),
      { wallMs: Date.now() - t0, reports: [r1, r2].map((r) => ({
          scanned: r.clustersScanned, triggered: r.clustersTriggered, llmUnavailable: r.llmUnavailable,
          add: r.add, update: r.update, skip: r.skip, conflict: r.conflict })),
        live: live.map((r) => ({ id: r.id, content: r.content, validUntil: r.valid_until })),
        episodes: [ep1.length, ep2.length] });
  }
} catch (e) {
  record("probe", "probe completed", false, { error: e instanceof Error ? e.stack ?? e.message : String(e) });
} finally {
  try { store.close(); } catch {}
  const failed = findings.filter((f) => !f.pass);
  mkdirSync(join(HERE, "out"), { recursive: true });
  writeFileSync(join(HERE, "out", "q2.json"), JSON.stringify({
    probe: "q2", generatedAt: new Date().toISOString(),
    inputSource: "real kernel + real SqliteSessionStore + real PI JSONL; scripted provider (no network)",
    findings,
  }, null, 2));
  try { rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  console.log("\n" + (failed.length === 0 ? "Q2: PASS" : "Q2: FAIL (" + failed.length + ")"));
  process.exit(failed.length === 0 ? 0 : 1);
}
