// Q3 probe — correction propagation, end to end.
// Real kernel (MemoryPipeline + PiAgentRuntime) + real SqliteSessionStore;
// scripted provider/seams (no network). Shows the business-hours case:
//
//   S1 seed: three episodes -> consolidate -> one live semantic memory.
//   S2 a rolling summary + recall digest carry the old hours (as they would
//      after a real session).
//   S3 one newer, contradicting material (single evidence, scoped by memoryId)
//      corrects the knowledge: old semantic row soft-closed with superseded_by,
//      its supporting episodes retired, new row inserted.
//   S4 affected summaries are paused (anchor_status needsRefresh=true) and stop
//      being injected; unrelated session knowledge is untouched.
//   S5 refreshIfNeeded rebuilds the summary from LIVE materials only; the
//      refresh request itself never carries the superseded row.
//   S6 a real runtime request after propagation carries the new fact and not
//      the old one; original rows remain traceable in the archive.
//
// Run: node --import tsx prototype/pi-esm-full-sdk/probe-q3.ts

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteSessionStore } from "../../packages/store/src/session-store";
import { PiAgentRuntime } from "../../packages/kernel/src/pi-runtime";
import { MemoryPipeline } from "../../packages/kernel/src/memory-pipeline";

const HERE = dirname(fileURLToPath(import.meta.url));
const findings: Array<{ id: string; question: string; pass: boolean; evidence: unknown }> = [];
function record(id: string, question: string, pass: boolean, evidence: unknown) {
  findings.push({ id, question, pass, evidence });
  console.log((pass ? "  ok   " : "  FAIL ") + id + " — " + question);
}

function assistantMessage(text: string, totalTokens = 200) {
  return {
    role: "assistant", content: [{ type: "text", text }],
    api: "openai-completions", provider: "probe", model: "probe-model",
    usage: {
      input: Math.max(0, totalTokens - 10), output: 10, cacheRead: 0, cacheWrite: 0,
      totalTokens, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop", timestamp: Date.now(),
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
      yield { type: "done", reason: "stop", message };
    },
    result: async () => message,
  };
}
function textOf(message: any): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) return message.content.map((c: any) => c?.text ?? "").join("\n");
  return "";
}
function contextText(context: any): string {
  return JSON.stringify((context?.messages ?? []).map((m: any) => ({ role: m.role, text: textOf(m), sections: m?.sections })));
}

// Scripted provider. A summarization request is detected by its system prompt.
// The refresh summary is built from what the request actually carried, so the
// assertion proves the superseded row never reached it.
function scriptedProvider() {
  const calls: Array<{ kind: string; text: string }> = [];
  const fn = (_model: any, context: any, _options: any) => {
    const system = JSON.stringify((context?.messages ?? []).find((m: any) => m?.role === "system")?.sections ?? {}) +
      textOf((context?.messages ?? []).find((m: any) => m?.role === "system"));
    const text = contextText(context);
    const isRefresh = system.includes("context summarization assistant") || text.includes("Rebuild the research summary");
    let reply: any;
    if (isRefresh) {
      const sawNew = text.includes("24/7");
      // The NEW fact mentions the old schedule as negated; only the old row's
      // own sentence ("Business hours are ...") marks a stale-material leak.
      const sawOld = /Business hours are Monday to Friday 9-5/.test(text);
      reply = assistantMessage(
        sawNew && !sawOld
          ? "REFRESHED-SUMMARY: support is available 24/7 every day (rebuilt from live materials)."
          : "REFRESH-BAD-SUMMARY",
        150,
      );
      calls.push({ kind: "refresh", text });
    } else {
      reply = assistantMessage("MAIN-ANSWER: current support hours are 24/7.", 150);
      calls.push({ kind: "main", text });
    }
    return streamOf(reply);
  };
  return { fn, calls };
}

const domain: any = {
  sources: { enabled: ["tavily"] },
  prompts: [{ name: "system", content: "PROBE-Q3-DOMAIN: probe research agent." }],
  skills: { active: ["search"] },
  hooks: { toolWhitelist: ["search"] },
  rag: { adapter: "none" },
};
const model: any = {
  id: "probe-model", name: "probe-model", api: "openai-completions", provider: "probe",
  contextWindow: 200000, maxTokens: 4096, reasoning: false, input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const fakeModels = { getModel: () => model };
const retriever: any = {
  async search(q: any) {
    return { query: q.query, mode: "fast", results: [], answers: [], metadata: {} };
  },
};

const workDir = mkdtempSync(join(tmpdir(), "ans-q3-"));
const dbPath = join(workDir, "anysearch.db");
const store = new SqliteSessionStore(dbPath);
const OLD_FACT = "Business hours are Monday to Friday 9-5.";
const NEW_FACT = "Support hours are now 24/7, no longer Monday to Friday 9-5.";
const row = (n: number, url = "https://biz.example/hours") => ({
  url, title: "Support hours", snippet: "The support page states: " + OLD_FACT + " (page " + n + ")",
  source: "tavily", score: 1,
});

try {
  const sBiz = await store.createSession("chat");
  const sOther = await store.createSession("chat");

  // ---------- S1 seed: 3 episodes -> one live semantic row ----------
  await store.saveResults(sBiz.id, [1, 2, 3].map((n) => row(n)));
  const seamCalls: Array<{ mode: string; evidence: string[] }> = [];
  const summarize = async (eps: any[]) => {
    const text = eps.map((e) => e.snippet).join(" ");
    if (text.includes("24/7")) {
      seamCalls.push({ mode: "correction", evidence: eps.map((e) => e.snippet) });
      return NEW_FACT;
    }
    if (text.includes("UNRELATED-KNOWLEDGE")) {
      seamCalls.push({ mode: "unrelated", evidence: eps.map((e) => e.snippet) });
      return "UNRELATED-KNOWLEDGE: the unrelated conclusion stays valid.";
    }
    seamCalls.push({ mode: "seed", evidence: eps.map((e) => e.snippet) });
    return OLD_FACT;
  };
  const classify = () => ({ label: "supported" as const, confidence: 0.95 });
  store.setConsolidationSeams?.({ summarize, classify });
  const seed = await store.consolidateMemory!({ sessionIds: [sBiz.id] });
  const oldSem = store.dbQuery<any>("SELECT id, content, source_episode_ids, valid_until, superseded_by FROM semantic_memories WHERE content LIKE 'Business hours%'")[0];
  record("S1", "three-business-hours episodes consolidate into one live semantic memory",
    seed.add === 1 && !!oldSem && oldSem.valid_until === null,
    { report: { add: seed.add, update: seed.update, skip: seed.skip }, oldSem });

  // ---------- S2 summaries that carry the old fact ----------
  await store.saveAnchor(sBiz.id, "rolling_summary", { summary: "Session summary so far: " + OLD_FACT + " Users asked about weekend coverage.", timestamp: Date.now() });
  await store.saveAnchor(sBiz.id, "l2_recall", { hits: "Recalled: " + OLD_FACT, timestamp: Date.now() });
  const sumRowsBefore = store.dbQuery<any>("SELECT COUNT(*) AS n FROM resume_anchors WHERE session_id = ? AND anchor_type = 'rolling_summary'", [sBiz.id])[0].n;

  // Unrelated session: its own knowledge + summary must survive the correction.
  await store.saveResults(sOther.id, [1, 2, 3].map((n) => ({
    url: "https://other.example/topic/" + n, entity: "https://other.example/topic", title: "Unrelated topic",
    snippet: "UNRELATED-KNOWLEDGE: the unrelated conclusion stays valid. Episode " + n,
    source: "tavily", score: 1,
  })));
  const otherSeed = await store.consolidateMemory!({ sessionIds: [sOther.id] });
  await store.saveAnchor(sOther.id, "rolling_summary", { summary: "UNRELATED-SUMMARY remains valid.", timestamp: Date.now() });
  const unrelatedSem = store.dbQuery<any>("SELECT id, content, valid_until FROM semantic_memories WHERE content LIKE 'UNRELATED-KNOWLEDGE%'")[0];

  // ---------- S3 single-evidence correction, scoped to the new material ----------
  await store.saveResults(sBiz.id, [{
    url: "https://biz.example/hours-2026", title: "Support hours updated (official page)",
    snippet: "Official update: " + NEW_FACT + " Effective 2026-11-01.",
    source: "tavily", score: 1,
  }]);
  const newEpisode = store.dbQuery<any>("SELECT id FROM retrieval_results WHERE url = 'https://biz.example/hours-2026'")[0];
  const correction = await store.consolidateMemory!({ memoryIds: [newEpisode.id], allowSingleEvidence: true });
  const newSem = store.dbQuery<any>("SELECT id, content, source_episode_ids, valid_until FROM semantic_memories WHERE content LIKE 'Support hours are now%'")[0];
  const oldSemAfter = store.dbQuery<any>("SELECT id, content, valid_until, superseded_by FROM semantic_memories WHERE id = ?", [oldSem.id])[0];
  const retired = store.dbQuery<any>("SELECT id, superseded_by, archived FROM retrieval_results WHERE url = 'https://biz.example/hours'");
  record("S3", "one newer contradicting material updates the knowledge, soft-closes the old row, retires its episodes",
    correction.update === 1 && !!newSem && newSem.valid_until === null &&
      oldSemAfter.valid_until !== null && oldSemAfter.superseded_by === newSem.id &&
      retired.length === 3 && retired.every((r) => r.superseded_by === newSem.id && r.archived === 0) &&
      JSON.parse(newSem.source_episode_ids).includes(newEpisode.id) &&
      JSON.parse(oldSem.source_episode_ids).every((id: number) => JSON.parse(newSem.source_episode_ids).includes(id)) &&
      correction.updates.length === 1 && correction.updates[0].oldId === oldSem.id && correction.updates[0].newId === newSem.id,
    { report: { add: correction.add, update: correction.update, skip: correction.skip, conflict: correction.conflict },
      singleEvidenceSkipped: correction.singleEvidenceSkipped, newSem, oldSemAfter,
      retiredEpisodes: retired.map((r) => ({ id: r.id, supersededBy: r.superseded_by, archived: r.archived })),
      updates: correction.updates, seamCalls: seamCalls.map((c) => c.mode) });

  // ---------- S4 pause + injection gate + unrelated isolation ----------
  const summaryStatus = await store.getAnchorStatus!(sBiz.id, "rolling_summary");
  const recallStatus = await store.getAnchorStatus!(sBiz.id, "l2_recall");
  const otherStatus = await store.getAnchorStatus!(sOther.id, "rolling_summary");
  const refreshProvider = scriptedProvider();
  const pipeline = new MemoryPipeline({
    store, models: fakeModels, retriever, domain, model,
    streamFn: refreshProvider.fn as any, sessionId: sBiz.id, getApiKey: async () => "probe-key",
  } as any);
  const pausedInjection = textOf((await pipeline.inject([{ role: "user", content: [{ type: "text", text: "what are the support hours?" }] }] as any))[0]);
  record("S4", "affected summaries are paused from injection; unrelated session knowledge is untouched",
    correction.summariesNeedingRefresh.includes(sBiz.id) &&
      summaryStatus?.payload?.needsRefresh === true && recallStatus?.payload?.needsRefresh === true &&
      otherStatus === undefined &&
      !pausedInjection.includes("Business hours are Monday to Friday 9-5") &&
      unrelatedSem?.valid_until === null && otherSeed.add === 1,
    { summariesNeedingRefresh: correction.summariesNeedingRefresh,
      summaryStatus: summaryStatus?.payload ?? null, recallStatus: recallStatus?.payload ?? null,
      otherStatus: otherStatus?.payload ?? null, otherStatusIsUndefined: otherStatus === undefined,
      pausedInjectionHead: pausedInjection.slice(0, 300),
      pausedHasOld: pausedInjection.includes("Business hours are Monday to Friday 9-5"),
      unrelatedSeed: { add: otherSeed.add, update: otherSeed.update, skip: otherSeed.skip, scanned: otherSeed.clustersScanned },
      unrelatedSemantic: unrelatedSem });

  // ---------- S5 rebuild from live materials only ----------
  const refresh = await pipeline.refreshIfNeeded();
  const refreshReq = refreshProvider.calls.find((c) => c.kind === "refresh")?.text ?? "";
  const statusAfter = await store.getAnchorStatus!(sBiz.id, "rolling_summary");
  const anchors = await store.getAnchors(sBiz.id);
  const latestSummary = anchors.filter((a: any) => a.anchorType === "rolling_summary").at(-1)?.payload as any;
  const digest = await store.getLiveKnowledgeDigest!(40);
  const refreshedInjection = textOf((await pipeline.inject([{ role: "user", content: [{ type: "text", text: "what are the support hours now?" }] }] as any))[0]);
  const summaryRowsAfter = store.dbQuery<any>("SELECT COUNT(*) AS n FROM resume_anchors WHERE session_id = ? AND anchor_type = 'rolling_summary'", [sBiz.id])[0].n;
  const second = await pipeline.refreshIfNeeded(); // pause cleared -> no second call
  record("S5", "refresh rebuilds the summary from live materials and clears the pause",
    refresh.refreshed === true && statusAfter?.payload?.needsRefresh === false &&
      String(latestSummary?.summary ?? "").includes("REFRESHED-SUMMARY") &&
      String(latestSummary?.summary ?? "").includes("24/7") &&
      summaryRowsAfter > sumRowsBefore &&
      digest.some((d) => d.id === newSem.id) && !digest.some((d) => d.id === oldSem.id) &&
      refreshedInjection.includes("REFRESHED-SUMMARY") &&
      !refreshedInjection.includes("Business hours are Monday to Friday 9-5") &&
      refreshReq.includes("[knowledge #" + newSem.id + "]") && !refreshReq.includes("[knowledge #" + oldSem.id + "]") &&
      second.refreshed === false && refreshProvider.calls.filter((c) => c.kind === "refresh").length === 1,
    { refresh, statusAfter: statusAfter?.payload ?? null, latestSummary: latestSummary?.summary ?? null,
      digestHasNew: digest.some((d) => d.id === newSem.id), digestHasOld: digest.some((d) => d.id === oldSem.id),
      refreshedInjection: refreshedInjection.slice(0, 400), extraSummaryRows: summaryRowsAfter - sumRowsBefore,
      refreshRequestHead: refreshReq.slice(0, 500), refreshHasNewRow: refreshReq.includes("[knowledge #" + newSem.id + "]"),
      refreshHasOldRow: refreshReq.includes("[knowledge #" + oldSem.id + "]"),
      secondRefresh: second, secondRefreshCalls: refreshProvider.calls.filter((c) => c.kind === "refresh").length });

  // ---------- S6 real runtime request after propagation ----------
  const p = scriptedProvider();
  const runtime = new PiAgentRuntime({
    retriever, store, sessionId: sBiz.id, domain, model, models: fakeModels,
    streamFn: p.fn as any, getApiKey: async () => "probe-key",
    piSessionDir: join(workDir, "pi-sessions"),
  });
  const events: any[] = [];
  for await (const e of runtime.run("What are the current support hours?")) events.push(e);
  const done = events.find((e) => e.type === "done");
  const firstMain = p.calls.find((c) => c.kind === "main")?.text ?? "";
  record("S6", "the post-correction model request states the new fact and no longer presents the old one",
    firstMain.includes("24/7") && firstMain.includes("no longer") &&
      firstMain.includes("REFRESHED-SUMMARY") &&
      !firstMain.includes("[Session Memory] Business hours are Monday to Friday 9-5") &&
      done !== undefined &&
      runtime.getMemoryUsage() !== null,
    { firstMainHead: firstMain.slice(0, 700), done: done?.summary ?? null,
      context: done?.context ?? null, usage: done?.usage ?? null,
      memoryUsage: runtime.getMemoryUsage() });

  // ---------- traceability: originals are retained, relations point forward ----------
  const oldSummaryRows = store.dbQuery<any>("SELECT id, payload FROM resume_anchors WHERE session_id = ? AND anchor_type = 'rolling_summary' ORDER BY id", [sBiz.id]);
  const finalOld = store.dbQuery<any>("SELECT id, valid_until, superseded_by FROM semantic_memories WHERE id = ?", [oldSem.id])[0];
  const finalNew = store.dbQuery<any>("SELECT id, valid_until, superseded_by FROM semantic_memories WHERE id = ?", [newSem.id])[0];
  record("S7", "old rows and old anchor history stay queryable; relations are traceable forward",
    oldSummaryRows.length >= 2 && oldSummaryRows.some((r) => String(r.payload).includes("Monday to Friday 9-5")) &&
      finalOld.valid_until !== null && finalOld.superseded_by === newSem.id &&
      finalNew.valid_until === null,
    { rollingSummaryVersions: oldSummaryRows.length,
      oldAnchorStillHasOldFact: oldSummaryRows.some((r) => String(r.payload).includes("Monday to Friday 9-5")),
      finalOld, finalNew });
} catch (e) {
  record("probe", "probe completed", false, { error: e instanceof Error ? e.stack ?? e.message : String(e) });
} finally {
  try { store.close(); } catch {}
  const failed = findings.filter((f) => !f.pass);
  mkdirSync(join(HERE, "out"), { recursive: true });
  writeFileSync(join(HERE, "out", "q3.json"), JSON.stringify({
    probe: "q3", generatedAt: new Date().toISOString(),
    inputSource: "real MemoryPipeline + PiAgentRuntime + SqliteSessionStore; scripted provider and seams (no network)",
    findings,
  }, null, 2));
  try { rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  console.log("\n" + (failed.length === 0 ? "Q3: PASS" : "Q3: FAIL (" + failed.length + ")"));
  process.exit(failed.length === 0 ? 0 : 1);
}
