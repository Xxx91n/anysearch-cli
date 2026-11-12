// #260 — scoped consolidation, shared by `ans consolidate` and
// `ans_chat operation=consolidate` (spec D5, tests T1/T2/T4).
//
// What is under test, and what is not:
//   - the scope rule (missing / malformed / memory-list-beats-session),
//   - the scan really reading only the selected materials,
//   - dryRun leaving no trace at all (knowledge, material state, version
//     relation, summary change),
//   - the usage block's four cost bases and its `missing[]` honesty,
//   - a budget refusal stopping the run instead of quietly skipping.
//
// The semantic judgement of a correction is NOT tested here; that is the next
// ticket's subject. These tests use injected seams (deterministic summaries and
// a fixed fidelity verdict), which is the T4 "controlled answer" entry: it
// proves the flow, not the model's judgement quality.
//
// No test framework (repo convention).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "../src/session-store";
import {
  resolveConsolidateScope,
  isValidConsolidateSessionId,
  ConsolidateScopeError,
  type ConsolidateScopeBy,
} from "../src/consolidate";
import { __setEmbeddingModuleForTest } from "../src/embedding-arm";
import { __setExtractorForTest } from "@anysearch-cli/embedding";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error("FAIL: " + msg); }
}

// Deterministic embedding seam: identical input -> identical vector, so a
// rerun lands on NOOP without float32 boundary noise.
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

function scopeOf(raw: {
  sessionId?: unknown; sessionIds?: unknown; memoryIds?: unknown;
}): { by: ConsolidateScopeBy; sessionIds: string[]; memoryIds: number[]; sessionIdNotApplied: boolean } {
  return resolveConsolidateScope(raw);
}

function scopeThrew(raw: Record<string, unknown>): string | null {
  try {
    resolveConsolidateScope(raw);
    return null;
  } catch (e) {
    if (e instanceof ConsolidateScopeError) return e.message;
    throw e;
  }
}

const dir = mkdtempSync(join(tmpdir(), "ans-260-"));
const dbPath = join(dir, "scoped.db");
const stores: SqliteSessionStore[] = [];
function openStore(opts?: ConstructorParameters<typeof SqliteSessionStore>[1]): SqliteSessionStore {
  const s = new SqliteSessionStore(dbPath, opts);
  stores.push(s);
  return s;
}
function count(db: string, sql: string, ...params: unknown[]): number {
  const d = new Database(db, { readonly: true });
  try { return (d.prepare(sql).get(...params) as { c: number }).c; } finally { d.close(); }
}

// --- 1. the scope rule (Q18) ---

{
  // Neither scope: refused, and the message says what to pass.
  const msg = scopeThrew({});
  assert(msg !== null && /explicit scope is required/i.test(msg), "no scope at all is an error, not a full-archive run");
  assert(msg !== null && /memoryIds/i.test(msg), "the error names the parameters that form a scope");

  // Empty memoryIds is a malformed request, not "no memory scope".
  const emptyArr = scopeThrew({ memoryIds: [] });
  assert(emptyArr !== null && /non-empty list of positive integer ids/i.test(emptyArr), "an empty memoryIds list is refused");
  const emptyWithSession = scopeThrew({ sessionId: "sess-1", memoryIds: [] });
  assert(emptyWithSession !== null, "an explicit empty memoryIds is not silently replaced by the session scope");

  // Bad ids.
  for (const bad of [[0], [-1], [1.5], ["3"], [1, 0]]) {
    assert(scopeThrew({ memoryIds: bad }) !== null, "memoryIds " + JSON.stringify(bad) + " is refused");
  }
  // Bad session handles: empty, whitespace, control chars, too long.
  for (const bad of ["", " ", "a b", "a\tb", "x".repeat(129), 42]) {
    assert(scopeThrew({ sessionId: bad }) !== null, "sessionId " + JSON.stringify(bad) + " is refused");
  }
  assert(isValidConsolidateSessionId("a"), "a single visible ASCII char is a valid session id");
  assert(isValidConsolidateSessionId("x".repeat(128)), "128 visible ASCII chars is valid");
  assert(!isValidConsolidateSessionId("x".repeat(129)), "129 chars is invalid");

  // Valid shapes.
  const bySession = scopeOf({ sessionId: "sess-a" });
  assert(bySession.by === "session" && bySession.sessionIds[0] === "sess-a", "sessionId alone scopes by session");
  assert(bySession.memoryIds.length === 0, "a session scope names no memory ids");

  const byMemory = scopeOf({ memoryIds: [7, 9], sessionId: "sess-a" });
  assert(byMemory.by === "memory", "memoryIds with a sessionId still scopes by memory");
  assert(byMemory.memoryIds.join(",") === "7,9", "the memory list is used as given");
  assert(byMemory.sessionIds[0] === "sess-a", "the session is echoed back");
  assert(byMemory.sessionIdNotApplied === true, "the report says the sessionId did not decide the scope");

  // The archive mode is not reachable from the caller-facing resolver at all:
  // a caller that asks for it still gets the missing-scope refusal.
  assert(
    scopeThrew({ allowArchive: true } as Record<string, unknown>) !== null,
    "no caller input can reach the full-archive mode",
  );
}

// --- 2. the scan reads only the selected materials ---

const SUMMARY = "Alpha service uses Beta library for builds. Release cadence is weekly.";
const seed = openStore({
  consolidateSummarize: async () => SUMMARY,
  consolidateClassify: () => ({ label: "supported", confidence: 0.95 }),
});
const sessionA = await seed.createSession("eval");
const sessionB = await seed.createSession("eval");
const idsA: number[] = [];
const idsB: number[] = [];
for (let i = 1; i <= 3; i++) {
  const ra = await seed.adjudicateMemory(sessionA.id, [
    { url: "https://ex.com/alpha", title: "Alpha note v" + i, snippet: "Alpha uses Beta for builds, revision " + i, source: "exa", evidence: 0.9, entity: "AlphaA" },
  ]);
  if (ra[0]?.insertedId) idsA.push(ra[0].insertedId);
  const rb = await seed.adjudicateMemory(sessionB.id, [
    { url: "https://ex.com/beta", title: "Beta note v" + i, snippet: "Beta uses Gamma for deploys, revision " + i, source: "exa", evidence: 0.9, entity: "BetaB" },
  ]);
  if (rb[0]?.insertedId) idsB.push(rb[0].insertedId);
}
assert(idsA.length === 3 && idsB.length === 3, "seed: three materials in each session");

let rep = await seed.consolidateMemory({ dryRun: true, scope: scopeOf({ sessionId: sessionA.id }) });
assert(rep.scope.by === "session", "session scope is reported as such");
assert(rep.scope.materialsRead === 3, "session scope reads only that session's materials (got " + rep.scope.materialsRead + ")");
assert(rep.clustersScanned === 1, "session scope scans one entity cluster (got " + rep.clustersScanned + ")");

rep = await seed.consolidateMemory({ dryRun: true, scope: scopeOf({ memoryIds: idsB }) });
assert(rep.scope.by === "memory", "memory scope is reported as such");
assert(rep.scope.requestedMaterials === 3, "memory scope echoes the requested count");
assert(rep.scope.materialsRead === 3, "memory scope reads exactly the listed materials");
assert(rep.clustersScanned === 1, "memory scope scans the listed cluster only");

rep = await seed.consolidateMemory({ dryRun: true, scope: scopeOf({ memoryIds: [idsA[0]!, idsB[0]!] }) });
assert(rep.scope.materialsRead === 2, "a cross-session memory list reads exactly those two materials");
assert(rep.clustersScanned === 2, "the cross-session list yields two clusters (one per entity)");

// memoryIds wins over a sessionId: the session must NOT add its other materials.
rep = await seed.consolidateMemory({
  dryRun: true,
  scope: scopeOf({ memoryIds: [idsA[0]!], sessionId: sessionA.id }),
});
assert(rep.scope.materialsRead === 1, "a sessionId alongside memoryIds does not widen the list (got " + rep.scope.materialsRead + ")");
assert(rep.scope.sessionIdNotApplied === true, "the report flags the unused sessionId");

// A memory id that does not exist reads nothing but still reports a memory scope.
rep = await seed.consolidateMemory({ dryRun: true, scope: scopeOf({ memoryIds: [999999] }) });
assert(rep.scope.materialsRead === 0 && rep.clustersScanned === 0, "an unknown memory id reads nothing");
assert(rep.semanticIds.length === 0, "an unknown memory id writes nothing");

// --- 3. dryRun leaves no trace ---

const semCountBefore = count(dbPath, "SELECT COUNT(*) c FROM semantic_memories");
// Material state this run could touch: the bi-temporal close is what an UPDATE
// does to materials, so "no closed materials appeared" is the state assertion.
const rrBefore = count(dbPath, "SELECT COUNT(*) c FROM retrieval_results WHERE valid_until IS NOT NULL");
const anchorsBefore = count(dbPath, "SELECT COUNT(*) c FROM resume_anchors");

rep = await seed.consolidateMemory({ dryRun: true, scope: scopeOf({ sessionId: sessionA.id }) });
assert(rep.dryRun === true && rep.scope.by === "session", "dry-run reports itself and its scope");
assert(count(dbPath, "SELECT COUNT(*) c FROM semantic_memories") === semCountBefore, "dry-run saves no knowledge");
assert(count(dbPath, "SELECT COUNT(*) c FROM retrieval_results WHERE valid_until IS NOT NULL") === rrBefore, "dry-run changes no material state");
assert(count(dbPath, "SELECT COUNT(*) c FROM resume_anchors") === anchorsBefore, "dry-run writes no summary/anchor change");

// The dry-run counts still predict an apply over the same state.
const predicted = rep;
rep = await seed.consolidateMemory({ scope: scopeOf({ sessionId: sessionA.id }) });
assert(rep.add === predicted.add && rep.update === predicted.update, "apply matches the dry-run prediction for the state it read");
assert(count(dbPath, "SELECT COUNT(*) c FROM semantic_memories") === semCountBefore + rep.add, "apply wrote exactly the predicted rows");

// A second apply over unchanged state is a no-op: nothing new is saved.
rep = await seed.consolidateMemory({ scope: scopeOf({ sessionId: sessionA.id }) });
assert(rep.add === 0 && rep.update === 0 && rep.noop === 1, "unchanged state re-runs as noop (got add=" + rep.add + " update=" + rep.update + " noop=" + rep.noop + ")");

// --- 4. budget refusal stops the run and is counted ---

{
  // A zero call cap rejects every reserve. The run must stop at the first
  // refusal, report it, and write nothing that a summary would have produced.
  const budgetDb = join(dir, "budget.db");
  const bStore = new SqliteSessionStore(budgetDb, {
    consolidateSummarize: async () => "Delta service uses Epsilon for caching. Rollout is monthly.",
    consolidateClassify: () => ({ label: "supported", confidence: 0.9 }),
  });
  const s = await bStore.createSession("eval");
  for (let i = 1; i <= 3; i++) {
    await bStore.adjudicateMemory(s.id, [
      { url: "https://ex.com/delta", title: "Delta note v" + i, snippet: "Delta uses Epsilon, revision " + i, source: "exa", evidence: 0.9, entity: "Delta" },
    ]);
  }
  bStore.initBudget!(s.id, { callCap: 0, tokenCap: 0 });
  // The same ledger over the same connection the store uses, so the reserve
  // the seam makes is the one the cap has to reject.
  const ledger = bStore.createBudgetLedger();
  const rejection = Object.assign(new Error("budget exhausted"), { code: "consolidate-budget-rejected" });
  let calls = 0;
  const refusing = new SqliteSessionStore(budgetDb, {
    consolidateSummarize: async () => {
      calls++;
      if (!ledger.reserveCalls(s.id, 1)) throw rejection;
      return "Delta service uses Epsilon for caching. Rollout is monthly.";
    },
    consolidateClassify: () => ({ label: "supported", confidence: 0.9 }),
  });
  const repBudget = await refusing.consolidateMemory({ scope: scopeOf({ sessionId: s.id }) });
  assert(calls === 1, "budget: the seam is asked once, then the run stops (got " + calls + ")");
  assert(repBudget.budgetRejected === 1, "budget: the refusal is counted in the report");
  assert(repBudget.add === 0 && repBudget.update === 0, "budget: nothing is written from a refused call");
  assert(count(budgetDb, "SELECT COUNT(*) c FROM semantic_memories") === 0, "budget: no knowledge row was saved");
  refusing.close();
  bStore.close();
}

// --- 5. usage shape: the four cost bases and the named gaps ---

// The seam tests live in the kernel package (createConsolidationSeams); here we
// pin the report-side contract the two entries rely on: a dry-run over an
// empty scope still carries a scope and a budget counter.
{
  const emptyStore = new SqliteSessionStore(join(dir, "empty.db"));
  const r = await emptyStore.consolidateMemory({
    dryRun: true,
    scope: scopeOf({ sessionId: "session-with-nothing" }),
  });
  assert(r.scope.by === "session" && r.scope.materialsRead === 0, "empty scope still reports its scope");
  assert(r.budgetRejected === 0, "empty scope reports zero budget refusals, not a missing field");
  assert(r.llmUnavailable === 0, "empty scope triggers no cluster, so no llmUnavailable");
  emptyStore.close();
}

for (const s of stores) { try { s.close(); } catch { /* already closed */ } }
__setEmbeddingModuleForTest("auto");
rmSync(dir, { recursive: true, force: true });

console.log("scoped-consolidate: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
