import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "../src/session-store";
import { __setEmbeddingModuleForTest } from "../src/embedding-arm";

const dir = mkdtempSync(join(tmpdir(), "ans-283-"));
const path = join(dir, "store.db");
const store = new SqliteSessionStore(path);
__setEmbeddingModuleForTest(null);
try {
  assert(store.declareEntityAlias("Acme", "甲公司").ok);
  const db = new Database(path);
  try {
    const put = db.prepare("INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence) VALUES (?, '[]', 0.5, 0.9)");
    // The wrong object's row comes first and covers both query scripts. Neither
    // its language nor its relevance can bypass #277's object check.
    put.run("乙公司客服邮箱 email 为 wrong@sample.example。");
    put.run("甲公司客服邮箱页面正在维护。");
    put.run("Acme 客服邮箱 email 为 help@sample.example。");
    put.run("Acme support email is support@sample.example.");
    const old = put.run("Acme 客服邮箱 email 为 retired@sample.example。");
    db.prepare("UPDATE semantic_memories SET valid_until = datetime('now') WHERE id = ?").run(old.lastInsertRowid);
  } finally { db.close(); }

  const query = "Acme 客服邮箱 email";
  for (const recall of [
    (limit: number) => store.searchMemory(query, limit),
    (limit: number) => store.searchMemoryMulti([query], limit),
  ]) {
    const first = await recall(1);
    assert.equal(first.length, 1);
    assert(first[0]!.content.includes("help@sample.example"), "stronger evidence beats the earlier Chinese distractor");
    const all = await recall(10);
    assert(all.some((h) => h.content.includes("support@sample.example")), "English evidence is retained");
    assert(all.some((h) => h.content.includes("help@sample.example")), "Chinese LIKE works without embeddings");
    assert(!all.some((h) => /wrong@|retired@/.test(h.content)), "wrong objects and replaced knowledge stay out");
  }
  console.log("knowledge recall: object check, relevance, both languages and no-vector Chinese passed");
} finally {
  store.close();
  __setEmbeddingModuleForTest("auto");
  rmSync(dir, { recursive: true, force: true });
}
