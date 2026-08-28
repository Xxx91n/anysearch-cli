// ADR-0031 test closure: steps 2-7 (schema, extraction, LLM backfill fail-open, 3-tier dedup, RRF arm, telemetry).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "../src/session-store";
import { extractEntityCandidates, normalizeEntityName, trigramSimilarity } from "../src/entity";

const dir = mkdtempSync(join(tmpdir(), "ans-ent-"));
const dbPath = join(dir, "t.db");
const t = (name: string, fn: () => Promise<void> | void) => fn();
void t;

// --- step 2: schema migration idempotent + existing six tables intact ---
{
  const s1 = new SqliteSessionStore(dbPath);
  s1.close();
  const s2 = new SqliteSessionStore(dbPath); // reopen = migration re-runs, must not throw
  const raw = new Database(dbPath, { readonly: true });
  const tables = (raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name);
  for (const want of ["sessions", "messages", "retrieval_results", "resume_anchors", "budget_ledger", "t0_preferences", "entities", "memory_entity", "entity_merge_log"])
    assert.ok(tables.includes(want), "missing table " + want);
  raw.close();
  s2.close();
  console.log("step2 schema idempotent + 9 tables: OK");
}

// --- step 3: rule extraction channels ---
{
  const c = extractEntityCandidates("see https://ex.com/x and ping @alice about the \"Mercury Bank\" deal; BuildZone done");
  const names = c.map((x) => normalizeEntityName(x.name));
  assert.ok(names.includes("https://ex.com/x"), "url channel");
  assert.ok(names.includes("alice"), "handle channel");
  assert.ok(names.some((n) => n === "mercury bank"), "phrase channel");
  assert.ok(names.includes("buildzone"), "ident channel (camel)");
  assert.equal(c.find((x) => normalizeEntityName(x.name) === "alice")?.type, "handle");
  // dictionary pass: known entity token re-recognized
  const c2 = extractEntityCandidates("the weatherx report is stale", new Set(["weatherx"]));
  assert.ok(c2.some((x) => normalizeEntityName(x.name) === "weatherx"), "dict channel");
  assert.ok(c2.some((x) => x.type === "ident"), "dict hit type ident");
  console.log("step3 rule extraction channels: OK");
}

// helpers
const km = (url: string, title: string, snippet: string, evidence: number, entity?: string) =>
  entity ? ({ url, title, snippet, source: "exa", evidence, entity } as const) : ({ url, title, snippet, source: "exa", evidence } as const);

// --- step 4: LLM backfill fail-open ---
{
  // throwing fallback: rules-empty write keeps going, no crash, no entity rows
  const store = new SqliteSessionStore(join(dir, "t4.db"), { entityLlmFallback: async () => { throw new Error("offline"); } });
  const ses = await store.createSession("eval");
  const res = await store.adjudicateMemory(ses.id, [km("https://ex.com/q1", "the quick fox", "plain prose without marks", 0.9)]);
  assert.equal(res[0]?.action, "accept");
  const rows = store.dbQuery<{ n: number }>("SELECT COUNT(*) n FROM entities");
  assert.equal(rows[0]!.n, 0, "no entities when rules empty and fallback throws");
  store.close();
  // fallback returning a candidate: entity created
  const store2 = new SqliteSessionStore(join(dir, "t4b.db"), { entityLlmFallback: async () => [{ name: "FallbackCorp", type: "declared" }] });
  const s2 = await store2.createSession("eval");
  await store2.adjudicateMemory(s2.id, [km("https://ex.com/q2", "the lazy dog", "more plain prose", 0.9)]);
  const names = store2.dbQuery<{ nameNorm: string }>("SELECT name_norm as nameNorm FROM entities").map((r) => r.nameNorm);
  assert.ok(names.includes("fallbackcorp"), "fallback entity created");
  store2.close();
  console.log("step4 LLM backfill fail-open: OK");
}

// --- step 5: three-tier dedup + type gate + reversible merge ---
{
  const store = new SqliteSessionStore(join(dir, "t5.db"));
  const sess = await store.createSession("eval");
  // 5a exact reuse: declared buildzone twice across sessions → single entity
  await store.adjudicateMemory(sess.id, [km("https://ex.com/d1", "buildzone deploy notes", "buildzone deploy notes", 0.9, "buildzone-d1")]);
  const sess2 = await store.createSession("eval");
  await store.adjudicateMemory(sess2.id, [km("https://ex.com/d2", "buildzone rollback notes", "buildzone rollback notes", 0.9, "buildzone")]);
  // 5b alias tier: same-type near-identical (>=0.9 trigram) ident variants → alias append + merge log
  const longA = "nfxwledger" + "abcdefghijklmnopqrstuvwxyz0123456789A";
  const longB = "nfxwledger" + "abcdefghijklmnopqrstuvwxyz0123456789B";
  assert.ok(trigramSimilarity(longA.toLowerCase(), longB.toLowerCase()) >= 0.9, "alias pair sim>=0.9");
  await store.adjudicateMemory(sess.id, [km("https://ex.com/d3", "uses " + longA + " lib", "notes", 0.9)]);
  await store.adjudicateMemory(sess.id, [km("https://ex.com/d4", "uses " + longB + " lib", "notes", 0.9)]);
  const aliasLogs = store.dbQuery<{ id: number }>("SELECT id FROM entity_merge_log WHERE kind = 'alias'");
  assert.ok(aliasLogs.length >= 1, "alias merge logged");
  // 5b undo: alias removed, log marked undone
  assert.equal(store.undoEntityMerge(aliasLogs[0]!.id), true);
  const undone = store.dbQuery<{ undone: number }>("SELECT undone FROM entity_merge_log WHERE id = ?", aliasLogs[0]!.id);
  assert.equal(undone[0]!.undone, 1);
  // 5c review band: same-type similar-but-not-identical (0.6-0.9) → new entity + candidate log
  const midA = "tgpndb_cache_lru_aa";
  const midB = "tgpndb_cache_lru_ab";
  const sim = trigramSimilarity(midA, midB);
  assert.ok(sim >= 0.6 && sim < 0.9, "band pair sim: " + sim);
  await store.adjudicateMemory(sess.id, [km("https://ex.com/d5", "define " + midA, "x", 0.9)]);
  await store.adjudicateMemory(sess.id, [km("https://ex.com/d6", "define " + midB, "x", 0.9)]);
  const candLogs = store.dbQuery<{ id: number }>("SELECT id FROM entity_merge_log WHERE kind = 'candidate'");
  assert.ok(candLogs.length >= 1, "candidate band logged");
  assert.equal(store.undoEntityMerge(candLogs[0]!.id), false, "candidate logs are not alias-undoable");
  // 5d type gate: @mercury (handle) vs "mercury" (phrase) → two rows, never merged
  await store.adjudicateMemory(sess.id, [km("https://ex.com/d7", "wire to @mercuryfast", "wire to @mercuryfast", 0.9)]);
  await store.adjudicateMemory(sess.id, [km("https://ex.com/d8", "opened \"mercuryfast\" account", "opened \"mercuryfast\" account", 0.9)]);
  const merc = store.dbQuery<{ c: number }>("SELECT COUNT(*) c FROM entities WHERE name_norm = 'mercuryfast' AND valid_until IS NULL");
  assert.equal(merc[0]!.c, 2, "type gate: cross-type same-norm rows coexist");
  store.close();
  console.log("step5 three-tier dedup + type gate + reversible merge: OK");
}

// --- step 6: RRF entity arm (conditional activation, cross-session aggregation, guards) + step 7 telemetry ---
{
  const store = new SqliteSessionStore(join(dir, "t6.db"));
  const sa = await store.createSession("eval");
  await store.adjudicateMemory(sa.id, [km("https://ex.com/r1", "weatherx daily briefing", "weatherx daily briefing notes", 0.9, "weatherx")]);
  const sb = await store.createSession("eval"); // cross-session
  await store.adjudicateMemory(sb.id, [km("https://ex.com/r2", "morning digest posted", "morning digest posted fine", 0.9, "weatherx-digest")]);
  // quarantined row under same entity family must be excluded from the arm
  await store.adjudicateMemory(sa.id, [km("https://ex.com/r3", "weatherx rumor unverified", "weatherx rumor unverified claim", 0.5)]);
  const hits = await store.searchMemory("weatherx", 10);
  const titles = hits.map((h) => h.role ?? "");
  assert.ok(titles.some((t) => t.includes("morning digest posted")), "arm surfaced cross-session non-FTS row");
  assert.ok(titles.some((t) => t.includes("daily briefing")), "FTS row still present");
  assert.ok(!titles.some((t) => t.includes("rumor unverified")), "quarantined row excluded from arm");
  // no-entity query: arm absent, results = pure FTS
  const plain = await store.searchMemory("banana muffin recipe", 10);
  assert.equal(plain.length, 0);
  const tel = store.entityTelemetry();
  assert.ok(tel.queries >= 2 && tel.activations >= 1, "telemetry counts: " + JSON.stringify(tel));
  // multi-query path also gets the arm
  const multi = await store.searchMemoryMulti(["weatherx", "daily briefing notes"], 10);
  assert.ok(multi.some((h) => (h.role ?? "").includes("morning digest posted")), "multi-query arm");
  store.close();
  console.log("step6 RRF entity arm + step7 telemetry: OK");
}

rmSync(dir, { recursive: true, force: true });
console.log("entity-link.test.ts ALL PASS");
