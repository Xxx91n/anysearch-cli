// #310: pre-migration consistent backup — the tests for the ticket's own rules.
//
// What each family proves:
//   A. opening a legacy database publishes a snapshot BEFORE the assembly
//      touches it: the backup contains the old rows and NOT the new marker
//      table, while the live database ended up fully migrated with the old
//      rows and the old budget history untouched.
//   B. the JSON record is verifiable: its sha256 matches the file bytes
//      actually on disk, and the compatibility claim names exactly the two
//      known sample sources (the N1 combined scenario stays pending).
//   C. the snapshot carries data that lives only in -wal: a committed row
//      whose bytes are demonstrably absent from the main file. A plain file
//      copy could not pass this.
//   D. idempotence: brand-new files and 0-byte files never snapshot; opening
//      a migrated database again leaves the existing backup untouched.
//   E. failure: a database that cannot be snapshotted (corrupt file) makes
//      the constructor refuse to start, with a message an operator can act
//      on — never a silent continue into migration.
//   F. the observation store takes the same snapshot (its own constructor
//      path), and a pre-existing backup is reused, not rewritten.
//   G. readMigrationStatus reports each state without writing anything —
//      including the honest "unknown" for a file that cannot even be opened
//      read-only (the diagnostic connection is read-only on purpose).
//   H. sessionless files (observation-only): re-opening them never snapshots
//      — the session assembly on them is purely additive — and whoever
//      completes the session structure claims the marker.
//   I. publish serialization: the source DB's write lock gates the publish;
//      a held lock makes the gate fail closed (no backup, no migration, no
//      tmp litter), and a retry after release publishes normally.
//
// Style: assert-based self-check (no framework), matching the fixture family
// this ticket extends (fk-restore-after-migration.test.ts).

import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { SqliteSessionStore } from "../src/session-store.js";
import { SqliteObservationStore } from "../src/observation.js";
import { openTaskRegistry } from "../src/task-registry.js";
import {
  MANUAL_RECOVERY_NOTE,
  VERIFIED_LAYOUT_SOURCES,
  ensurePreMigrationBackup,
  preMigrationBackupPath,
  preMigrationRecordPath,
  readMigrationStatus,
  STORE_LAYOUT_VERSION,
} from "../src/migration-backup.js";
import { preUpgradeSchema } from "./access-chain-fixtures.js";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

const STORE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_PATH = join(STORE_DIR, "src", "schema.sql");

/**
 * The "older build" fixture: the current schema with (1) the legacy 3-column
 * access_events (preUpgradeSchema) and (2) the #310 layout marker table
 * stripped — the last one is what makes migration-backup see the file as a
 * database the current line has never migrated.
 */
function legacySchema(): string {
  const out = preUpgradeSchema(SCHEMA_PATH).replace(
    /CREATE TABLE IF NOT EXISTS store_meta \([\s\S]*?\);/,
    "",
  );
  // Comments legitimately name the table; only the DDL has to be gone.
  if (/CREATE TABLE[^;]*store_meta/.test(out)) {
    throw new Error("legacySchema: store_meta DDL pattern not found — refusing a silently-current fixture");
  }
  return out;
}

function buildLegacyDb(dbPath: string, extra?: (db: Database.Database) => void): void {
  const db = new Database(dbPath);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(legacySchema());
    db.prepare("INSERT INTO sessions (id, domain) VALUES ('legacy-1', 'probe')").run();
    db.prepare("INSERT INTO retrieval_results (session_id, url, title, snippet, source, rrf_score) VALUES ('legacy-1', 'https://older.example/keep', 'OLDER-TITLE', 'OLDER-SNIPPET keepword', 'exa', 0.5)").run();
    // An old conversation's spend history — migration must leave the numbers.
    db.prepare("INSERT INTO budget_ledger (session_id, token_cap, usd_cap, time_limit_ms, call_cap, reserved_tokens, spent_tokens, reserved_usd, spent_usd, reserved_calls, billable_calls) VALUES ('legacy-1', 1000, 10, 60000, 50, 0, 137, 0, 0.25, 0, 3)").run();
    if (extra) extra(db);
  } finally {
    db.close();
  }
}

function main(): void {
  const dir = mkdtempSync(join(tmpdir(), "ans-pre-migration-"));

  try {
    // ============ A. legacy open: snapshot first, then migrate ============
    {
      const dbPath = join(dir, "legacy.db");
      buildLegacyDb(dbPath);
      assert(!existsSync(preMigrationBackupPath(dbPath)), "A: no backup exists before the first open");

      const store = new SqliteSessionStore(dbPath);
      const backupPath = preMigrationBackupPath(dbPath);
      try {
        assert(existsSync(backupPath), "A: opening a legacy database publishes a backup");

        // The backup is a pre-migration snapshot: old rows in, new marker out.
        const bak = new Database(backupPath, { readonly: true });
        try {
          const kept = bak.prepare("SELECT title, snippet FROM retrieval_results WHERE url = 'https://older.example/keep'").get() as { title: string } | undefined;
          assert(kept?.title === "OLDER-TITLE", "A: backup carries the old row");
          const bakTables = (bak.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((t) => t.name);
          assert(!bakTables.includes("store_meta"), "A: backup predates the marker table (snapshot, not post-migration copy)");
        } finally {
          bak.close();
        }

        // The live database is now migrated with history intact.
        const db = (store as unknown as { db: Database.Database }).db;
        const meta = db.prepare("SELECT value FROM store_meta WHERE key = 'store_layout'").get() as { value: string } | undefined;
        assert(meta?.value === STORE_LAYOUT_VERSION, "A: live DB carries the current layout marker");
        const row = db.prepare("SELECT title FROM retrieval_results WHERE url = 'https://older.example/keep'").get() as { title: string } | undefined;
        assert(row?.title === "OLDER-TITLE", "A: the old row is still in the migrated DB");
        const budget = db.prepare("SELECT spent_tokens, spent_usd, billable_calls FROM budget_ledger WHERE session_id = 'legacy-1'").get() as { spent_tokens: number; spent_usd: number; billable_calls: number };
        assert(budget.spent_tokens === 137 && budget.spent_usd === 0.25 && budget.billable_calls === 3,
          "A: the old conversation's spend history is untouched (" + JSON.stringify(budget) + ")");
        for (const t of ["chat_projects", "task_records", "task_budgets", "store_meta"]) {
          const present = (db.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table' AND name=?").get(t) as { c: number }).c > 0;
          assert(present, "A: migration recreated table " + t);
        }
      } finally {
        store.close();
      }

      // ============ D (part 1). idempotence: reopen does not re-snapshot ====
      const before = statSync(backupPath);
      const again = new SqliteSessionStore(dbPath);
      again.close();
      const after = statSync(backupPath);
      assert(before.mtimeMs === after.mtimeMs && before.size === after.size,
        "D: reopening a migrated DB leaves the existing backup untouched (no second snapshot)");

      // ============ B. the JSON record is verifiable ============
      const recordPath = preMigrationRecordPath(dbPath);
      assert(existsSync(recordPath), "B: the record file exists next to the backup");
      const record = JSON.parse(readFileSync(recordPath, "utf8")) as {
        method: string; sha256: string; bytes: number;
        declaredCompatibleLayouts: string[]; manualRecovery: string;
      };
      assert(record.method === "sqlite-vacuum-into", "B: record names the snapshot method");
      const digest = createHash("sha256").update(readFileSync(backupPath)).digest("hex");
      assert(record.sha256 === digest, "B: record sha256 matches the backup bytes on disk");
      assert(record.bytes === statSync(backupPath).size, "B: record byte count matches the backup file");
      assert(record.declaredCompatibleLayouts.length === VERIFIED_LAYOUT_SOURCES.length &&
        record.declaredCompatibleLayouts.every((v, i) => v === VERIFIED_LAYOUT_SOURCES[i]),
        "B: compatibility claim lists exactly the known sample sources");
      const claims = record.declaredCompatibleLayouts.join(" | ");
      assert(/simulated-legacy-tables/.test(claims) && /npm-0\.2\.0-published-layout/.test(claims) && /N1 combined scenario pending/.test(claims),
        "B: simulated vs published 0.2.0 sources are named separately, N1 marked pending");
      assert(record.manualRecovery === MANUAL_RECOVERY_NOTE && record.manualRecovery.includes("手动"),
        "B: manual-recovery warning is carried in the record");
    }

    // ============ C. WAL-only data must be inside the snapshot ============
    {
      const dbPath = join(dir, "wal.db");
      // Legacy layout with a committed row living only in -wal: keep a writer
      // connection open with autocheckpoint off, write, do NOT checkpoint.
      buildLegacyDb(dbPath, (db) => {
        db.pragma("wal_autocheckpoint = 0");
      });
      const writer = new Database(dbPath);
      try {
        writer.pragma("wal_autocheckpoint = 0");
        writer.pragma("foreign_keys = ON");
        writer.prepare("INSERT INTO retrieval_results (session_id, url, title, snippet, source) VALUES ('legacy-1', 'https://wal.example/only', 'WAL-ONLY-TITLE', 'wal only row', 'exa')").run();
        // Prove the row is NOT in the main file: with the writer open and
        // autocheckpoint off, the committed pages are in -wal alone.
        const mainBytes = readFileSync(dbPath).toString("latin1");
        assert(!mainBytes.includes("WAL-ONLY-TITLE"), "C: fixture set up so the new row is only in -wal, not the main file");
        assert(mainBytes.includes("OLDER-TITLE"), "C: sanity — the pre-existing row is in the main file");

        const outcome = ensurePreMigrationBackup(dbPath);
        assert(outcome.status === "backed-up", "C: backup proceeds while the writer holds the WAL (status " + outcome.status + ")");
        const bak = new Database(preMigrationBackupPath(dbPath), { readonly: true });
        try {
          const hit = bak.prepare("SELECT title FROM retrieval_results WHERE url = 'https://wal.example/only'").get() as { title: string } | undefined;
          assert(hit?.title === "WAL-ONLY-TITLE",
            "C: the snapshot contains the WAL-only row — a copy of the main file alone could not");
        } finally {
          bak.close();
        }
      } finally {
        try { writer.close(); } catch { /* already closed */ }
      }
    }

    // ============ D. fresh files never snapshot ============
    {
      const dbPath = join(dir, "fresh.db");
      const store = new SqliteSessionStore(dbPath);
      store.close();
      assert(!existsSync(preMigrationBackupPath(dbPath)), "D: a brand-new database gets no backup");

      const zeroPath = join(dir, "zero.db");
      writeFileSync(zeroPath, "");
      const zero = new SqliteSessionStore(zeroPath);
      zero.close();
      assert(!existsSync(preMigrationBackupPath(zeroPath)), "D: a 0-byte file gets no backup (nothing to lose)");

      // The CLI's register-then-engine order on a brand-new install: the
      // registry creates the file and writes the marker, so the engine's open
      // must NOT treat it as a legacy shell. Otherwise every first `ans chat`
      // litters a snapshot of an empty table set.
      const registryFirstPath = join(dir, "registry-first.db");
      const registry = openTaskRegistry(registryFirstPath);
      registry.close();
      assert(!existsSync(preMigrationBackupPath(registryFirstPath)),
        "D: the registry's own create path takes no snapshot (no file existed)");
      const engineStore = new SqliteSessionStore(registryFirstPath);
      engineStore.close();
      assert(!existsSync(preMigrationBackupPath(registryFirstPath)),
        "D: after the registry created the file and marked it, the engine open does not snapshot an empty shell");
      const probe = new Database(registryFirstPath, { readonly: true });
      try {
        const marker = probe.prepare("SELECT value FROM store_meta WHERE key = 'store_layout'").get() as { value: string } | undefined;
        assert(marker?.value === STORE_LAYOUT_VERSION, "D: the creator registry wrote the layout marker");
      } finally {
        probe.close();
      }

      // The REAL CLI order on a brand-new install: trackCliCommand tightens
      // permissions first (ensureOwnerOnlyDb creates a 0-byte placeholder),
      // then the registry opens. existsSync-based creator detection sees the
      // placeholder and refuses the marker — the engine then snapshots a
      // table-only shell as if it were legacy. This is the exact sequence the
      // ubuntu installed-acceptance lane caught; a 0-byte placeholder file
      // must still count as "nothing to lose" for the creator rule.
      const placeholderPath = join(dir, "registry-placeholder.db");
      writeFileSync(placeholderPath, ""); // what ensureOwnerOnlyDb does
      const placeholderRegistry = openTaskRegistry(placeholderPath);
      placeholderRegistry.close();
      assert(!existsSync(preMigrationBackupPath(placeholderPath)),
        "D: the 0-byte placeholder path takes no snapshot at the registry open");
      const placeholderEngine = new SqliteSessionStore(placeholderPath);
      placeholderEngine.close();
      assert(!existsSync(preMigrationBackupPath(placeholderPath)),
        "D: the engine open after the placeholder path does not snapshot the registry-created shell (ubuntu lane F regression)");
      const placeholderProbe = new Database(placeholderPath, { readonly: true });
      try {
        const marker = placeholderProbe.prepare("SELECT value FROM store_meta WHERE key = 'store_layout'").get() as { value: string } | undefined;
        assert(marker?.value === STORE_LAYOUT_VERSION, "D: the placeholder-path registry claimed the layout marker");
      } finally {
        placeholderProbe.close();
      }
    }

    // ============ F. observation store + existing-backup reuse ============
    {
      const dbPath = join(dir, "obs.db");
      buildLegacyDb(dbPath);
      const obs = new SqliteObservationStore(dbPath);
      obs.close();
      assert(existsSync(preMigrationBackupPath(dbPath)), "F: the observation store's own path takes the snapshot too");

      // The registry opening a PRE-EXISTING legacy file: snapshot, migrate its
      // schema, no marker (structure upgraded, marker stays the engine's to
      // write after column migrations) — and the engine's open then skips on
      // the published backup instead of snapshotting twice.
      const registryLegacyPath = join(dir, "registry-legacy.db");
      buildLegacyDb(registryLegacyPath);
      const registry = openTaskRegistry(registryLegacyPath);
      registry.close();
      assert(existsSync(preMigrationBackupPath(registryLegacyPath)),
        "F: the registry snapshots a pre-existing legacy database before running the schema");
      {
        // No marker row inside that snapshot: it predates the registry's own
        // schema application, so it really is the pre-migration state.
        const bak = new Database(preMigrationBackupPath(registryLegacyPath), { readonly: true });
        try {
          const marker = bak.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table' AND name='store_meta'").get() as { c: number };
          assert(marker.c === 0, "F: the registry's snapshot predates the marker table");
        } finally { bak.close(); }
      }
      const backupMtime = statSync(preMigrationBackupPath(registryLegacyPath)).mtimeMs;
      const legacyEngineStore = new SqliteSessionStore(registryLegacyPath);
      legacyEngineStore.close();
      const backupMtimeAfter = statSync(preMigrationBackupPath(registryLegacyPath)).mtimeMs;
      assert(backupMtimeAfter === backupMtime,
        "F: the engine open after the registry reuses the published backup (no second snapshot)");
      {
        const probe = new Database(registryLegacyPath, { readonly: true });
        try {
          const marker = probe.prepare("SELECT value FROM store_meta WHERE key = 'store_layout'").get() as { value: string } | undefined;
          assert(marker?.value === STORE_LAYOUT_VERSION, "F: the engine wrote the marker after its full assembly");
        } finally {
          probe.close();
        }
      }

      const reusePath = join(dir, "reuse.db");
      buildLegacyDb(reusePath);
      // A pre-existing backup (say, the user restored a copy by hand) must be
      // reused as-is, never overwritten or re-snapshotted.
      writeFileSync(preMigrationBackupPath(reusePath), "previous backup sentinel");
      const store = new SqliteSessionStore(reusePath);
      store.close();
      assert(readFileSync(preMigrationBackupPath(reusePath), "utf8") === "previous backup sentinel",
        "F: an existing backup file is left untouched");
    }

    // ============ H. sessionless files (observation-only databases) ============
    // greptile round: a file the observation store created ALONE carries no
    // session tables and no marker. Re-opening it must NOT snapshot it as
    // "legacy" — the session assembly on such a file is purely additive, so
    // nothing a migration could rewrite exists there.
    {
      const obsOnly = join(dir, "obs-only.db");
      const obs1 = new SqliteObservationStore(obsOnly);
      obs1.close();
      assert(!existsSync(preMigrationBackupPath(obsOnly)), "H: the standalone observation create takes no snapshot");
      const obs2 = new SqliteObservationStore(obsOnly);
      obs2.close();
      assert(!existsSync(preMigrationBackupPath(obsOnly)),
        "H: re-opening a sessionless observation DB does not snapshot a current structure (greptile waste case)");
      const status = readMigrationStatus(obsOnly);
      assert(status.layout === "sessionless", "H: the read side reports sessionless for the observation-only file (got " + status.layout + ")");

      const sessionAfterObs = join(dir, "obs-then-session.db");
      const obs3 = new SqliteObservationStore(sessionAfterObs);
      obs3.close();
      const sessionStore = new SqliteSessionStore(sessionAfterObs);
      sessionStore.close();
      assert(!existsSync(preMigrationBackupPath(sessionAfterObs)),
        "H: the session open on a sessionless file takes no backup (the assembly there is purely additive)");
      {
        const probe = new Database(sessionAfterObs, { readonly: true });
        try {
          const marker = probe.prepare("SELECT value FROM store_meta WHERE key = 'store_layout'").get() as { value: string } | undefined;
          assert(marker?.value === STORE_LAYOUT_VERSION, "H: the session assembly wrote the current marker on the sessionless file");
        } finally { probe.close(); }
      }

      const registryOnObs = join(dir, "obs-then-registry.db");
      const obs4 = new SqliteObservationStore(registryOnObs);
      obs4.close();
      const reg = openTaskRegistry(registryOnObs);
      reg.close();
      assert(!existsSync(preMigrationBackupPath(registryOnObs)),
        "H: the registry on a sessionless observation file takes no snapshot");
      {
        const probe = new Database(registryOnObs, { readonly: true });
        try {
          const marker = probe.prepare("SELECT value FROM store_meta WHERE key = 'store_layout'").get() as { value: string } | undefined;
          assert(marker?.value === STORE_LAYOUT_VERSION, "H: the registry claimed the marker for the sessionless file (no session tables existed to protect)");
        } finally { probe.close(); }
      }
    }

    // ============ E. a database that cannot be snapshotted refuses to start ====
    {
      const dbPath = join(dir, "corrupt.db");
      writeFileSync(dbPath, "this is not a sqlite database at all, just bytes");
      let threw = false;
      let message = "";
      try {
        new SqliteSessionStore(dbPath);
      } catch (e) {
        threw = true;
        message = String(e instanceof Error ? e.message : e);
      }
      assert(threw, "E: an unsnapshottable legacy DB fails the constructor instead of migrating");
      assert(message.includes("迁移前备份"), "E: the failure says which step failed and what to do (got: " + message.slice(0, 120) + ")");
      assert(!existsSync(preMigrationBackupPath(dbPath)), "E: no leftover backup artifact from the failed attempt");
    }

    // ============ G. readMigrationStatus reports, never writes ============
    {
      const absent = readMigrationStatus(join(dir, "not-there.db"));
      assert(!absent.dbExists && absent.layout === "absent", "G: absent file reported as absent");

      const memory = readMigrationStatus(":memory:");
      assert(memory.layout === "memory", "G: :memory: reported as memory");

      const legacyDb = join(dir, "status-legacy.db");
      buildLegacyDb(legacyDb);
      const legacyStatus = readMigrationStatus(legacyDb);
      assert(legacyStatus.dbExists && legacyStatus.layout === "legacy" && !legacyStatus.backupExists,
        "G: an unmigrated legacy DB reports legacy without creating a backup (" + legacyStatus.layout + ")");
      assert(!existsSync(preMigrationBackupPath(legacyDb)), "G: status probing writes nothing");

      const corruptStatusPath = join(dir, "status-corrupt.db");
      writeFileSync(corruptStatusPath, "definitely not a sqlite database");
      const corruptStatus = readMigrationStatus(corruptStatusPath);
      assert(corruptStatus.dbExists && corruptStatus.layout === "unknown" && typeof corruptStatus.error === "string" && corruptStatus.error.length > 0,
        "G: a file the read-only connection cannot open is reported unknown with its reason — never guessed (got " + corruptStatus.layout + ")");

      const currentStatus = readMigrationStatus(join(dir, "legacy.db"));
      assert(currentStatus.layout === "current" && currentStatus.backupExists && currentStatus.record !== undefined,
        "G: a migrated DB reports current with its backup record");
    }

    // ============ I. publish is serialized by the source DB's write lock ====
    // CodeRabbit round: when the source's write lock is held elsewhere, the
    // publish cannot complete and the gate fails CLOSED — no backup, no
    // migration, no tmp litter. Once the holder releases, a second attempt
    // publishes normally.
    {
      const dbPath = join(dir, "publish-lock.db");
      buildLegacyDb(dbPath);
      const holder = new Database(dbPath);
      let threw = false;
      let message = "";
      try {
        holder.exec("BEGIN IMMEDIATE");
        // The probe and the VACUUM only read (a writer does not block readers
        // in WAL), so the gate gets as far as the publish step and fails
        // there on the write lock, inside the bounded init-retry window.
        ensurePreMigrationBackup(dbPath);
      } catch (e) {
        threw = true;
        message = String(e instanceof Error ? e.message : e);
      } finally {
        try { holder.exec("ROLLBACK"); } catch { /* already rolled back */ }
        holder.close();
      }
      assert(threw, "I: a held write lock makes the gate fail instead of half-succeeding");
      assert(message.includes("迁移前备份"), "I: the failure names the backup step (got: " + message.slice(0, 120) + ")");
      assert(!existsSync(preMigrationBackupPath(dbPath)), "I: nothing was published under the lock");
      {
        const leftovers = readdirSync(dir).filter((f) => f.startsWith("publish-lock.db") && f.includes(".tmp"));
        assert(leftovers.length === 0, "I: the failed attempt left no tmp litter (found: " + leftovers.join(", ") + ")");
      }
      // Holder released — the next attempt publishes normally.
      const outcome = ensurePreMigrationBackup(dbPath);
      assert(outcome.status === "backed-up", "I: after the holder releases, the backup publishes (status " + outcome.status + ")");
      {
        const bak = new Database(preMigrationBackupPath(dbPath), { readonly: true });
        try {
          const kept = bak.prepare("SELECT title FROM retrieval_results WHERE url = 'https://older.example/keep'").get() as { title: string } | undefined;
          assert(kept?.title === "OLDER-TITLE", "I: the published snapshot carries the legacy row");
        } finally { bak.close(); }
      }
    }

    // ============ in-memory store: backup step skips entirely ============
    {
      const before = existsSync(join(dir, "memory-store-has-no-file.db"));
      const store = new SqliteSessionStore(":memory:");
      store.close();
      assert(!before && !existsSync(join(dir, "memory-store-has-no-file.db")),
        ":memory: stores take no filesystem action at all");
    }
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may hold handles briefly */ }
  }

  console.log("pre-migration-backup: " + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}

main();
