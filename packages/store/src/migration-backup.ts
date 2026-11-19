// #310: pre-migration consistent backup for the durable store.
//
// Why this file exists
// --------------------
// Opening a database written by an older build (npm 0.2.0 packages, or anything
// predating #299/#302) runs DDL and ALTERs that rewrite its schema in place.
// Until now that step had no recovery point: if a migration half-failed, or a
// later release disagreed with a migrated layout, the only honest answer was
// "your history predates the upgrade". The ticket's rule restores the other
// order: build a verifiable, consistent snapshot of the ORIGINAL database
// BEFORE any assembly step that can change it — the very first of which is the
// WAL pragma in the constructors, not the DDL.
//
// What "consistent" means here
// ----------------------------
// Copying the main DB file is not a snapshot: a live WAL database can hold
// committed pages in `-wal` that the main file never saw. The snapshot must
// come from SQLite itself. `VACUUM INTO` runs the online backup path over the
// connection's snapshot — it reads through WAL, produces one standalone
// database file, and either completes or fails atomically. That is the only
// mechanism this module uses; a plain file copy never appears.
//
// Concurrency (why the tmp name + source write lock)
// ------------------------------------------------
// Two processes can cold-start the same legacy database at once. Both probe,
// both see "legacy", both snapshot (a VACUUM needs only shared read access).
// The publish itself runs under the SOURCE database's cross-process write
// lock (`BEGIN IMMEDIATE` inside the bounded init-retry window):
//   lock → check the canonical name is still absent → link (preferred, an
//   atomic no-replace publish) or rename (no-hardlink filesystems; the lock
//   makes it no-replace among compliant publishers) → commit.
// A published backup is therefore never swapped for another process's
// snapshot — on exFAT-class filesystems the unguarded rename used to have
// exactly that TOCTOU window, and two snapshots taken back-to-back are NOT
// guaranteed identical (CodeRabbit round: committed writes can land between
// them). Crash safety comes free with the lock: it lives in the source DB
// and dies with the connection; a publisher that dies mid-section releases
// it, and whatever it already renamed into place is the winner any later
// claimant keeps. Contention that outlives the retry window fails CLOSED —
// no backup, no migration — which is the honest outcome for a machine where
// a recovery point cannot be published at all.
//
// The tmp file itself is created through SQLite, whose creation mode is
// 0666&~umask — the vacuum temporarily tightens the process umask so the
// snapshot is owner-only from its first byte (the post-publish chmod covers
// only the canonical name).
//
// Failure policy (ticket: failure must not pretend success or silently lose
// data): a backup attempt that cannot produce a snapshot throws, and the store
// constructor refuses to start. No migration happens without a recovery
// point. A JSON sidecar records what was backed up, from which source layout,
// and which sample layouts the compatibility claim actually covers.
//
// Compatibility claims stay honest
// --------------------------------
// Verified sources are exactly what we have run: the simulated legacy layout
// (installed-acceptance lane F + store fixtures) and the npm 0.2.0 published
// layout as verified during the #295 prototype. The N1 combined scenario that
// exercises the real published packages end-to-end has NOT run yet — the
// record says so instead of claiming every historical version works.
//
// Program rollback vs data recovery stay separate (S10): nothing here ever
// restores a backup automatically. readMigrationStatus reports the path and
// the warning; restoring over the live database loses everything written after
// the migration, so it is a human decision with a shell command, not code.
//
// Gate scope (greptile P2 round): the gate protects the SESSION schema family
// only (SESSION_SCHEMA_SENTINELS). A database that carries no session tables
// cannot have its structure rewritten by the session assembly — that assembly
// is purely additive on such a file — so no recovery point is owed, and an
// observation-only database re-opened by its own store must not be copied
// whole on every start.

import Database from "better-sqlite3";
import {
  chmodSync,
  closeSync,
  existsSync,
  linkSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { beginInit, endInit, withInitBusyRetry } from "./sqlite-init.js";
import { openDatabase } from "./db.js";

/** Layout marker table name; presence (with the marker row) means "written by build line ≥ #310". */
export const STORE_META_TABLE = "store_meta";

/**
 * Session-schema sentinels: tables so old that every database the session
 * store ever wrote carries at least one of them (checked as a set, so a
 * hand-forged file missing one is still recognized). A file with NONE of
 * them holds no session-family structure — the only structure such a file
 * can carry is another family's (today: the observation tables), whose own
 * migration is versioned and additive. The session assembly on it is purely
 * additive too, so no migration recovery point is owed (see the gate).
 */
const SESSION_SCHEMA_SENTINELS: readonly string[] = ["sessions", "messages", "retrieval_results", "budget_ledger"];

/** Current store layout ordinal. v1 = the #299/#302 table set plus this ticket's marker. */
export const STORE_LAYOUT_VERSION = "1";

/** Canonical pre-migration snapshot path for a database. */
export function preMigrationBackupPath(dbPath: string): string {
  return dbPath + ".pre-migration.db";
}

/** Diagnostic record path for a pre-migration snapshot. */
export function preMigrationRecordPath(dbPath: string): string {
  return dbPath + ".pre-migration.json";
}

/**
 * The source layouts the forward migration is verified against — and nothing
 * else. "simulated" is the in-repo fixture family; "npm-0.2.0" comes from the
 * #295 prototype verification of the actually published packages. The N1
 * combined scenario has not executed, so it is listed as pending rather than
 * silently folded into the verified set. Anything else (older hand-edited
 * databases, unknown history) is not claimed.
 */
export const VERIFIED_LAYOUT_SOURCES: readonly string[] = [
  "simulated-legacy-tables (store fixtures + installed-acceptance F)",
  "npm-0.2.0-published-layout (verified in #295 prototype; N1 combined scenario pending)",
];

/**
 * Human wording for the restore warning every record carries (S10: restore is
 * manual, loses later writes). The -wal/-shm move-aside step is load-bearing:
 * pairing a restored main file with a leftover WAL from the crashed process is
 * one of SQLite's documented corruption scenarios — never "just overwrite".
 */
export const MANUAL_RECOVERY_NOTE =
  "回退到旧程序前先手动恢复备份：先停掉所有正在跑的相关进程，再把当前的库文件和它的 -wal、-shm 伴生文件一起改名挪走，最后把备份文件放到原来库文件的位置上。千万注意：只覆盖主库、留着旧的 -wal，会把库弄坏。" +
  "恢复会丢掉迁移之后新写入的数据；旧版本程序没对这个布局做兼容确认，先别拿它打开迁移后的库。" +
  "这几步都必须手动执行，本工具不会自动恢复。";

/** Row key holding the layout ordinal inside store_meta. */
export const STORE_LAYOUT_KEY = "store_layout";

interface LayoutProbe {
  /** No tables at all — a brand-new or zero-byte file; assembly has nothing to lose. */
  fresh: boolean;
  /** store_meta exists AND already carries the current layout marker. */
  current: boolean;
  /** Any session-family table present (the structure the session assembly can rewrite). */
  hasSessionTables: boolean;
  /** Whether store_meta exists at all (a build line ≥ #310 wrote this file). */
  storeMetaPresent: boolean;
  /** Observation store's PRAGMA user_version, recorded in the backup record. */
  observationUserVersion: number;
}

function probeLayout(db: Database.Database): LayoutProbe {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  ).all() as Array<{ name: string }>;
  const names = new Set(tables.map((t) => t.name));
  const storeMetaPresent = names.has(STORE_META_TABLE);
  let current = false;
  if (storeMetaPresent) {
    const row = db.prepare("SELECT value FROM store_meta WHERE key = ?").get(STORE_LAYOUT_KEY) as { value: string } | undefined;
    current = row?.value === STORE_LAYOUT_VERSION;
  }
  const observationUserVersion = (db.pragma("user_version", { simple: true }) as number) | 0;
  return {
    fresh: names.size === 0,
    current,
    hasSessionTables: SESSION_SCHEMA_SENTINELS.some((t) => names.has(t)),
    storeMetaPresent,
    observationUserVersion,
  };
}

/** Result of one ensurePreMigrationBackup call — diagnostic surface for tests and doctor. */
export interface PreMigrationBackupOutcome {
  status: "skipped-fresh" | "skipped-current" | "skipped-no-session-data" | "skipped-existing-backup" | "backed-up";
  backupFile?: string;
  at?: string;
}

/**
 * Runs before any SQL the store constructors issue, on the database file.
 * `:memory:` and non-existent files return immediately (no data to protect).
 * Idempotent: a database already on the current layout, or one whose canonical
 * backup exists, is left untouched. The connection is a plain (non-readonly)
 * handle for three reasons: a bare `-wal` without `-shm` cannot be opened
 * readonly at all, the VACUUM must produce its output, and the publish step
 * takes the source DB's write lock. Outside the publish microsection only
 * SELECTs are issued.
 *
 * Brand-new installs stay quiet on purpose: openTaskRegistry detects "I am
 * the creator" (no session tables existed when probed — absent file, 0-byte
 * permission placeholder, even an observation-only database) and writes the
 * layout marker itself, so the CLI's register-then-engine order cannot
 * snapshot a table-only shell. The marker therefore never means "migration
  * ran" — for a created-from-scratch file it means "this structure was born
  * current", and idempotent bootstrap writes are not data to recover.
  *
  * Sessionless files (observation-only databases, e.g.) return
  * "skipped-no-session-data": the session assembly on them is purely
  * additive, so no snapshot is owed (see the gate comment for the waste this
  * prevents).
  *
  * @throws Error with an operator-actionable message when a legacy database
  *   cannot be snapshotted — the caller must refuse to assemble/migrate.
  */
export function ensurePreMigrationBackup(dbPath: string): PreMigrationBackupOutcome {
  if (!dbPath || dbPath === ":memory:") return { status: "skipped-fresh" };
  if (!existsSync(dbPath)) return { status: "skipped-fresh" };
  const backupFile = preMigrationBackupPath(dbPath);
  // Presence-only: an existing file is trusted as the recovery point and is
  // NEVER re-made or overwritten (see F: reuse). The deliberate boundary: if a
  // user manually plants a non-database file here, this step still passes and
  // the wrongness surfaces at manual-restore time (verifiable per the record's
  // sha256), which is a diagnosable manual dead end — not silent data loss —
  // and re-snapshooting to "fix" it would overwrite whatever the user placed.
  if (existsSync(backupFile)) return { status: "skipped-existing-backup" };

  let db: Database.Database | undefined;
  let tmpPath = "";
  // Same cold-start discipline as the store constructors (#257): during this
  // phase the connection waits only the short init timeout per attempt, and
  // busy/locked failures retry inside the bounded window. The contended-start
  // tests recognize the exhaustion through the cause chain and its message
  // shape ("still busy after N attempts (window 6000ms)"), so both the probe
  // and the VACUUM have to run as init retries — a bare SELECT would surface
  // SQLite's own "database is locked" after a 5s wait, which is not that.
  // Open and init are inside the try too: an unopenable file (no read
  // permission, unreadable directory) gets the same wrapped, actionable
  // message instead of a raw SQLITE_CANTOPEN.
  try {
    const conn = new Database(dbPath, { timeout: 5000 });
    db = conn;
    const initDeadline = beginInit(conn);
    const probe = withInitBusyRetry("pre-migration probe", () => probeLayout(conn), initDeadline);
    if (probe.fresh) return { status: "skipped-fresh" };
    if (probe.current) return { status: "skipped-current" };
    // Sessionless file (e.g. a database the observation store created on its
    // own): the session assembly here is purely additive — nothing existing
    // gets ALTERed or swapped — so there is no schema migration to build a
    // recovery point for. Snapshotting would copy the whole file every time
    // such a database was re-opened by a store it never shared structure with.
    if (!probe.hasSessionTables) return { status: "skipped-no-session-data" };

    // --- snapshot the original via SQLite's own backup path ---
    tmpPath = backupFile + tmpSuffix() + ".tmp";
    withInitBusyRetry("pre-migration backup", () => {
      // A previous failed attempt inside the retry loop leaves the target
      // behind and "VACUUM INTO" refuses to overwrite it — clear first.
      try { rmSync(tmpPath, { force: true }); } catch { /* nothing to clear */ }
      // The snapshot file is born with SQLite's default mode (0666&~umask) —
      // readable by others for the whole vacuum. Tighten the umask around it
      // so the tmp is owner-only from its first byte; the post-publish chmod
      // below covers only the canonical name. umask is process-global, but
      // this section is synchronous startup code and owns the only file
      // creation happening in this process right now (CodeRabbit round).
      const prevUmask = process.umask(0o077);
      try {
        conn.prepare("VACUUM INTO ?").run(tmpPath);
      } finally {
        process.umask(prevUmask);
      }
    }, initDeadline);

    // Snapshot captured; publish under the source DB's write lock — same
    // cross-process mutual exclusion the schema assembly already rides on
    // (sqlite-init), no lock files to go stale, released with the connection.
    // See the Concurrency header for the full ordering argument. On the
    // keep-theirs branch NOTHING downstream runs either: their JSON record
    // describes their snapshot, and ours would overwrite it while lying about
    // the bytes (the writeAtomicJson rename replaces). On rename the lock
    // makes it no-replace among compliant publishers; on lock exhaustion this
    // throws and the start fails closed — a machine where a backup cannot be
    // published must not migrate without one.
    let keptTheirs = false;
    withInitBusyRetry("pre-migration publish", () => {
      conn.exec("BEGIN IMMEDIATE");
      try {
        if (existsSync(backupFile)) {
          // Another starter's complete snapshot is already there — keep theirs,
          // record included.
          conn.exec("ROLLBACK");
          keptTheirs = true;
          return;
        }
        try {
          linkSync(tmpPath, backupFile);
        } catch {
          // No hard links here (exFAT, some network shares). Safe under the
          // lock: every compliant publisher must hold it to publish, so
          // "canonical absent" cannot change out from under this rename.
          renameSync(tmpPath, backupFile);
        }
        conn.exec("COMMIT");
      } catch (e) {
        try { conn.exec("ROLLBACK"); } catch { /* nothing to roll back */ }
        throw e;
      }
    }, initDeadline);
    try { rmSync(tmpPath, { force: true }); } catch { /* best effort; tmp names never collide */ }
    tmpPath = "";
    if (keptTheirs) return { status: "skipped-existing-backup" };
    try { chmodSync(backupFile, 0o600); } catch { /* best-effort (Windows ACL path) */ }

    // --- verifiable record (sha256 + size + source layout + honest claims) ---
    const at = new Date().toISOString();
    const record = {
      version: 1,
      db: dbPath,
      backupFile,
      createdAt: at,
      method: "sqlite-vacuum-into",
      bytes: statSync(backupFile).size,
      sha256: sha256File(backupFile),
      probedLayout: {
        storeMetaPresent: probe.storeMetaPresent,
        observationUserVersion: probe.observationUserVersion,
      },
      declaredCompatibleLayouts: VERIFIED_LAYOUT_SOURCES,
      afterLayout: STORE_LAYOUT_VERSION,
      manualRecovery: MANUAL_RECOVERY_NOTE,
    };
    try {
      writeAtomicJson(preMigrationRecordPath(dbPath), record);
    } catch (e) {
      // The backup itself exists and is verifiable on demand (sha256 can be
      // recomputed against the file). Losing the convenience record must not
      // fail a start that already has its recovery point.
      process.stderr.write(
        "[anysearch] 迁移前备份已完成，但记录文件写不进去（" + String(e instanceof Error ? e.message : e) +
        "）；备份本体在 " + backupFile + "，没有受影响。\n",
      );
    }
    return { status: "backed-up", backupFile, at };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // `cause` rides along on purpose: contended-start tests (fk-restore's held
    // EXCLUSIVE lock, coldstart-locks' long lock) recognize the startup
    // failure through isBusyRetryExhausted and the sqlite-init message shape,
    // which reads the cause chain — an honest busy exhaustion must stay one,
    // and the original message stays inline so its shape stays discoverable.
    const wrapped = new Error(
      "旧版数据库需要先做迁移前备份，但备份失败了：" + detail +
      "。没有恢复依据就不会改数据库；请检查对 " + dbPath + " 所在目录的写权限和磁盘空间，修好后重试。",
      { cause: error },
    );
    (wrapped as { code?: unknown }).code = (error as { code?: unknown })?.code;
    throw wrapped;
  } finally {
    try { if (tmpPath) rmSync(tmpPath, { force: true }); } catch { /* best effort */ }
    if (db) {
      try { endInit(db); } catch { /* connection may already be closing */ }
      db.close();
    }
  }
}

/**
 * #309: a deliberate snapshot of the CURRENT database, before a destructive
 * operation that is not a schema migration (pruning old task history).
 *
 * Deliberately separate from `ensurePreMigrationBackup`, whose job is the
 * opposite: that one only copies a LEGACY file, and never re-snapshots a
 * current one (its idempotent-replay contract). Pruning wants a fresh recovery
 * point every time an operator asks to delete data, so this one always writes a
 * new file and never overwrites an existing one — a timestamped name keeps
 * several prunes from clobbering each other's evidence.
 *
 * Same snapshot mechanism as the migration path (`VACUUM INTO`, never a file
 * copy — see the header), same verifiable record, same manual-restore note.
 *
 * @returns the snapshot path and what it captured.
 * @throws when no snapshot can be produced: the caller must not delete data
 *   without one.
 */
export function snapshotBeforeDestructiveOp(dbPath: string, label: string): { backupFile: string; bytes: number; sha256: string } {
  if (!dbPath || dbPath === ":memory:") {
    throw new Error("cannot snapshot an in-memory database; nothing to recover to");
  }
  if (!existsSync(dbPath)) {
    throw new Error("cannot snapshot " + dbPath + ": the file does not exist");
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = dbPath + "." + label + "-" + stamp + ".db";
  let db: Database.Database | undefined;
  try {
    // Tracked opener, unlike the migration path above: this runs from a command
    // (`ans upgrade prune`) that keeps living after the snapshot, so the handle
    // must be visible to the exit path if something goes wrong mid-snapshot.
    const conn = openDatabase(dbPath, { timeout: 5000 });
    db = conn;
    const initDeadline = beginInit(conn);
    const prevUmask = process.umask(0o077);
    try {
      withInitBusyRetry("destructive-op snapshot", () => {
        // A previous attempt inside the retry loop leaves the target behind, and
        // then "VACUUM INTO" fails with "output file already exists" — which is
        // not a busy error, so the retry stops and the real cause (a locked
        // database) is replaced by a misleading one. Clear it first, the same
        // step the migration path takes.
        try { rmSync(backupFile, { force: true }); } catch { /* nothing to clear */ }
        conn.prepare("VACUUM INTO ?").run(backupFile);
      }, initDeadline);
    } finally {
      process.umask(prevUmask);
    }
    endInit(conn);
    try { chmodSync(backupFile, 0o600); } catch { /* best-effort (Windows ACL path) */ }
    const bytes = statSync(backupFile).size;
    const sha256 = sha256File(backupFile);
    const at = new Date().toISOString();
    try {
      writeAtomicJson(backupFile + ".json", {
        version: 1,
        db: dbPath,
        backupFile,
        createdAt: at,
        method: "sqlite-vacuum-into",
        reason: label,
        bytes,
        sha256,
        manualRecovery: MANUAL_RECOVERY_NOTE,
      });
    } catch (e) {
      // Same rule as the migration path: a snapshot without its record is still
      // verifiable (sha256 can be recomputed), so this must not fail the
      // operation — but it must not be silent either, or a later reader sees a
      // .db with no .json and cannot tell "never written" from "written and lost".
      process.stderr.write(
        "[anysearch] 恢复存档点已建好，但记录文件写不进去（" + String(e instanceof Error ? e.message : e) +
        "）；快照本体在 " + backupFile + "，没有受影响。\n",
      );
    }
    return { backupFile, bytes, sha256 };
  } catch (error) {
    // A half-written snapshot sitting next to the live database looks exactly
    // like a valid recovery point and carries no .json record; remove it so the
    // failure cannot be mistaken for evidence.
    try { rmSync(backupFile, { force: true }); } catch { /* best effort */ }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      "建立恢复存档点失败：" + detail +
      "。没有恢复依据就不删数据；请检查对 " + dbPath + " 所在目录的写权限和磁盘空间。",
      { cause: error },
    );
  } finally {
    if (db) {
      try { endInit(db); } catch { /* already ended */ }
      try { db.close(); } catch { /* already closed */ }
    }
  }
}

/**
 * #323: publish a consistent copy of `from` at `to` for the directory rename.
 *
 * Same mechanism as the pre-migration snapshot (`VACUUM INTO`, never a file
 * copy): the source may be a live WAL database held open by a running server,
 * and a plain copy would miss committed pages still in `-wal`. The source is
 * left untouched — the rename keeps the old file as the pre-upgrade copy, and
 * deleting it is the operator's call, not this function's.
 *
 * @throws when no copy can be produced. The caller must not treat the new
 *   directory as authoritative in that case; the old database stays in use.
 */
export function adoptDatabase(from: string, to: string): { bytes: number; sha256: string } {
  if (!existsSync(from)) throw new Error("cannot adopt " + from + ": the file does not exist");
  if (existsSync(to)) throw new Error("cannot adopt " + from + ": " + to + " already exists");
  let db: Database.Database | undefined;
  /** Set only while this call owns `to`, so a failure never deletes another process's snapshot. */
  let written = false;
  try {
    const conn = openDatabase(from, { timeout: 5000 });
    db = conn;
    const initDeadline = beginInit(conn);
    const prevUmask = process.umask(0o077);
    try {
      withInitBusyRetry("layout adoption", () => {
        // A process that held the lock first may have published the snapshot
        // while this one waited. Its file is the winner and this one stops:
        // vacuuming over it would replace a completed copy with a second one,
        // the swap this module's publish path refuses to make. VACUUM INTO
        // either completes or fails atomically, so an existing file here is
        // never a torn leftover from a crashed attempt.
        if (existsSync(to)) {
          written = false;
          return;
        }
        written = true;
        conn.prepare("VACUUM INTO ?").run(to);
      }, initDeadline);
    } finally {
      process.umask(prevUmask);
    }
    endInit(conn);
    try { chmodSync(to, 0o600); } catch { /* best-effort (Windows ACL path) */ }
    return { bytes: statSync(to).size, sha256: sha256File(to) };
  } catch (error) {
    // A half-written copy next to the live database looks like a valid one;
    // remove it so the failure cannot be mistaken for a finished move. Only
    // this call's own file: a copy another process published is its result,
    // and deleting it would destroy the recovery point this module promises.
    if (written) {
      try { rmSync(to, { force: true }); } catch { /* best effort */ }
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      "把 " + from + " 复制到 " + to + " 失败：" + detail +
      "。旧库原样保留，本次继续用旧库；检查 " + dirname(to) + " 的写权限和磁盘空间后重试。",
      { cause: error },
    );
  } finally {
    if (db) {
      try { endInit(db); } catch { /* already ended */ }
      try { db.close(); } catch { /* already closed */ }
    }
  }
}

/**
 * Marks the database as being on the current store layout — called by the
 * session store constructor AFTER the schema/ALTER assembly has committed, so
 * the marker can never claim a layout that was never finished. Idempotent.
 */
export function writeStoreLayout(db: Database.Database): void {
  const upsertMeta = db.prepare(
    "INSERT INTO store_meta (key, value) VALUES (?, ?) " +
    "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  );
  upsertMeta.run(STORE_LAYOUT_KEY, STORE_LAYOUT_VERSION);
  upsertMeta.run("store_layout_written_at", new Date().toISOString());
}

/** Read-side layout summary used by doctor and tests. Probe is SELECT-only. */
export type MigrationLayoutStatus = "memory" | "absent" | "fresh" | "current" | "legacy" | "sessionless" | "unknown";

export interface MigrationStatus {
  dbExists: boolean;
  backupExists: boolean;
  record?: { createdAt: string; sha256: string; bytes: number };
  layout: MigrationLayoutStatus;
  error?: string;
}

/**
 * Diagnostics for `ans doctor`: reports what is on disk without assembling,
 * migrating, or writing anything. The connection is READ-ONLY: closing a
 * writable handle can checkpoint a post-crash WAL and thereby modify the
 * database being probed (CodeRabbit round). A leftover -wal without -shm
 * genuinely cannot be opened read-only (recovery needs write access); that
 * state is reported as "unknown" with the reason — a probe that cannot see,
 * rather than a probe that works around by mutating.
 */
export function readMigrationStatus(dbPath: string): MigrationStatus {
  if (!dbPath || dbPath === ":memory:") return { dbExists: false, backupExists: false, layout: "memory" };
  const backupExists = existsSync(preMigrationBackupPath(dbPath));
  if (!existsSync(dbPath)) return { dbExists: false, backupExists, layout: "absent" };
  let db: Database.Database | undefined;
  try {
    const conn = new Database(dbPath, { readonly: true, timeout: 5000 });
    db = conn;
    const probe = probeLayout(conn);
    const layout: MigrationLayoutStatus = probe.fresh
      ? "fresh"
      : probe.current
        ? "current"
        : probe.hasSessionTables
          ? "legacy"
          : "sessionless";
    let record: { createdAt: string; sha256: string; bytes: number } | undefined;
    const recordPath = preMigrationRecordPath(dbPath);
    if (existsSync(recordPath)) {
      try {
        const parsed = JSON.parse(readFileSync(recordPath, "utf8")) as {
          createdAt?: string; sha256?: string; bytes?: number;
        };
        if (typeof parsed.createdAt === "string" && typeof parsed.sha256 === "string" && typeof parsed.bytes === "number") {
          record = { createdAt: parsed.createdAt, sha256: parsed.sha256, bytes: parsed.bytes };
        }
      } catch { /* unreadable record shows as absent; doctor says which file */ }
    }
    return { dbExists: true, backupExists, record, layout };
  } catch (e) {
    // A file the read-only connection cannot read is its own diagnostic state
    // (typically a leftover -wal from a crashed process, or a non-database
    // file — SQLite defers that discovery to the first query); doctor prints
    // this instead of pretending to know the layout, or mutating the files to
    // find out.
    return {
      dbExists: true,
      backupExists,
      layout: "unknown",
      error: String(e instanceof Error ? e.message : e),
    };
  } finally {
    if (db) {
      try { db.close(); } catch { /* already closed */ }
    }
  }
}

/** Collision-proof suffix for throwaway files this process creates (pid + uuid). */
function tmpSuffix(): string {
  return "." + process.pid + "." + randomUUID().slice(0, 8);
}

function writeAtomicJson(path: string, value: unknown): void {
  const tmp = path + tmpSuffix();
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
}

function sha256File(path: string): string {
  const h = createHash("sha256");
  const buf = Buffer.alloc(1024 * 1024);
  const fd = openSync(path, "r");
  try {
    let read: number;
    while ((read = readSync(fd, buf, 0, buf.length, null)) > 0) {
      h.update(buf.subarray(0, read));
    }
  } finally {
    closeSync(fd);
  }
  return h.digest("hex");
}
