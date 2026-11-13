// #262 — concurrent corrections: the write-phase target-version check, one
// re-read + re-judge, re-merge against the latest version, and unresolved
// conflicts with BOTH sides' evidence (spec D11, tests T4).
// The two-real-process entry (T3) lives in
// packages/store/test/consolidate-race-processes.test.ts.
//
// What is under test, and what is not:
//   - the write transaction recognizes a dead target closed by a CONCURRENT
//     writer (here: a second store connection, i.e. another session's run)
//     and withholds the whole planned op; it never writes to dead knowledge
//     and never lets two live successors fork one old row;
//   - a collision closed by THIS run keeps the old same-run report (11e
//     behaviour stays in single-evidence-correction.test.ts);
//   - resolution re-reads the live head and re-judges AT MOST ONCE:
//       already corrected  -> no new version, this run's materials join the
//                             live row's sources ("duplicate", B1);
//       still accepted     -> ONE re-merge against the LATEST content — never
//                             the first attempt's final summary — the same
//                             final-content check, then a write that must
//                             still target the re-judged row ("re-merged",
//                             M1);
//       refused / moved    -> an UNRESOLVED conflict with both sides'
//                             materials, the current live content, the reason
//                             and what to check next. No third judgment (B2,
//                             M2);
//   - a FAILED re-merge or final check during resolution withholds the
//     replacement the same way plan time does (correctionsIncomplete, the
//     target row untouched);
//   - dry-run spends no model call on resolution: the collision is reported
//     as a preview fact only;
//   - a budget refusal during resolution stops the phase and names every
//     still-unresolved collision as incomplete, so nothing silently vanishes;
//   - assertions read the PERSISTED rows (content, supersede chains, source
//     sets, material liveness) plus the report's retry accounting — never the
//     printed counts alone.
//
// The judgement itself is NOT tested here: every verdict is an injected
// seam (T4's "controlled checker"). Coverage notes:
//   - the pending-collision creation site is exercised through the update
//     kind; the noop-kind sites push the same PendingCollision record and
//     resolve through the same phase (one function, all kinds);
//   - real-model coverage of the retry branches is explicitly UNCOVERED;
//     see the three labels in packages/kernel/test/correction-a1-a4.online.ts.
//     B2's first real-model judgment refused conservatively, which is the
//     recorded, expected behavior — the branch is deliberately not forced on
//     the model.
//
// Samples: B1/B2 and the shared old knowledge are the user-confirmed Q21
// round (SAMPLES-Q20-Q21-LOCK-COLDSTART.md, commit 7afa2d1d). M1 (multi-fact
// concurrency) and M2 (the version moves again during the re-judged attempt)
// are the two #262 samples the user confirmed before this file was written
// or run.
//
// No test framework (repo convention).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "../src/session-store";
import type {
  ConsolidateEvidence,
  ConsolidateVerifyInput,
  ConsolidateVerifyVerdict,
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

const dir = mkdtempSync(join(tmpdir(), "ans-262-"));
const stores: SqliteSessionStore[] = [];
function openStore(db: string): SqliteSessionStore {
  const s = new SqliteSessionStore(join(dir, db));
  stores.push(s);
  return s;
}
// Direct SQL over a fresh readonly handle keeps the assertions independent of
// the store's own read paths.
function q(db: string, sql: string, ...params: unknown[]): any {
  const d = new Database(join(dir, db), { readonly: true });
  try { return d.prepare(sql).get(...params); } finally { d.close(); }
}
function listRows(db: string, sql: string, ...params: unknown[]): any[] {
  const d = new Database(join(dir, db), { readonly: true });
  try { return d.prepare(sql).all(...params) as any[]; } finally { d.close(); }
}
function liveRows(db: string): any[] {
  return listRows(db, "SELECT * FROM semantic_memories WHERE valid_until IS NULL");
}

// --- fixtures (confirmed sample text) --------------------------------------

const A4_OLD = "A 公司在线客服工作日（周一至周五）9:00—17:00 提供服务。客服邮箱为 help@example.com。公共假期暂停人工客服、仅保留自助服务。";
const HOURS_NOTICE = "A 公司官方通知（2026-11-01 生效）：在线客服改为 7×24 小时全天候服务，替代原工作日（周一至周五）9:00—17:00 安排。客服邮箱和公共假期的人工客服安排保持不变。";
const A4_MERGED = "A 公司在线客服自 2026-11-01 起改为 7×24 小时全天候服务，替代原工作日（周一至周五）9:00—17:00 安排。客服邮箱 help@example.com 和公共假期暂停人工客服、仅保留自助服务的安排保持不变。";
const B2_CANDIDATE = "A 公司通知：在线客服仅在周末 10:00—18:00 提供服务。";
const EMAIL_NOTICE = "A 公司官方通知（2026-11-05 生效）：在线客服邮箱自 2026-11-05 起改为 support@example.com，替代原邮箱 help@example.com。服务时间与公共假期的人工客服安排保持不变。";
const BETA_EMAIL_FIRST_MERGED = "A 公司在线客服工作日（周一至周五）9:00—17:00 提供服务。客服邮箱自 2026-11-05 起改为 support@example.com，替代原邮箱 help@example.com。公共假期暂停人工客服、仅保留自助服务。";
const M1_FINAL = "A 公司在线客服自 2026-11-01 起改为 7×24 小时全天候服务，替代原工作日（周一至周五）9:00—17:00 安排。客服邮箱自 2026-11-05 起改为 support@example.com，替代原邮箱 help@example.com。公共假期暂停人工客服、仅保留自助服务的安排保持不变。";
const HOLIDAY_NOTICE = "A 公司官方通知（2026-11-08 生效）：公共假期人工客服照常提供服务，替代此前公共假期暂停人工客服、仅保留自助服务的安排。服务时间与客服邮箱保持不变。";
const GAMMA_FINAL = "A 公司在线客服自 2026-11-01 起改为 7×24 小时全天候服务，替代原工作日（周一至周五）9:00—17:00 安排。客服邮箱为 help@example.com，保持不变。公共假期人工客服照常提供服务，替代此前公共假期暂停人工客服、仅保留自助服务的安排。";

const CORRECTION: ConsolidateVerifyVerdict = {
  alreadyCurrent: false,
  sameFact: true,
  reliable: true,
  relation: "correction",
  reason: "official notice with effective date replaces the same fact",
};
const B1_REJUDGE: ConsolidateVerifyVerdict = {
  alreadyCurrent: true,
  sameFact: true,
  reliable: true,
  relation: "same",
  reason: "the live version already carries the same official correction",
};
const B2_REJUDGE: ConsolidateVerifyVerdict = {
  alreadyCurrent: false,
  sameFact: true,
  reliable: true,
  relation: "unclear",
  reason: "两份通知说法相反，没有生效日期或适用范围能解释差异，无法判定哪份更可靠",
};
const PASS_FINAL = async () => ({ supported: true, preserved: true, corrected: true, noExtras: true });
const SUPPORTED = () => ({ label: "supported" as const, confidence: 0.95 });

// A summarize seam that answers the candidate for the new material, the
// first-merge text when the CURRENT KNOWLEDGE item is the planned (old) row,
// and the re-merge text when it is the latest version ("7×24" is in alpha's
// content only — the re-merge target).
function stagedSummarize(
  candidate: string,
  firstMerge: string,
  opts: { reMerge?: string; onReMerge?: () => Promise<void>; reMergeError?: Error } = {},
) {
  let calls = 0;
  const fn = async (eps: ConsolidateEvidence[]): Promise<string | null> => {
    calls++;
    const ck = eps.find((e) => e.title === "CURRENT KNOWLEDGE");
    if (!ck) return candidate;
    if (ck.snippet.includes("7×24")) {
      if (opts.reMergeError) throw opts.reMergeError;
      if (opts.onReMerge) await opts.onReMerge();
      return opts.reMerge ?? firstMerge;
    }
    return firstMerge;
  };
  return { fn, calls: () => calls };
}

// A verify seam with scripted per-call verdicts and hooks:
//   `hold(n)`  runs before verdict n is returned — the concurrent writer's
//              whole run can complete while this session sits inside a
//              judgment, so this run's apply sees the target already replaced;
//   `onCall(n)` runs on every call (throwing a budget-shaped error there
//              simulates the seam refusing to spend).
function stagedVerify(
  verdicts: ConsolidateVerifyVerdict[],
  opts: { hold?: () => Promise<void>; holdAt?: number; onCall?: (n: number) => void } = {},
) {
  let calls = 0;
  const fn = async (input: ConsolidateVerifyInput): Promise<ConsolidateVerifyVerdict> => {
    const mine = calls++;
    if (opts.onCall) opts.onCall(mine);
    const holdAt = opts.holdAt ?? 0;
    if (mine === holdAt && opts.hold) await opts.hold();
    return verdicts[Math.min(mine, verdicts.length - 1)]!;
  };
  return { fn, calls: () => calls };
}

async function seedEpisode(
  store: SqliteSessionStore, sessionId: string, url: string, title: string, snippet: string, entity: string,
): Promise<number> {
  const ra = await store.adjudicateMemory(sessionId, [{ url, title, snippet, source: "tavily", evidence: 0.9, entity }]);
  const id = ra[0]?.insertedId;
  if (typeof id !== "number") throw new Error("seed failed for " + url);
  return id;
}

// The shared old knowledge row: three episodes of one entity, one batch run.
async function buildKnowledge(
  store: SqliteSessionStore, sessionId: string, entity: string, content: string, urlBase: string,
): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 1; i <= 3; i++) {
    ids.push(await seedEpisode(store, sessionId, urlBase + "-v" + i, entity + " v" + i, content, entity));
  }
  const rep = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [...ids], sessionIdNotApplied: false } },
    { summarize: async () => content, classify: SUPPORTED },
  );
  if (rep.add !== 1) throw new Error("seed failed: the batch run built " + rep.add + " rows, expected 1");
  return ids;
}

function sourceIds(row: any): number[] {
  try { return JSON.parse(String(row.source_episode_ids)) as number[]; } catch { return []; }
}

// The winner side of every scenario below: alpha's single-evidence correction
// of the hours fact, landing while the other session is mid-judgment.
function alphaCorrection(alpha: SqliteSessionStore, alphaNotice: number):
  () => Promise<Awaited<ReturnType<SqliteSessionStore["consolidateMemory"]>>> {
  return () => alpha.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [alphaNotice], sessionIdNotApplied: false }, allowSingleEvidence: true },
    { summarize: stagedSummarize(HOURS_NOTICE, A4_MERGED).fn, classify: SUPPORTED, verify: async () => CORRECTION, verifyFinal: PASS_FINAL },
  );
}

// --- S1. B1: both sessions submit the same official correction -------------
// Expected: ONE update, ONE live version; the later submitter re-reads the
// current version, its ONE re-judge recognizes the correction already
// applied, no duplicate version is created, and BOTH sides' materials live
// on in the row's sources.
{
  const db = "b1.db";
  const seed = openStore(db);
  const sessSeed = await seed.createSession("eval");
  await buildKnowledge(seed, sessSeed.id, "a-support-hours", A4_OLD, "https://a.example/support-facts");
  const oldRowId = liveRows(db)[0]!.id;
  seed.close();

  const alpha = openStore(db);
  const sessA = await alpha.createSession("alpha-b1");
  const alphaNotice = await seedEpisode(alpha, sessA.id, "https://a.example/notice-2026-11-01",
    "A 公司客服时间更新通知（官方）", HOURS_NOTICE, "a-support-hours");
  const beta = openStore(db);
  const sessB = await beta.createSession("beta-b1");
  // Same notice text, deliberately a different url: same url invalidates the
  // row on write, and the confirmed sample makes the copy explicit.
  const betaNotice = await seedEpisode(beta, sessB.id, "https://a.example/notice-2026-11-01-copy",
    "A 公司客服时间更新通知（官方）", HOURS_NOTICE, "a-support-hours");

  const betaVerify = stagedVerify([CORRECTION, B1_REJUDGE], { hold: alphaCorrection(alpha, alphaNotice) });
  const betaSum = stagedSummarize(HOURS_NOTICE, A4_MERGED);
  const repB = await beta.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [betaNotice], sessionIdNotApplied: false }, allowSingleEvidence: true },
    { summarize: betaSum.fn, classify: SUPPORTED, verify: betaVerify.fn, verifyFinal: PASS_FINAL },
  );

  const lives = liveRows(db);
  assert(lives.length === 1, "B1: exactly one live version (got " + lives.length + ")");
  const live = lives[0]!;
  assert(live.content === A4_MERGED, "B1: the live version is alpha's merged content, not a second copy");
  assert(repB.update === 0, "B1: the later submitter wrote no update (update=" + repB.update + ")");
  assert(repB.noop === 1, "B1: the resolution is counted as the noop it was (noop=" + repB.noop + ")");
  assert(repB.conflicts === 0, "B1: no unresolved conflict");
  assert(repB.resolvedCollisions.length === 1, "B1: the resolved collision is visible in the report");
  const res = repB.resolvedCollisions[0]!;
  assert(res.resolution === "duplicate", "B1: resolution is duplicate — no new version");
  assert(res.retries === 1, "B1: exactly one re-read + re-judge");
  assert(res.plannedTargetId === oldRowId, "B1: the planned target was the old row");
  assert(res.targetId === live.id, "B1: the resolution targeted the live head");
  assert(betaVerify.calls() === 2, "B1: at most two model judgments — initial + one re-judge (got " + betaVerify.calls() + ")");
  const srcs = sourceIds(live);
  assert(srcs.includes(alphaNotice), "B1: the winning side's material stays a source of the live row");
  assert(srcs.includes(betaNotice), "B1: the later submitter's material ALSO survives in the live row's sources");
  assert(q(db, "SELECT superseded_by FROM semantic_memories WHERE id = ?", oldRowId).superseded_by === live.id,
    "B1: the old row points at the single new version");
  const retired = listRows(db, "SELECT id FROM retrieval_results WHERE superseded_by = ?", live.id).map((r) => r.id);
  assert(retired.length >= 3, "B1: the old episodes were retired to the new row by the winning update");
  assert(q(db, "SELECT superseded_by FROM retrieval_results WHERE id = ?", betaNotice).superseded_by === null,
    "B1: the later submitter's material is not deleted or retired");
  assert(q(db, "SELECT superseded_by FROM retrieval_results WHERE id = ?", alphaNotice).superseded_by === null,
    "B1: the correcting material stays live");
  assert(repB.verifiedCorrections.length === 0 && repB.updates.length === 0,
    "B1: no fake 'verified' entry when nothing was replaced");
}

// --- S2. B2: the later material contradicts the landed version -------------
// Expected: first writer lands one update; the later submitter is blocked
// from overwriting, re-reads, re-judges once, and gets an UNRESOLVED conflict
// back: both sides' materials, the current live content, the reason. Nothing
// is deleted; write order is not treated as a verdict.
{
  const db = "b2.db";
  const seed = openStore(db);
  const sessSeed = await seed.createSession("eval");
  await buildKnowledge(seed, sessSeed.id, "a-support-hours", A4_OLD, "https://a.example/support-facts");
  seed.close();

  const alpha = openStore(db);
  const sessA = await alpha.createSession("alpha-b2");
  const alphaNotice = await seedEpisode(alpha, sessA.id, "https://a.example/notice-2026-11-01",
    "A 公司客服时间更新通知（官方）", HOURS_NOTICE, "a-support-hours");
  const beta = openStore(db);
  const sessB = await beta.createSession("beta-b2");
  const betaNotice = await seedEpisode(beta, sessB.id, "https://b.example/notice-2",
    "A 公司客服时间通知（另一份）", "A 公司通知：在线客服仅在周末 10:00—18:00 提供服务。", "a-support-hours");

  const betaVerify = stagedVerify([CORRECTION, B2_REJUDGE], { hold: alphaCorrection(alpha, alphaNotice) });
  const repB = await beta.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [betaNotice], sessionIdNotApplied: false }, allowSingleEvidence: true },
    { summarize: stagedSummarize(B2_CANDIDATE, A4_MERGED).fn, classify: SUPPORTED, verify: betaVerify.fn, verifyFinal: PASS_FINAL },
  );

  const lives = liveRows(db);
  assert(lives.length === 1, "B2: exactly one live version after the conflict");
  const live = lives[0]!;
  assert(live.content === A4_MERGED, "B2: the current knowledge is still the first writer's version");
  assert(repB.conflicts === 1 && repB.conflictDetails.length === 1,
    "B2: the unresolved conflict is reported (conflicts=" + repB.conflicts + ")");
  assert(repB.update === 0 && repB.noop === 0, "B2: nothing was written by the losing run");
  assert(repB.verifyRejected === 0, "B2: the conflict is NOT mislabeled as an ordinary refusal");
  assert(repB.resolvedCollisions.length === 0, "B2: nothing claims a resolution that did not happen");
  const d = repB.conflictDetails[0]!;
  assert(d.plannedContent === A4_OLD, "B2: the detail carries what the correction planned to replace");
  assert(d.currentTargetId === live.id && d.currentContent === A4_MERGED,
    "B2: the detail carries the CURRENT live content, not a guess");
  assert(d.evidence.some((e) => e.url === "https://b.example/notice-2"), "B2: our side's material is in the detail");
  const currentUrls = d.currentEvidence.map((e) => e.url);
  assert(currentUrls.includes("https://a.example/notice-2026-11-01"),
    "B2: the other side's correcting material is in the detail");
  assert(currentUrls.some((u) => u.includes("support-facts")),
    "B2: the current version's own source materials are in the detail");
  assert(d.relation === "unclear" && d.sameFact === true && d.reliable === true,
    "B2: the re-judge verdict travels with the conflict");
  assert(typeof d.followUp === "string" && d.followUp.length > 0, "B2: the detail says what to check next");
  assert(d.retries === 1, "B2: exactly one re-read + re-judge was spent");
  assert(betaVerify.calls() === 2, "B2: at most two model judgments, no third (got " + betaVerify.calls() + ")");
  assert(q(db, "SELECT superseded_by FROM retrieval_results WHERE id = ?", betaNotice).superseded_by === null,
    "B2: the conflicting material is kept, not deleted");
  const snippets = d.evidence.map((e) => e.snippet).join("\n");
  assert(snippets.includes("周末 10:00—18:00"), "B2: the material's own text (both sides' 原文) travels back");
}

// --- S3. M1: concurrent corrections of DIFFERENT facts (user-confirmed) ----
// Expected: after the collision the re-judge still accepts the email
// correction; ONE re-merge regenerates the text against the LATEST version,
// keeping the other session's just-updated fact instead of reusing the first
// merge (which was built for the dead target and still shows the old hours).
{
  const db = "m1.db";
  const seed = openStore(db);
  const sessSeed = await seed.createSession("eval");
  await buildKnowledge(seed, sessSeed.id, "a-support-hours", A4_OLD, "https://a.example/support-facts");
  seed.close();

  const alpha = openStore(db);
  const sessA = await alpha.createSession("alpha-m1");
  const alphaNotice = await seedEpisode(alpha, sessA.id, "https://a.example/notice-2026-11-01b",
    "A 公司客服时间更新通知（官方）", HOURS_NOTICE, "a-support-hours");
  const beta = openStore(db);
  const sessB = await beta.createSession("beta-m1");
  const betaNotice = await seedEpisode(beta, sessB.id, "https://a.example/notice-2026-11-05",
    "A 公司客服邮箱变更通知（官方）", EMAIL_NOTICE, "a-support-hours");

  const betaVerify = stagedVerify([CORRECTION, CORRECTION], { hold: alphaCorrection(alpha, alphaNotice) });
  const betaSum = stagedSummarize(EMAIL_NOTICE, BETA_EMAIL_FIRST_MERGED, {
    reMerge: M1_FINAL,
    onReMerge: async () => {
      const live = liveRows(db)[0]!;
      assert(live.content === A4_MERGED,
        "M1 (probe): at re-merge time the latest version is alpha's, not the dead plan's target");
    },
  });
  const repB = await beta.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [betaNotice], sessionIdNotApplied: false }, allowSingleEvidence: true },
    { summarize: betaSum.fn, classify: SUPPORTED, verify: betaVerify.fn, verifyFinal: PASS_FINAL },
  );

  const lives = liveRows(db);
  assert(lives.length === 1, "M1: exactly one live version after the re-merge");
  const live = lives[0]!;
  // The persisted content proves: alpha's just-updated fact survived, beta's
  // correction landed, and the first merge (old hours still current) was NOT
  // reused.
  assert(live.content === M1_FINAL, "M1: the live content is the re-merged text built on the latest version");
  assert(live.content.includes("7×24") && live.content.includes("support@example.com"),
    "M1: both sessions' corrections are in the live version");
  assert(repB.update === 1, "M1: the re-merged correction landed (update=" + repB.update + ")");
  const res = repB.resolvedCollisions[0]!;
  assert(res.resolution === "re-merged" && res.newId === live.id && res.targetContent === A4_MERGED,
    "M1: the report names the re-merge and the version it targeted");
  assert(res.retries === 1, "M1: exactly one re-judge");
  assert(repB.conflicts === 0, "M1: no unresolved conflict");
  assert(betaVerify.calls() === 2, "M1: two judgments total — initial + one re-judge");
  assert(repB.verifiedCorrections.length === 1 && repB.verifiedCorrections[0]!.oldContent === A4_MERGED,
    "M1: the correction is 'verified' against the version it actually replaced");
  const chains = listRows(db, "SELECT id, superseded_by, content FROM semantic_memories ORDER BY id");
  const rRow = chains.find((c) => c.content === A4_OLD)!;
  const saRow = chains.find((c) => c.content === A4_MERGED)!;
  assert(rRow.superseded_by === saRow.id, "M1: the old row points at alpha's version");
  assert(saRow.superseded_by === live.id, "M1: alpha's version points at the re-merged version");
  const alphaNoteRow = q(db, "SELECT superseded_by FROM retrieval_results WHERE id = ?", alphaNotice);
  assert(alphaNoteRow.superseded_by === live.id,
    "M1: the other session's correcting material was retired by the re-merge that superseded it");
  assert(q(db, "SELECT superseded_by FROM retrieval_results WHERE id = ?", betaNotice).superseded_by === null,
    "M1: the re-merging session's material stays live as the current version's evidence");
  const liveSrcs = sourceIds(live);
  assert(liveSrcs.includes(betaNotice) && liveSrcs.includes(alphaNotice),
    "M1: the live version's sources carry both sessions' notices");
}

// --- S4. M2: the version moves AGAIN during the re-judged attempt ---------
// Expected: beta re-reads alpha's version and its re-judge accepts; while the
// re-merge runs a THIRD session lands its own correction; beta's second
// submit finds the target gone and reports an UNRESOLVED conflict. No third
// judgment happens; both sides' evidence goes back; the current knowledge is
// the third session's version.
{
  const db = "m2.db";
  const seed = openStore(db);
  const sessSeed = await seed.createSession("eval");
  await buildKnowledge(seed, sessSeed.id, "a-support-hours", A4_OLD, "https://a.example/support-facts");
  seed.close();

  const alpha = openStore(db);
  const sessA = await alpha.createSession("alpha-m2");
  const alphaNotice = await seedEpisode(alpha, sessA.id, "https://a.example/notice-2026-11-01b",
    "A 公司客服时间更新通知（官方）", HOURS_NOTICE, "a-support-hours");
  const beta = openStore(db);
  const sessB = await beta.createSession("beta-m2");
  const betaNotice = await seedEpisode(beta, sessB.id, "https://a.example/notice-2026-11-05",
    "A 公司客服邮箱变更通知（官方）", EMAIL_NOTICE, "a-support-hours");
  const gamma = openStore(db);
  const sessG = await gamma.createSession("gamma-m2");
  const gammaNotice = await seedEpisode(gamma, sessG.id, "https://a.example/notice-2026-11-08",
    "A 公司公告：公共假期人工客服照常服务（官方）", HOLIDAY_NOTICE, "a-support-hours");

  let gammaReport: Awaited<ReturnType<SqliteSessionStore["consolidateMemory"]>> | undefined;
  const gammaRun = async (): Promise<void> => {
    gammaReport = await gamma.consolidateMemory(
      { scope: { by: "memory", sessionIds: [], memoryIds: [gammaNotice], sessionIdNotApplied: false }, allowSingleEvidence: true },
      { summarize: stagedSummarize(HOLIDAY_NOTICE, GAMMA_FINAL).fn, classify: SUPPORTED, verify: async () => CORRECTION, verifyFinal: PASS_FINAL },
    );
  };
  const betaVerify = stagedVerify([CORRECTION, CORRECTION], { hold: alphaCorrection(alpha, alphaNotice) });
  const betaSum = stagedSummarize(EMAIL_NOTICE, BETA_EMAIL_FIRST_MERGED, {
    reMerge: M1_FINAL,
    onReMerge: gammaRun,
  });
  const repB = await beta.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [betaNotice], sessionIdNotApplied: false }, allowSingleEvidence: true },
    { summarize: betaSum.fn, classify: SUPPORTED, verify: betaVerify.fn, verifyFinal: PASS_FINAL },
  );

  const lives = liveRows(db);
  assert(lives.length === 1, "M2: exactly one live version after the three-way race");
  const live = lives[0]!;
  assert(live.content === GAMMA_FINAL, "M2: the current knowledge is the third session's landed version");
  assert(repB.conflicts === 1 && repB.conflictDetails.length === 1,
    "M2: the second submit reports the version-moved conflict");
  const d = repB.conflictDetails[0]!;
  assert(d.currentTargetId === live.id && d.currentContent === GAMMA_FINAL,
    "M2: the conflict carries the CURRENT live content — the version that moved");
  assert(d.plannedContent === A4_OLD, "M2: the conflict remembers what the original plan targeted");
  assert(d.retries === 1, "M2: one re-judge was spent before the version moved again");
  assert(betaVerify.calls() === 2, "M2: NO third judgment after the version moved (got " + betaVerify.calls() + ")");
  assert(repB.update === 0 && repB.noop === 0, "M2: nothing was written by the losing run");
  assert(repB.resolvedCollisions.length === 0, "M2: no fake resolution");
  assert(gammaReport !== undefined && gammaReport!.update === 1,
    "M2: the third session's own correction landed normally");
  assert(q(db, "SELECT superseded_by FROM retrieval_results WHERE id = ?", betaNotice).superseded_by === null,
    "M2: the losing session's material is kept, not deleted");
  assert(q(db, "SELECT superseded_by FROM retrieval_results WHERE id = ?", gammaNotice).superseded_by === null,
    "M2: the winning session's material stays live");
  // The extra calls beta spent (merge + final check before the failed submit)
  // were real model work and must show up in the seam accounting.
  assert(betaSum.calls() === 3, "M2: plan summarize + first merge + ONE re-merge = 3 summarize calls (got " + betaSum.calls() + ")");
  const saRow = listRows(db, "SELECT id, superseded_by FROM semantic_memories WHERE content = ?", A4_MERGED)[0]!;
  assert(saRow.superseded_by === live.id, "M2: alpha's version points at the version that replaced it");
}

// --- S5. dry-run: the collision is a preview fact, no resolution model call -
{
  const db = "dryrun.db";
  const seed = openStore(db);
  const sessSeed = await seed.createSession("eval");
  await buildKnowledge(seed, sessSeed.id, "a-support-hours", A4_OLD, "https://a.example/support-facts");
  seed.close();

  const alpha = openStore(db);
  const sessA = await alpha.createSession("alpha-dry");
  const alphaNotice = await seedEpisode(alpha, sessA.id, "https://a.example/notice-2026-11-01",
    "A 公司客服时间更新通知（官方）", HOURS_NOTICE, "a-support-hours");
  const beta = openStore(db);
  const sessB = await beta.createSession("beta-dry");
  const betaNotice = await seedEpisode(beta, sessB.id, "https://a.example/notice-2026-11-05",
    "A 公司客服邮箱变更通知（官方）", EMAIL_NOTICE, "a-support-hours");

  const betaVerify = stagedVerify([CORRECTION], { hold: alphaCorrection(alpha, alphaNotice) });
  const betaSum = stagedSummarize(EMAIL_NOTICE, BETA_EMAIL_FIRST_MERGED, { reMerge: M1_FINAL });
  const repB = await beta.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [betaNotice], sessionIdNotApplied: false }, allowSingleEvidence: true, dryRun: true },
    { summarize: betaSum.fn, classify: SUPPORTED, verify: betaVerify.fn, verifyFinal: PASS_FINAL },
  );

  assert(repB.dryRun === true, "dry-run: the report is a dry-run report");
  assert(repB.conflicts === 1 && repB.conflictDetails.length === 1,
    "dry-run: the collision is reported, not silently absorbed");
  const d = repB.conflictDetails[0]!;
  assert(d.retries === 0, "dry-run: no re-judge was spent");
  assert(d.reason.includes("dry-run preview"), "dry-run: the reason names it a preview, so it cannot read as a lost live correction");
  assert(d.currentTargetId === liveRows(db)[0]!.id, "dry-run: the detail still says WHICH version replaced the plan");
  assert(repB.resolvedCollisions.length === 0, "dry-run: no resolution is claimed");
  assert(betaVerify.calls() === 1, "dry-run: only the plan-time judgment ran — no model call after the ROLLBACK");
  assert(betaSum.calls() === 2, "dry-run: plan summarize + merge preview only (got " + betaSum.calls() + ")");
  const lives = liveRows(db);
  assert(lives.length === 1, "dry-run: still exactly one live version (alpha's)");
  assert(lives[0]!.content === A4_MERGED, "dry-run: the live version is untouched by the preview run");
  assert(q(db, "SELECT superseded_by FROM retrieval_results WHERE id = ?", betaNotice).superseded_by === null,
    "dry-run: the preview made no persistent change to the later submitter's material");
}

// --- S6. budget refusal during resolution names collisions as incomplete ---
// Two clusters collide in one run; the budget refuses the FIRST re-judge. The
// phase stops, both collisions are counted incomplete with the budget stage,
// nothing is written and nothing silently vanishes.
{
  const db = "budget.db";
  const seed = openStore(db);
  const sessSeed = await seed.createSession("eval");
  await buildKnowledge(seed, sessSeed.id, "a-support-hours", A4_OLD, "https://a.example/support-facts");
  seed.close();

  const alpha = openStore(db);
  const sessA = await alpha.createSession("alpha-budget");
  const alphaNotice = await seedEpisode(alpha, sessA.id, "https://a.example/notice-2026-11-01",
    "A 公司客服时间更新通知（官方）", HOURS_NOTICE, "a-support-hours");
  const beta = openStore(db);
  const sessB = await beta.createSession("beta-budget");
  // Two clusters (different entities) whose candidates both best-match the
  // same live row: two colliding update ops in one run. Alpha lands during
  // the SECOND plan judgment (holdAt 1), so BOTH plan-phase scans still see
  // the old row and BOTH closes collide at apply.
  const betaHours = await seedEpisode(beta, sessB.id, "https://a.example/notice-hours",
    "时间通知", HOURS_NOTICE, "beta-hours-claim");
  const betaEmail = await seedEpisode(beta, sessB.id, "https://a.example/notice-email",
    "邮箱通知", EMAIL_NOTICE, "beta-email-claim");

  const budgetRejection = Object.assign(
    new Error("consolidation stopped: the session budget rejected this call"),
    { code: "consolidate-budget-rejected" },
  );
  const betaVerify = stagedVerify([CORRECTION, CORRECTION, CORRECTION], {
    hold: alphaCorrection(alpha, alphaNotice),
    holdAt: 1,
    onCall: (n) => { if (n === 2) throw budgetRejection; },
  });
  const repB = await beta.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [betaHours, betaEmail], sessionIdNotApplied: false }, allowSingleEvidence: true },
    { summarize: stagedSummarize(HOURS_NOTICE, A4_MERGED).fn, classify: SUPPORTED, verify: betaVerify.fn, verifyFinal: PASS_FINAL },
  );

  assert(repB.budgetRejected === 1, "budget: exactly one budget refusal is counted");
  assert(repB.correctionsIncomplete === 2 && repB.incompleteDetails.length === 2,
    "budget: BOTH collisions are named incomplete, not dropped (incomplete=" + repB.correctionsIncomplete + ")");
  assert(repB.incompleteDetails.every((x) => x.stage === "rejudge-budget"),
    "budget: the incomplete stage names the refused re-judge");
  assert(repB.conflicts === 0 && repB.resolvedCollisions.length === 0,
    "budget: an interrupted resolution is neither a conflict nor a fake resolution");
  assert(betaVerify.calls() === 3,
    "budget: two plan judgments + ONE refused re-judge; the second re-judge never runs (got " + betaVerify.calls() + ")");
  assert(liveRows(db).length === 1, "budget: still exactly one live version (alpha's)");
  assert(q(db, "SELECT superseded_by FROM retrieval_results WHERE id = ?", betaHours).superseded_by === null
    && q(db, "SELECT superseded_by FROM retrieval_results WHERE id = ?", betaEmail).superseded_by === null,
    "budget: both losing-side materials stay live");
}

// --- S8. a FAILED re-merge withholds the replacement ------------------------
// The collision resolves into an accepted correction, the re-merge model call
// then fails: no replacement, the current knowledge untouched, counted
// incomplete (same rule as plan time), only ONE re-judge spent.
{
  const db = "remerge-failed.db";
  const seed = openStore(db);
  const sessSeed = await seed.createSession("eval");
  await buildKnowledge(seed, sessSeed.id, "a-support-hours", A4_OLD, "https://a.example/support-facts");
  seed.close();

  const alpha = openStore(db);
  const sessA = await alpha.createSession("alpha-8");
  const alphaNotice = await seedEpisode(alpha, sessA.id, "https://a.example/notice-2026-11-01",
    "A 公司客服时间更新通知（官方）", HOURS_NOTICE, "a-support-hours");
  const beta = openStore(db);
  const sessB = await beta.createSession("beta-8");
  const betaNotice = await seedEpisode(beta, sessB.id, "https://a.example/notice-2026-11-05",
    "A 公司客服邮箱变更通知（官方）", EMAIL_NOTICE, "a-support-hours");

  const betaVerify = stagedVerify([CORRECTION, CORRECTION], { hold: alphaCorrection(alpha, alphaNotice) });
  const betaSum = stagedSummarize(EMAIL_NOTICE, BETA_EMAIL_FIRST_MERGED, {
    reMerge: M1_FINAL,
    reMergeError: new Error("provider stream ended mid-merge"),
  });
  const repB = await beta.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [betaNotice], sessionIdNotApplied: false }, allowSingleEvidence: true },
    { summarize: betaSum.fn, classify: SUPPORTED, verify: betaVerify.fn, verifyFinal: PASS_FINAL },
  );

  const lives = liveRows(db);
  assert(lives.length === 1 && lives[0]!.content === A4_MERGED,
    "S8: the latest version is untouched after the failed re-merge");
  assert(repB.correctionsIncomplete === 1 && repB.incompleteDetails.length === 1,
    "S8: the failed re-merge is counted incomplete, not dropped (incomplete=" + repB.correctionsIncomplete + ")");
  const d = repB.incompleteDetails[0]!;
  assert(d.stage === "merge-failed", "S8: the stage names the failed resolution merge");
  assert(d.oldId === lives[0]!.id && d.oldContent === A4_MERGED,
    "S8: the incomplete detail is about the LATEST version, the one the re-merge targeted");
  assert(typeof d.reason === "string" && d.reason.includes("provider stream ended mid-merge"),
    "S8: the merge failure's reason travels back");
  assert(repB.conflicts === 0 && repB.resolvedCollisions.length === 0,
    "S8: a failed re-merge is neither a conflict nor a claimed resolution");
  assert(repB.update === 0 && repB.noop === 0, "S8: nothing was written");
  assert(betaVerify.calls() === 2, "S8: exactly two judgments — initial + one re-judge (got " + betaVerify.calls() + ")");
  assert(q(db, "SELECT superseded_by FROM retrieval_results WHERE id = ?", betaNotice).superseded_by === null,
    "S8: the losing side's material stays live");
}

// --- S9. a FAILED final check during resolution withholds the replacement --
{
  const db = "final-failed.db";
  const seed = openStore(db);
  const sessSeed = await seed.createSession("eval");
  await buildKnowledge(seed, sessSeed.id, "a-support-hours", A4_OLD, "https://a.example/support-facts");
  seed.close();

  const alpha = openStore(db);
  const sessA = await alpha.createSession("alpha-9");
  const alphaNotice = await seedEpisode(alpha, sessA.id, "https://a.example/notice-2026-11-01",
    "A 公司客服时间更新通知（官方）", HOURS_NOTICE, "a-support-hours");
  const beta = openStore(db);
  const sessB = await beta.createSession("beta-9");
  const betaNotice = await seedEpisode(beta, sessB.id, "https://a.example/notice-2026-11-05",
    "A 公司客服邮箱变更通知（官方）", EMAIL_NOTICE, "a-support-hours");

  const betaVerify = stagedVerify([CORRECTION, CORRECTION], { hold: alphaCorrection(alpha, alphaNotice) });
  // Final check: the plan-time check (against the old row) passes; the
  // resolution re-check FAILS fact retention — e.g. the re-merged text
  // dropped the holiday arrangement the other session just updated.
  let finalCalls = 0;
  const failingVerifyFinal = async () => {
    finalCalls++;
    if (finalCalls === 1) return { supported: true, preserved: true, corrected: true, noExtras: true };
    return {
      supported: true, preserved: false, corrected: true, noExtras: true,
      reason: "the re-merged text no longer states the holiday arrangement the current version carries",
    };
  };
  const repB = await beta.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [betaNotice], sessionIdNotApplied: false }, allowSingleEvidence: true },
    { summarize: stagedSummarize(EMAIL_NOTICE, BETA_EMAIL_FIRST_MERGED, { reMerge: M1_FINAL }).fn, classify: SUPPORTED, verify: betaVerify.fn, verifyFinal: failingVerifyFinal },
  );

  const lives = liveRows(db);
  assert(lives.length === 1 && lives[0]!.content === A4_MERGED,
    "S9: the latest version survives the failed final check");
  assert(repB.correctionsIncomplete === 1 && repB.incompleteDetails[0]!.stage === "final-check",
    "S9: the failed final check is counted incomplete at the final-check stage");
  const d = repB.incompleteDetails[0]!;
  assert(d.oldId === lives[0]!.id && d.oldContent === A4_MERGED,
    "S9: the incomplete detail is about the version the re-merge targeted");
  assert(typeof d.reason === "string" && d.reason.includes("holiday arrangement"),
    "S9: the final-check failure reason travels back");
  assert(repB.conflicts === 0 && repB.resolvedCollisions.length === 0 && repB.update === 0,
    "S9: nothing was written and nothing is claimed resolved");
  assert(betaVerify.calls() === 2, "S9: still exactly two judgments");
  assert(q(db, "SELECT superseded_by FROM retrieval_results WHERE id = ?", betaNotice).superseded_by === null,
    "S9: the losing side's material stays live");
}

for (const s of stores) { try { s.close(); } catch { /* already closed */ } }
__setEmbeddingModuleForTest("auto");
rmSync(dir, { recursive: true, force: true });

console.log("concurrent-correction: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
