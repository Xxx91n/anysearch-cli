// relaxed recall rung. Repro from the host-in-loop follow-up: memory held the
// NBA Finals results, but the host's natural-language recall question had no single row
// containing every term, so the strict AND rung returned zero and memory was unreachable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStore } from "../src/session-store";
import { fts5EscapeQuery, fts5RelaxedQuery, appendRelaxed, coversMajority } from "../src/fts5";

const ROWS = [
  { url: "https://www.nba.com/news/knicks-win-2026-finals", title: "Knicks win 2026 NBA Finals", snippet: "New York beat San Antonio 4-1 to claim the championship", source: "tavily" },
  { url: "https://www.espn.com/nba/story/brunson-finals-mvp", title: "Brunson named NBA Finals MVP", snippet: "Jalen Brunson scored 45 in Game 5", source: "exa" },
  { url: "https://example.com/nba-schedule", title: "NBA preseason schedule", snippet: "Preseason games start in October", source: "exa" },
  { url: "https://example.com/gardening", title: "Tomato pruning basics", snippet: "Prune suckers early in the season", source: "exa" },
];

async function seeded() {
  const dir = mkdtempSync(join(tmpdir(), "ans-relax-"));
  const store = new SqliteSessionStore(join(dir, "m.db"));
  const s = await store.createSession("code");
  await store.saveResults(s.id, ROWS);
  await new Promise((r) => setTimeout(r, 10));
  return { store, dir };
}

test("relaxed query: content words OR-ed with prefix match, function words dropped, null when nothing to relax", () => {
  assert.equal(fts5RelaxedQuery("Who won the latest NBA championship"), "won* OR latest* OR nba* OR championship*");
  assert.equal(fts5RelaxedQuery("NBA"), null);
  assert.equal(fts5RelaxedQuery("what is the"), null);
  assert.equal(fts5RelaxedQuery("NBA champion"), null, "two content words: a strict majority is both, nothing to relax");
  assert.equal(fts5RelaxedQuery('a " b; DROP c'), "b* OR drop* OR c*", "sanitised exactly like the strict rung (CWE-20)");
  assert.equal(fts5RelaxedQuery("a b c d e f g h i j k")!.split(" OR ").length, 8, "≤8 terms");
});

test("coverage floor: a relaxed row must cover a strict majority of content words", () => {
  assert.equal(coversMajority(["cacheflush", "release", "timetable"], "cacheflush interval config cacheflush interval is ten minutes"), false, "one shared entity word is not evidence (golden un_*)");
  assert.equal(coversMajority(["latest", "nba", "champion", "finals", "mvp"], "Knicks win 2026 NBA Finals New York claim the championship"), true);
  assert.equal(coversMajority(["latest", "nba", "champion", "finals", "mvp"], "NBA preseason schedule"), false);
});

test("appendRelaxed keeps strict hits first, skips duplicates, respects limit", () => {
  const r = appendRelaxed([{ rowid: 2 }, { rowid: 1 }], [{ rowid: 1 }, { rowid: 3 }, { rowid: 4 }], 3);
  assert.deepEqual(r.map((h) => h.rowid), [2, 1, 3]);
});

test("searchMemory: a natural-language recall question reaches stored evidence (was 0 hits)", async () => {
  const { store, dir } = await seeded();
  try {
    const q = "latest NBA champion NBA Finals MVP";
    const strictOnly = store.dbQuery("SELECT rowid FROM retrieval_results_fts WHERE retrieval_results_fts MATCH ?", fts5EscapeQuery(q));
    assert.equal(strictOnly.length, 0, "repro: the strict rung alone returns nothing");
    const hits = await store.searchMemory(q, 5);
    assert.ok(hits.length >= 2, `expected the two NBA rows, got ${hits.length}`);
    assert.ok(hits.every((h) => /Knicks|Brunson/.test(h.role)), "only majority-covered rows; the one-word 'NBA schedule' row stays out");
  } finally { store.close?.(); rmSync(dir, { recursive: true, force: true }); }
});

test("searchMemory: strict hits keep priority and a full strict result is not diluted", async () => {
  const { store, dir } = await seeded();
  try {
    const hits = await store.searchMemory("Brunson Finals MVP", 1);
    assert.equal(hits.length, 1);
    assert.match(hits[0]!.role, /Brunson/);
  } finally { store.close?.(); rmSync(dir, { recursive: true, force: true }); }
});

test("searchMemory: a query with no overlapping content word still returns nothing", async () => {
  const { store, dir } = await seeded();
  try {
    assert.equal((await store.searchMemory("quantum zebra telescope", 5)).length, 0);
  } finally { store.close?.(); rmSync(dir, { recursive: true, force: true }); }
});

test("searchMemoryMulti: the relaxed rung also applies per query variant", async () => {
  const { store, dir } = await seeded();
  try {
    const hits = await store.searchMemoryMulti(["latest NBA champion NBA Finals MVP", "who won the NBA title this year"], 5);
    assert.ok(hits.length >= 1, `expected NBA rows via the multi-query path, got ${hits.length}`);
  } finally { store.close?.(); rmSync(dir, { recursive: true, force: true }); }
});

test("searchMemory: a near-miss sharing one entity word is NOT recalled through the relaxed rung (golden un_* contract)", async () => {
  const { store, dir } = await seeded();
  try {
    const hits = await store.searchMemory("NBA ticket refund policy", 5);
    assert.equal(hits.length, 0, `expected no evidence, got ${hits.map((h) => h.role).join(" | ")}`);
  } finally { store.close?.(); rmSync(dir, { recursive: true, force: true }); }
});
