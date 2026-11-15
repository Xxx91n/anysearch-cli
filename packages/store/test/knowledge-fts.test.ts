import assert from "node:assert/strict";
import { SqliteSessionStore } from "../src/session-store";
import { knowledgeFtsSql } from "../src/knowledge-fts";

const store = new SqliteSessionStore(":memory:");
try {
  for (const content of [
    "Acme support email.",
    "Acme support email is help@sample.example. More details are available during business hours.",
    "Acme почта поддержки. Contact the team during business hours for additional help.",
    "Acme почта.",
    "AcmeCloud support email.",
  ]) {
    store.dbQuery("INSERT INTO semantic_memories (content, source_episode_ids) VALUES (?, '[]') RETURNING id", content);
  }
  for (const c of [
    { label: "Latin", query: "Acme* AND email*", where: "", params: [] },
    { label: "Latin with object join filter", query: "Acme* AND email*", where: " AND (s.content LIKE ? OR s.content LIKE ?)", params: ["%acme%", "%甲公司%"] },
    { label: "relaxed with object join filter", query: "Acme* OR support* OR email*", where: " AND (s.content LIKE ?)", params: ["%acme%"] },
    { label: "mixed-script intersection", query: '("Acme"*) AND ("почта"*)', where: " AND (s.content LIKE ?)", params: ["%acme%"] },
    { label: "Unicode indexed", query: '"почта"*', where: " AND (s.content LIKE ?)", params: ["%acme%"] },
  ]) {
    // Explain the exact SQL used by production, with the real store schema.
    const sql = knowledgeFtsSql(c.where);
    const plan = store.dbQuery<{ detail: string }>("EXPLAIN QUERY PLAN " + sql, c.query, ...c.params);
    console.log(c.label + ": " + plan.map((row) => row.detail).join("; "));
    assert(!plan.some((row) => /USE TEMP B-TREE FOR ORDER BY/i.test(row.detail)), c.label + ": rank order must stream without a temporary sort");

    const actual = store.dbQuery<{ id: number; rank: number }>(sql, c.query, ...c.params);
    const reference = store.dbQuery<{ id: number; rank: number }>(
      sql.replace("ORDER BY semantic_memories_fts.rank", "ORDER BY bm25(semantic_memories_fts)"), c.query, ...c.params,
    );
    assert(actual.length > 0, c.label + ": nonempty scoring comparison");
    assert.deepEqual(actual.map((row) => row.rank), reference.map((row) => row.rank), c.label + ": same BM25 score order");
    assert.deepEqual(actual.map((row) => row.id).sort((a, b) => a - b), reference.map((row) => row.id).sort((a, b) => a - b), c.label + ": same candidates");
  }
  console.log("knowledge FTS plans: joined queries stream by hidden rank and preserve BM25 scores");
} finally {
  store.close();
}
