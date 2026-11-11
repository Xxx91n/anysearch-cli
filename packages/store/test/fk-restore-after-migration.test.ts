// #257 / CodeRabbit: the legacy access_events rebuild turns foreign-key
// enforcement OFF on the connection to do its table swap. With the new bounded
// retry the constructor can enter that rebuild again (or hit SQLITE_BUSY inside
// it), and a stale shape check would then return early — leaving a LIVE
// connection with foreign keys disabled, where cascades silently stop working.
//
// This test proves the restore holds on the path that actually migrates: it
// opens a store on a pre-upgrade database, then asserts (a) the connection still
// reports foreign_keys=1 and (b) an ON DELETE CASCADE really fires. Both fail if
// the pragma is left OFF.
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteSessionStore } from "../src/session-store.js";
import { isBusyRetryExhausted } from "../src/sqlite-init.js";
import { preUpgradeSchema } from "./access-chain-fixtures.js";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

const STORE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

function main() {
  const dir = mkdtempSync(join(tmpdir(), "ans-fk-restore-"));
  const dbPath = join(dir, "t.db");
  try {
    // Pre-upgrade shape that actually triggers the rebuild: the legacy 3-column
    // access_events (memory_id NOT NULL) plus the chain columns an earlier ALTER
    // already added. The rebuild keys on "memory_id NOT NULL AND prev_hash
    // present", so the bare 3-column form takes the ALTER path and never rebuilds.
    {
      const db = new Database(dbPath);
      db.pragma("journal_mode = WAL");
      db.pragma("foreign_keys = ON");
      db.exec(preUpgradeSchema(join(STORE_DIR, "src", "schema.sql")));
      db.exec("ALTER TABLE access_events ADD COLUMN prev_hash TEXT");
      db.exec("ALTER TABLE access_events ADD COLUMN schema_version INTEGER");
      db.exec("ALTER TABLE access_events ADD COLUMN event_type TEXT");
      db.prepare("INSERT INTO sessions (id, domain) VALUES ('s1', 'code')").run();
      db.prepare("INSERT INTO retrieval_results (session_id, url) VALUES ('s1', 'https://example.com/a')").run();
      db.prepare("INSERT INTO access_events (memory_id, accessed_at) VALUES (1, '2025-01-01 00:00:01')").run();
      db.close();
    }

    // Opening the store runs the rebuild migration on this legacy file.
    const store = new SqliteSessionStore(dbPath);
    const db = (store as unknown as { db: Database.Database }).db;
    try {
      assert((db.pragma("foreign_keys", { simple: true }) as number) === 1,
        "foreign_keys is still ON after the access_events rebuild");

      // The rebuilt table really has the v2 shape (so the rebuild did run, and
      // this test is not silently exercising the no-op path).
      const cols = db.prepare("PRAGMA table_info(access_events)").all() as Array<{ name: string; notnull: number }>;
      const memory = cols.find((c) => c.name === "memory_id");
      assert(memory !== undefined && memory.notnull === 0,
        "access_events.memory_id is nullable after the rebuild (legacy NOT NULL is gone)");
      assert(cols.some((c) => c.name === "prev_hash"), "rebuilt access_events carries the chain columns");

      // Enforcement, not just the flag: deleting the parent must cascade.
      const before = (db.prepare("SELECT COUNT(*) AS n FROM access_events WHERE memory_id = 1").get() as { n: number }).n;
      assert(before >= 1, "fixture has an access event pointing at retrieval_results id 1 (got " + before + ")");
      db.prepare("DELETE FROM retrieval_results WHERE id = 1").run();
      const after = (db.prepare("SELECT COUNT(*) AS n FROM access_events WHERE memory_id = 1").get() as { n: number }).n;
      assert(after === 0, "ON DELETE CASCADE actually fired after migration (left " + after + " rows)");
    } finally {
      store.close();
    }

    // --- a held lock fails the start honestly (does NOT reach the rebuild) ---
    //
    // Worth pinning even though it does not exercise migrateSwitchEventSchema:
    // the first contended step is `schema`, so the constructor gives up before
    // any table swap. What this proves is the ticket's own rule — a contended
    // startup fails instead of reporting success — and that the database is left
    // in a state the next open can still migrate (FK enforcement intact).
    // The restore-during-failure behaviour itself is covered directly by
    // sqlite-init.test.ts ("enforcement is restored even when the swap throws"),
    // which is the only way to force a throw inside the swap deterministically.
    {
      const lockPath = join(dir, "locked.db");
      {
        const db = new Database(lockPath);
        db.pragma("journal_mode = WAL");
        db.pragma("foreign_keys = ON");
        db.exec(preUpgradeSchema(join(STORE_DIR, "src", "schema.sql")));
        db.exec("ALTER TABLE access_events ADD COLUMN prev_hash TEXT");
        db.exec("ALTER TABLE access_events ADD COLUMN schema_version INTEGER");
        db.exec("ALTER TABLE access_events ADD COLUMN event_type TEXT");
        db.prepare("INSERT INTO sessions (id, domain) VALUES ('s1', 'code')").run();
        db.prepare("INSERT INTO retrieval_results (session_id, url) VALUES ('s1', 'https://example.com/b')").run();
        db.prepare("INSERT INTO access_events (memory_id, accessed_at) VALUES (1, '2025-01-01 00:00:02')").run();
        db.close();
      }

      const holder = new Database(lockPath);
      holder.exec("BEGIN EXCLUSIVE");
      let threw = false;
      let failure: unknown;
      try {
        // Contended from the first write-ish step; the window runs out and the
        // constructor must fail rather than claim a start.
        new SqliteSessionStore(lockPath);
      } catch (e) {
        threw = true;
        failure = e;
      } finally {
        try { holder.exec("COMMIT"); } catch { /* holder is disposable */ }
        holder.close();
      }
      assert(threw, "a store opened under a held exclusive lock fails instead of starting");
      assert(isBusyRetryExhausted(failure), "the failure is the bounded-retry exhaustion, not some other error");

      // The database itself is fine; opening it after the lock is released must
      // produce a connection that still enforces foreign keys and can finish the
      // rebuild that the failed startup never reached.
      const reopened = new SqliteSessionStore(lockPath);
      const rdb = (reopened as unknown as { db: Database.Database }).db;
      try {
        assert((rdb.pragma("foreign_keys", { simple: true }) as number) === 1,
          "after a failed startup, a fresh connection still has foreign_keys ON");
        const cols = rdb.prepare("PRAGMA table_info(access_events)").all() as Array<{ name: string; notnull: number }>;
        assert(cols.some((c) => c.name === "prev_hash"), "the rebuild completes on the open that is not contended");
        rdb.prepare("DELETE FROM retrieval_results WHERE id = 1").run();
        const left = (rdb.prepare("SELECT COUNT(*) AS n FROM access_events WHERE memory_id = 1").get() as { n: number }).n;
        assert(left === 0, "cascade still fires after the failed-then-successful startup (left " + left + " rows)");
      } finally {
        reopened.close();
      }
    }
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may hold handles briefly */ }
  }

  console.log("fk-restore-after-migration: " + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}

main();
