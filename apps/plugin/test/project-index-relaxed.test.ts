// ADR-0102 D1: the project index (host-recallable memory) gets the same relaxed rung.
// Repro: the host indexed NBA Finals results in session 1, then asked a natural-language
// question in session 2; the strict AND rung returned 0 although 85 rows were indexed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectIndexStore } from "../src/index.js";

function seeded() {
  const dir = mkdtempSync(join(tmpdir(), "ans-pi-relax-"));
  const store = new ProjectIndexStore(join(dir, "pi.db"));
  const rows = [
    ["Knicks win 2026 NBA Finals", "https://www.nba.com/news/knicks-win-2026-finals", "New York beat San Antonio 4-1 to claim the championship"],
    ["Brunson named NBA Finals MVP", "https://www.espn.com/nba/story/brunson-finals-mvp", "Jalen Brunson scored 45 in Game 5"],
    ["NBA preseason schedule", "https://example.com/nba-schedule", "Preseason games start in October"],
    ["Tomato pruning basics", "https://example.com/gardening", "Prune suckers early in the season"],
  ];
  rows.forEach(([title, url, snippet], i) => store.indexEntry({ projectPath: dir, toolName: "search_web", title, url, snippet, source: "tavily", contentHash: "h" + i }));
  return { store, dir };
}

test("project index: a natural-language follow-up question recalls indexed evidence (was 0)", () => {
  const { store, dir } = seeded();
  try {
    const hits = store.search("latest NBA champion NBA Finals MVP", 5);
    assert.ok(hits.length >= 2, `expected the two NBA rows, got ${hits.length}`);
    assert.ok(hits.every((h) => /Knicks|Brunson/.test(h.title)), "one-word near-miss rows stay out");
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("project index: strict matches keep priority; unrelated queries stay empty", () => {
  const { store, dir } = seeded();
  try {
    const top = store.search("Brunson Finals MVP", 1);
    assert.equal(top.length, 1);
    assert.match(top[0]!.title, /Brunson/);
    assert.equal(store.search("quantum zebra telescope", 5).length, 0);
    assert.equal(store.search("NBA ticket refund policy", 5).length, 0, "single shared entity word is not evidence");
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
