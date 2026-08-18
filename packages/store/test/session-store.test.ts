// SessionStore better-sqlite3 test (G003).
// Self-check via assert-based demo (ponytail: no test framework).
// Uses OS temp file for SQLite (WAL needs file, not :memory:).

import Database from "better-sqlite3";
import { SqliteSessionStore } from "../src/session-store";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

async function main() {
  // Use temp dir for SQLite file (WAL incompatible with :memory:).
  const tmpDir = mkdtempSync(join(tmpdir(), "ans-test-"));
  const dbPath = join(tmpDir, "test.db");

  try {
    const store = new SqliteSessionStore(dbPath);

    // 1. createSession
    const session = await store.createSession("code");
    assert(typeof session.id === "string" && session.id.length > 0, "createSession returns id");
    assert(session.domain === "code", "createSession returns domain");
    assert(typeof session.createdAt === "string", "createSession returns createdAt");

    // 2. append + searchFts5
    await store.append(session.id, { role: "user", content: "TypeScript best practices" });
    await store.append(session.id, { role: "assistant", content: "Use strict mode in TypeScript" });
    await store.append(session.id, { role: "user", content: "Python data analysis" });
    const hits = await store.searchFts5(session.id, "TypeScript", 10);
    assert(hits.length >= 2, "searchFts5 finds TypeScript messages (got " + hits.length + ")");
    assert(hits[0].sessionId === session.id, "searchFts5 hits have correct sessionId");
    assert(typeof hits[0].rank === "number", "searchFts5 hits have numeric rank");

    // 3. searchFts5 with null sessionId (search all sessions)
    const allHits = await store.searchFts5(null, "TypeScript", 10);
    assert(allHits.length >= 2, "searchFts5 with null finds across all sessions");

    // 4. saveResults - verify via direct count (searchFts5 searches messages, not results)
    const results = [
      { url: "https://example.com/1", title: "Test 1", snippet: "Snippet 1", source: "tavily" },
      { url: "https://example.com/2", title: "Test 2", snippet: "Snippet 2", source: "exa" },
    ];
    await store.saveResults(session.id, results);
    // Verify rows landed in retrieval_results table via a second read-only connection.
    // ponytail: WAL allows concurrent readers; store still holds the write connection.
    const checkDb = new Database(dbPath, { readonly: true });
    const count = checkDb.prepare("SELECT COUNT(*) as c FROM retrieval_results WHERE session_id = ?").get(session.id) as { c: number };
    assert(count.c === 2, "saveResults stored 2 rows in retrieval_results (got " + count.c + ")");
    checkDb.close();

    // 5. saveAnchor + getAnchors
    await store.saveAnchor(session.id, "query", { query: "test query", timestamp: 12345 });
    await store.saveAnchor(session.id, "fetch", { url: "https://example.com" });
    const anchors = await store.getAnchors(session.id);
    assert(anchors.length === 2, "getAnchors returns 2 anchors (got " + anchors.length + ")");
    const firstAnchor = anchors[0];
    assert(firstAnchor.anchorType === "query", "first anchor type is query");
    assert(typeof firstAnchor.payload === "object", "anchor payload is parsed object");
    assert((firstAnchor.payload as any).query === "test query", "anchor payload has query field");

    // 6. session isolation - new session should not see old session data
    const session2 = await store.createSession("research");
    await store.append(session2.id, { role: "user", content: "Different content here" });
    const session1Hits = await store.searchFts5(session.id, "TypeScript", 10);
    const session2Hits = await store.searchFts5(session2.id, "TypeScript", 10);
    const session2AllHits = await store.searchFts5(session2.id, "Different", 10);
    assert(session1Hits.length >= 2, "session 1 still has its messages");
    assert(session2Hits.length === 0, "session 2 has no TypeScript messages (isolation)");
    assert(session2AllHits.length >= 1, "session 2 has its own Different content");

    store.close();
  } finally {
    // Cleanup temp db files. Windows may EPERM on WAL files after close; ignore.
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* Windows WAL lock */ }
  }

  console.log("--- SessionStore tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
