// Q3 probe: real model, controlled correction materials.
//
// Two modes per case:
//   current = summarize + deterministic fidelity gate (no correction checker,
//             no merge with the old knowledge) -> the pre-declared defects can
//             be observed honestly.
//   fixed   = the same seams plus the real-model correction checker and the
//             preserve-on-update merge.
//
// Cases (frozen in SAMPLES-Q1-Q3.md before this ran):
//   R1 business-hours correction, single evidence.
//   R2 publication-date-only update.
//   R3 negation about a different scope (holiday hours).
//   R4 low-reliability hearsay.
//   R5 multi-fact old knowledge, only one fact corrected.
//
// Run: node --import tsx prototype/pi-concurrency-reliability/probe-q3-real-model.ts
// Requires ANS_LLM_PROVIDER / MODEL / BASE_URL / API / API_KEY.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { createLlmSession } from "../../packages/kernel/src/llm-init";
import { createConsolidationSeams } from "../../packages/kernel/src/consolidation";
import { MemoryPipeline } from "../../packages/kernel/src/memory-pipeline";
import { SqliteSessionStore } from "../../packages/store/src/session-store";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });

const provider = process.env.ANS_LLM_PROVIDER ?? "";
const modelName = process.env.ANS_LLM_MODEL ?? "";
const baseUrl = process.env.ANS_LLM_BASE_URL;
const api = process.env.ANS_LLM_API as "chat" | "messages" | "responses" | undefined;
const apiKey = process.env.ANS_LLM_API_KEY;
if (!provider || !modelName) {
  console.error("missing ANS_LLM_PROVIDER / ANS_LLM_MODEL");
  process.exit(2);
}
if (baseUrl && !api) {
  console.error("ANS_LLM_BASE_URL requires ANS_LLM_API");
  process.exit(2);
}

const OLD = "Business hours are Monday to Friday 9-5. Support email is help@example.com.";
const OLD_PLAIN = "Business hours are Monday to Friday 9-5.";
const OLD_MULTI = "Business hours are Monday to Friday 9-5. Support email is help@example.com. The office is closed on public holidays.";
const NEW = "Support hours are now 24/7, no longer Monday to Friday 9-5.";
const ROW_EPISODES = (fact: string, n: number) => Array.from({ length: n }, (_, i) => ({
  url: "https://support.example/hours-" + (i + 1),
  title: "Support hours (source " + (i + 1) + ")",
  snippet: "The support page states: " + fact,
  source: "tavily",
  score: 1,
  entity: "support-hours",
}));

const findings: Array<{ id: string; mode: string; question: string; pass: boolean; evidence: unknown }> = [];
function record(id: string, mode: string, question: string, pass: boolean, evidence: unknown) {
  findings.push({ id, mode, question, pass, evidence });
  console.log((pass ? "  ok   " : "  FAIL ") + id + " [" + mode + "] — " + question);
}

const prompts: Array<{ label: string; prompt: string }> = [];
function loggedStream(inner: any, label: string) {
  return (model: any, context: any, options: any) => {
    try {
      const messages = context?.messages ?? [];
      const last = messages.slice().reverse().find((m: any) => m?.role === "user");
      const text = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? "");
      prompts.push({ label, prompt: String(text).slice(0, 3000) });
    } catch { /* logging must not break the call */ }
    return inner(model, context, options);
  };
}

async function runCase(
  c: { id: string; oldContent: string; newText: string; newTitle: string },
  mode: "current" | "fixed" | "diagnostic",
  llm: any,
  opts: { verifyOverride?: any; wantRefresh?: boolean } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "ans-q3-" + c.id + "-" + mode + "-"));
  const dbPath = join(root, "anysearch.db");
  const store = new SqliteSessionStore(dbPath);
  const session = await store.createSession("chat");
  await store.saveResults(session.id, ROW_EPISODES(c.oldContent, 3));
  const oldIds = (store.dbQuery<{ id: number }>("SELECT id FROM retrieval_results ORDER BY id")).map((r) => r.id);

  const raw = new Database(dbPath);
  const oldInfo = raw.prepare(
    "INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, ?, ?, ?, NULL)",
  ).run(c.oldContent, JSON.stringify(oldIds), 0.8, 0.95);
  const oldId = Number(oldInfo.lastInsertRowid);
  raw.prepare("INSERT INTO resume_anchors (session_id, anchor_type, payload) VALUES (?, 'rolling_summary', ?)")
    .run(session.id, JSON.stringify({ summary: "Session note: " + c.oldContent, timestamp: Date.now() }));
  raw.close();

  await store.saveResults(session.id, [{
    url: "https://support.example/official-update",
    title: c.newTitle,
    snippet: c.newText,
    source: "tavily",
    score: 1,
    entity: "support-hours",
  }]);
  const newEpisodeId = (store.dbQuery<{ id: number }>(
    "SELECT id FROM retrieval_results WHERE url = 'https://support.example/official-update'"))[0].id;

  const seams = createConsolidationSeams({ ...llm, streamFn: loggedStream(llm.streamFn, c.id + "-" + mode) } as any);
  store.setConsolidationSeams(
    mode === "current"
      ? { summarize: seams.summarize, classify: seams.classify }
      : { summarize: seams.summarize, classify: seams.classify, verify: opts.verifyOverride ?? seams.verify },
  );

  const report = await store.consolidateMemory({
    memoryIds: [newEpisodeId],
    allowSingleEvidence: true,
    thetaDup: 0.999,
    preserveOnUpdate: mode !== "current",
  });

  const sem = store.dbQuery<any>("SELECT id, content, valid_until, superseded_by FROM semantic_memories ORDER BY id");
  const oldAfter = sem.find((r) => r.id === oldId) ?? null;
  const live = sem.filter((r) => r.valid_until === null);
  const newRow = live.find((r) => r.id !== oldId) ?? null;
  const oldEpisodes = store.dbQuery<any>("SELECT id, superseded_by FROM retrieval_results WHERE id IN (" + oldIds.join(",") + ")");

  // R1 fixed also exercises the summary rebuild against real model output.
  let refresh: unknown = null;
  if (c.id === "R1" && opts.wantRefresh) {
    const pipeline = new MemoryPipeline({
      store,
      models: { ...llm.models, streamSimple: loggedStream(llm.streamFn, "R1-refresh") },
      retriever: { search: async () => ({ results: [], answers: [], metadata: {} }) } as any,
      domain: {} as any,
      model: llm.model,
      streamFn: loggedStream(llm.streamFn, "R1-refresh"),
      sessionId: session.id,
      getApiKey: async () => llm.apiKey,
    } as any);
    const r = await pipeline.refreshIfNeeded();
    const anchors = store.dbQuery<any>(
      "SELECT payload FROM resume_anchors WHERE session_id = ? AND anchor_type = 'rolling_summary' ORDER BY id DESC LIMIT 1",
      session.id,
    );
    let text = "";
    try { text = JSON.parse(anchors[0]?.payload ?? "{}")?.summary ?? ""; } catch { text = ""; }
    const status = await store.getAnchorStatus?.(session.id, "rolling_summary");
    refresh = { result: r, summary: text, pausedAfter: status?.payload?.needsRefresh === true };
  }

  store.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  return {
    mode,
    report: {
      add: report.add, update: report.update, skip: report.skip, conflict: report.conflict,
      staleUpdates: report.staleUpdates, verifyRejected: report.verifyRejected,
      updates: report.updates, verifyDetails: report.verifyDetails,
      summariesNeedingRefresh: report.summariesNeedingRefresh,
    },
    usage: seams.usage,
    knowledge: {
      oldContent: oldAfter?.content ?? null,
      oldStillLive: oldAfter?.valid_until === null,
      oldSupersededBy: oldAfter?.superseded_by ?? null,
      liveRows: live.map((r) => ({ id: r.id, content: r.content })),
      newContent: newRow?.content ?? null,
      oldEpisodes,
    },
    refresh,
  };
}

const cases = [
  { id: "R1", oldContent: OLD, newTitle: "Support hours updated (official page)", newText: "Official update: " + NEW + " Effective 2026-11-01." },
  { id: "R2", oldContent: OLD_PLAIN, newTitle: "Support page republished", newText: "Published 2026-11-01. Business hours are Monday to Friday 9-5. The page was republished with a new date." },
  { id: "R3", oldContent: OLD_PLAIN, newTitle: "Holiday hours notice", newText: "Holiday business hours are not Monday to Friday 9-5; the office is closed on public holidays." },
  { id: "R4", oldContent: OLD_PLAIN, newTitle: "Forum post about support", newText: "Someone on a forum says support might be 24/7 now, but the poster is not certain and gives no official source." },
  { id: "R5", oldContent: OLD_MULTI, newTitle: "Support hours updated (official page)", newText: "Official update: " + NEW },
];

const evidence: any = {
  probe: "q3-real-model",
  startedAt: new Date().toISOString(),
  fixedSamples: "SAMPLES-Q1-Q3.md",
  model: {
    provider, model: modelName, baseUrlPresent: !!baseUrl, api: api ?? null,
    apiKeyLength: apiKey?.length ?? 0,
    note: "custom endpoint: provider does not return USD; cost is reported as unknown, never free",
  },
  cases: [],
  checks: {},
};

try {
  const llm = await createLlmSession({
    provider, model: modelName, baseUrl, api, apiKey,
  } as any);

  for (const c of cases) {
    const current = await runCase(c, "current", llm);
    const fixed = await runCase(c, "fixed", llm);
    evidence.cases.push({ id: c.id, current, fixed });
    console.log("case " + c.id + " done (current update=" + current.report.update + ", fixed update=" + fixed.report.update + ")");
  }

  // Diagnostics: the same frozen inputs, but the correction checker is
  // scripted to say "same fact, reliable". This isolates the mechanical
  // question (does the real model keep uncorrected facts / rebuild the
  // summary) from the real model's same-fact judgment, which is reported
  // separately above.
  const scriptedVerify = async () => ({
    sameFact: true,
    reliable: true,
    reason: "diagnostic: scripted checker isolates the preservation/refresh mechanics",
  });
  const r1Diag = await runCase(cases[0], "diagnostic", llm, { verifyOverride: scriptedVerify, wantRefresh: true });
  const r5Diag = await runCase(cases[4], "diagnostic", llm, { verifyOverride: scriptedVerify });
  evidence.diagnostics = { R1: r1Diag, R5: r5Diag };
  console.log("diagnostics done (R1 update=" + r1Diag.report.update + ", R5 update=" + r5Diag.report.update + ")");

  // Reliability is about repeatability on the SAME frozen input. Repeat the
  // real-model fixed path 3 times per case and report the outcome distribution.
  const stability: any = { R1: [], R5: [] };
  for (const id of ["R1", "R5"]) {
    const c = cases.find((x) => x.id === id)!;
    for (let i = 1; i <= 3; i++) {
      const r = await runCase(c, "fixed", llm);
      stability[id].push({
        run: i,
        update: r.report.update,
        verifyRejected: r.report.verifyRejected,
        verifyDetails: r.report.verifyDetails,
        content: r.knowledge.newContent,
        usage: r.usage,
      });
      console.log("stability " + id + " run " + i + ": update=" + r.report.update + " reject=" + r.report.verifyRejected);
    }
  }
  evidence.stability = stability;

  const byId = (id: string, mode: string) => evidence.cases.find((x: any) => x.id === id)?.[mode];
  const cur = (id: string) => byId(id, "current");
  const fix = (id: string) => byId(id, "fixed");

  // Sentence-level check: "no longer ... 9-5" and an explicit "this was
  // corrected" note are not restatements; a sentence that asserts the old
  // hours as a current fact is. A whole line is too coarse because a merge can
  // put the correction and the old claim in the same line.
  // Normalize en/em dashes: real-model text writes "9–5" while the frozen
  // sample uses "9-5". Without this the check silently misses restatements.
  const restatesOldHours = (text: string) => text
    .replace(/[–—]/g, "-")
    .split(/(?<=[.!?])\s+|\n+/)
    .some((sentence) => /Monday to Friday 9-5/i.test(sentence) &&
      !/no longer|corrected|must not|not restated|not current/i.test(sentence));

  // R1 primary correction: real model, real gate.
  record("R1", "fixed", "real model corrects the same fact, old knowledge closed and replaced",
    fix("R1").report.update === 1 && fix("R1").knowledge.oldStillLive === false &&
      /24\/7/.test(fix("R1").knowledge.newContent ?? "") &&
      !restatesOldHours(fix("R1").knowledge.newContent ?? "") &&
      typeof fix("R1").knowledge.oldSupersededBy === "number",
    { report: fix("R1").report, content: fix("R1").knowledge.newContent });
  record("R1", "current", "without the new seams the same correction also lands (pipeline behavior unchanged)",
    cur("R1").report.update === 1, cur("R1").report);
  // The real-model checker refused R1 ("business hours" vs "support hours").
  // Keep that failure above, and isolate the mechanics with the diagnostic run.
  record("R1-mechanics", "diagnostic", "real model summary + rebuild use the corrected materials, not the old conclusion",
    r1Diag.report.update === 1 && !!r1Diag.refresh &&
      r1Diag.refresh.result?.refreshed === true &&
      /24\/7/.test(r1Diag.refresh.summary ?? "") &&
      !restatesOldHours(r1Diag.refresh.summary ?? "") &&
      r1Diag.refresh.pausedAfter === false,
    { report: r1Diag.report, refresh: r1Diag.refresh });

  // R2 date-only.
  record("R2", "fixed", "a publication-date update does not replace the fact",
    fix("R2").report.update === 0 && fix("R2").knowledge.oldStillLive === true, fix("R2").report);
  record("R2", "current", "current path also refuses the date-only update",
    cur("R2").report.update === 0 && cur("R2").knowledge.oldStillLive === true, cur("R2").report);

  // R3 different scope.
  record("R3", "fixed", "holiday-hours negation does not overwrite regular-hours knowledge",
    fix("R3").report.update === 0 && fix("R3").knowledge.oldStillLive === true &&
      fix("R3").report.verifyRejected === 1, fix("R3").report);
  record("R3", "current", "PRE-DECLARED DEFECT reproduced: negation-only path wrongly updates regular hours from a holiday notice",
    cur("R3").report.update === 1, { report: cur("R3").report, knowledge: cur("R3").knowledge });

  // R4 hearsay.
  // Any of the three refusal paths is acceptable: the checker rejects it, the
  // fidelity gate rejects it, or no existing row is similar enough to be a
  // correction target. The frozen criterion is only "no update".
  record("R4", "fixed", "uncertain hearsay does not replace reliable knowledge",
    fix("R4").report.update === 0 && fix("R4").knowledge.oldStillLive === true &&
      (fix("R4").report.verifyRejected >= 1 || fix("R4").report.conflict >= 1 || fix("R4").report.skip >= 1),
    fix("R4").report);
  record("R4", "current", "PRE-DECLARED DEFECT not reproduced: the existing gate already refuses the hearsay claim",
    cur("R4").report.update === 0 && cur("R4").knowledge.oldStillLive === true,
    { report: cur("R4").report, knowledge: cur("R4").knowledge });

  // R5 multi-fact preservation.
  const merged = fix("R5").knowledge.newContent ?? "";
  record("R5", "fixed", "one corrected fact keeps the other still-valid facts and drops the corrected one",
    fix("R5").report.update === 1 &&
      /24\/7/.test(merged) && /help@example\.com/.test(merged) && /holiday/i.test(merged) &&
      !restatesOldHours(merged),
    { content: merged, report: fix("R5").report });
  record("R5", "current", "PRE-DECLARED DEFECT reproduced: current update drops the other still-valid facts",
    cur("R5").report.update === 1 &&
      !(/help@example\.com/.test(cur("R5").knowledge.newContent ?? "") && /holiday/i.test(cur("R5").knowledge.newContent ?? "")),
    { content: cur("R5").knowledge.newContent, report: cur("R5").report });
  // Mechanics only: scripted checker says "same fact, reliable"; the real model
  // must still preserve the facts the new material did not correct.
  const diagMerged = r5Diag.knowledge.newContent ?? "";
  record("R5-mechanics", "diagnostic", "real model merge keeps the other facts AND drops the corrected one",
    r5Diag.report.update === 1 &&
      /24\/7/.test(diagMerged) && /help@example\.com/.test(diagMerged) && /holiday/i.test(diagMerged) &&
      // the old hours claim must stop being presented as current
      !restatesOldHours(diagMerged),
    { content: diagMerged, report: r5Diag.report });

  // Repeatability: the frozen input must get the same decision every time.
  for (const id of ["R1", "R5"]) {
    const outcomes = stability[id].map((x: any) => x.update === 1 ? "update" : "refuse");
    record(id + "-stability", "fixed", "same frozen input repeated 3x gets the same decision",
      new Set(outcomes).size === 1,
      { outcomes, details: stability[id].map((x: any) => ({ update: x.update, reasons: x.verifyDetails?.map((v: any) => v.reason) })) });
  }

  // Q19: cost basis on the real endpoint.
  const usage = fix("R1").usage;
  record("Q19", "fixed", "cost is reported as unknown (no price table), not as free",
    usage.costBasis === "unknown" && usage.missing.some((m: string) => m.includes("price unknown")),
    { costBasis: usage.costBasis, costUsd: usage.costUsd, missing: usage.missing });

  // No credential material in the evidence file.
  const text = JSON.stringify(evidence);
  record("SEC", "all", "evidence carries no API key material",
    !apiKey || !text.includes(apiKey), { apiKeyLength: apiKey?.length ?? 0 });

  // Total real-model spend for THIS probe run. Cost stays unknown because the
  // custom endpoint has no price table; tokens are provider-reported.
  const allUsage = [
    ...evidence.cases.flatMap((c: any) => [c.current.usage, c.fixed.usage]),
    evidence.diagnostics.R1.usage, evidence.diagnostics.R5.usage,
    ...stability.R1.map((x: any) => x.usage), ...stability.R5.map((x: any) => x.usage),
  ];
  evidence.usageTotals = allUsage.reduce((a: any, u: any) => ({
    calls: a.calls + u.calls,
    inputTokens: a.inputTokens + u.inputTokens,
    outputTokens: a.outputTokens + u.outputTokens,
    cacheReadTokens: a.cacheReadTokens + u.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + u.cacheWriteTokens,
    totalTokens: a.totalTokens + u.totalTokens,
  }), { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 });
  evidence.usageTotals.costBasis = "unknown";
  evidence.checks = findings;
  evidence.prompts = prompts.slice(0, 60);
  writeFileSync(join(OUT, "q3-real-model.json"), JSON.stringify(evidence, null, 2) + "\n");
  const failed = findings.filter((f) => !f.pass);
  for (const f of findings) {
    if (!f.pass) console.log("  FAIL DETAIL " + f.id + " [" + f.mode + "] " + JSON.stringify(f.evidence).slice(0, 800));
  }
  console.log("\n" + (failed.length === 0 ? "all checks passed" : failed.length + " check(s) failed") + " — out/q3-real-model.json");
  process.exitCode = failed.length === 0 ? 0 : 1;
} catch (e) {
  console.error("probe failed: " + (e instanceof Error ? e.stack ?? e.message : String(e)));
  process.exitCode = 2;
}
