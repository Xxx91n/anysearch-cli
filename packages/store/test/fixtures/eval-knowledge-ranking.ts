// Run in CI against BOTH the pinned base and this branch. Same corpus, same
// queries, real public recall path, no model or embedding calls.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "../../src/session-store";
import { __setEmbeddingModuleForTest } from "../../src/embedding-arm";

type Case = { bucket: string; query: string; rows: string[]; relevant: number[] };
const cases = JSON.parse(readFileSync(new URL("./knowledge-ranking-cases.json", import.meta.url), "utf8")) as Case[];
const buckets: Record<string, { count: number; ndcgAt10: number; mrrAt10: number; recallAt10: number }> = {};
const dir = mkdtempSync(join(tmpdir(), "ans-ranking-eval-"));
__setEmbeddingModuleForTest(null);
try {
  for (const [i, c] of cases.entries()) {
    const path = join(dir, i + ".db");
    const store = new SqliteSessionStore(path);
    try {
      const db = new Database(path);
      try {
        const insert = db.prepare("INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, '[]', 0.5, 0.9, NULL)");
        for (const row of c.rows) insert.run(row);
      } finally { db.close(); }
      const single = (await store.searchMemory(c.query, 10)).filter((h) => h.rowid < 0).map((h) => h.content);
      const multi = (await store.searchMemoryMulti([c.query], 10)).filter((h) => h.rowid < 0).map((h) => h.content);
      assert.deepEqual(multi, single, "single/multi recall parity: " + c.query);
      const expected = new Set(c.relevant.map((index) => c.rows[index]));
      const ranks = single.flatMap((content, index) => expected.has(content) ? [index + 1] : []);
      const dcg = ranks.reduce((sum, rank) => sum + 1 / Math.log2(rank + 1), 0);
      const ideal = c.relevant.slice(0, 10).reduce((sum, _, index) => sum + 1 / Math.log2(index + 2), 0);
      const bucket = buckets[c.bucket] ??= { count: 0, ndcgAt10: 0, mrrAt10: 0, recallAt10: 0 };
      bucket.count++;
      bucket.ndcgAt10 += dcg / ideal;
      bucket.mrrAt10 += ranks.length ? 1 / ranks[0]! : 0;
      bucket.recallAt10 += ranks.length / expected.size;
    } finally { store.close(); }
  }
  for (const bucket of Object.values(buckets)) {
    bucket.ndcgAt10 /= bucket.count;
    bucket.mrrAt10 /= bucket.count;
    bucket.recallAt10 /= bucket.count;
  }
  console.log(JSON.stringify(buckets, null, 2));
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(buckets, null, 2) + "\n");
} finally {
  __setEmbeddingModuleForTest("auto");
  rmSync(dir, { recursive: true, force: true });
}
