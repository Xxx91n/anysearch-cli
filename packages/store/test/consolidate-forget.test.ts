// consolidation ops quadruple, fidelity gate, theta boundary,
// dry-run exact prediction, reversible archive undo, pinned exemption.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "../src/session-store";
import { decideOp } from "../src/consolidate";
import { __setEmbeddingModuleForTest } from "../src/embedding-arm";
import { __setExtractorForTest } from "@anysearch-cli/embedding";

function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error("FAIL: " + msg); process.exit(1); }
}

// Deterministic embedding seam: FNV-seeded LCG vector. Identical input -> identical vector
// (cos = 1.0 exactly), which anchors the NOOP/rerun path without float32 boundary fragility.
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

const dir = mkdtempSync(join(tmpdir(), "ans-cons-"));
const dbPath = join(dir, "cons.db");
const semRows = () => {
  const d = new Database(dbPath, { readonly: true });
  const rows = d
    .prepare("SELECT id, content, valid_until as vu, confidence, access_count as ac, source_episode_ids as src FROM semantic_memories ORDER BY id")
    .all() as Array<{ id: number; content: string; vu: string | null; confidence: number; ac: number; src: string }>;
  d.close();
  return rows;
};

// --- D7 assertion 3: theta_dup = 0.90 boundary (strict >) ---
assert(decideOp(0.900001, 0, false) === "noop", "cos just above theta -> noop");
assert(decideOp(0.9, 0, false) === "add", "cos exactly 0.90 is NOT noop (strict boundary)");
assert(decideOp(0.899999, 0, false) === "add", "cos just below theta -> add");
assert(decideOp(0.5, 0.5, true) === "update", "high-overlap contradiction -> update");
assert(decideOp(0.5, 0.5, false) === "add", "high overlap without contradiction -> add");
assert(decideOp(0.5, 0.39, true) === "add", "contradiction below jac 0.4 -> add");

// --- degraded path — bestCos === null means no cosine was computable ---
// theta_jac = 0.80 boundary (strict >), calibrated on golden dataset: distinct summaries
// jac=0.000, identical rerun=1.000, contradiction-pair ceiling=0.714 (update stays reachable).
assert(decideOp(null, 0.81, false) === "noop", "degraded: jac above theta_jac -> noop");
assert(decideOp(null, 1.0, false) === "noop", "degraded: verbatim rerun -> noop");
assert(decideOp(null, 0.8, false) === "add", "degraded: jac exactly 0.80 is NOT noop (strict boundary)");
assert(decideOp(null, 0.72, true) === "update", "degraded: contradiction pair at 0.714 ceiling still updates, not noop");
assert(decideOp(null, 0.5, true) === "update", "degraded: update path unchanged (jac>0.4 + contradiction)");
assert(decideOp(null, 0.9, true) === "noop", "degraded: noop precedence over update mirrors cosine path");
assert(decideOp(null, 0.5, false) === "add", "degraded: mid-jac without contradiction -> add");

// --- consolidation integration ---
const SUMMARY_A = "Alpha service uses Beta library for builds. Release cadence is weekly.";
const SUMMARY_B = "Alpha service does not use Beta library for builds. Release cadence is not weekly.";
// A different fact set, used where the case needs a cluster untouched by the
// contradiction runs above (the gate-absent ADD path).
const SUMMARY_C = "Delta service runs on Epsilon for deploys. Rollout cadence is daily.";
const store = new SqliteSessionStore(dbPath, {
  consolidateSummarize: async () => SUMMARY_A,
  consolidateClassify: () => ({ label: "supported", confidence: 0.92 }),
});
const session = await store.createSession("eval");
// Supersede chain: 3 writes, one entity -> 2 closed + 1 live episode (the history cluster, D2).
for (let i = 1; i <= 3; i++) {
  const r = await store.adjudicateMemory(session.id, [
    { url: "https://ex.com/alpha", title: "Alpha build note v" + i, snippet: "Alpha uses Beta for builds, revision " + i, source: "exa", evidence: 0.9 },
  ]);
  assert(r[0] && (r[0].action === "accept" || r[0].action === "supersede"), "write " + i + " accepted");
}

// dry-run == apply prediction (D7-6), and dry-run writes nothing
let rep = await store.consolidateMemory({ dryRun: true });
assert(rep.dryRun === true && rep.clustersTriggered === 1, "dry-run triggers the one cluster");
assert(rep.add === 1 && rep.noop === 0 && rep.update === 0, "dry-run predicts one ADD");
assert(semRows().length === 0, "dry-run wrote nothing (rolled-back tx)");

rep = await store.consolidateMemory();
assert(rep.add === 1 && rep.semanticIds.length === 1, "apply writes exactly one semantic row (matches dry-run)");
let sem = semRows();
assert(sem.length === 1 && sem[0].vu === null, "one live semantic row");
assert(Math.abs(sem[0].confidence - 0.92) < 1e-9, "fidelity confidence propagates to row");

// rerun -> NOOP (same summary => cos 1.0 > 0.90); NOOP touches access_count
let rep2 = await store.consolidateMemory();
assert(rep2.noop === 1 && rep2.add === 0 && rep2.update === 0, "rerun is NOOP (idempotent, D4)");
assert(semRows()[0].ac === 1, "NOOP touched access_count");

// contradiction UPDATE: negated summary, high token overlap -> soft-close old, write new.
// #261: a replacement now has to pass both checks, so this store supplies
// checkers that say "same fact, reliable, explicit correction". What the case
// still pins is the UPDATE op itself (soft-close + new row + source union).
const CORRECTION_OK = {
  consolidateVerify: async () => ({ alreadyCurrent: false, sameFact: true, reliable: true, relation: "correction" as const }),
  consolidateVerifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
};
const store2 = new SqliteSessionStore(dbPath, {
  consolidateSummarize: async () => SUMMARY_B,
  consolidateClassify: () => ({ label: "supported", confidence: 0.95 }),
  ...CORRECTION_OK,
});
rep2 = await store2.consolidateMemory();
assert(rep2.update === 1, "contradicting summary -> UPDATE op (D4)");
sem = semRows();
assert(sem.length === 2 && sem.filter((r) => r.vu === null).length === 1, "UPDATE soft-closes old row, writes new (bi-temporal)");
assert(JSON.parse(sem[1].src).length === 3, "UPDATE unions source episode ids");

// D7-1 fidelity negative: unsupported claim -> reject, no write.
// Own database: after the contradiction above every material of the original
// cluster is superseded, and the fixed rule skips such a cluster before it ever
// reaches the gate (#261). This case needs a cluster with a live material, so
// it builds a fresh one.
{
  const gateDb2 = join(dir, "gate-negative.db");
  const seed = new SqliteSessionStore(gateDb2, { consolidateSummarize: async () => SUMMARY_C });
  const gs = await seed.createSession("eval");
  for (let i = 1; i <= 3; i++) {
    await seed.adjudicateMemory(gs.id, [
      { url: "https://ex.com/delta", title: "Delta note v" + i, snippet: "Delta runs on Epsilon, revision " + i, source: "exa", evidence: 0.9 },
    ]);
  }
  const rejecting = new SqliteSessionStore(gateDb2, {
    consolidateSummarize: async () => "Delta service uses Zeta compiler for everything now.",
    consolidateClassify: () => ({ label: "unsupported", confidence: 0.1 }),
    ...CORRECTION_OK,
  });
  const repNeg = await rejecting.consolidateMemory();
  assert(repNeg.gateRejected === 1 && repNeg.add === 0 && repNeg.update === 0 && repNeg.noop === 0,
    "unsupported claim rejected by fidelity gate (D7-1); got gateRejected=" + repNeg.gateRejected);
  const gn = new Database(gateDb2, { readonly: true });
  const gnRows = gn.prepare("SELECT COUNT(*) c FROM semantic_memories").get() as { c: number };
  gn.close();
  assert(gnRows.c === 0, "gate rejection wrote nothing (rows=" + gnRows.c + ")");
  seed.close();
  rejecting.close();
}

// gate absent -> LOW_CONFIDENCE row (fail-open, never blocks). #261 needs this
// case on its own database: after the contradiction above, every material of
// this cluster is superseded, and the fixed rule then skips the cluster
// instead of re-summarizing the past (pinned separately). What this case still
// covers is the ADD path with no fidelity gate: new knowledge is written and
// carries the LOW_CONFIDENCE marker rather than being blocked.
{
  const gateDb = join(dir, "gate-absent.db");
  const seed = new SqliteSessionStore(gateDb, { consolidateSummarize: async () => SUMMARY_C });
  const gs = await seed.createSession("eval");
  for (let i = 1; i <= 3; i++) {
    await seed.adjudicateMemory(gs.id, [
      { url: "https://ex.com/delta", title: "Delta note v" + i, snippet: "Delta runs on Epsilon, revision " + i, source: "exa", evidence: 0.9 },
    ]);
  }
  const rep4 = await seed.consolidateMemory();
  assert(rep4.add === 1, "gate absent still runs ops (add expected here)");
  const gd = new Database(gateDb, { readonly: true });
  const gateRows = gd.prepare("SELECT confidence as c, valid_until as vu FROM semantic_memories ORDER BY id").all() as Array<{ c: number; vu: string | null }>;
  gd.close();
  assert(gateRows.length === 1, "gate absent: the row was written");
  assert(Math.abs(gateRows[0]!.c - 0.2) < 1e-9, "gate absent: the row carries the LOW_CONFIDENCE 0.2 marker");
  assert(gateRows[0]!.vu === null, "gate absent: the written row is live");
  seed.close();

  // The same state now has a superseded-only cluster story: the contradiction
  // run above replaced every material of ITS cluster, so a rerun over that
  // archive skips it rather than re-summarizing replaced facts.
  const store4 = new SqliteSessionStore(dbPath, { consolidateSummarize: async () => SUMMARY_A });
  rep2 = await store4.consolidateMemory();
  assert(rep2.supersededClusterSkipped === 1 && rep2.add === 0 && rep2.update === 0,
    "all materials replaced: the cluster is skipped, not re-summarized (got " +
    rep2.supersededClusterSkipped + ", add=" + rep2.add + ", update=" + rep2.update + ")");
  sem = semRows();
  assert(sem.length === 2, "all materials replaced: no knowledge row was invented from them");
  const live = sem.filter((r) => r.vu === null);
  assert(live.length === 1, "all materials replaced: the corrected row stays the only live one");
  store4.close();
}

// #261: without both checks a contradiction is refused, not written on faith.
// Its own database on purpose: this case needs a freshly built knowledge row,
// not whatever the earlier runs left behind.
{
  const nocheckDb = join(dir, "nocheck.db");
  const seed = new SqliteSessionStore(nocheckDb, {
    consolidateSummarize: async () => SUMMARY_A,
    consolidateClassify: () => ({ label: "supported", confidence: 0.92 }),
  });
  const ns = await seed.createSession("eval");
  for (let i = 1; i <= 3; i++) {
    await seed.adjudicateMemory(ns.id, [
      { url: "https://ex.com/alpha", title: "Alpha build note v" + i, snippet: "Alpha uses Beta for builds, revision " + i, source: "exa", evidence: 0.9 },
    ]);
  }
  const seededReport = await seed.consolidateMemory();
  assert(seededReport.add === 1, "no checker setup: one knowledge row was built");

  const counter = new SqliteSessionStore(nocheckDb, {
    consolidateSummarize: async () => SUMMARY_B,
    consolidateClassify: () => ({ label: "supported", confidence: 0.95 }),
    // deliberately no verify / verifyFinal
  });
  const repNoCheck = await counter.consolidateMemory();
  assert(repNoCheck.update === 0 && repNoCheck.verifyRejected === 1,
    "no checker: a contradiction is refused, not replaced (update=" + repNoCheck.update + ", verifyRejected=" + repNoCheck.verifyRejected + ")");
  const refused = repNoCheck.verifyDetails[0];
  assert(!!refused && refused.sameFact === false && refused.reliable === false,
    "no checker: the refusal says no verdict was obtained");
  const ro = new Database(nocheckDb, { readonly: true });
  const rowsNow = ro
    .prepare("SELECT content, valid_until as vu FROM semantic_memories ORDER BY id").all() as Array<{ content: string; vu: string | null }>;
  ro.close();
  assert(rowsNow.length === 1 && rowsNow[0]!.vu === null && rowsNow[0]!.content === SUMMARY_A,
    "no checker: the old knowledge is still the only live row");
  seed.close();
  counter.close();
}

// --- semantic arm resolves on the single-query searchMemory path.
// Pre-fix, negative synthetic rowids entered the RRF list but never the byId map -> silent drop.
{
  // The live row at this point is the corrected one from the contradiction run.
  const liveRow = semRows().filter((r) => r.vu === null)[0]!;
  const hits = await store.searchMemory(SUMMARY_A, 5);
  const semHit = hits.find((h) => h.rowid === -liveRow.id);
  if (!semHit) { console.error("FAIL: semantic-only id resolves via searchMemory (r94 A1)"); process.exit(1); }
  assert(semHit.role === "(semantic)", "semantic hit carries the (semantic) role");
  assert(!!semHit.arms && semHit.arms.includes("semantic"), "hit provenance lists the semantic arm");
}

// summarize seam absent -> llmUnavailable, fail-open, no write.
// Own database for the same reason as the gate case: the original cluster is
// fully superseded by now, and a superseded cluster is skipped before the
// summarizer is consulted at all (#261).
{
  const llmDb = join(dir, "no-summarizer.db");
  const seed = new SqliteSessionStore(llmDb, { consolidateSummarize: async () => SUMMARY_C });
  const ls = await seed.createSession("eval");
  for (let i = 1; i <= 3; i++) {
    await seed.adjudicateMemory(ls.id, [
      { url: "https://ex.com/delta", title: "Delta note v" + i, snippet: "Delta runs on Epsilon, revision " + i, source: "exa", evidence: 0.9 },
    ]);
  }
  // A store with no summarize seam at all: the cluster triggers, the missing
  // seam is reported, and nothing is written.
  const bare = new SqliteSessionStore(llmDb);
  const repBare = await bare.consolidateMemory();
  assert(repBare.llmUnavailable === 1 && repBare.add === 0 && repBare.update === 0 && repBare.noop === 0,
    "missing summarize seam -> llmUnavailable, fail-open; got llmUnavailable=" + repBare.llmUnavailable);
  seed.close();
  bare.close();
}

// --- D5 forget: reversible archive (D7-4) ---
const seedRw = new Database(dbPath);
const ins = seedRw.prepare(
  "INSERT INTO retrieval_results (session_id, url, title, snippet, source, created_at, access_count, pinned, entity) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)",
);
const oldId = Number(ins.run(session.id, "https://ex.com/old", "zzz obsolete craft notes", "zzz obsolete craft notes body", "exa", "2025-01-01 00:00:00", 0, "zzold").lastInsertRowid);
const pinId = Number(ins.run(session.id, "https://ex.com/oldp", "zzz pinned craft notes", "zzz pinned craft notes body", "exa", "2025-01-01 00:00:00", 1, "zzpin").lastInsertRowid);
seedRw.close();

const cands = store.scanArchive();
assert(cands.some((c) => c.id === oldId), "aged zero-access row is an archive candidate");
assert(!cands.some((c) => c.id === pinId), "pinned row is exempt from archiving (D5)");

// dry-run: exact prediction, no state change
const drep = store.applyArchive(undefined, { dryRun: true });
assert(drep.dryRun && drep.archived === 1 && drep.requested === 1, "archive dry-run predicts exactly one archive");
{
  const d = new Database(dbPath, { readonly: true });
  const r = d.prepare("SELECT archived FROM retrieval_results WHERE id = ?").get(oldId) as { archived: number };
  d.close();
  assert(r.archived === 0, "archive dry-run left row untouched (rolled-back tx)");
}

// retrieval visibility via recall path (searchAllResults => retrieval_results_fts) and
// bit-exact row restore on the fields archive/undo are allowed to touch.
// recall bumps access_count/last_accessed, so those two are excluded from the raw snapshot.
const snapRow = (id: number): Record<string, unknown> => {
  const d = new Database(dbPath, { readonly: true });
  const r = d.prepare("SELECT * FROM retrieval_results WHERE id = ?").get(id) as Record<string, unknown>;
  d.close();
  for (const k of ["access_count", "last_accessed", "archived"]) delete r[k];
  return r;
};
// memory hits are set-membership: RRF side arms (vector etc.) may add extra rows, so assert the
// candidate rowid is present, not that it is the only hit.
const memBefore = await store.searchMemory("obsolete", 10);
assert(memBefore.some((h) => h.rowid === oldId), "row retrievable before archive (recall path)");
assert((await store.searchMemory("obsolete", 10)).some((h) => h.rowid === oldId), "recall stable before archive");
const rowBefore = snapRow(oldId);
// Note: the recall probe above touched access_count, so a fresh auto-scan would no longer
// list this row; the apply call passes explicit ids (the documented manual path).
const arep = store.applyArchive([oldId]);
assert(arep.archived === 1 && arep.logIds.length === 1, "apply archives exactly the candidate");
const memMid = await store.searchMemory("obsolete", 10);
assert(!memMid.some((h) => h.rowid === oldId), "archived row excluded from retrieval (D5)");
const uok = store.undoArchive(arep.logIds[0]);
assert(uok.ok === true && uok.memoryId === oldId, "undo restores archived row");
const memAfter = await store.searchMemory("obsolete", 10);
const rowBeforeHit = memBefore.find((h) => h.rowid === oldId);
const rowAfterHit = memAfter.find((h) => h.rowid === oldId);
if (!rowBeforeHit) throw new Error("pre-archive hit present");
assert(!!rowAfterHit && rowAfterHit.content === rowBeforeHit.content && rowAfterHit.role === rowBeforeHit.role, "undo restores identical hit content (D7-4)");
const rawAfter = (() => { const d = new Database(dbPath, { readonly: true }); const r = d.prepare("SELECT archived FROM retrieval_results WHERE id = ?").get(oldId) as { archived: number }; d.close(); return r; })();
assert(rawAfter.archived === 0, "archived flag restored to 0");
assert(JSON.stringify(snapRow(oldId)) === JSON.stringify(rowBefore), "row snapshot bit-exact after apply+undo (D7-4)");
assert(store.undoArchive(arep.logIds[0]).ok === false, "undo is idempotent (second call is a no-op)");

// --- pinned exemption enforced at the force point on the explicit-ids path ---
const prep = store.applyArchive([pinId]);
assert(prep.archived === 0 && prep.skipped === 1, "explicit pinned id refused at apply (r94 A7)");

// --- integration: embedding arm absent -> jaccard-only dedup ---
// Reproduces the con_add_then_noop offline regression: first consolidate ADDs, the rerun
// near-verbatim summary NOOPs via theta_jac — and the degraded decision is counted.
{
  const dir2 = mkdtempSync(join(tmpdir(), "ans-cons-absent-"));
  const dbPath2 = join(dir2, "absent.db");
  __setEmbeddingModuleForTest(null); // package absent: embedText === null
  try {
    const storeA = new SqliteSessionStore(dbPath2, {
      consolidateSummarize: async () => "pnpm pins prevent lockfile drift; corepack enforces packageManager",
      consolidateClassify: () => ({ label: "supported" as const, confidence: 0.95 }),
    });
    const sess2 = await storeA.createSession("eval");
    for (let i = 1; i <= 3; i++) {
      await storeA.adjudicateMemory(sess2.id, [
        { url: "https://ex.com/pn" + i, title: "pnpm note v" + i, snippet: "pin drift note revision " + i, source: "exa", evidence: 0.9, entity: "PnpmPinning" },
      ]);
    }
    const repA1 = await storeA.consolidateMemory();
    assert(repA1.add === 1 && repA1.noop === 0, "absent arm: first consolidate adds (got add=" + repA1.add + " noop=" + repA1.noop + ")");
    assert(repA1.embeddingAbsent === 0, "absent arm: no live rows yet -> no degraded decision counted");
    const repA2 = await storeA.consolidateMemory();
    assert(repA2.noop === 1 && repA2.add === 0, "absent arm: verbatim rerun noops via theta_jac (got add=" + repA2.add + " noop=" + repA2.noop + ")");
    assert(repA2.embeddingAbsent === 1, "absent arm: degraded dedup decision counted (embeddingAbsent=" + repA2.embeddingAbsent + ")");
    const semRowsA = (() => { const d = new Database(dbPath2, { readonly: true }); const rows = d.prepare("SELECT COUNT(*) c FROM semantic_memories").get() as { c: number }; d.close(); return rows.c; })();
    assert(semRowsA === 1, "absent arm: noop wrote no duplicate row (semantic_memories=" + semRowsA + ")");
    storeA.close();
  } finally {
    __setEmbeddingModuleForTest("auto");
    rmSync(dir2, { recursive: true, force: true });
  }
}

for (const st of [store, store2]) st.close();
rmSync(dir, { recursive: true, force: true });
console.log("consolidate-forget: all assertions passed");
