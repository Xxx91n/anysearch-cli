// #261 — single-evidence correction, preserved facts and the two checks
// (spec D6/D7/D8, tests T4).
//
// What is under test, and what is not:
//   - a lone material may only CORRECT existing knowledge (never add);
//   - the correction-relationship check (same fact + reliable) gates every
//     automatic replacement, single-evidence and batch alike;
//   - the merged replacement keeps the old row's uncorrected facts, and the
//     final-content check (basis + retention) gates the write;
//   - a failed/empty merge or a failed final check withholds the replacement
//     (no fallback to the candidate summary);
//   - supersede chains: old row -> new row, old episodes -> new row, and the
//     corrected episodes leave current-fact recall while the merged knowledge
//     keeps carrying the preserved facts;
//   - refusals hand back the old content, the candidate, the sources, the
//     verdict and what to check next;
//   - polarity: a negation in the candidate alone no longer selects UPDATE.
//
// The judgement itself is NOT tested here: every check is an injected seam
// with a fixed verdict (the T4 "controlled answer" entry proves the flow, not
// the model's judgement quality). The real-model evidence for the confirmed
// A1-A4 samples is recorded separately.
//
// No test framework (repo convention).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "../src/session-store";
import {
  polarityContradiction,
  type ConsolidateEvidence,
  type ConsolidateVerifyVerdict,
} from "../src/consolidate";
import { __setEmbeddingModuleForTest } from "../src/embedding-arm";
import { __setExtractorForTest } from "@anysearch-cli/embedding";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error("FAIL: " + msg); }
}

// Deterministic embedding seam: identical input -> identical vector, so dedup
// behaves the same on every run without float32 boundary noise.
function vecFor(input: string): Float32Array {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const out = new Float32Array(16);
  let state = h || 1;
  for (let i = 0; i < out.length; i++) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    out[i] = (state / 0xffffffff) * 2 - 1;
  }
  return out;
}
__setExtractorForTest(async (input: string) => ({ data: vecFor(input) }));

const dir = mkdtempSync(join(tmpdir(), "ans-261-"));
const stores: SqliteSessionStore[] = [];
function openStore(db: string): SqliteSessionStore {
  const s = new SqliteSessionStore(join(dir, db));
  stores.push(s);
  return s;
}
// Direct SQL over a fresh readonly handle keeps the assertions independent of
// the store's own read paths (those get their own section below).
function q(db: string, sql: string, ...params: unknown[]): any {
  const d = new Database(join(dir, db), { readonly: true });
  try { return d.prepare(sql).get(...params); } finally { d.close(); }
}

// --- fixtures -------------------------------------------------------------

// The confirmed A1/A4 sample text (Chinese) for the correction-flow sections:
// content assertions are string containment, so no FTS dependence.
const A1_OLD = "A 公司在线客服的服务时间为工作日（周一至周五）9:00—17:00。客服邮箱为 help@example.com。";
const A1_CANDIDATE = "A 公司在线客服自 2026-11-01 起改为 7×24 小时全天候服务。";
const A1_MERGED = "A 公司在线客服自 2026-11-01 起改为 7×24 小时全天候服务，替代原工作日（周一至周五）9:00—17:00 的安排。客服邮箱为 help@example.com。";
const A4_OLD = "A 公司在线客服工作日（周一至周五）9:00—17:00 提供服务。客服邮箱为 help@example.com。公共假期暂停人工客服，仅保留自助服务。";
const A4_MERGED = "A 公司在线客服自 2026-11-01 起改为 7×24 小时全天候服务，替代原工作日（周一至周五）9:00—17:00 安排。客服邮箱 help@example.com 和公共假期暂停人工客服、仅保留自助服务的安排保持不变。";

// English fixtures for the recall section (FTS-matched queries).
const R_OLD = "Acme online support operates weekdays 9:00-17:00. Support email is help@acme.com.";
const R_CANDIDATE = "Acme official notice effective 2026-11-01: online support is now 24x7 every day, replacing the weekday 9:00-17:00 schedule.";
const R_MERGED = "Acme official notice effective 2026-11-01: online support is now 24x7 every day, replacing the weekday 9:00-17:00 schedule. The support email help@acme.com is unchanged.";

const CORRECTION: ConsolidateVerifyVerdict = {
  alreadyCurrent: false, sameFact: true, reliable: true, relation: "correction",
  reason: "official notice with effective date replaces the same service-hours fact",
};

// A summarize seam that answers the candidate for the new material and the
// merged text once the CURRENT KNOWLEDGE item joins the evidence (the UPDATE
// merge call).
function twoStageSummarize(candidate: string, merged: string) {
  return async (eps: ConsolidateEvidence[]): Promise<string | null> =>
    eps.some((e) => e.title === "CURRENT KNOWLEDGE") ? merged : candidate;
}

async function seedEpisode(
  store: SqliteSessionStore, sessionId: string, url: string, title: string, snippet: string, entity: string,
): Promise<number> {
  const ra = await store.adjudicateMemory(sessionId, [{ url, title, snippet, source: "tavily", evidence: 0.9, entity }]);
  const id = ra[0]?.insertedId;
  if (typeof id !== "number") throw new Error("seed failed for " + url);
  return id;
}

// Build the "old knowledge" row: three episodes of one entity, one batch run.
async function buildKnowledge(
  store: SqliteSessionStore, db: string, sessionId: string, entity: string, content: string, urlBase: string,
): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 1; i <= 3; i++) {
    ids.push(await seedEpisode(store, sessionId, urlBase + "-v" + i, entity + " v" + i, content, entity));
  }
  const rep = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [...ids], sessionIdNotApplied: false } },
    { summarize: async () => content, classify: () => ({ label: "supported", confidence: 0.95 }) },
  );
  assert(rep.add === 1, "seed: the batch run built one knowledge row (add=" + rep.add + ")");
  void db;
  return ids;
}

const SUPPORTED = () => ({ label: "supported" as const, confidence: 0.95 });

// --- 1. polarity rule (D7 negation misjudgment fix) -----------------------

{
  assert(polarityContradiction("Zeta no longer supports REST", "Zeta supports REST") === true,
    "polarity: candidate negated, live not -> contradiction");
  assert(polarityContradiction("Zeta supports REST", "Zeta no longer supports REST") === true,
    "polarity: live negated, candidate not -> contradiction");
  assert(polarityContradiction("Zeta no longer supports REST", "Zeta never supported REST") === false,
    "polarity: same negation restated -> NOT a contradiction");
  assert(polarityContradiction("Zeta supports REST", "Zeta supports GraphQL") === false,
    "polarity: no negation anywhere -> no contradiction");
}

// --- 2. A1: a clear correction of the same fact lands, others survive ------

{
  const db = "a1.db";
  const store = openStore(db);
  const seed = await store.createSession("eval");
  const oldIds = await buildKnowledge(store, db, seed.id, "a-support-hours", A1_OLD, "https://a.example/support-hours");
  const corr = await store.createSession("eval");
  const newId = await seedEpisode(store, corr.id, "https://a.example/notice-2026-11-01",
    "A 公司客服时间更新通知（官方）",
    "A 公司官方通知（2026-11-01 生效）：在线客服自 2026-11-01 起改为 7×24 小时全天候服务，替代原工作日（周一至周五）9:00—17:00 的安排。", "a-support-hours");

  const rep = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [newId], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: twoStageSummarize(A1_CANDIDATE, A1_MERGED),
      classify: SUPPORTED,
      verify: async () => CORRECTION,
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true, reason: "all facts kept" }),
    },
  );

  assert(rep.update === 1 && rep.add === 0 && rep.noop === 0, "A1: one correction lands (update=" + rep.update + " add=" + rep.add + " noop=" + rep.noop + ")");
  assert(rep.verifyRejected === 0 && rep.correctionsIncomplete === 0, "A1: nothing refused or incomplete");
  assert(rep.verifiedCorrections.length === 1, "A1: the accepted correction records the checker's verdict");
  const vc = rep.verifiedCorrections[0]!;
  assert(vc.sameFact === true && vc.reliable === true && vc.relation === "correction" && typeof vc.reason === "string",
    "A1: the verdict shows same-fact + reliable + explicit correction with a reason");
  assert(vc.oldContent === A1_OLD, "A1: the verdict names the knowledge it corrected");

  const up = rep.updates[0]!;
  const oldRow = q(db, "SELECT id, content, valid_until, superseded_by FROM semantic_memories WHERE id = ?", up.oldId);
  const newRow = q(db, "SELECT id, content, valid_until, superseded_by, confidence, source_episode_ids FROM semantic_memories WHERE id = ?", up.newId);
  assert(oldRow.valid_until !== null && oldRow.superseded_by === up.newId,
    "A1: the old row is soft-closed and names its successor");
  assert(newRow.valid_until === null && newRow.superseded_by === null, "A1: the new row is the live version");
  assert(String(newRow.content).includes("7×24") && String(newRow.content).includes("help@example.com"),
    "A1: the live content states the correction AND keeps the email");
  assert(Number(newRow.confidence) !== 0.85, "A1: no fixed 0.85 posing as reliability (confidence=" + newRow.confidence + ")");
  const sources = JSON.parse(newRow.source_episode_ids) as number[];
  assert(sources.includes(newId) && oldIds.every((id) => sources.includes(id)),
    "A1: the new row's sources union the new material and the old row's materials");
  for (const id of oldIds) {
    const ep = q(db, "SELECT superseded_by FROM retrieval_results WHERE id = ?", id);
    assert(ep.superseded_by === up.newId, "A1: old episode " + id + " points at the new knowledge row");
  }
  const newEp = q(db, "SELECT superseded_by FROM retrieval_results WHERE id = ?", newId);
  assert(newEp.superseded_by === null, "A1: the correcting material itself stays live");
  assert(up.supersededEpisodeIds.length === 3, "A1: the report lists the superseded episodes");
  assert(up.withinScope === false && up.outsideScopeMaterialIds.length === 3,
    "A1: the correction targeted knowledge outside the selected materials, visibly");
  store.close();
}

// --- 3. A2: a different object is refused and handed back -----------------

{
  const db = "a2.db";
  const store = openStore(db);
  const seed = await store.createSession("eval");
  await buildKnowledge(store, db, seed.id, "a-store-hours", "A 公司门店营业时间为每天 10:00—20:00。", "https://a.example/store");
  const corr = await store.createSession("eval");
  const newId = await seedEpisode(store, corr.id, "https://a.example/support-now",
    "A 公司在线客服时间说明", "A 公司在线客服自 2026-11-01 起提供 7×24 小时全天候服务。", "a-support-hours");

  const rep = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [newId], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: twoStageSummarize("A 公司在线客服自 2026-11-01 起提供 7×24 小时全天候服务。", "merged"),
      classify: SUPPORTED,
      verify: async () => ({ alreadyCurrent: false, sameFact: false, reliable: true, relation: "different", reason: "material is about online support, knowledge is about store hours" }),
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
    },
  );

  assert(rep.update === 0 && rep.add === 0 && rep.verifyRejected === 1, "A2: a different object corrects nothing (verifyRejected=" + rep.verifyRejected + ")");
  assert(rep.verifyDetails.length === 1, "A2: the refusal is handed back");
  const d = rep.verifyDetails[0]!;
  assert(d.oldContent.includes("门店营业时间"), "A2: the refusal carries the old content");
  assert(d.candidate.length > 0, "A2: the refusal carries the candidate");
  assert(d.evidence.length === 1 && d.evidence[0]!.url === "https://a.example/support-now", "A2: the refusal carries the candidate's source");
  assert(d.sameFact === false && d.relation === "different" && typeof d.reason === "string",
    "A2: the refusal carries the verdict and its reason");
  assert(d.followUp.includes("同一对象"), "A2: the follow-up names what to check (object mismatch)");
  const live = q(db, "SELECT COUNT(*) c FROM semantic_memories WHERE valid_until IS NULL").c;
  assert(live === 1, "A2: the store-hours knowledge is still the only live row");
  const ep = q(db, "SELECT superseded_by FROM retrieval_results WHERE id = ?", newId);
  assert(ep.superseded_by === null, "A2: the new material is retained, not deleted");
  store.close();
}

// --- 4. A3: an unreliable source is refused -------------------------------

{
  const db = "a3.db";
  const store = openStore(db);
  const seed = await store.createSession("eval");
  await buildKnowledge(store, db, seed.id, "a-support-hours", A1_OLD, "https://a.example/support-hours");
  const corr = await store.createSession("eval");
  const newId = await seedEpisode(store, corr.id, "https://forum.example/thread-123",
    "论坛帖子：A 公司客服是不是改时间了",
    "论坛帖子称：听说 A 公司在线客服可能已改成全天在线，但发帖人不确定，也没有给出官方链接。", "a-support-hours");

  const rep = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [newId], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: twoStageSummarize("听说 A 公司在线客服可能已改成全天在线。", "merged"),
      classify: SUPPORTED,
      verify: async () => ({ alreadyCurrent: false, sameFact: true, reliable: false, relation: "unclear", reason: "hearsay without an official source" }),
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
    },
  );

  assert(rep.update === 0 && rep.verifyRejected === 1, "A3: an unreliable source does not override");
  const d = rep.verifyDetails[0]!;
  assert(d.reliable === false && d.followUp.length > 0, "A3: the refusal names unreliable evidence and what to check");
  const live = q(db, "SELECT content FROM semantic_memories WHERE valid_until IS NULL");
  assert(live.content === A1_OLD, "A3: the old knowledge is untouched");
  store.close();
}

// --- 5. A4: one old knowledge, several facts, only one replaced -----------

{
  const db = "a4.db";
  const store = openStore(db);
  const seed = await store.createSession("eval");
  await buildKnowledge(store, db, seed.id, "a-support-hours", A4_OLD, "https://a.example/support-facts");
  const corr = await store.createSession("eval");
  const newId = await seedEpisode(store, corr.id, "https://a.example/notice-2026-11-01b",
    "A 公司客服时间更新通知（官方）",
    "A 公司官方通知（2026-11-01 生效）：在线客服改为 7×24 小时全天候服务，替代原工作日（周一至周五）9:00—17:00 安排。客服邮箱和公共假期的人工客服安排保持不变。", "a-support-hours");

  const rep = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [newId], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: twoStageSummarize("在线客服改为 7×24 小时全天候服务。", A4_MERGED),
      classify: SUPPORTED,
      verify: async () => CORRECTION,
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true, reason: "email and holiday exception kept" }),
    },
  );

  assert(rep.update === 1, "A4: the correction lands");
  const up = rep.updates[0]!;
  const newRow = q(db, "SELECT content FROM semantic_memories WHERE id = ?", up.newId);
  const content = String(newRow.content);
  assert(content.includes("7×24"), "A4: the corrected fact is the current one");
  assert(content.includes("help@example.com"), "A4: the email fact survives");
  assert(content.includes("公共假期暂停人工客服"), "A4: the holiday exception survives");
  assert(!content.startsWith("在线客服改为 7×24"), "A4: the committed text is the merge, not the bare candidate");
  store.close();
}

// --- 6. already-current material: no duplicate version --------------------

{
  const db = "same.db";
  const store = openStore(db);
  const seed = await store.createSession("eval");
  await buildKnowledge(store, db, seed.id, "a-support-hours", A1_OLD, "https://a.example/support-hours");
  const corr = await store.createSession("eval");
  const newId = await seedEpisode(store, corr.id, "https://a.example/support-hours-again",
    "A 公司客服时间说明（重申）", "A 公司在线客服的服务时间为工作日（周一至周五）9:00—17:00。客服邮箱为 help@example.com。", "a-support-hours");
  const before = q(db, "SELECT COUNT(*) c FROM semantic_memories").c;

  const rep = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [newId], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: twoStageSummarize(A1_OLD, A1_MERGED),
      classify: SUPPORTED,
      verify: async () => ({ alreadyCurrent: true, sameFact: true, reliable: true, relation: "same", reason: "restates current knowledge" }),
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
    },
  );

  assert(rep.noop === 1 && rep.update === 0 && rep.add === 0, "same fact: touch only, no new version (noop=" + rep.noop + ")");
  assert(q(db, "SELECT COUNT(*) c FROM semantic_memories").c === before, "same fact: no duplicate row was created");
  store.close();
}

// --- 7. a lone material creates nothing -----------------------------------

{
  const db = "lone.db";
  const store = openStore(db);
  const corr = await store.createSession("eval");
  const newId = await seedEpisode(store, corr.id, "https://ex.com/lone",
    "Lone material", "A single fresh material with no live knowledge to correct.", "lone-topic");

  const rep = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [newId], sessionIdNotApplied: false }, allowSingleEvidence: true },
    { summarize: async () => "A single fresh material with no live knowledge to correct.", classify: SUPPORTED, verify: async () => CORRECTION, verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }) },
  );
  assert(rep.singleEvidenceSkipped === 1 && rep.add === 0 && rep.update === 0,
    "lone material: may correct only — nothing to correct means no write");

  // Without the flag the batch threshold stands.
  const rep2 = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [newId], sessionIdNotApplied: false } },
    { summarize: async () => "candidate", classify: SUPPORTED, verify: async () => CORRECTION, verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }) },
  );
  assert(rep2.clustersScanned === 1 && rep2.clustersTriggered === 0,
    "lone material: without allowSingleEvidence the batch threshold skips it");
  store.close();
}

// --- 7c. superseded materials do not count toward the batch gate ----------
// Three replaced episodes plus one new material is FOUR rows in the cluster, so
// the old `eps.length` check called it a batch run and let that lone material
// write a brand-new conclusion. The gate now counts LIVE materials only
// (#273 review).
{
  const db = "gate-live-only.db";
  const store = openStore(db);
  const seed = await store.createSession("eval");
  const oldIds = await buildKnowledge(store, db, seed.id, "a-support-hours", A1_OLD, "https://a.example/support-hours");
  const corr = await store.createSession("eval");
  const newId = await seedEpisode(store, corr.id, "https://a.example/notice", "通知", "官方通知：改为 7×24。", "a-support-hours");
  // Replace the old row, so the three seed materials become superseded.
  const first = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [newId], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: twoStageSummarize(A1_CANDIDATE, A1_MERGED),
      classify: SUPPORTED,
      verify: async () => CORRECTION,
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
    },
  );
  assert(first.update === 1, "gate-live setup: the correction landed");
  assert(oldIds.every((id) => q(db, "SELECT superseded_by FROM retrieval_results WHERE id = ?", id).superseded_by !== null),
    "gate-live setup: the seed materials are now superseded");

  // Now a lone NEW material, unrelated enough that dedup would `add`. With the
  // three superseded rows counted, this used to clear CLUSTER_MIN and write a
  // new long-term fact; with only live materials counted it stays single-evidence
  // and is skipped.
  const lone = await store.createSession("eval");
  const loneId = await seedEpisode(store, lone.id, "https://a.example/unrelated", "无关材料",
    "公司年会安排在大会议室举行。", "a-support-hours");
  const rep = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [...oldIds, loneId], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: async () => "公司年会安排在大会议室举行。",
      classify: SUPPORTED,
      // Not a correction of the live row: the cluster has one live material, so
      // this must be treated as single-evidence and refused, not added.
      verify: async () => ({ alreadyCurrent: false, sameFact: false, reliable: true, relation: "different" }),
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
    },
  );
  assert(rep.add === 0,
    "gate-live: one live material does not become batch evidence (add=" + rep.add + ")");
  assert(rep.update === 0, "gate-live: nothing is replaced (update=" + rep.update + ")");
  const liveRows = Number(q(db, "SELECT COUNT(*) c FROM semantic_memories WHERE valid_until IS NULL").c);
  assert(liveRows === 1, "gate-live: the archive still holds one live row (got " + liveRows + ")");
  store.close();
}

// --- 7d. a noop joins its materials so a later correction can retire them --
// Without the merge the restating material keeps `superseded_by` empty, so a
// later correction only retires the OLD sources and the stale text stays in
// recall (#273 review).
{
  const db = "noop-links.db";
  const store = openStore(db);
  const seed = await store.createSession("eval");
  const oldIds = await buildKnowledge(store, db, seed.id, "zeta-api", "Zeta service supports REST.", "https://ex.com/zeta");
  const restated = await store.createSession("eval");
  // Exact restatement: same text, different source session.
  const restatedId = await seedEpisode(store, restated.id, "https://ex.com/zeta-copy", "Zeta copy",
    "Zeta service supports REST.", "zeta-api");
  const rep = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [restatedId], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: async () => "Zeta service supports REST.",
      classify: SUPPORTED,
      verify: async () => ({ alreadyCurrent: true, sameFact: true, reliable: true, relation: "same" }),
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
    },
  );
  assert(rep.noop === 1, "noop-links: the restatement is a noop");
  const live = q(db, "SELECT source_episode_ids FROM semantic_memories WHERE valid_until IS NULL");
  const sources = JSON.parse(live.source_episode_ids) as number[];
  assert(sources.includes(restatedId),
    "noop-links: the restating material joined the row's source set (got " + JSON.stringify(sources) + ")");
  assert(oldIds.every((id) => sources.includes(id)),
    "noop-links: the original sources stay in the set");
  store.close();
}
// --- 7b. no correction checker: a lone material may not write at all --------
// The negation-keyword quadruple is not a substitute for the same-fact /
// reliability verdict, so with `verify` absent neither a correction nor a new
// row is written (CodeRabbit review on #273).
{
  const db = "lone-noverify.db";
  const store = openStore(db);
  const seed = await store.createSession("eval");
  const oldIds = await buildKnowledge(store, db, seed.id, "a-support-hours", A1_OLD, "https://a.example/support-hours");
  const corr = await store.createSession("eval");
  const newId = await seedEpisode(store, corr.id, "https://a.example/notice", "通知", "官方通知：改为 7×24。", "a-support-hours");
  const rep = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [newId], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      // A negated candidate is exactly what the old keyword rule would have
      // turned into an UPDATE.
      summarize: async (eps) => eps.some((e) => e.title === "CURRENT KNOWLEDGE")
        ? "A 公司在线客服不再按工作日 9:00—17:00 提供服务，改为 7×24。"
        : "A 公司在线客服不再按工作日 9:00—17:00 提供服务。",
      classify: SUPPORTED,
      // deliberately no verify
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
    },
  );
  assert(rep.singleEvidenceSkipped === 1 && rep.update === 0 && rep.add === 0,
    "no checker: a lone material writes nothing, even on a polarity disagreement");
  assert(q(db, "SELECT COUNT(*) c FROM semantic_memories WHERE valid_until IS NULL").c === 1,
    "no checker: the old knowledge is untouched");
  assert(oldIds.every((id) => q(db, "SELECT superseded_by FROM retrieval_results WHERE id = ?", id).superseded_by === null),
    "no checker: no episode was superseded");
  store.close();
}

// --- 7b2. a heuristic UPDATE cannot bypass a missing verifier -------------
{
  const db = "no-verifier-update.db";
  const store = openStore(db);
  const session = await store.createSession("eval");
  await buildKnowledge(store, db, session.id, "zeta-api",
    "Zeta service supports the REST API. Deploys run weekly.", "https://ex.com/old-zeta");
  const next = await store.createSession("eval");
  const id = await seedEpisode(store, next.id, "https://ex.com/new-zeta",
    "Zeta correction", "Zeta service no longer supports the REST API.", "zeta-api");
  const rep = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [id], sessionIdNotApplied: false }, allowSingleEvidence: true },
    { summarize: twoStageSummarize("Zeta service no longer supports the REST API.",
        "Zeta service no longer supports the REST API. Deploys run weekly."),
      classify: SUPPORTED,
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }) },
  );
  assert(rep.singleEvidenceSkipped === 1 && rep.update === 0,
    "missing relation checker: heuristic UPDATE must be withheld");
  assert(String(q(db, "SELECT content FROM semantic_memories WHERE valid_until IS NULL").content).includes("supports the REST"),
    "missing relation checker: old knowledge stays current");
  store.close();
}

// --- 7b3. mixed clusters must not feed retired episodes to summarization ---
{
  const db = "mixed-retired.db";
  const store = openStore(db);
  const seed = await store.createSession("eval");
  const oldIds = await buildKnowledge(store, db, seed.id, "zeta-api",
    "Zeta service supports REST. Deploys run weekly.", "https://ex.com/retired");
  const currentId = Number(q(db, "SELECT id FROM semantic_memories WHERE valid_until IS NULL").id);
  const rw = new Database(join(dir, db), { readonly: false });
  rw.prepare("UPDATE retrieval_results SET superseded_by = ? WHERE id IN (" +
    oldIds.map(() => "?").join(",") + ")").run(currentId, ...oldIds);
  rw.close();
  const next = await store.createSession("eval");
  const fresh: number[] = [];
  for (let i = 0; i < 3; i++) fresh.push(await seedEpisode(store, next.id,
    "https://ex.com/fresh-" + i, "New note " + i,
    "An unrelated new fact is stated here.", "zeta-api"));
  let seen: ConsolidateEvidence[] = [];
  await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [...oldIds, ...fresh], sessionIdNotApplied: false } },
    { summarize: async (evidence) => { seen = evidence; return "An unrelated new fact is stated here."; },
      classify: SUPPORTED },
  );
  assert(seen.length === 3 && seen.every((e) => e.url.includes("/fresh-")),
    "mixed cluster: superseded materials cannot become current evidence");
  store.close();
}

// --- 8. withheld corrections (merge / final check) -------------------------

{
  // 8a. empty merge.
  {
    const db = "m-empty.db";
    const store = openStore(db);
    const seed = await store.createSession("eval");
    await buildKnowledge(store, db, seed.id, "a-support-hours", A1_OLD, "https://a.example/support-hours");
    const corr = await store.createSession("eval");
    const newId = await seedEpisode(store, corr.id, "https://a.example/notice", "通知", "官方通知：改为 7×24。", "a-support-hours");
    const rep = await store.consolidateMemory(
      { scope: { by: "memory", sessionIds: [], memoryIds: [newId], sessionIdNotApplied: false }, allowSingleEvidence: true },
      {
        summarize: async (eps) => eps.some((e) => e.title === "CURRENT KNOWLEDGE") ? null : A1_CANDIDATE,
        classify: SUPPORTED,
        verify: async () => CORRECTION,
        verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
      },
    );
    assert(rep.correctionsIncomplete === 1 && rep.update === 0, "merge-empty: the replacement is withheld");
    assert(rep.verifiedCorrections.length === 0,
      "merge-empty: a withheld correction is not also reported as verified");
    const d = rep.incompleteDetails[0]!;
    assert(d.stage === "merge-empty" && d.oldContent === A1_OLD && d.candidate === A1_CANDIDATE,
      "merge-empty: the detail names the stage, the old content and the candidate");
    const live = q(db, "SELECT content FROM semantic_memories WHERE valid_until IS NULL");
    assert(live.content === A1_OLD, "merge-empty: the old knowledge stays live");
    assert(q(db, "SELECT COUNT(*) c FROM semantic_memories").c === 1, "merge-empty: nothing was written");
    store.close();
  }

  // 8b. throwing merge.
  {
    const db = "m-fail.db";
    const store = openStore(db);
    const seed = await store.createSession("eval");
    await buildKnowledge(store, db, seed.id, "a-support-hours", A1_OLD, "https://a.example/support-hours");
    const corr = await store.createSession("eval");
    const newId = await seedEpisode(store, corr.id, "https://a.example/notice", "通知", "官方通知：改为 7×24。", "a-support-hours");
    const rep = await store.consolidateMemory(
      { scope: { by: "memory", sessionIds: [], memoryIds: [newId], sessionIdNotApplied: false }, allowSingleEvidence: true },
      {
        summarize: async (eps) => {
          if (eps.some((e) => e.title === "CURRENT KNOWLEDGE")) throw new Error("summarizer exploded");
          return A1_CANDIDATE;
        },
        classify: SUPPORTED,
        verify: async () => CORRECTION,
        verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
      },
    );
    assert(rep.correctionsIncomplete === 1 && rep.update === 0, "merge-failed: the replacement is withheld");
    assert(rep.incompleteDetails[0]!.stage === "merge-failed" && String(rep.incompleteDetails[0]!.reason).includes("exploded"),
      "merge-failed: the detail carries the failure reason");
    assert(q(db, "SELECT COUNT(*) c FROM semantic_memories WHERE valid_until IS NULL").c === 1,
      "merge-failed: the old knowledge stays live");
    store.close();
  }

  // 8c. final check: preservation failed (the merge dropped the email).
  {
    const db = "f-pres.db";
    const store = openStore(db);
    const seed = await store.createSession("eval");
    await buildKnowledge(store, db, seed.id, "a-support-hours", A1_OLD, "https://a.example/support-hours");
    const corr = await store.createSession("eval");
    const newId = await seedEpisode(store, corr.id, "https://a.example/notice", "通知", "官方通知：改为 7×24。", "a-support-hours");
    const rep = await store.consolidateMemory(
      { scope: { by: "memory", sessionIds: [], memoryIds: [newId], sessionIdNotApplied: false }, allowSingleEvidence: true },
      {
        summarize: twoStageSummarize(A1_CANDIDATE, A1_CANDIDATE), // merge "forgot" the old facts
        classify: SUPPORTED,
        verify: async () => CORRECTION,
        verifyFinal: async () => ({ supported: true, preserved: false, corrected: true, noExtras: true, reason: "the email fact vanished" }),
      },
    );
    assert(rep.correctionsIncomplete === 1 && rep.update === 0, "final-check(preserved): the replacement is withheld");
    assert(rep.incompleteDetails[0]!.stage === "final-check" && String(rep.incompleteDetails[0]!.reason).includes("email"),
      "final-check(preserved): the detail names the retention failure");
    assert(rep.verifiedCorrections.length === 0,
      "final-check(preserved): a withheld correction is not also reported as verified");
    assert(q(db, "SELECT content FROM semantic_memories WHERE valid_until IS NULL").content === A1_OLD,
      "final-check(preserved): the old knowledge stays live");
    store.close();
  }

  // 8d. final check: unsupported statement in the merged text.
  {
    const db = "f-supp.db";
    const store = openStore(db);
    const seed = await store.createSession("eval");
    await buildKnowledge(store, db, seed.id, "a-support-hours", A1_OLD, "https://a.example/support-hours");
    const corr = await store.createSession("eval");
    const newId = await seedEpisode(store, corr.id, "https://a.example/notice", "通知", "官方通知：改为 7×24。", "a-support-hours");
    const rep = await store.consolidateMemory(
      { scope: { by: "memory", sessionIds: [], memoryIds: [newId], sessionIdNotApplied: false }, allowSingleEvidence: true },
      {
        summarize: twoStageSummarize(A1_CANDIDATE, A1_MERGED + " 客服团队扩编至 500 人。"), // merge invented a number
        classify: SUPPORTED,
        verify: async () => CORRECTION,
        verifyFinal: async () => ({ supported: false, preserved: true, corrected: true, noExtras: false, reason: "the headcount has no basis" }),
      },
    );
    assert(rep.correctionsIncomplete === 1 && rep.update === 0, "final-check(supported): the replacement is withheld");
    assert(q(db, "SELECT COUNT(*) c FROM semantic_memories").c === 1, "final-check(supported): nothing was written");
    store.close();
  }

  // 8g. the merge drops the ACCEPTED correction (corrected = false).
  // `supported` and `preserved` can both be true while the new value never made
  // it into the merged text: the old row's facts are all there, and the
  // correction — the reason this run exists — is gone. Writing that row would
  // lose the accepted fact (#273 review).
  {
    const db = "f-lost.db";
    const store = openStore(db);
    const seed = await store.createSession("eval");
    await buildKnowledge(store, db, seed.id, "a-support-hours", A1_OLD, "https://a.example/support-hours");
    const corr = await store.createSession("eval");
    const newId = await seedEpisode(store, corr.id, "https://a.example/notice", "通知", "官方通知：改为 7×24。", "a-support-hours");
    const rep = await store.consolidateMemory(
      { scope: { by: "memory", sessionIds: [], memoryIds: [newId], sessionIdNotApplied: false }, allowSingleEvidence: true },
      {
        // The merge kept the old text verbatim — the new hours are missing.
        summarize: twoStageSummarize(A1_CANDIDATE, A1_OLD),
        classify: SUPPORTED,
        verify: async () => CORRECTION,
        verifyFinal: async () => ({ supported: true, preserved: true, corrected: false, noExtras: true, reason: "the new hours are missing" }),
      },
    );
    assert(rep.correctionsIncomplete === 1 && rep.update === 0,
      "final-check(corrected): a merge that drops the accepted correction is withheld (update=" + rep.update + ")");
    assert(q(db, "SELECT content FROM semantic_memories WHERE valid_until IS NULL").content === A1_OLD,
      "final-check(corrected): the old knowledge is untouched");
    store.close();
  }

  // 8h. the merge smuggles in a fact nobody asked to change (noExtras = false).
  // This is the hole the relationship check cannot close: it only inspects the
  // candidate, while the merge also sees the raw material. A lone material
  // must not add a new long-term conclusion "through the back door" (#273 review).
  {
    const db = "f-extra.db";
    const store = openStore(db);
    const seed = await store.createSession("eval");
    await buildKnowledge(store, db, seed.id, "a-support-hours", A1_OLD, "https://a.example/support-hours");
    const corr = await store.createSession("eval");
    const newId = await seedEpisode(store, corr.id, "https://a.example/notice", "通知",
      "官方通知：改为 7×24。另外白金客户每月收费 500 元。", "a-support-hours");
    const rep = await store.consolidateMemory(
      { scope: { by: "memory", sessionIds: [], memoryIds: [newId], sessionIdNotApplied: false }, allowSingleEvidence: true },
      {
        summarize: twoStageSummarize(
          A1_CANDIDATE,
          A1_MERGED + " 白金客户每月收费 500 元。",
        ),
        classify: SUPPORTED,
        verify: async () => CORRECTION,
        verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: false, reason: "the price is neither old knowledge nor the accepted correction" }),
      },
    );
    assert(rep.correctionsIncomplete === 1 && rep.update === 0,
      "final-check(noExtras): a merge that adds an uncorrected fact is withheld (update=" + rep.update + ")");
    assert(q(db, "SELECT COUNT(*) c FROM semantic_memories").c === 1,
      "final-check(noExtras): nothing was written");
    store.close();
  }

  // 8e. no final-content seam: the replacement is withheld, not guessed.
  // The claim gate alone cannot tell whether an uncorrected fact survived, so
  // "no checker" must mean "no replacement" (CodeRabbit review on #273).
  {
    const db = "f-gate.db";
    const store = openStore(db);
    const seed = await store.createSession("eval");
    await buildKnowledge(store, db, seed.id, "a-support-hours", A1_OLD, "https://a.example/support-hours");
    const corr = await store.createSession("eval");
    const newId = await seedEpisode(store, corr.id, "https://a.example/notice", "通知", "官方通知：改为 7×24。", "a-support-hours");
    const rep = await store.consolidateMemory(
      { scope: { by: "memory", sessionIds: [], memoryIds: [newId], sessionIdNotApplied: false }, allowSingleEvidence: true },
      {
        summarize: twoStageSummarize(A1_CANDIDATE, A1_MERGED),
        classify: () => ({ label: "supported", confidence: 0.9 }),
        verify: async () => CORRECTION,
        // deliberately no verifyFinal
      },
    );
    assert(rep.correctionsIncomplete === 1 && rep.update === 0,
      "no final checker: the replacement is withheld (update=" + rep.update + ")");
    assert(rep.incompleteDetails[0]!.stage === "final-check", "no final checker: the stage is named");
    assert(String(rep.incompleteDetails[0]!.reason).includes("no final-content checker"),
      "no final checker: the reason says the retention check could not run");
    assert(q(db, "SELECT COUNT(*) c FROM semantic_memories WHERE valid_until IS NULL").c === 1,
      "no final checker: the old knowledge stays live");
    store.close();
  }

  // 8f. the checker's reply has no usable `relation`: refuse, do not "close enough".
  {
    const db = "f-relation.db";
    const store = openStore(db);
    const seed = await store.createSession("eval");
    await buildKnowledge(store, db, seed.id, "a-support-hours", A1_OLD, "https://a.example/support-hours");
    const corr = await store.createSession("eval");
    const newId = await seedEpisode(store, corr.id, "https://a.example/notice", "通知", "官方通知：改为 7×24。", "a-support-hours");
    const rep = await store.consolidateMemory(
      { scope: { by: "memory", sessionIds: [], memoryIds: [newId], sessionIdNotApplied: false }, allowSingleEvidence: true },
      {
        summarize: twoStageSummarize(A1_CANDIDATE, A1_MERGED),
        classify: SUPPORTED,
        // sameFact + reliable but relation missing (the parser drops an
        // unrecognised value instead of inventing one).
        verify: async () => ({ sameFact: true, reliable: true }),
        verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
      },
    );
    assert(rep.update === 0 && rep.verifyRejected === 1,
      "relation missing: sameFact/reliable alone do not replace knowledge (update=" + rep.update + ")");
    assert(q(db, "SELECT content FROM semantic_memories WHERE valid_until IS NULL").content === A1_OLD,
      "relation missing: the old knowledge is untouched");
    store.close();
  }
}

// --- 9. batch corrections pass the same gate ------------------------------

{
  // 9a. accepted batch update (deterministic trigger + verify + merge).
  {
    const db = "b-ok.db";
    const store = openStore(db);
    const seed = await store.createSession("eval");
    await buildKnowledge(store, db, seed.id, "zeta-api", "Zeta service supports the REST API. Deploys run weekly.", "https://ex.com/zeta");
    const corr = await store.createSession("eval");
    const ids: number[] = [];
    for (let i = 1; i <= 3; i++) {
      ids.push(await seedEpisode(store, corr.id, "https://ex.com/zeta-new-" + i, "Zeta change v" + i,
        "Zeta service no longer supports the REST API as of November.", "zeta-api"));
    }
    const rep = await store.consolidateMemory(
      { scope: { by: "memory", sessionIds: [], memoryIds: ids, sessionIdNotApplied: false } },
      {
        summarize: twoStageSummarize(
          "Zeta service no longer supports the REST API.",
          "Zeta service no longer supports the REST API. Deploys still run weekly.",
        ),
        classify: SUPPORTED,
        verify: async () => CORRECTION,
        verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
      },
    );
    assert(rep.update === 1 && rep.verifiedCorrections.length === 1,
      "batch: a verified contradiction updates through the same gate");
    const up = rep.updates[0]!;
    const newRow = q(db, "SELECT content FROM semantic_memories WHERE id = ?", up.newId);
    assert(String(newRow.content).includes("Deploys still run weekly"),
      "batch: the merge kept the uncorrected deploy fact");
    const mergedRow = q(db, "SELECT superseded_by FROM semantic_memories WHERE id = ?", up.oldId);
    assert(mergedRow.superseded_by === up.newId, "batch: the old row names its successor");
    store.close();
  }

  // 9b. refused batch update: the polarity disagreement is not enough.
  {
    const db = "b-no.db";
    const store = openStore(db);
    const seed = await store.createSession("eval");
    await buildKnowledge(store, db, seed.id, "zeta-api", "Zeta service supports the REST API. Deploys run weekly.", "https://ex.com/zeta");
    const corr = await store.createSession("eval");
    const ids: number[] = [];
    for (let i = 1; i <= 3; i++) {
      ids.push(await seedEpisode(store, corr.id, "https://ex.com/zeta-alt-" + i, "Zeta alt v" + i,
        "Zeta service no longer supports the REST API as of November.", "zeta-api"));
    }
    const rep = await store.consolidateMemory(
      { scope: { by: "memory", sessionIds: [], memoryIds: ids, sessionIdNotApplied: false } },
      {
        summarize: twoStageSummarize("Zeta service no longer supports the REST API.", "merged"),
        classify: SUPPORTED,
        verify: async () => ({ alreadyCurrent: false, sameFact: false, reliable: true, relation: "different", reason: "different subject" }),
        verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
      },
    );
    assert(rep.update === 0 && rep.verifyRejected === 1,
      "batch: a polarity disagreement without the same-fact verdict corrects nothing");
    assert(q(db, "SELECT COUNT(*) c FROM semantic_memories WHERE valid_until IS NULL").c === 1,
      "batch: the refused run leaves one live row");
    store.close();
  }

  // 9c3. a one-value edit must NOT be swallowed as a duplicate.
  //
  // "opens at 09:00" -> "opens at 10:00" scores 0.867 token overlap, which the
  // old near-verbatim rule read as `noop`: the access count went up, the old
  // time stayed current. `noop` now requires an exact restatement, so this
  // near-duplicate reaches the relationship check (#273 review).
  {
    const db = "b-near-dup.db";
    const store = openStore(db);
    const seed = await store.createSession("eval");
    await buildKnowledge(store, db, seed.id, "acme-support",
      "Acme online support phone line opens at 09:00 every weekday except public holidays.",
      "https://acme.example/support");
    const corr = await store.createSession("eval");
    const ids: number[] = [];
    for (let i = 1; i <= 3; i++) {
      ids.push(await seedEpisode(store, corr.id, "https://acme.example/hours-" + i, "Acme hours v" + i,
        "Acme online support phone line now opens at 10:00 every weekday except public holidays.",
        "acme-support"));
    }
    const rep = await store.consolidateMemory(
      { scope: { by: "memory", sessionIds: [], memoryIds: ids, sessionIdNotApplied: false } },
      {
        summarize: twoStageSummarize(
          "Acme online support phone line opens at 10:00 every weekday except public holidays.",
          "Acme online support phone line opens at 10:00 every weekday except public holidays.",
        ),
        classify: SUPPORTED,
        verify: async () => CORRECTION,
        verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
      },
    );
    assert(rep.update === 1 && rep.noop === 0,
      "one-value edit: it is corrected, not counted as a duplicate (update=" + rep.update + ", noop=" + rep.noop + ")");
    const live = q(db, "SELECT content FROM semantic_memories WHERE valid_until IS NULL");
    assert(String(live.content).includes("10:00"),
      "one-value edit: the live knowledge carries the new time");
    assert(!String(live.content).includes("09:00"),
      "one-value edit: the old time is no longer current knowledge");
    store.close();
  }

  // 9c2. same polarity, CHANGED value: the check decides, not the keyword rule.
  //
  // "does not support REST, deploys run weekly" -> "... monthly" shares the
  // negation and 0.8 token overlap, so the old polarity rule calls it `add` and
  // two live rows then state different cadences. A same-topic candidate must
  // reach the relationship check, which recognises the value change as a
  // correction (#273 review).
  {
    const db = "b-pol-value.db";
    const store = openStore(db);
    const seed = await store.createSession("eval");
    await buildKnowledge(store, db, seed.id, "zeta-api",
      "Zeta service does not support REST. Deploys run weekly.", "https://ex.com/zeta");
    const corr = await store.createSession("eval");
    const ids: number[] = [];
    for (let i = 1; i <= 3; i++) {
      ids.push(await seedEpisode(store, corr.id, "https://ex.com/zeta-cadence-" + i, "Zeta cadence v" + i,
        "Zeta deploys now run monthly instead of weekly.", "zeta-api"));
    }
    const rep = await store.consolidateMemory(
      { scope: { by: "memory", sessionIds: [], memoryIds: ids, sessionIdNotApplied: false } },
      {
        summarize: twoStageSummarize(
          "Zeta service does not support REST. Deploys run monthly.",
          "Zeta service does not support REST. Deploys run monthly.",
        ),
        classify: SUPPORTED,
        verify: async () => CORRECTION,
        verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
      },
    );
    assert(rep.update === 1,
      "same polarity + changed value: the correction lands (update=" + rep.update + ", add=" + rep.add + ")");
    assert(q(db, "SELECT COUNT(*) c FROM semantic_memories WHERE valid_until IS NULL").c === 1,
      "same polarity + changed value: exactly one live row, so no contradictory cadences");
    store.close();
  }

  // 9c0. a PARAPHRASE judged "same fact" must not become a second row.
  // The checker answers `relation: "same"` because the wording differs but the
  // fact does not. Text equality cannot see that, so gating `noop` on
  // `exactRestatement` alone sent this candidate to `insert()` and added a
  // duplicate — on the single-evidence path too (#273 review).
  {
    const db = "b-paraphrase.db";
    const store = openStore(db);
    const seed = await store.createSession("eval");
    await buildKnowledge(store, db, seed.id, "zeta-api", "Zeta service no longer supports the REST API.", "https://ex.com/zeta");
    const corr = await store.createSession("eval");
    const newId = await seedEpisode(store, corr.id, "https://ex.com/zeta-restated", "Zeta restated",
      "Zeta service has dropped support for the REST API.", "zeta-api");
    const before = Number(q(db, "SELECT COUNT(*) c FROM semantic_memories").c);
    const rep = await store.consolidateMemory(
      { scope: { by: "memory", sessionIds: [], memoryIds: [newId], sessionIdNotApplied: false }, allowSingleEvidence: true },
      {
        summarize: async () => "Zeta service has dropped support for the REST API.",
        classify: SUPPORTED,
        verify: async () => ({ alreadyCurrent: true, sameFact: true, reliable: true, relation: "same" }),
        verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
      },
    );
    assert(rep.noop === 1 && rep.add === 0 && rep.update === 0,
      "paraphrase: it is a noop, not a new row (noop=" + rep.noop + ", add=" + rep.add + ")");
    assert(Number(q(db, "SELECT COUNT(*) c FROM semantic_memories").c) === before,
      "paraphrase: no duplicate knowledge row was created");
    store.close();
  }

  // 9c. same-polarity restatement is not a contradiction (negation fix).
  //
  // The summary here states EXACTLY what the materials say. Two correct
  // outcomes are possible and both are checked: no replacement (the negation
  // is not treated as disagreement), and no second copy of the same fact
  // (a rerun over identical material must not build duplicate knowledge).
  // Inventing a fact the material does not contain would turn this into a test
  // of fabrication, which is not what this case is about.
  {
    const db = "b-pol.db";
    const store = openStore(db);
    const seed = await store.createSession("eval");
    const oldIds = await buildKnowledge(store, db, seed.id, "zeta-api", "Zeta service no longer supports the REST API.", "https://ex.com/zeta");
    const rep = await store.consolidateMemory(
      { scope: { by: "memory", sessionIds: [], memoryIds: oldIds, sessionIdNotApplied: false } },
      {
        summarize: async () => "Zeta service no longer supports the REST API.",
        classify: SUPPORTED,
        verify: async () => CORRECTION,
        verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
      },
    );
    assert(rep.update === 0,
      "polarity: restating the same negation is not a contradiction (update=" + rep.update + ")");
    assert(rep.add === 0,
      "polarity: identical material creates no duplicate knowledge row (add=" + rep.add + ")");
    // The live row count is unchanged, and the old row is still the live one.
    assert(q(db, "SELECT COUNT(*) c FROM semantic_memories").c === 1,
      "polarity: the archive still holds exactly one knowledge row");
    assert(q(db, "SELECT COUNT(*) c FROM semantic_memories WHERE valid_until IS NULL").c === 1,
      "polarity: the original row is still live, nothing replaced it");
    store.close();
  }
}

// --- 10. dry-run leaves no trace of a correction ---------------------------

{
  const db = "dry.db";
  const store = openStore(db);
  const seed = await store.createSession("eval");
  const oldIds = await buildKnowledge(store, db, seed.id, "a-support-hours", A1_OLD, "https://a.example/support-hours");
  const corr = await store.createSession("eval");
  const newId = await seedEpisode(store, corr.id, "https://a.example/notice", "通知", "官方通知：改为 7×24。", "a-support-hours");
  const before = q(db, "SELECT COUNT(*) c FROM semantic_memories").c;
  // NOTE: this block used to run one apply first (a "relation: same" pass) just
  // to show that a no-change run records no verified correction. That preamble
  // mutated the state the dry-run then had to preview, and tightening the noop
  // rule made it change again — the assertion belongs with the same-fact case
  // (9c), not here. The dry-run case now starts from a clean state.
  const rep = await store.consolidateMemory(
    { dryRun: true, scope: { by: "memory", sessionIds: [], memoryIds: [newId], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: twoStageSummarize(A1_CANDIDATE, A1_MERGED),
      classify: SUPPORTED,
      verify: async () => CORRECTION,
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
    },
  );
  assert(rep.dryRun === true && rep.update === 1, "dry-run: the correction is previewed (update=" + rep.update + ")");
  // The preview may name the correction it would land; the CLI labels it
  // "would land" under --dry-run so a rolled-back write is never called
  // "verified". The store-side contract is: nothing was saved.
  assert(rep.verifiedCorrections.length === 1, "dry-run: the preview names the correction it would land");
  assert(q(db, "SELECT COUNT(*) c FROM semantic_memories").c === before, "dry-run: no knowledge row was written");
  assert(q(db, "SELECT valid_until, superseded_by FROM semantic_memories WHERE content = ?", A1_OLD).valid_until === null,
    "dry-run: the old row stays live");
  for (const id of oldIds) {
    assert(q(db, "SELECT superseded_by FROM retrieval_results WHERE id = ?", id).superseded_by === null,
      "dry-run: no episode was superseded");
  }
  store.close();
}

// --- 10b. a budget refusal inside the correction check stops the run --------

{
  const db = "budget.db";
  const store = openStore(db);
  const seed = await store.createSession("eval");
  await buildKnowledge(store, db, seed.id, "a-support-hours", A1_OLD, "https://a.example/support-hours");
  const corr = await store.createSession("eval");
  const newId = await seedEpisode(store, corr.id, "https://a.example/notice", "通知", "官方通知：改为 7×24。", "a-support-hours");
  const rep = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [newId], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: async () => A1_CANDIDATE,
      classify: SUPPORTED,
      verify: async () => {
        // The same shape the kernel seam raises when reserveCalls rejects.
        throw Object.assign(new Error("budget exhausted"), { code: "consolidate-budget-rejected" });
      },
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
    },
  );
  assert(rep.budgetRejected === 1 && rep.update === 0 && rep.add === 0,
    "budget: a refusal inside the correction check stops the run and is counted (budgetRejected=" + rep.budgetRejected + ")");
  assert(rep.verifyRejected === 0 && rep.correctionsIncomplete === 0,
    "budget: an exhaustion is not reported as a refusal verdict or an incomplete correction");
  assert(q(db, "SELECT COUNT(*) c FROM semantic_memories").c === 1, "budget: nothing was written");
  store.close();
}

// --- 11. recall: superseded episodes leave, preserved facts stay -----------

{
  const db = "recall.db";
  const store = openStore(db);
  const seed = await store.createSession("seed-session");
  const oldIds = await buildKnowledge(store, db, seed.id, "acme-support", R_OLD, "https://acme.example/support");

  // Before: the live old episode is recallable. (Same-entity writes in one
  // session close each other at write time — the temporal supersede — so of
  // the three seeded episodes only the newest was ever recallable; the
  // cluster scan still reads all three.)
  const before = await store.searchMemory("acme support email", 20);
  const beforeIds = new Set(before.map((h) => h.rowid));
  assert(beforeIds.has(oldIds[oldIds.length - 1]!), "recall: the live old episode was recallable before the correction");

  const corr = await store.createSession("corr-session");
  const newId = await seedEpisode(store, corr.id, "https://acme.example/notice-2026-11-01",
    "Acme support hours notice (official)",
    "Acme official notice effective 2026-11-01: online support is now 24x7 every day, replacing the weekday 9:00-17:00 schedule. The support email help@acme.com is unchanged.",
    "acme-support");
  const rep = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [newId], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: twoStageSummarize(R_CANDIDATE, R_MERGED),
      classify: SUPPORTED,
      verify: async () => CORRECTION,
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
    },
  );
  assert(rep.update === 1, "recall: the correction landed");

  // A fresh store instance answers "does recall still surface the corrected
  // episodes, and does the preserved fact stay reachable cross-session?".
  const reader = openStore(db);
  const after = await reader.searchMemory("acme support email", 20);
  const afterIds = new Set(after.map((h) => h.rowid));
  assert(!oldIds.some((id) => afterIds.has(id)), "recall: the superseded episodes left current-fact recall");
  const semantic = after.find((h) => h.rowid < 0);
  assert(!!semantic && String(semantic!.content).includes("help@acme.com"),
    "recall: the live merged knowledge still carries the preserved email fact");
  const newEp = after.find((h) => h.rowid === newId);
  assert(!!newEp, "recall: the correcting material stays recallable");

  // The multi-query lane mirrors the same live-row predicate; it must not
  // resurface a superseded episode either (#261 D8 / standards review).
  const multi = await reader.searchMemoryMulti(["acme support email"], 20);
  const multiIds = new Set(multi.map((h) => h.rowid));
  assert(!multiIds.has(oldIds[oldIds.length - 1]!),
    "recall: the multi-query lane also drops the superseded episode");
  assert(multiIds.has(newId), "recall: the multi-query lane keeps the correcting material");
  reader.close();
  store.close();
}

// --- 11e. two clusters in ONE run cannot both replace the same row --------
// Clusters are grouped by entity, so two distinct entities are what produces
// two plans in one run. Both can end up targeting the same live knowledge row
// (the dedup scan compares against every live row, not only same-entity ones),
// and both plans pass their checks because no write has run yet. Closing the
// row twice would leave two live successors — a knowledge fork with no
// concurrency involved (#273 review).
{
  const db = "same-run.db";
  const store = openStore(db);
  const seed = await store.createSession("eval");
  await buildKnowledge(store, db, seed.id, "acme-support",
    "Acme support email is help@acme.com. Phone line opens at 9:00.", "https://acme.example/support");
  const corr = await store.createSession("eval");
  const idsA: number[] = [];
  const idsB: number[] = [];
  for (let i = 1; i <= 3; i++) {
    // Two DIFFERENT entities whose materials both speak about the same facts,
    // so each cluster's candidate lands on the one existing knowledge row.
    idsA.push(await seedEpisode(store, corr.id, "https://acme.example/notice-a-" + i, "Acme 邮箱通知 v" + i,
      "Acme support email is help@acme.com now. Phone line opens at 8:00.", "acme-email"));
    idsB.push(await seedEpisode(store, corr.id, "https://acme.example/notice-b-" + i, "Acme 电话通知 v" + i,
      "Acme support email is help@acme.com now. Phone line opens at 8:00.", "acme-phone"));
  }
  const rep = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [...idsA, ...idsB], sessionIdNotApplied: false } },
    {
      summarize: twoStageSummarize(
        "Acme support email is help@acme.com now. Phone line opens at 8:00.",
        "Acme support email is help@acme.com now. Phone line opens at 8:00.",
      ),
      classify: SUPPORTED,
      verify: async () => CORRECTION,
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
    },
  );
  assert(rep.clustersScanned === 2,
    "same run: two entities produce two plans (got " + rep.clustersScanned + ")");
  // Never two live successors for one old row.
  const live = Number(q(db, "SELECT COUNT(*) c FROM semantic_memories WHERE valid_until IS NULL").c);
  assert(live === 1, "same run: exactly one live successor remains (got " + live + ")");
  const closedWithSuccessor = Number(q(db, "SELECT COUNT(*) c FROM semantic_memories WHERE valid_until IS NOT NULL AND superseded_by IS NOT NULL").c);
  assert(closedWithSuccessor === 1,
    "same run: the old row is closed once with one successor (got " + closedWithSuccessor + ")");
  store.close();
}

// --- 12. a cluster of only-superseded materials creates nothing -----------
// The scan keeps reading superseded rows (the update chain needs the history),
// but summarizing them again would resurrect the facts a correction replaced
// (CodeRabbit review on #273).
{
  const db = "superseded-cluster.db";
  const store = openStore(db);
  const seed = await store.createSession("eval");
  const oldIds = await buildKnowledge(store, db, seed.id, "a-support-hours", A1_OLD, "https://a.example/support-hours");
  const corr = await store.createSession("eval");
  const newId = await seedEpisode(store, corr.id, "https://a.example/notice", "通知", "官方通知：改为 7×24。", "a-support-hours");
  const rep = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [newId], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: twoStageSummarize(A1_CANDIDATE, A1_MERGED),
      classify: SUPPORTED,
      verify: async () => CORRECTION,
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
    },
  );
  assert(rep.update === 1, "superseded cluster: setup correction landed");
  const liveBefore = q(db, "SELECT COUNT(*) c FROM semantic_memories WHERE valid_until IS NULL").c;

  // Now consolidate ONLY the three superseded materials. Their entity cluster
  // is entirely historical, so nothing new may be written.
  const again = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: oldIds, sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: async () => A1_OLD,
      classify: SUPPORTED,
      verify: async () => CORRECTION,
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
    },
  );
  assert(again.supersededClusterSkipped === 1,
    "superseded cluster: it is counted as skipped (got " + again.supersededClusterSkipped + ")");
  assert(again.add === 0 && again.update === 0,
    "superseded cluster: no new knowledge is created from replaced materials");
  assert(q(db, "SELECT COUNT(*) c FROM semantic_memories WHERE valid_until IS NULL").c === liveBefore,
    "superseded cluster: the live row count is unchanged");
  store.close();
}

// --- 11b. the kept fact stays reachable with NO embedding at all -----------
// A corrected row is the only carrier of the facts the correction did not
// touch. The vector semantic arm needs an embedding on both the query and the
// row, so this pins the keyword lane that does not (CodeRabbit review on #273:
// without it, "help@acme.com survives" was only true while embeddings worked).
{
  const db = "recall-noemb.db";
  const store = openStore(db);
  const seed = await store.createSession("seed-session");
  const oldIds = await buildKnowledge(store, db, seed.id, "acme-support", R_OLD, "https://acme.example/support");
  const corr = await store.createSession("corr-session");
  const newId = await seedEpisode(store, corr.id, "https://acme.example/notice-2026-11-01",
    "Acme support hours notice (official)",
    "Acme official notice effective 2026-11-01: online support is now 24x7 every day, replacing the weekday 9:00-17:00 schedule. The support email help@acme.com is unchanged.",
    "acme-support");
  const rep = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [newId], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: twoStageSummarize(R_CANDIDATE, R_MERGED),
      classify: SUPPORTED,
      verify: async () => CORRECTION,
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
    },
  );
  assert(rep.update === 1, "no-embedding setup: the correction landed");

  // Now make embeddings unavailable on both sides: the module is absent, so
  // neither a query vector nor a stored vector can be computed. Only the
  // keyword lane over semantic_memories can answer.
  __setEmbeddingModuleForTest(null);
  const reader = openStore(db);
  const hits = await reader.searchMemory("acme support email", 20);
  const semantic = hits.find((h) => h.rowid < 0);
  assert(!!semantic, "no embeddings: the knowledge row is still recalled (got " + hits.length + " hits)");
  assert(String(semantic!.content).includes("help@acme.com"),
    "no embeddings: the kept email fact is still retrievable cross-session");
  // The superseded episodes stay out even on this path.
  assert(!hits.some((h) => oldIds.includes(h.rowid)),
    "no embeddings: the superseded episodes are still excluded");
  reader.close();
  store.close();
  __setEmbeddingModuleForTest("auto");
}

// --- 11c. a CHINESE kept fact stays reachable with NO embedding -----------
// The A1-A4 samples are Chinese, and the keyword lane has two traps for them:
// `fts5EscapeQuery` strips every non-ASCII character (a pure Chinese query
// becomes `""`, which returns nothing), and the default unicode61 tokenizer
// glues a whole Chinese run into one token, so MATCH alone cannot find a
// substring. Without the LIKE rung the kept 客服邮箱 is unreachable — the exact
// case this ticket exists to protect.
{
  const db = "recall-zh.db";
  const store = openStore(db);
  const seed = await store.createSession("eval");
  await buildKnowledge(store, db, seed.id, "a-support-hours", A1_OLD, "https://a.example/support-hours");
  const corr = await store.createSession("eval");
  const newId = await seedEpisode(store, corr.id, "https://a.example/notice-2026-11-01",
    "A 公司客服时间更新通知（官方）",
    "A 公司官方通知（2026-11-01 生效）：在线客服自 2026-11-01 起改为 7×24 小时全天候服务，替代原工作日（周一至周五）9:00—17:00 的安排。",
    "a-support-hours");
  const rep = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [newId], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: twoStageSummarize(A1_CANDIDATE, A1_MERGED),
      classify: SUPPORTED,
      verify: async () => CORRECTION,
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
    },
  );
  assert(rep.update === 1, "zh no-embedding setup: the correction landed");

  __setEmbeddingModuleForTest(null);
  const reader = openStore(db);
  // A pure-Chinese query: the one the sanitizer turns into `""`.
  const zhHits = await reader.searchMemory("客服邮箱", 20);
  const zhSem = zhHits.find((h) => h.rowid < 0);
  assert(!!zhSem, "zh no embeddings: a pure Chinese query still reaches the knowledge row");
  assert(String(zhSem!.content).includes("help@example.com"),
    "zh no embeddings: the kept email fact is retrievable");
  // A pure-Chinese question with no ASCII at all: the run has to be broken
  // into word-sized slices, because "请问客服邮箱是什么" appears nowhere in the
  // stored text verbatim (CodeRabbit round 4 on #273).
  const pureZh = await reader.searchMemory("请问客服邮箱是什么", 20);
  assert(!!pureZh.find((h) => h.rowid < 0),
    "zh no embeddings: a pure-Chinese question with no ASCII still reaches it");
  reader.close();
  store.close();
  __setEmbeddingModuleForTest("auto");
}

// --- 11c2. a keyword-only match must be relevant, not merely present ------
// The relaxed rung is an OR query, so a row that shares ONE common word with
// the question would enter the arm. The episode lane filters such rows by
// requiring a strict majority of the query's content words; the knowledge lane
// must do the same (CodeRabbit round 4 on #273).
{
  const db = "kw-relevance.db";
  const store = openStore(db);
  const rw = new Database(join(dir, db), { readonly: false });
  // Both rows are stored WITHOUT embeddings, so only the keyword lane can find
  // them. The second shares just "support" with the question.
  const rows = [
    "Acme online support operates weekdays. Support email is help@acme.com.",
    "Support ticket volume grew last quarter for unrelated reasons.",
  ];
  for (const content of rows) {
    rw.prepare("INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, '[]', 0.5, 0.9, NULL)")
      .run(content);
  }
  rw.close();
  const hits = await store.searchMemory("acme support email", 20);
  const semContents = hits.filter((h) => h.rowid < 0).map((h) => String(h.content));
  assert(semContents.some((c) => c.includes("help@acme.com")),
    "kw relevance: the row that answers the question is returned");
  assert(!semContents.some((c) => c.includes("ticket volume")),
    "kw relevance: a row sharing only one common word is not returned");
  store.close();
}

// --- 11c3. the CJK rung is not gated on the ASCII rung's fill level ------
// The gate used to read "out.length < limit", i.e. "the other rung already
// answered enough". For a mixed query that is wrong: FTS can only serve the
// ASCII part, so a full ASCII answer says nothing about the Chinese half.
//
// Construction that actually exercises the gate: `limit` is 1, the strict FTS
// rung returns one English row and its own LIMIT cuts the Chinese row away.
// With the old gate (`out.length < limit`) the CJK rung is skipped because the
// slot is already full, and the Chinese fact is unreachable. Only an
// unconditional CJK rung finds it. Verified by mutation: restoring the gate
// makes this assertion fail.
{
  const db = "kw-mixed.db";
  const store = openStore(db);
  const rw = new Database(join(dir, db), { readonly: false });
  // Four English-only rows first, so the strict rung has plenty to fill one slot.
  // Their ASCII token is `email` — a FACT word, not an object name. That is
  // deliberate (#273 review): a fixture where the ASCII half is a company name
  // ("Acme") and the Chinese row belongs to a DIFFERENT company ("甲公司")
  // would assert that a stranger's email answers an Acme question, which is
  // exactly the cross-language binding gap this ticket does not close (tracked
  // as its own issue). What this case pins is narrower and provable: the CJK
  // rung runs even when the ASCII slot is already full.
  const englishRows = [
    "Acme support email is help@acme.example.",
    "Acme billing email is bills@acme.example.",
    "Acme press email is press@acme.example.",
    "Acme hiring email is jobs@acme.example.",
  ];
  for (const content of englishRows) {
    rw.prepare("INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, '[]', 0.5, 0.9, NULL)")
      .run(content);
  }
  // The Chinese fact row, inserted last so it ranks behind the English rows. It
  // carries no company name, so returning it claims nothing about whose email
  // it is — only that a Chinese fact about 客服邮箱 is reachable.
  rw.prepare("INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, '[]', 0.5, 0.9, NULL)")
    .run("客服邮箱为 help@jia.example，全年可用。");
  rw.close();

  const lane = (store as unknown as {
    semanticKeywordRows(query: string, limit: number): Array<{ content: string }>;
  }).semanticKeywordRows("客服邮箱是什么 email", 1);
  const got = lane.map((h) => String(h.content));
  assert(got.some((c) => c.includes("help@jia.example")),
    "kw mixed: with one ASCII slot already filled, the Chinese fact is still reached (got " +
    JSON.stringify(got.map((c) => c.slice(0, 22))) + ")");
  store.close();
}

// --- 11f. one answer never carries both a replaced row and its successor --
// The keyword SELECT and the vector SELECT are separate statements. A correction
// committed between them leaves one list holding the closed row and the other
// holding its successor (#273 review). This test makes the two statements
// disagree deliberately and asserts the merge drops the closed one.
{
  const db = "stale-read.db";
  const store = openStore(db);
  const rw = new Database(join(dir, db), { readonly: false });
  // An old row (keyword-matchable) and its successor (vector-matchable), both
  // live at read time — then the old one is closed BEFORE the second read.
  const vec = vecFor("Acme support email is help@acme.com.");
  rw.prepare("INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, '[]', 0.5, 0.9, NULL)")
    .run("Acme support email is help@acme.com.");
  rw.prepare("INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, '[]', 0.5, 0.9, ?)")
    .run("Acme support email moved to help2@acme.com.", Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength));
  // A third LIVE row, keyword-matchable like the stale one, so a freed slot has
  // somewhere to go. Without it the fixture holds only one live row and both
  // implementations return one hit — the assertion would not tell them apart.
  rw.prepare("INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, '[]', 0.5, 0.9, NULL)")
    .run("Acme support email backup is help3@acme.com.");
  rw.close();

  // Close the FIRST row after the keyword read but before the vector read, the
  // way a concurrent consolidating process would.
  const asAny = store as unknown as {
    semanticKeywordRows(q: string, l: number): Array<{ rowid: number; content: string }>;
  };
  const original = asAny.semanticKeywordRows.bind(asAny);
  asAny.semanticKeywordRows = (q: string, l: number) => {
    const res = original(q, l);
    const write = new Database(join(dir, db), { readonly: false });
    write.prepare("UPDATE semantic_memories SET valid_until = datetime('now') WHERE content = ?")
      .run("Acme support email is help@acme.com.");
    write.close();
    return res;
  };
  const hits = await store.searchMemory("acme support email", 3);
  const contents = hits.filter((h) => h.rowid < 0).map((h) => String(h.content));
  assert(!contents.some((c) => c.includes("help@acme.com.")),
    "stale read: the row closed mid-read is not returned alongside its successor (got " +
    JSON.stringify(contents.map((c) => c.slice(0, 26))) + ")");
  // A dropped row frees its slot instead of shortening the answer (#273 review).
  // The semantic lane filters its own rows, so this case is built on the
  // MATERIAL lane: three keyword-matching materials, the first closed mid-read,
  // limit 2. Filtering after the truncation keeps one material instead of two.
  const matDir = "stale-slot.db";
  const matStore = openStore(matDir);
  const matIds: number[] = [];
  for (let i = 1; i <= 3; i++) {
    const s = await matStore.createSession("eval");
    const ra = await matStore.adjudicateMemory(s.id, [{
      url: "https://acme.example/stale-" + i,
      title: "Acme support email note " + i,
      snippet: "Acme support email " + i + " is help" + i + "@acme.example.",
      source: "tavily", evidence: 0.9, entity: "acme-stale",
    }]);
    matIds.push(ra[0]!.insertedId!);
  }
  const matAsAny = matStore as unknown as {
    semanticKeywordRows(q: string, l: number): Array<{ rowid: number; content: string }>;
  };
  const matOriginal = matAsAny.semanticKeywordRows.bind(matAsAny);
  matAsAny.semanticKeywordRows = (q: string, l: number) => {
    const res = matOriginal(q, l);
    const write = new Database(join(dir, matDir), { readonly: false });
    write.prepare("UPDATE retrieval_results SET valid_until = datetime('now') WHERE id = ?").run(matIds[0]);
    write.close();
    return res;
  };
  const matHits = await matStore.searchMemory("acme support email", 2);
  assert(matHits.length === 2,
    "stale read: the freed slot is refilled, not lost (materials=" + matHits.length + ", " +
    JSON.stringify(matHits.map((h) => h.rowid)) + ")");
  assert(!matHits.some((h) => h.rowid === matIds[0]),
    "stale read: the closed material is not returned");
  store.close();
}

// --- 11c8. the object name must not outrank the fact word ---------------
// "甲公司 客服邮箱是什么" yields both a 3-character object name and a
// 4-character fact word. OR-ed together, any row mentioning the object wins the
// slot and the row holding the email never appears (#273 review).
{
  const db = "kw-object-vs-fact.db";
  const store = openStore(db);
  const rw = new Database(join(dir, db), { readonly: false });
  // Object-only row first, the fact row second — order decides under LIMIT.
  for (const content of [
    "甲公司每周一发布新版。",
    "甲公司客服邮箱为 help@jia.example。",
  ]) {
    rw.prepare("INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, '[]', 0.5, 0.9, NULL)")
      .run(content);
  }
  rw.close();
  const lane = (store as unknown as {
    semanticKeywordRows(query: string, limit: number): Array<{ content: string }>;
  }).semanticKeywordRows("甲公司 客服邮箱是什么", 1);
  const got = lane.map((h) => String(h.content));
  assert(got.some((c) => c.includes("help@jia.example")),
    "kw object vs fact: the fact word wins over the object name (got " +
    JSON.stringify(got.map((c) => c.slice(0, 16))) + ")");
  store.close();
}

// --- 11c7. the relaxed rung keeps reading until it has enough survivors ---
// The rung used to fetch a fixed `limit * 2` rows and filter afterwards, so a
// list whose head were one-word matches could be emptied by the filter while
// the covering row sat past the cut (#273 review).
//
// This case pins the OUTCOME (the covering row is returned) rather than the
// paging. A regression test that fails when the paging is reverted needs a
// fixture where BM25 ranks the one-word rows ahead of the covering one; with
// unicode61 and equal document length the covering row wins on term count,
// so such a fixture is not stable enough to assert on. The paging is kept
// because it removes the failure mode outright.
{
  const db = "kw-relaxed-page.db";
  const store = openStore(db);
  const rw = new Database(join(dir, db), { readonly: false });
  for (let i = 1; i <= 10; i++) {
    rw.prepare("INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, '[]', 0.5, 0.9, NULL)")
      .run("Support team memo " + i + " about seating arrangements and rota.");
  }
  rw.prepare("INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, '[]', 0.5, 0.9, NULL)")
    .run("Email escalations reach Acme support through help@acme.com.");
  rw.close();
  const lane = (store as unknown as {
    semanticKeywordRows(query: string, limit: number): Array<{ content: string }>;
  }).semanticKeywordRows("acme support email", 1);
  const got = lane.map((h) => String(h.content));
  assert(got.some((c) => c.includes("help@acme.com")),
    "kw relaxed: the row covering the whole query is returned (got " +
    JSON.stringify(got.map((c) => c.slice(0, 20))) + ")");
  store.close();
}

// --- 11c6. a SHORT Chinese query is still a complete word ----------------
// "邮箱" is two characters: the 4-character slice floor would produce no slice
// at all, so a short but perfectly meaningful query could not reach anything
// without embeddings (#273 review).
{
  const db = "kw-short-zh.db";
  const store = openStore(db);
  const rw = new Database(join(dir, db), { readonly: false });
  rw.prepare("INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, '[]', 0.5, 0.9, NULL)")
    .run("甲公司客服邮箱为 help@jia.example。负责人是张三。");
  rw.close();
  for (const q of ["邮箱", "负责人"]) {
    const lane = (store as unknown as {
      semanticKeywordRows(query: string, limit: number): Array<{ content: string }>;
    }).semanticKeywordRows(q, 1);
    assert(lane.some((h) => String(h.content).includes("help@jia.example")),
      "kw short zh: the 2-3 character query \"" + q + "\" still reaches the row (got " +
      JSON.stringify(lane.map((h) => String(h.content).slice(0, 16))) + ")");
  }
  store.close();
}

// --- 11c5. a long question keeps the SHORT slice at its tail ------------
// "请帮我确认一下甲公司客服邮箱" is 14 characters: it yields ~19 six/five-char
// slices before any four-char one, so a plain "keep the first N" budget drops
// "客服邮箱" — the fact word the caller actually asked about (#273 review).
{
  const db = "kw-long-tail.db";
  const store = openStore(db);
  const rw = new Database(join(dir, db), { readonly: false });
  rw.prepare("INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, '[]', 0.5, 0.9, NULL)")
    .run("甲公司在线客服全年可用。客服邮箱为 help@jia.example。");
  rw.close();
  const lane = (store as unknown as {
    semanticKeywordRows(query: string, limit: number): Array<{ content: string }>;
  }).semanticKeywordRows("请帮我确认一下甲公司客服邮箱", 1);
  const got = lane.map((h) => String(h.content));
  assert(got.some((c) => c.includes("help@jia.example")),
    "kw long tail: the 14-character question still matches through its tail slice (got " +
    JSON.stringify(got.map((c) => c.slice(0, 18))) + ")");
  store.close();
}

// --- 11c4. the relevance floor runs in SQL, before LIMIT (CodeRabbit
//           round 5 on #273) ------------------------------------------------
// With LIMIT applied first, `limit` weak rows can be returned and only then
// filtered out — leaving the real row unseen. The rows below are arranged so
// that the weak ones sort first: each shares a 3-character piece with the
// question ("客服" appears in all four), while only the last one contains the
// 4+ character slice the question actually asks for.
//
// Called on the lane directly: at the searchMemory level other arms can mask
// the difference, so the lane contract is what gets pinned.
{
  const db = "kw-floor.db";
  const store = openStore(db);
  const rw = new Database(join(dir, db), { readonly: false });
  // Insert order matters: weak rows first, the real one last. The weak rows
  // share only a 2-character topic word with the question, which is below the
  // 4-character evidence floor; the real row carries the 4+ character slice
  // the question actually asks about.
  const rows = [
    "甲公司培训手册目录第一页，客服相关章节见附录。",
    "乙公司排班表说明，客服岗位另附。",
    "丙公司话术清单，客服通用模板在最后。",
    "甲公司员工邮箱为 help@jia.example，全年可用。",
  ];
  for (const content of rows) {
    rw.prepare("INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, '[]', 0.5, 0.9, NULL)")
      .run(content);
  }
  rw.close();
  const lane = (store as unknown as {
    semanticKeywordRows(query: string, limit: number): Array<{ content: string }>;
  }).semanticKeywordRows("甲公司员工邮箱是什么", 1);
  const got = lane.map((h) => String(h.content));
  assert(got.some((c) => c.includes("help@jia.example")),
    "kw floor: the 4+ character match wins even with limit 1 and weaker rows inserted first (got " +
    JSON.stringify(got.map((c) => c.slice(0, 18))) + ")");
  store.close();
}

// --- 11d. neither lane may shut the other out ----------------------------
// A corrected row that carries a kept fact may end up with NO embedding. If the
// archive also holds `limit` embedded rows, "vectors first" would fill every
// slot and that row would never surface — exactly the case the keyword lane
// exists for (CodeRabbit round 3 on #273).
//
// Written straight to the knowledge table: the point is the semantic arm's slot
// allocation, so no episode material may shadow it through the FTS arm.
{
  const db = "lane-quota.db";
  const store = openStore(db);
  const rw = new Database(join(dir, db), { readonly: false });
  // THREE rows WITH embeddings and one WITHOUT: with limit 3, "vectors first"
  // fills every slot, so the embedding-free row can only appear if the quota
  // actually reserves a slot for the keyword lane.
  const embedded = [
    "Beta service ships releases every Monday. Owner is release-team@beta.example.",
    "Gamma service runs on nightly builds. Owner is build-team@gamma.example.",
    "Delta service deploys on demand. Owner is ops-team@delta.example.",
  ];
  for (const content of embedded) {
    const vec = vecFor(content);
    rw.prepare("INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, '[]', 0.5, 0.9, ?)")
      .run(content, Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength));
  }
  rw.prepare("INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, '[]', 0.5, 0.9, NULL)")
    .run(R_OLD);
  rw.close();

  // limit 3 with four knowledge rows: the embedding-free one must survive.
  const hits = await store.searchMemory("acme support email", 3);
  const semHits = hits.filter((h) => h.rowid < 0);
  const contents = semHits.map((h) => String(h.content));
  assert(
    contents.some((c) => c.includes("help@acme.com")),
    "lane quota: the embedding-free knowledge row is still returned (got " +
    JSON.stringify(contents.map((c) => c.slice(0, 24))) + ")",
  );
  store.close();
}

// --- 12. two clusters touching ONE knowledge row in a single run ----------
// Both clusters are planned before anything is written, so both see the same
// live row and the same source set. What the writes must not do (#273 review):
//   (a) land a restatement on a row another cluster already closed — that
//       reports a successful noop against dead knowledge and loses the
//       materials from the successor;
//   (b) write a source set from a stale snapshot, dropping the materials the
//       earlier write already merged in. Those would never be retired by a
//       later correction, so their stale text stays recallable.
//
// Construction: one knowledge row, then two entity clusters of 3 live
// materials each. Clusters iterate in entity order, so the notice cluster
// (update) writes first and the restate cluster (noop) arrives second, on a
// row that is already closed.
{
  const db = "run-collision.db";
  const store = openStore(db);
  const shared = "Acme support hours are weekdays 9:00-17:00.";
  const seed = await store.createSession("eval");
  await buildKnowledge(store, db, seed.id, "acme-shared", shared, "https://acme.example/base");

  // Cluster "acme-notice" sorts before "acme-restate", so the correction runs first.
  // Its text deliberately reuses the old wording ("hours ... weekdays") so the
  // pair scores as the SAME topic and reaches the relationship check; a
  // unrelated phrasing would decide `add` and the two clusters would never
  // compete for the same row.
  const sessB = await store.createSession("eval");
  for (let i = 1; i <= 3; i++) {
    await seedEpisode(store, sessB.id, "https://acme.example/notice-" + i, "Acme notice " + i,
      "Acme support hours are 24x7 now, not weekdays.", "acme-notice");
  }
  const sessA = await store.createSession("eval");
  for (let i = 1; i <= 3; i++) {
    await seedEpisode(store, sessA.id, "https://acme.example/restate-" + i, "Acme restate " + i, shared, "acme-restate");
  }

  const rep = await store.consolidateMemory(
    { scope: { by: "session", sessionIds: [sessA.id, sessB.id], memoryIds: [], sessionIdNotApplied: false } },
    {
      summarize: async (eps: ConsolidateEvidence[]) => {
        if (eps.some((e) => e.title === "CURRENT KNOWLEDGE")) {
          return "Acme support hours are 24x7 now, not weekdays. Support email is help@acme.com.";
        }
        return eps.some((e) => String(e.url).includes("/restate-"))
          ? shared
          : "Acme support hours are 24x7 now, not weekdays.";
      },
      classify: SUPPORTED,
      verify: async () => CORRECTION,
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
    },
  );

  assert(rep.update === 1,
    "run collision: the first cluster's correction lands (update=" + rep.update + ")");
  assert(rep.noop === 0,
    "run collision: the later restatement does NOT also write to the closed row (noop=" + rep.noop + ")");
  assert(rep.verifyRejected === 1,
    "run collision: the losing cluster is reported as a conflict, not silence (verifyRejected=" + rep.verifyRejected + ")");
  const liveRows = q(db, "SELECT COUNT(*) c FROM semantic_memories WHERE valid_until IS NULL").c;
  assert(liveRows === 1, "run collision: exactly one live knowledge row survives (live=" + liveRows + ")");
  const live = q(db, "SELECT source_episode_ids src FROM semantic_memories WHERE valid_until IS NULL");
  assert(JSON.parse(live.src).length >= 4,
    "run collision: the successor's source set carries the corrected materials too (src=" + live.src + ")");
  store.close();
}

// --- 12b. a non-exact paraphrase is judged, not counted as a duplicate ----
// decideOp calls cosine > theta a `noop`, and cosine stays high when only the
// wording changes. With low token overlap the old code skipped the relationship
// check and left the old value current forever (#273 review).
//
// The fixture makes that exact shape deterministic: the stored row carries the
// embedding `embedText` would compute for the candidate, so cosine is 1.0,
// while the two texts share almost no words (Jaccard well under
// SAME_TOPIC_JACCARD). Only the `op === "noop"` leg can send this to the
// checker — drop it and the candidate is counted as a duplicate.
//
// Verified by mutation: removing `|| op === "noop"` from the batch gate makes
// this case report noop=1 / update=0.
{
  const db = "paraphrase-nodup.db";
  const store = openStore(db);
  const oldContent = "Acme office hours are 09:00 to 17:00 on weekdays.";
  const candidate = "Doors open at ten and close at six.";
  // The passage prefix matters: embedText embeds `passage: <text>`, so a raw
  // vector would give a cosine of ~0 and the case would test the wrong branch.
  const vec = vecFor("passage: " + candidate);
  const rw = new Database(join(dir, db), { readonly: false });
  rw.prepare("INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, '[]', 0.5, 0.9, ?)")
    .run(oldContent, Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength));
  rw.close();

  const sess = await store.createSession("eval");
  for (let i = 1; i <= 3; i++) {
    await seedEpisode(store, sess.id, "https://acme.example/hours-" + i, "Acme hours note " + i,
      candidate, "acme-hours");
  }
  const rep = await store.consolidateMemory(
    { scope: { by: "session", sessionIds: [sess.id], memoryIds: [], sessionIdNotApplied: false } },
    {
      summarize: async (eps: ConsolidateEvidence[]) =>
        eps.some((e) => e.title === "CURRENT KNOWLEDGE")
          ? "Doors open at ten and close at six. Support email is help@acme.com."
          : candidate,
      classify: SUPPORTED,
      verify: async () => CORRECTION,
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
    },
  );
  assert(rep.noop === 0,
    "paraphrase: a different-wording candidate is not silently counted as a duplicate (noop=" + rep.noop + ")");
  assert(rep.update === 1, "paraphrase: the checker's verdict decides, and the correction lands (update=" + rep.update + ")");
  assert(String(q(db, "SELECT content FROM semantic_memories WHERE valid_until IS NULL").content).includes("ten"),
    "paraphrase: the new value is the current knowledge");
  store.close();
}

for (const s of stores) { try { s.close(); } catch { /* already closed */ } }
__setEmbeddingModuleForTest("auto");
rmSync(dir, { recursive: true, force: true });

console.log("single-evidence-correction: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
