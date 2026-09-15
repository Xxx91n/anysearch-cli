// ADR-0037 D4/D5/D7: consolidation ops quadruple, fidelity gate, theta boundary,
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

// --- R63 T1 (D-002): degraded path — bestCos === null means no cosine was computable ---
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

// contradiction UPDATE: negated summary, high token overlap -> soft-close old, write new
const store2 = new SqliteSessionStore(dbPath, {
  consolidateSummarize: async () => SUMMARY_B,
  consolidateClassify: () => ({ label: "supported", confidence: 0.95 }),
});
rep2 = await store2.consolidateMemory();
assert(rep2.update === 1, "contradicting summary -> UPDATE op (D4)");
sem = semRows();
assert(sem.length === 2 && sem.filter((r) => r.vu === null).length === 1, "UPDATE soft-closes old row, writes new (bi-temporal)");
assert(JSON.parse(sem[1].src).length === 3, "UPDATE unions source episode ids");

// D7-1 fidelity negative: unsupported claim -> reject, no write
const store3 = new SqliteSessionStore(dbPath, {
  consolidateSummarize: async () => "Alpha service uses Gamma compiler for everything now.",
  consolidateClassify: () => ({ label: "unsupported", confidence: 0.1 }),
});
rep2 = await store3.consolidateMemory();
assert(rep2.gateRejected === 1 && rep2.add === 0 && rep2.update === 0 && rep2.noop === 0, "unsupported claim rejected by fidelity gate (D7-1)");
assert(semRows().length === 2, "gate rejection wrote nothing");

// gate absent -> LOW_CONFIDENCE row (fail-open, never blocks). Same text as row1 vs live row2
// (contradiction) -> op resolves to UPDATE per quadruple.
const store4 = new SqliteSessionStore(dbPath, { consolidateSummarize: async () => SUMMARY_A });
rep2 = await store4.consolidateMemory();
assert(rep2.update === 1, "gate absent still runs ops (update expected here)");
sem = semRows();
assert(sem.length === 3, "row written even without fidelity gate");
const live = sem.filter((r) => r.vu === null);
assert(live.length === 1 && Math.abs(live[0].confidence - 0.2) < 1e-9, "gate-absent row carries LOW_CONFIDENCE 0.2 marker");

// --- r94 audit A1 (atomcode Spec-1): semantic arm resolves on the single-query searchMemory path.
// Pre-fix, negative synthetic rowids entered the RRF list but never the byId map -> silent drop.
{
  const hits = await store.searchMemory(SUMMARY_A, 5);
  const semHit = hits.find((h) => h.rowid === -live[0].id);
  if (!semHit) { console.error("FAIL: semantic-only id resolves via searchMemory (r94 A1)"); process.exit(1); }
  assert(semHit.role === "(semantic)", "semantic hit carries the (semantic) role");
  assert(!!semHit.arms && semHit.arms.includes("semantic"), "hit provenance lists the semantic arm");
}

// summarize seam absent -> llmUnavailable, fail-open, no write
const store5 = new SqliteSessionStore(dbPath);
rep2 = await store5.consolidateMemory();
assert(rep2.llmUnavailable === 1 && rep2.add === 0 && rep2.update === 0 && rep2.noop === 0, "missing summarize seam -> llmUnavailable, fail-open");

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

// --- r94 audit A7: pinned exemption enforced at the force point on the explicit-ids path ---
const prep = store.applyArchive([pinId]);
assert(prep.archived === 0 && prep.skipped === 1, "explicit pinned id refused at apply (r94 A7)");

// --- R63 T1 (D-002) integration: embedding arm absent -> jaccard-only dedup ---
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

for (const st of [store, store2, store3, store4, store5]) st.close();
rmSync(dir, { recursive: true, force: true });
console.log("consolidate-forget: all assertions passed");
