// #263 — a summary records what it actually read, and a correction stops the
// summaries that depended on the replaced fact from being injected.
//
// What is under test (spec D8/D9, T4):
//   S1  a summary write records the rows it was built from, across sessions —
//       and ONLY those rows (no session-wide or text-matched guesses)
//   S2  a correction suspends the summaries that read the replaced fact, and
//       leaves unrelated summaries alone
//   S3  a suspended summary is not injected as the current conclusion; the
//       unrelated one still is
//   S4  the suspension does not delete anything: the old summary text and its
//       dependency rows stay readable
//   S5  a summary generated from a version that was already replaced is written
//       suspended, never re-marked valid
//   S6  the migration is repeatable: re-opening the same database twice leaves
//       every dependency and suspension intact
//
// The judgement here is NOT a model call: the correction uses the injected
// verify seam with a fixed verdict, and the injection check reads the pipeline
// that actually builds the prompt. That proves the FLOW (T4), not a model's
// ability to judge a correction.
//
// Run: pnpm --filter @anysearch-cli/store run test

import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "../src/session-store";
import {
  findSummariesDependingOn,
  isSourceCurrent,
  parseSummarySourceRefs,
  resolveSummarySourcesFromUrls,
  suspendedSummaryAnchorIds,
  type SummarySourceRef,
} from "../src/summary-sources";
import { __setEmbeddingModuleForTest } from "../src/embedding-arm";
import { __setExtractorForTest } from "@anysearch-cli/embedding";
import type { ConsolidateEvidence, ConsolidateVerifyVerdict } from "../src/consolidate";

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

const dir = mkdtempSync(join(tmpdir(), "ans-263-"));
const stores: SqliteSessionStore[] = [];
function openStore(db: string): SqliteSessionStore {
  const s = new SqliteSessionStore(join(dir, db));
  stores.push(s);
  return s;
}
function closeAll(): void {
  for (const s of stores.splice(0)) {
    try { s.close(); } catch { /* already closed */ }
  }
}
// Direct SQL over a separate handle keeps the assertions independent of the
// store's own read paths (those get their own section below).
function q(db: string, sql: string, ...params: unknown[]): any {
  const d = new Database(join(dir, db), { readonly: true });
  try { return d.prepare(sql).get(...params); } finally { d.close(); }
}
function qAll(db: string, sql: string, ...params: unknown[]): any[] {
  const d = new Database(join(dir, db), { readonly: true });
  try { return d.prepare(sql).all(...params) as any[]; } finally { d.close(); }
}
// Run a read against a separate connection and close it. Windows refuses to
// delete the temp directory while ANY better-sqlite3 handle is still open, so
// every ad-hoc connection goes through here instead of being left to the GC.
function withDb<T>(db: string, fn: (d: Database.Database) => T): T {
  const d = new Database(join(dir, db), { readonly: true });
  try { return fn(d); } finally { d.close(); }
}

/**
 * Remove a table (and the indexes naming it) from a schema script.
 *
 * S6b needs a database shaped like the PREVIOUS version's, and the honest way
 * to get one is to take the real schema and drop the parts this ticket added.
 * Splitting on `;` keeps it statement-level: no regex over the whole file, which
 * is where a quote or a newline would silently break the match.
 */
function dropTables(schema: string, tables: string[]): string {
  const kept: string[] = [];
  for (const stmt of schema.split(";")) {
    // A plain substring test: the table names here are unique enough that
    // escaping a word-boundary regex (which this repo's Python-side tooling
    // has already mangled twice) buys nothing.
    const mentions = tables.some((t) => stmt.includes(t));
    if (mentions) continue;
    kept.push(stmt);
  }
  return kept.join(";");
}

// --- fixtures -------------------------------------------------------------

const OLD_FACT = "Acme online support runs weekdays 9:00-17:00. Support email is help@acme.com.";
const NEW_FACT = "Acme online support is now 24x7 every day, effective 2026-11-01.";
const MERGED_FACT = "Acme online support is now 24x7 every day, effective 2026-11-01. Support email is help@acme.com.";
const UNRELATED = "Beta publishing ships its catalog on the first Monday of each month.";

const CORRECTION_VERDICT: ConsolidateVerifyVerdict = {
  alreadyCurrent: false, sameFact: true, reliable: true, relation: "correction",
  reason: "official notice with an effective date replaces the same service-hours fact",
};
const SUPPORTED = () => ({ label: "supported" as const, confidence: 0.95 });

async function seedEpisode(
  store: SqliteSessionStore, sessionId: string, url: string, title: string, snippet: string, entity: string,
): Promise<number> {
  const ra = await store.adjudicateMemory(sessionId, [{ url, title, snippet, source: "tavily", evidence: 0.9, entity }]);
  const id = ra[0]?.insertedId;
  if (typeof id !== "number") throw new Error("seed failed for " + url);
  return id;
}

// Build one live knowledge row from three materials of one entity.
async function buildKnowledge(
  store: SqliteSessionStore, sessionId: string, entity: string, content: string, urlBase: string,
): Promise<{ materialIds: number[]; knowledgeId: number }> {
  const ids: number[] = [];
  for (let i = 1; i <= 3; i++) {
    // One entity key (that is what the cluster groups on) with a distinct URL.
    // Writing the next row of the same key closes the previous one by temporal
    // supersede, so only the LAST row stays valid — and only a valid row may be
    // cited as a summary's source (isSourceCurrent checks valid_until as well as
    // superseded_by; a row retired by an ordinary re-fetch is history).
    ids.push(await seedEpisode(store, sessionId, urlBase + "-v" + i, entity + " v" + i, content, entity));
  }
  const rep = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [...ids], sessionIdNotApplied: false } },
    { summarize: async () => content, classify: SUPPORTED },
  );
  assert(rep.add === 1, "fixture: the batch run built one knowledge row (add=" + rep.add + ")");
  const knowledgeId = rep.semanticIds[0];
  if (typeof knowledgeId !== "number") throw new Error("fixture: no knowledge id");
  void store;
  return { materialIds: [ids[ids.length - 1]!], knowledgeId };
}

// --- S1: a summary records exactly the rows it read ------------------------

{
  const db = "s1.db";
  const store = openStore(db);
  await store.createSession("acme");
  const sessionId = "session-owner";
  await store.ensureSession(sessionId, "acme");
  // A summary from ANOTHER session: cross-session material is a real
  // dependency, so this must be recordable too.
  const other = "session-other";
  await store.ensureSession(other, "acme");
  const otherMaterial = await seedEpisode(store, other, "https://acme.example/handbook", "handbook", OLD_FACT, "acme");

  // Two of this summary's own materials live in its own session, one in another.
  const own1 = await seedEpisode(store, sessionId, "https://acme.example/notice-1", "notice", OLD_FACT, "acme");
  const own2 = await seedEpisode(store, sessionId, "https://acme.example/hours", "hours", OLD_FACT, "acme");

  await store.saveAnchor(sessionId, "rolling_summary", {
    summary: "support runs weekdays 9-17",
    sources: [
      { kind: "material", id: own1 },
      { kind: "material", id: own2 },
      { kind: "material", id: otherMaterial },
    ],
  });

  const anchors = await store.getAnchors(sessionId);
  const summaryAnchor = anchors.filter((a) => a.anchorType === "rolling_summary").pop()!;
  const rows = qAll(db, "SELECT source_kind, source_id FROM summary_sources WHERE anchor_id = ? ORDER BY source_id", summaryAnchor.id);
  assert(rows.length === 3, "S1: three dependency rows recorded (got " + rows.length + ")");
  const recorded = new Set(rows.map((r: any) => r.source_kind + ":" + r.source_id));
  assert(recorded.has("material:" + own1) && recorded.has("material:" + own2),
    "S1: the summary's own materials are recorded");
  assert(recorded.has("material:" + otherMaterial),
    "S1: material recalled from ANOTHER session is recorded too (cross-session dependency)");

  // "Same session" is not a dependency: the store must not invent rows for
  // materials the summary never named.
  const noise = await seedEpisode(store, sessionId, "https://acme.example/unused", "unused", "noise", "acme");
  assert(!recorded.has("material:" + noise),
    "S1: a material in the SAME session that the summary did not read is NOT recorded");
}

// --- S2: a correction suspends exactly the dependent summaries -------------

{
  const db = "s2.db";
  const store = openStore(db);
  await store.createSession("acme");
  const owner = "session-acme";
  await store.ensureSession(owner, "acme");
  const bystander = "session-beta";
  await store.ensureSession(bystander, "acme");

  const built = await buildKnowledge(store, owner, "acme", OLD_FACT, "https://acme.example/n");
  // The dependent summary read the knowledge row AND one of its materials.
  await store.saveAnchor(owner, "rolling_summary", {
    summary: "Acme support runs weekdays 9-17; email help@acme.com",
    sources: [
      { kind: "knowledge", id: built.knowledgeId },
      { kind: "material", id: built.materialIds[0]! },
    ],
  });
  // An unrelated summary in a DIFFERENT session, built from unrelated material.
  const unrelatedMaterial = await seedEpisode(store, bystander, "https://beta.example/catalog", "catalog", UNRELATED, "beta");
  await store.saveAnchor(bystander, "rolling_summary", {
    summary: "Beta ships the catalog on the first Monday",
    sources: [{ kind: "material", id: unrelatedMaterial }],
  });

  const beforeAnchors = await store.getAnchors(owner);
  const dependentAnchorId = beforeAnchors.filter((a) => a.anchorType === "rolling_summary").pop()!.id;

  // One reliable new material corrects the knowledge row.
  const correctionMaterial = await seedEpisode(store, bystander, "https://acme.example/notice-2026", "notice", NEW_FACT, "acme");
  const rep = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [correctionMaterial], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: async (eps: ConsolidateEvidence[]) =>
        eps.some((e) => e.title === "CURRENT KNOWLEDGE") ? MERGED_FACT : NEW_FACT,
      classify: SUPPORTED,
      verify: async () => CORRECTION_VERDICT,
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
    },
  );
  assert(rep.update === 1, "S2: the correction landed (update=" + rep.update + ")");
  assert(rep.summariesSuspended === 1, "S2: exactly one summary suspended (got " + rep.summariesSuspended + ")");
  assert(rep.suspendedSummaries.length === 1 && rep.suspendedSummaries[0]!.sessionId === owner,
    "S2: the suspended summary belongs to the session that held the stale conclusion");
  assert(rep.suspendedSummaries[0]!.triggerKnowledgeId === built.knowledgeId,
    "S2: the report names which knowledge row triggered the suspension");

  // The unrelated summary is untouched: its anchor is not in the suspended set.
  const bystanderAnchors = await store.getAnchors(bystander);
  const bystanderAnchorId = bystanderAnchors.filter((a) => a.anchorType === "rolling_summary").pop()!.id;
  const suspended = withDb(db, (d) => suspendedSummaryAnchorIds(d, bystander));
  const suspendedOwner = store.suspendedSummaryAnchorIds(owner);
  assert(suspendedOwner.has(dependentAnchorId),
    "S2: the dependent summary is suspended");
  assert(!suspendedOwner.has(bystanderAnchorId),
    "S2: an unrelated summary in another session is NOT suspended");
  assert(suspended.size === 0, "S2: the unrelated session has no suspensions at all");

  // A summary an earlier correction already suspended is NOT reported a second
  // time: a second correction to the same knowledge must not claim it did new
  // work, or a caller reading the count would think two summaries went stale.
  const secondCorrection = await seedEpisode(store, bystander, "https://acme.example/notice-2026-b", "notice", NEW_FACT, "acme");
  const rep2 = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [secondCorrection], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: async (eps: ConsolidateEvidence[]) =>
        eps.some((e) => e.title === "CURRENT KNOWLEDGE") ? MERGED_FACT : NEW_FACT,
      classify: SUPPORTED,
      verify: async () => CORRECTION_VERDICT,
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
    },
  );
  assert(rep2.summariesSuspended === 0,
    "S2: a summary already suspended by an earlier correction is not counted again (got " + rep2.summariesSuspended + ")");
  assert(q(db, "SELECT COUNT(*) AS n FROM summary_suspensions WHERE anchor_id = ?", dependentAnchorId)!.n === 1,
    "S2: still exactly one suspension row for that anchor (no duplicate audit rows)");

  // A summary written AFTER the correction, from a material that is still
  // current, is not retroactively suspended: the suspension is about the rows
  // a summary actually read, not about "a correction happened in this session".
  const stillCurrentMaterial = await seedEpisode(store, owner, "https://beta.example/after", "after", UNRELATED, "beta");
  await store.saveAnchor(owner, "rolling_summary", {
    summary: "a summary written after the correction from current material",
    sources: [{ kind: "material", id: stillCurrentMaterial }],
  });
  const afterOwn = await store.getAnchors(owner);
  const laterAnchorId = afterOwn[afterOwn.length - 1]!.id;
  assert(!store.suspendedSummaryAnchorIds(owner).has(laterAnchorId),
    "S2: a summary built from CURRENT material is not retroactively suspended by an earlier correction");
}

// --- S3/S4: the suspension blocks injection and deletes nothing ------------

{
  const db = "s3.db";
  const store = openStore(db);
  await store.createSession("acme");
  const owner = "session-inject";
  await store.ensureSession(owner, "acme");

  const built = await buildKnowledge(store, owner, "acme", OLD_FACT, "https://acme.example/i");
  await store.saveAnchor(owner, "rolling_summary", {
    summary: "STALE-CONCLUSION-263: support runs weekdays 9-17",
    sources: [{ kind: "knowledge", id: built.knowledgeId }],
  });
  const staleAnchorId = (await store.getAnchors(owner)).filter((a) => a.anchorType === "rolling_summary").pop()!.id;

  const correctionMaterial = await seedEpisode(store, owner, "https://acme.example/i-notice", "notice", NEW_FACT, "acme");
  await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [correctionMaterial], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: async (eps: ConsolidateEvidence[]) =>
        eps.some((e) => e.title === "CURRENT KNOWLEDGE") ? MERGED_FACT : NEW_FACT,
      classify: SUPPORTED,
      verify: async () => CORRECTION_VERDICT,
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
    },
  );

  // S4: nothing was deleted — the old summary text and its dependency rows are
  // still readable, which is what makes the decision auditable.
  const anchors = await store.getAnchors(owner);
  const staleAnchor = anchors.find((a) => a.id === staleAnchorId)!;
  assert((staleAnchor.payload as any).summary.includes("STALE-CONCLUSION-263"),
    "S4: the suspended summary's original text is still stored");
  const depRows = qAll(db, "SELECT source_kind, source_id FROM summary_sources WHERE anchor_id = ? ORDER BY source_id", staleAnchorId);
  assert(depRows.length > 0, "S4: the suspended summary keeps its dependency rows");
  assert(q(db, "SELECT COUNT(*) AS n FROM summary_suspensions WHERE anchor_id = ?", staleAnchorId)!.n === 1,
    "S4: exactly one suspension row records why it stopped");
  const suspensionReason = q(db, "SELECT reason FROM summary_suspensions WHERE anchor_id = ?", staleAnchorId)!.reason as string;
  assert(suspensionReason.length > 0 && suspensionReason.includes(String(built.knowledgeId)),
    "S4: the suspension names the knowledge row that triggered it");
  // The knowledge rows themselves were not deleted either.
  assert(q(db, "SELECT COUNT(*) AS n FROM semantic_memories WHERE id = ?", built.knowledgeId)!.n === 1,
    "S4: the replaced knowledge row is kept for provenance, not deleted");

  // S3: the pipeline's injection must skip the suspended summary. It is exercised
  // against the REAL store in the kernel test that owns the prompt-building
  // path (#263 memory-pipeline section); here the store-level contract is that
  // the id is reported as suspended, which is what that check reads.
  assert(store.suspendedSummaryAnchorIds(owner).has(staleAnchorId),
    "S3: the store reports the stale summary as suspended (the injection check reads this set)");
}

// --- S5: a summary built on an already-replaced version is not marked valid --

{
  const db = "s5.db";
  const store = openStore(db);
  await store.createSession("acme");
  const owner = "session-race";
  await store.ensureSession(owner, "acme");

  const built = await buildKnowledge(store, owner, "acme", OLD_FACT, "https://acme.example/r");
  // Simulate the race: a correction lands WHILE the summary is being written,
  // so by the time the summary's transaction commits, its source is closed.
  const correctionMaterial = await seedEpisode(store, owner, "https://acme.example/r-notice", "notice", NEW_FACT, "acme");
  await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [correctionMaterial], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: async (eps: ConsolidateEvidence[]) =>
        eps.some((e) => e.title === "CURRENT KNOWLEDGE") ? MERGED_FACT : NEW_FACT,
      classify: SUPPORTED,
      verify: async () => CORRECTION_VERDICT,
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
    },
  );
  assert(!withDb(db, (d) => isSourceCurrent(d, { kind: "knowledge", id: built.knowledgeId })),
    "S5: fixture — the knowledge row is now replaced");

  // The summary arrives AFTER the correction, citing the closed row.
  await store.saveAnchor(owner, "rolling_summary", {
    summary: "LATE-SUMMARY-263: weekdays 9-17",
    sources: [{ kind: "knowledge", id: built.knowledgeId }],
  });
  const lateAnchorId = (await store.getAnchors(owner)).filter((a) => a.anchorType === "rolling_summary").pop()!.id;
  assert(store.suspendedSummaryAnchorIds(owner).has(lateAnchorId),
    "S5: a summary written from an already-replaced version is written SUSPENDED, never marked valid");
  const text = (await store.getAnchors(owner)).find((a) => a.id === lateAnchorId)!.payload as any;
  assert(String(text.summary).includes("LATE-SUMMARY-263"),
    "S5: the late summary's text is still recorded (honest record of what was generated)");

  // And a summary built from a CURRENT row is NOT suspended: the check is
  // about the version, not about "a correction happened somewhere".
  const liveKnowledge = await buildKnowledge(store, owner, "beta", UNRELATED, "https://beta.example/l");
  await store.saveAnchor(owner, "l2_recall", {
    hits: "FRESH-RECALL-263",
    sources: [{ kind: "knowledge", id: liveKnowledge.knowledgeId }],
  });
  const recallAnchorId = (await store.getAnchors(owner)).filter((a) => a.anchorType === "l2_recall").pop()!.id;
  assert(!store.suspendedSummaryAnchorIds(owner).has(recallAnchorId),
    "S5: a summary built from a CURRENT row is not suspended");
}

// --- S6: the migration is repeatable --------------------------------------

{
  const db = "s6.db";
  const store = openStore(db);
  await store.createSession("acme");
  const owner = "session-migrate";
  await store.ensureSession(owner, "acme");
  const material = await seedEpisode(store, owner, "https://acme.example/m", "m", OLD_FACT, "acme");
  await store.saveAnchor(owner, "rolling_summary", {
    summary: "summary before upgrade",
    sources: [{ kind: "material", id: material }],
  });
  const anchorId = (await store.getAnchors(owner)).filter((a) => a.anchorType === "rolling_summary").pop()!.id;
  // Remove ONLY this section's handle from the tracking list before closing.
  // `stores.splice(0)` would also drop the store handles other sections still
  // have open, leaving them unreachable for closeAll() — a window leak that
  // makes the temp directory undeletable on Windows.
  const mine = stores.indexOf(store);
  if (mine >= 0) stores.splice(mine, 1);
  store.close();

  // Re-open the SAME database twice. Each open runs the schema script and the
  // column migrations; a second run must not lose or duplicate anything.
  const first = q(db, "SELECT COUNT(*) AS n FROM summary_sources");
  for (let round = 0; round < 2; round++) {
    const reopened = openStore(db);
    await reopened.getAnchors(owner);
    // Untrack only this reopen, then close it.
    const at = stores.indexOf(reopened);
    if (at >= 0) stores.splice(at, 1);
    reopened.close();
  }
  const after = q(db, "SELECT COUNT(*) AS n FROM summary_sources");
  assert(first!.n === after!.n,
    "S6: re-opening the database twice leaves the same dependency rows (" + first!.n + " -> " + after!.n + ")");
  assert(after!.n === 1, "S6: no duplicate dependency row was created");
  // The tables exist on a database created by the previous version too: an
  // existing DB without them gains them on the next open (CREATE IF NOT EXISTS).
  const tables = qAll(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('summary_sources', 'summary_suspensions')");
  assert(tables.length === 2, "S6: both summary-provenance tables exist after the migration path");
  // A row recorded before the reopen is still the right dependency.
  const row = q(db, "SELECT source_kind, source_id, anchor_id FROM summary_sources WHERE anchor_id = ?", anchorId);
  assert(row && row.source_id === material && row.source_kind === "material",
    "S6: the pre-existing dependency survived the migration");
}

// --- S6b: an OLD database (built before this ticket) upgrades in place ------

{
  // The migration case that matters is not "reopen a new database" — it is a
  // database created by the PREVIOUS version, which holds research data and
  // summaries but neither new table. Those tables must appear on the next open
  // with every existing row and anchor untouched.
  //
  // The file is built from the REAL schema minus the #263 tables, so it is
  // exactly the shape an older install left behind.
  const db = "s6b-legacy.db";
  const schemaPath = join(import.meta.dirname ?? ".", "..", "src", "schema.sql");
  const { readFileSync } = await import("node:fs");
  const fullSchema = readFileSync(schemaPath, "utf8");
  // Dropped by name rather than by regex: the schema text carries quotes,
  // newlines and semicolons, and a regex over it is a fragile way to prove
  // "this old database lacks the new tables".
  const legacySchema = dropTables(fullSchema, ["summary_sources", "summary_suspensions"]);
  assert(!/summary_sources/.test(legacySchema) && !/summary_suspensions/.test(legacySchema),
    "S6b prep: the legacy schema really has neither new table");
  {
    const raw = new Database(join(dir, db));
    try {
      raw.exec("PRAGMA journal_mode = WAL");
      raw.exec(legacySchema);
      // Legacy data: a session, one material row, and a summary anchor that,
      // being older than this ticket, records no sources at all.
      raw.prepare("INSERT INTO sessions (id, domain) VALUES (?, ?)").run("legacy-session", "acme");
      raw.prepare(
        "INSERT INTO retrieval_results (session_id, url, title, snippet, source, entity) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("legacy-session", "https://legacy.example/old", "old", "legacy material text", "tavily", "legacy");
      raw.prepare("INSERT INTO resume_anchors (session_id, anchor_type, payload) VALUES (?, ?, ?)").run(
        "legacy-session", "rolling_summary", JSON.stringify({ summary: "LEGACY-SUMMARY-263: written before the upgrade" }),
      );
    } finally {
      raw.close();
    }
  }

  const legacyRowsBefore = q(db, "SELECT COUNT(*) AS n FROM retrieval_results")!.n;
  const legacyAnchorsBefore = q(db, "SELECT COUNT(*) AS n FROM resume_anchors")!.n;
  assert(legacyRowsBefore === 1 && legacyAnchorsBefore === 1, "S6b prep: the legacy database holds real data");

  // Opening it with the CURRENT store runs the real startup path — the
  // migration under test.
  const upgraded = openStore(db);
  const anchors = await upgraded.getAnchors("legacy-session");
  assert(anchors.length === 1 && String((anchors[0]!.payload as any).summary).includes("LEGACY-SUMMARY-263"),
    "S6b: the old summary is still readable after the upgrade");
  assert(anchors[0]!.id !== undefined, "S6b: the old anchor still has its id (its columns are intact)");
  // An old summary has no recorded dependency, so it is neither suspended nor
  // claimed to depend on anything: "no record" is not "depends on everything".
  assert(!upgraded.suspendedSummaryAnchorIds("legacy-session").has(anchors[0]!.id),
    "S6b: an old summary with no recorded sources is not suspended by the upgrade");
  const depCount = q(db, "SELECT COUNT(*) AS n FROM summary_sources WHERE session_id = ?", "legacy-session")!.n;
  assert(depCount === 0, "S6b: the upgrade invents no dependency for the old summary (got " + depCount + ")");
  assert(q(db, "SELECT COUNT(*) AS n FROM retrieval_results")!.n === legacyRowsBefore,
    "S6b: existing research rows are preserved by the upgrade");
  const tables = qAll(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('summary_sources', 'summary_suspensions')");
  assert(tables.length === 2, "S6b: the upgrade added both new tables");
  // And the upgraded database records dependencies from now on.
  const legacyMaterialId = q(db, "SELECT id FROM retrieval_results WHERE session_id = 'legacy-session'")!.id as number;
  await upgraded.saveAnchor("legacy-session", "l2_recall", {
    hits: "NEW-RECALL-263",
    sources: [{ kind: "material", id: legacyMaterialId }],
  });
  assert(q(db, "SELECT COUNT(*) AS n FROM summary_sources WHERE session_id = ?", "legacy-session")!.n === 1,
    "S6b: the upgraded database records new dependencies");
  const at = stores.indexOf(upgraded);
  if (at >= 0) stores.splice(at, 1);
  upgraded.close();
}

// --- S8: a citation to an ALREADY-RETIRED material still suspends ---------

{
  // The window this closes: the summary was generated from a tool result that
  // cited a material, and that material was corrected before the summary was
  // written. Resolving only the CURRENT row would drop the citation, so
  // `saveSummaryAnchor` would find nothing to check and store the summary as
  // VALID even though its body states the replaced fact.
  const db = "s8.db";
  const store = openStore(db);
  await store.createSession("acme");
  const sid = "session-s8";
  await store.ensureSession(sid, "acme");

  const built = await buildKnowledge(store, sid, "acme", OLD_FACT, "https://acme.example/s8");
  // One of the row's own materials — these are what a correction retires.
  const oldMaterial = built.materialIds[0]!;
  const oldUrl = q(db, "SELECT url FROM retrieval_results WHERE id = ?", oldMaterial)!.url as string;
  assert(typeof oldUrl === "string" && oldUrl.length > 0, "S8 fixture: the material has a URL");

  // The correction retires that material.
  const correctionMaterial = await seedEpisode(store, sid, "https://acme.example/s8-notice", "notice", NEW_FACT, "acme");
  const rep = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [correctionMaterial], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: async (eps: ConsolidateEvidence[]) =>
        eps.some((e) => e.title === "CURRENT KNOWLEDGE") ? MERGED_FACT : NEW_FACT,
      classify: SUPPORTED,
      verify: async () => CORRECTION_VERDICT,
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
    },
  );
  assert(rep.update === 1, "S8 fixture: the correction landed");
  const retired = qAll(db, "SELECT id FROM retrieval_results WHERE id = ? AND superseded_by IS NOT NULL", oldMaterial);
  assert(retired.length === 1, "S8 fixture: the old material is now retired");

  // The summary arrives AFTER, citing the retired material's URL.
  const resolved = store.resolveSummarySources([oldUrl]);
  const ids = resolved.filter((r: SummarySourceRef) => r.kind === "material").map((r: SummarySourceRef) => r.id);
  assert(ids.includes(oldMaterial),
    "S8: a citation to an ALREADY-RETIRED material is still resolved (got " + JSON.stringify(ids) + ")");

  await store.saveAnchor(sid, "rolling_summary", {
    summary: "S8-STALE: written after the material was retired",
    sources: resolved,
  });
  const anchorId = (await store.getAnchors(sid)).filter((a) => a.anchorType === "rolling_summary").pop()!.id;
  assert(store.suspendedSummaryAnchorIds(sid).has(anchorId),
    "S8: the summary is written SUSPENDED instead of being injected as current");
  const text = (await store.getAnchors(sid)).find((a) => a.id === anchorId)!.payload as any;
  assert(String(text.summary).includes("S8-STALE"), "S8: its text is still recorded");
}

// --- S9: an ARCHIVED material is still a dependency -----------------------

{
  // Archiving is a retention decision, not a version change (see
  // isSourceCurrent). A material the tool read and that was archived before the
  // summary was written is STILL what the summary used; dropping it would lose
  // the dependency, and a later correction of the knowledge it supported could
  // not find this summary.
  const db = "s9.db";
  const store = openStore(db);
  await store.createSession("acme");
  const sid = "session-s9";
  await store.ensureSession(sid, "acme");
  const material = await seedEpisode(store, sid, "https://acme.example/s9", "s9", OLD_FACT, "acme");
  const url = q(db, "SELECT url FROM retrieval_results WHERE id = ?", material)!.url as string;

  // Archive it through the product path (explicit ids, apply).
  store.applyArchive([material]);
  assert(q(db, "SELECT archived FROM retrieval_results WHERE id = ?", material)!.archived === 1,
    "S9 fixture: the material is archived");
  assert(q(db, "SELECT superseded_by FROM retrieval_results WHERE id = ?", material)!.superseded_by === null,
    "S9 fixture: archived is NOT the same as superseded");

  const resolved = store.resolveSummarySources([url]);
  const ids = resolved.filter((r: SummarySourceRef) => r.kind === "material").map((r: SummarySourceRef) => r.id);
  assert(ids.includes(material),
    "S9: an archived material is still resolved as a dependency (got " + JSON.stringify(ids) + ")");

  // And it does NOT suspend the summary: archived-but-current is still current.
  await store.saveAnchor(sid, "rolling_summary", { summary: "S9-LIVE", sources: resolved });
  const anchorId = (await store.getAnchors(sid)).filter((a) => a.anchorType === "rolling_summary").pop()!.id;
  assert(!store.suspendedSummaryAnchorIds(sid).has(anchorId),
    "S9: reading an archived material does not suspend the summary (archiving is not a correction)");
}

// --- S11: one URL, two versions — the read decides which one --------------

{
  // The window this closes (CodeRabbit, round 14): a URL can hold an OLD
  // superseded row A and a live row B. Recording both would mean `isSourceCurrent`
  // sees A, reports it stale, and suspends a summary whose every fact came from
  // B. Excluding the old row is not the fix either: it is exactly what S8 needs
  // when the citation really is to the replaced version.
  //
  // So the read carries the row id and the id decides. S11a: the exact-read
  // form. S11b: the URL form, which must prefer the live row.
  const db = "s11.db";
  const store = openStore(db);
  await store.createSession("acme");
  const sid = "session-s11";
  await store.ensureSession(sid, "acme");

  // Row A: the version a correction later retired.
  const oldMaterial = await seedEpisode(store, sid, "https://acme.example/s11", "s11-v1", OLD_FACT, "acme");
  const url = q(db, "SELECT url FROM retrieval_results WHERE id = ?", oldMaterial)!.url as string;
  // Row B: the same URL written again (a re-fetch / the corrected version).
  const newMaterial = await seedEpisode(store, sid, url, "s11-v2", NEW_FACT, "acme");
  // The temporal replacement closes A's valid_until at write time.
  assert(q(db, "SELECT valid_until FROM retrieval_results WHERE id = ?", oldMaterial)!.valid_until !== null,
    "S11 fixture: writing B closed A's valid_until");
  assert(q(db, "SELECT valid_until FROM retrieval_results WHERE id = ?", newMaterial)!.valid_until === null,
    "S11 fixture: B is the live row for that URL");

  // S11a: the exact read form resolves to the row that was read, only.
  const exact = store.resolveSummarySourcesFromReads([{ url, rowId: newMaterial }]);
  const exactIds = exact.filter((r: SummarySourceRef) => r.kind === "material").map((r: SummarySourceRef) => r.id);
  assert(exactIds.length === 1 && exactIds[0] === newMaterial,
    "S11a: a read with its row id resolves to THAT row only (got " + JSON.stringify(exactIds) + ")");

  // ...and the summary written from it is NOT suspended: its one dependency is
  // live.
  await store.saveAnchor(sid, "rolling_summary", { summary: "S11-FROM-B", sources: exact });
  const anchorId = (await store.getAnchors(sid)).filter((a) => a.anchorType === "rolling_summary").pop()!.id;
  assert(!store.suspendedSummaryAnchorIds(sid).has(anchorId),
    "S11a: a summary built from the LIVE row is not suspended by its URL's retired predecessor");

  // S11b: the URL form (no row id) prefers the live row for the same URL.
  const viaUrl = store.resolveSummarySources([url]);
  const urlIds = viaUrl.filter((r: SummarySourceRef) => r.kind === "material").map((r: SummarySourceRef) => r.id);
  assert(urlIds.includes(newMaterial) && !urlIds.includes(oldMaterial),
    "S11b: an unattributed URL resolves to its LIVE row, not its retired predecessor (got " + JSON.stringify(urlIds) + ")");

  // S11d: the exact form is the row that was READ even when another row of the
  // same URL is live. This is the case that separates "used the id" from "looked
  // the URL up anyway": a citation of A must resolve to A, not to the live B.
  const citedOld = store.resolveSummarySourcesFromReads([{ url, rowId: oldMaterial }]);
  const citedOldIds = citedOld.filter((r: SummarySourceRef) => r.kind === "material").map((r: SummarySourceRef) => r.id);
  assert(citedOldIds.length === 1 && citedOldIds[0] === oldMaterial,
    "S11d: a citation of the older row resolves to THAT row, not the live one (got " + JSON.stringify(citedOldIds) + ")");

  // S11e: a read with a usable row id but an EMPTY URL still resolves.
  //
  // `saveResults` archives a result whose URL sanitized to "", so such a row is
  // real. The resolver must take the id before the URL check, or the dependency
  // vanishes and the summary is stored as valid — a later correction then has
  // nothing to find.
  const noUrlId = (store as any).db
    .prepare("INSERT INTO retrieval_results (session_id, url, title, snippet, source, entity) VALUES (?, '', ?, ?, 'tavily', 'no-url')")
    .run(sid, "no-url row", "a material archived without a URL");
  const insertedId = Number(noUrlId.lastInsertRowid);
  const emptyUrl = store.resolveSummarySourcesFromReads([{ url: "", rowId: insertedId }]);
  const emptyUrlIds = emptyUrl.filter((r: SummarySourceRef) => r.kind === "material").map((r: SummarySourceRef) => r.id);
  assert(emptyUrlIds.length === 1 && emptyUrlIds[0] === insertedId,
    "S11e: an id-only read resolves even with an empty URL (got " + JSON.stringify(emptyUrlIds) + ")");
  // The summary written from it is valid (the row is current), and a later
  // correction CAN find it — the dependency exists at all, which is the point.
  await store.saveAnchor(sid, "rolling_summary", { summary: "S11-NO-URL", sources: emptyUrl });
  assert(q(db, "SELECT COUNT(*) AS n FROM summary_sources WHERE source_kind = 'material' AND source_id = ?", insertedId)!.n === 1,
    "S11e: the id-only read was recorded as a dependency");

  // S11c: the exact read form keeps a citation to a row that was retired BEFORE
  // the write (the S8 window). Currency is the write-time check's job, not the
  // resolver's: dropping it here would leave the summary with no dependency and
  // store it as VALID. Proven over the REAL correction path on its own entity,
  // so the retirement is the product's, not SQL tampering.
  const built = await buildKnowledge(store, sid, "gamma-s11", OLD_FACT, "https://gamma.example/s11");
  const retiredTarget = built.materialIds[0]!;
  const retiredUrl = q(db, "SELECT url FROM retrieval_results WHERE id = ?", retiredTarget)!.url as string;
  const correctionMaterial = await seedEpisode(store, sid, "https://gamma.example/s11-notice", "notice", NEW_FACT, "gamma-s11");
  const rep = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [correctionMaterial], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: async (eps: ConsolidateEvidence[]) =>
        eps.some((e) => e.title === "CURRENT KNOWLEDGE") ? MERGED_FACT : NEW_FACT,
      classify: SUPPORTED,
      verify: async () => CORRECTION_VERDICT,
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
    },
  );
  assert(rep.update === 1,
    "S11c fixture: the correction landed as an UPDATE (update=" + rep.update + " add=" + rep.add +
    " rejected=" + rep.verifyRejected + " skipped=" + rep.singleEvidenceSkipped + ")");
  assert(q(db, "SELECT superseded_by FROM retrieval_results WHERE id = ?", retiredTarget)!.superseded_by !== null,
    "S11c fixture: the correction retired the material");
  const afterCorrection = store.resolveSummarySourcesFromReads([{ url: retiredUrl, rowId: retiredTarget }]);
  const afterIds = afterCorrection.filter((r: SummarySourceRef) => r.kind === "material").map((r: SummarySourceRef) => r.id);
  assert(afterIds.includes(retiredTarget),
    "S11c: a citation to a material retired BEFORE the write is still resolved (got " + JSON.stringify(afterIds) + ")");
  await store.saveAnchor(sid, "rolling_summary", { summary: "S11-STALE-CITATION", sources: afterCorrection });
  const lateAnchorId = (await store.getAnchors(sid)).filter((a) => a.anchorType === "rolling_summary").pop()!.id;
  assert(store.suspendedSummaryAnchorIds(sid).has(lateAnchorId),
    "S11c: the summary citing the retired row is written SUSPENDED, not as current");
}

// --- S10: the URL lookup uses an index -------------------------------------

{
  // resolveSummarySourcesFromUrls looks a material up BY URL. Without an index
  // that is a full scan of the archive on every compression, and the cost grows
  // with the table. The assertion is the query PLAN, which is what actually
  // proves the index is used; an index that the planner ignores would be dead
  // schema weight.
  const db = "s10.db";
  const store = openStore(db);
  await store.createSession("acme");
  const raw = (store as any).db as Database.Database;
  const plan = raw
    .prepare("EXPLAIN QUERY PLAN SELECT id FROM retrieval_results WHERE url = ? ORDER BY id")
    .all("https://s10.example/1") as Array<{ detail: string }>;
  const usesIndex = plan.some((p) => String(p.detail).includes("idx_retrieval_results_url"));
  assert(usesIndex,
    "S10: the URL lookup uses idx_retrieval_results_url (plan=" + JSON.stringify(plan.map((p) => p.detail)) + ")");
  const cur = stores.indexOf(store);
  if (cur >= 0) stores.splice(cur, 1);
  store.close();
}

// --- helper contracts -----------------------------------------------------

{
  // Malformed refs never become index-0 lookups.
  const parsed = parseSummarySourceRefs([
    { kind: "material", id: 7 },
    { kind: "material", id: 0 },
    { kind: "material", id: -3 },
    { kind: "material", id: 1.5 },
    { kind: "material", id: "9" },
    { kind: "wrong", id: 4 },
    null,
    { kind: "knowledge", id: 2 },
    { kind: "knowledge", id: 2 },
  ]);
  assert(parsed.length === 2, "refs: only well-formed, unique refs survive (got " + parsed.length + ")");
  assert(parsed.map((r) => r.kind + r.id).join(",") === "material7,knowledge2",
    "refs: the survivors are material 7 and knowledge 2");
  assert(parseSummarySourceRefs(undefined).length === 0,
    "refs: an absent source list is empty, not an error");
}

// --- URL -> id bridge -----------------------------------------------------

{
  const db = "bridge.db";
  const store = openStore(db);
  await store.createSession("acme");
  const sid = "session-bridge";
  await store.ensureSession(sid, "acme");
  const m1 = await seedEpisode(store, sid, "https://acme.example/b1", "b1", OLD_FACT, "acme");
  const m2 = await seedEpisode(store, sid, "https://beta.example/b2", "b2", UNRELATED, "beta");
  const resolved = store.resolveSummarySources(["https://acme.example/b1", "https://beta.example/b2", "https://nowhere.example/x", ""]);
  const kinds = resolved.map((r: SummarySourceRef) => r.kind + ":" + r.id);
  assert(kinds.includes("material:" + m1) && kinds.includes("material:" + m2),
    "bridge: URLs resolve to the exact archive rows they name");
  assert(resolved.length === 2,
    "bridge: an URL with no archive row contributes nothing (got " + resolved.length + ")");
  // A knowledge citation resolves to a knowledge ref, and only when current.
  const built = await buildKnowledge(store, sid, "gamma", UNRELATED, "https://gamma.example/k");
  const viaKnowledge = store.resolveSummarySources(["knowledge://semantic/" + built.knowledgeId]);
  assert(viaKnowledge.length === 1 && viaKnowledge[0]!.kind === "knowledge" && viaKnowledge[0]!.id === built.knowledgeId,
    "bridge: a knowledge:// citation resolves to the knowledge row");
  // A missing knowledge row contributes nothing; an EXISTING but CLOSED one is
  // still recorded (see the S7 section) because currency is decided at write
  // time, where the summary gets suspended instead of stored as valid.
  const stale = withDb(db, (d) => resolveSummarySourcesFromUrls(d, ["knowledge://semantic/99999"]));
  assert(stale.length === 0, "bridge: a citation to a missing knowledge row contributes nothing");
}

// --- S7: a citation closed BEFORE the write still suspends the summary ------

{
  // The window this closes: a tool result cites knowledge://semantic/<id>, that
  // row is corrected, and only then is the summary written. If the resolver
  // dropped the citation for being closed, the anchor would carry no dependency
  // at all, saveSummaryAnchor would find nothing to check, and the summary
  // would be stored VALID — still stating the replaced fact.
  const db = "s7.db";
  const store = openStore(db);
  await store.createSession("acme");
  const sid = "session-s7";
  await store.ensureSession(sid, "acme");

  const built = await buildKnowledge(store, sid, "acme", OLD_FACT, "https://acme.example/s7");
  const citation = "knowledge://semantic/" + built.knowledgeId;

  // The correction lands BEFORE the summary is written.
  const correctionMaterial = await seedEpisode(store, sid, "https://acme.example/s7-notice", "notice", NEW_FACT, "acme");
  const rep = await store.consolidateMemory(
    { scope: { by: "memory", sessionIds: [], memoryIds: [correctionMaterial], sessionIdNotApplied: false }, allowSingleEvidence: true },
    {
      summarize: async (eps: ConsolidateEvidence[]) =>
        eps.some((e) => e.title === "CURRENT KNOWLEDGE") ? MERGED_FACT : NEW_FACT,
      classify: SUPPORTED,
      verify: async () => CORRECTION_VERDICT,
      verifyFinal: async () => ({ supported: true, preserved: true, corrected: true, noExtras: true }),
    },
  );
  assert(rep.update === 1, "S7 fixture: the correction landed");
  // Through the product path: resolve the citation, THEN write the summary.
  const resolved = store.resolveSummarySources([citation]);
  assert(resolved.length === 1 && resolved[0]!.id === built.knowledgeId,
    "S7: a citation to an ALREADY-CLOSED knowledge row is still resolved, so the write can check it");

  await store.saveAnchor(sid, "rolling_summary", {
    summary: "S7-STALE: written after the fact was replaced",
    sources: resolved,
  });
  const anchorId = (await store.getAnchors(sid)).filter((a) => a.anchorType === "rolling_summary").pop()!.id;
  assert(store.suspendedSummaryAnchorIds(sid).has(anchorId),
    "S7: the summary is written SUSPENDED, not stored as a valid current conclusion");
  const text = (await store.getAnchors(sid)).find((a) => a.id === anchorId)!.payload as any;
  assert(String(text.summary).includes("S7-STALE"), "S7: its text is still recorded");

  // And the ordinary write path still stores a CURRENT citation as valid.
  await store.saveAnchor(sid, "l2_recall", {
    hits: "S7-FRESH",
    sources: store.resolveSummarySources([citation]),
  });
  // The l2_recall is built from a closed row too, so it is suspended as well;
  // that is the same rule, applied without special-casing the anchor type.
  const recallId = (await store.getAnchors(sid)).filter((a) => a.anchorType === "l2_recall").pop()!.id;
  assert(store.suspendedSummaryAnchorIds(sid).has(recallId),
    "S7: the same version check applies to l2_recall");

  const cur = stores.indexOf(store);
  if (cur >= 0) stores.splice(cur, 1);
  store.close();
}

// --- reverse lookup -------------------------------------------------------

{
  const db = "lookup.db";
  const store = openStore(db);
  await store.createSession("acme");
  const a = "session-lookup-a";
  const b = "session-lookup-b";
  await store.ensureSession(a, "acme");
  await store.ensureSession(b, "acme");
  const shared = await seedEpisode(store, a, "https://shared.example/one", "one", OLD_FACT, "acme");
  await store.saveAnchor(a, "rolling_summary", { summary: "s-a", sources: [{ kind: "material", id: shared }] });
  await store.saveAnchor(b, "rolling_summary", { summary: "s-b", sources: [{ kind: "material", id: shared }] });
  const dependents = withDb(db, (d) => findSummariesDependingOn(d, [{ kind: "material", id: shared }]));
  assert(dependents.length === 2, "lookup: both sessions' summaries that read the same material are found (got " + dependents.length + ")");
  assert(new Set(dependents.map((d) => d.sessionId)).size === 2,
    "lookup: the dependents span two different sessions");
  assert(withDb(db, (d) => findSummariesDependingOn(d, [])).length === 0,
    "lookup: no refs -> no dependents (a correction never suspends the whole archive)");
  // Untrack only this section's handle, then close it.
  const idx = stores.indexOf(store);
  if (idx >= 0) stores.splice(idx, 1);
  store.close();
}

closeAll();
// Windows can keep a WAL/SHM file locked for a moment after the last handle
// closes, so a plain rmSync can fail with EPERM. Retry instead of masking the
// failure: a directory that truly cannot be removed still reports.
try {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
} catch (e) {
  console.error("cleanup warning (temp dir left in place): " + (e instanceof Error ? e.message : String(e)));
}


console.log("summary-sources: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exitCode = 1;
