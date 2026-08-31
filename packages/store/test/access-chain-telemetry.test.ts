// ADR-0040 D2/D6/D7 items 6+7: event write failures are counted (alert-on-silence), second
// construction is idempotent (no duplicate anchor, zero legacy byte rewrite), and the write
// path stays unblocked under a degraded (renamed-away) events table.
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteSessionStore } from "../src/session-store.js";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

const STORE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  // --- (6) telemetry: knocked-out events table -> writeFailures counted, recall unblocked ---
  {
    const dir = mkdtempSync(join(tmpdir(), "ans-chain-tel-"));
    try {
      const store = new SqliteSessionStore(join(dir, "t.db"));
      const session = await store.createSession("code");
      await store.saveResults(session.id, [
        { url: "https://example.com/a", title: "Alpha fusion notes", snippet: "alpha fusion snippet", source: "tavily" },
      ]);
      // Warm path proves events write fine before the fault.
      await store.searchMemory("fusion", 10);
      assert(store.accessEventTelemetry().writeFailures === 0, "no failures before fault");
      // Fault injection from a second connection (dbQuery only runs row-returning statements).
      const rogue = new Database(join(dir, "t.db"));
      rogue.exec("ALTER TABLE access_events RENAME TO access_events_gone");
      rogue.close();
      const hits = await store.searchMemory("fusion", 10);
      assert(hits.length >= 1, "recall still returns hits despite event write failure (fail-open)");
      assert(store.accessEventTelemetry().writeFailures > 0, "eventWriteFailures incremented (got " + store.accessEventTelemetry().writeFailures + ")");
      store.close();
    } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
  }

  // --- (7) idempotency + legacy zero-rewrite ---
  {
    const dir = mkdtempSync(join(tmpdir(), "ans-chain-idem-"));
    const dbPath = join(dir, "t.db");
    try {
      const schema = readFileSync(join(STORE_DIR, "src", "schema.sql"), "utf8");
      const legacy = (p: string) => new Database(p, { readonly: true }).prepare("SELECT id, memory_id, accessed_at FROM access_events ORDER BY id").all();
      const ro = (p: string) => new Database(p, { readonly: true });
      {
        const db = new Database(dbPath);
        db.pragma("journal_mode = WAL");
        db.pragma("foreign_keys = ON");
        db.exec(schema.replace(/CREATE TABLE IF NOT EXISTS access_chain_anchor[^;]*;/s, "").replace(/CREATE TABLE IF NOT EXISTS access_events \(([^)]*)\);/s, "CREATE TABLE access_events (id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id INTEGER NOT NULL REFERENCES retrieval_results(id) ON DELETE CASCADE, accessed_at TEXT NOT NULL DEFAULT (datetime('now')));"));
        db.prepare("INSERT INTO sessions (id, domain) VALUES ('s1', 'code')").run();
        db.prepare("INSERT INTO retrieval_results (session_id, url) VALUES ('s1', 'https://example.com/l1')").run();
        db.prepare("INSERT INTO access_events (memory_id, accessed_at) VALUES (1, '2025-01-01 00:00:01')").run();
        db.close();
      }
      const before = legacy(dbPath);
      new SqliteSessionStore(dbPath).close(); // upgrade + bootstrap
      const after = ro(dbPath);
      const rowsAfter = after.prepare("SELECT id, memory_id, accessed_at, prev_hash, schema_version, event_type FROM access_events ORDER BY id").all() as Record<string, unknown>[];
      const anchors = after.prepare("SELECT COUNT(*) AS n FROM access_chain_anchor").get() as { n: number };
      after.close();
      assert(anchors.n === 1, "anchor sealed exactly once (got " + anchors.n + ")");
      assert(JSON.stringify(rowsAfter.map((r) => ({ id: r.id, memory_id: r.memory_id, accessed_at: r.accessed_at }))) === JSON.stringify(before), "legacy rows byte-identical after upgrade (no UPDATE evidence)");
      assert(rowsAfter.every((r) => r.prev_hash === null && r.schema_version === null && r.event_type === null), "legacy rows stay v0 (new columns NULL, never backfilled)");

      new SqliteSessionStore(dbPath).close(); // second construction
      const after2 = ro(dbPath);
      assert((after2.prepare("SELECT COUNT(*) AS n FROM access_chain_anchor").get() as { n: number }).n === 1, "second construction: still exactly one anchor (idempotent)");
      after2.close();
    } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
  }

  console.log("access-chain-telemetry: " + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}
main();
