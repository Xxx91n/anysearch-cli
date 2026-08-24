// ADR-0023 D2 (Q2=B): FTS5 Query Tokenization acceptance test.
// Bug repro: legacy `"vector database"` phrase misses content containing only the word "vectors".
// Fix: tokenize → per-word `word*` AND, full-phrase OR branch, ≤8 term truncation.
// Uses OS temp dir for SQLite (WAL needs a file, not :memory:).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStore } from "../src/session-store";
import { fts5EscapeQuery } from "../src/fts5";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

async function main() {
  const tmpDir = mkdtempSync(join(tmpdir(), "ans-fts5-"));
  const dbPath = join(tmpDir, "test.db");
  try {
    const store = new SqliteSessionStore(dbPath);
    const session = await store.createSession("code");

    // Seed: documents with morphological variants (vector / vectors / database)
    await store.saveResults(session.id, [
      { url: "https://example.com/v1", title: "vectors reference", snippet: "vectors explanation", source: "exa" },
      { url: "https://example.com/v2", title: "vector database guide", snippet: "vector database tutorial", source: "exa" },
    ]);
    // Trigger FTS sync via saveResults transaction
    await new Promise((r) => setTimeout(r, 10));

    // AC: "vectors" must match a doc containing "vector database"
    const hits = await store.searchMemory("vectors", 10);
    assert(hits.length >= 1, `expected >=1 hit for "vectors" against "vector database", got ${hits.length}`);

    // Phrase fallback still works
    const phraseHits = await store.searchMemory('"vector database"', 10);
    assert(phraseHits.length >= 1, "phrase form 'vector database' still matches");

    // Long query truncated to ≤8 terms (no empty-row miss)
    const longQ = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda";
    const escaped = fts5EscapeQuery(longQ);
    const andTerms = escaped.split(" AND ").length;
    assert(andTerms <= 8, `escape truncates to ≤8 AND terms (got ${andTerms})`);

    // CWE-20 escape preserved: quotes doubled inside phrase branch
    const inj = fts5EscapeQuery('a " b');
    assert(inj.includes('""'), `CWE-20 double-quote escaping preserved: ${inj}`);

    // Empty query → phrase-empty, no crash
    assert(fts5EscapeQuery("   ") === '""', "whitespace-only query returns '\"\"'");

    // searchMemoryMulti: RRF k=60 fusion across the two variants, reusable seam
    const session2 = await store.createSession("code");
    await store.saveResults(session2.id, [
      { url: "https://example.com/onlyA", title: "onlyA alpha", snippet: "alpha-only body", source: "exa" },
      { url: "https://example.com/onlyB", title: "onlyB beta", snippet: "beta-only body", source: "exa" },
    ]);
    await new Promise((r) => setTimeout(r, 10));

    // single-query legacy path hits A but not B
    const single = await store.searchMemory("alpha", 5);
    assert(single.some((h) => (h.content || "").includes("alpha-only")), "single query finds alpha doc");

    // multi-query: variants ["alpha", "beta"] fused via RRF k=60 returns BOTH docs
    const multi = await store.searchMemoryMulti(["alpha", "beta"], 5);
    const urls = multi.map((h) => h.rowid);
    assert(multi.length >= 2, `multi-query fusion returned ≥2 hits, got ${multi.length}`);
    assert(urls.length === new Set(urls).size, "RRF fusion deduped");

    console.log(`fts5-tokenize.test.ts: ${passed} passed, ${failed} failed`);

    if (failed > 0) process.exit(1);
    store.close?.();
  } finally {
    // Windows WAL lock: tolerate EPERM
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
