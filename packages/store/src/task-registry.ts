// #302: the task registry — process records and business-task records for a
// main program, kept in the shared durable DB so a later upgrade coordinator
// (#309) can ask "who is still working?" across processes.
//
// Two tables, two lifetimes, on purpose. A running process (task_records'
// owner, or a resident MCP server) is a fact about a machine; an active task
// is a fact about work that must finish before an upgrade replaces files.
// Registering them separately is what stops a resident MCP server's whole
// lifetime from reading as one permanently-unfinished "task": the server is a
// process row, and its business work (per-request tasks, #303) is what
// finishes.
//
// Honesty rules carried over from the budget layer:
// - a task that never wrote its end is NOT cleaned up here. It stays as an
//   open row with its owner pid; the reader probes the pid and says
//   "running" / "owner gone, outcome unknown" instead of guessing. Unknown
//   leftovers are upgrade blockers to report (#309), not rows to sweep.
// - only a provably dead owner (ESRCH, same host) reads as dead — the rule
//   pidIsAlive states and the session lock applies.
// - management/diagnostic commands register too, with role='management', so
//   an admission pause can keep them usable (#309 reads the role; this layer
//   only records it).

import type Database from "better-sqlite3";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./db";
import { beginInit, endInit, execDdlAtomically, withInitBusyRetry } from "./sqlite-init";
import { pidIsAlive } from "./budget-ledger";
import { SCHEMA_SQL } from "./schema-content";
// #310: the registry can be the FIRST opener of a durable database (the main
// program registers its task before any command builds an engine), so the
// same snapshot-before-assembly rule applies here when the file already
// exists. A registry that CREATES the file instead writes the layout marker
// itself: the database it just built IS the current schema, full stop. That
// is what stops a brand-new install's first `ans chat` from snapshotting a
// table-only shell the engine would otherwise (correctly but uselessly) see
// as "structure without a marker — snapshot before altering". A file opened
// by an older build keeps the no-marker rule: the later session-store open
// finds the backup the registry took and skips its own.
import { ensurePreMigrationBackup, writeStoreLayout } from "./migration-backup";

/** What the task row says about the work it names. */
export type TaskRole = "business" | "management";

export interface TaskRegistryOptions {
  /** Owner identity for rows this registry writes. Defaults to this process. */
  owner?: { pid: number; host: string };
  /** Liveness probe for a same-host owner; injected so tests need no real kill. */
  isOwnerAlive?: (pid: number) => boolean;
  /**
   * #303: whether this registry opened the connection it writes through.
   * `openTaskRegistry` owns its handle; a registry borrowed from the session
   * store (#303) does not, and closing the engine's database out from under it
   * would break every later query. Defaults to true.
   */
  ownsConnection?: boolean;
}

export interface TaskRecordRow {
  taskId: string;
  kind: string;
  role: TaskRole;
  entry: string;
  ownerPid: number;
  ownerHost: string;
  /** Best-effort context handle, attached while the task was running. */
  sessionId: string | null;
  startedAt: string;
  /** NULL = still running, or crashed before finishing. */
  endedAt: string | null;
  exitCode: number | null;
}

export interface ProcessRecordRow {
  id: number;
  pid: number;
  ownerHost: string;
  entry: string;
  startedAt: string;
  /** NULL = still running. */
  endedAt: string | null;
}

/** An open task and how to end it. `finish` is idempotent (a second call is a no-op). */
export interface RegisteredTask {
  taskId: string;
  /** Attach the context handle (session id) the task ran under, best-effort. */
  attachSession(sessionId: string): void;
  /** Record the task's end. Success and failure both end a task; the code says which. */
  finish(opts?: { exitCode?: number }): void;
}

/** An open process record and how to close it. */
export interface RegisteredProcess {
  end(): void;
}

export class TaskRegistry {
  private stmts: {
    insertTask: Database.Statement;
    finishTask: Database.Statement;
    attachSession: Database.Statement;
    taskById: Database.Statement;
    openTasks: Database.Statement;
    insertProcess: Database.Statement;
    endProcess: Database.Statement;
    openProcesses: Database.Statement;
  };
  private readonly owner: { pid: number; host: string };
  private readonly isOwnerAlive: (pid: number) => boolean;
  private readonly ownsConnection: boolean;

  constructor(private db: Database.Database, opts: TaskRegistryOptions = {}) {
    this.owner = opts.owner ?? { pid: process.pid, host: hostname() };
    this.isOwnerAlive = opts.isOwnerAlive ?? pidIsAlive;
    this.ownsConnection = opts.ownsConnection ?? true;
    this.stmts = {
      // ended_at IS NULL in the WHERE keeps `finish` from rewriting history:
      // a task that already reported its end keeps the code it ended with.
      insertTask: db.prepare(
        "INSERT INTO task_records (task_id, kind, role, entry, owner_pid, owner_host) VALUES (?, ?, ?, ?, ?, ?)",
      ),
      finishTask: db.prepare(
        "UPDATE task_records SET ended_at = datetime('now'), exit_code = ? WHERE task_id = ? AND ended_at IS NULL",
      ),
      // Only while running: attaching to finished history would silently
      // rewrite what the task was recorded against.
      attachSession: db.prepare(
        "UPDATE task_records SET session_id = ? WHERE task_id = ? AND ended_at IS NULL",
      ),
      taskById: db.prepare(
        "SELECT task_id as taskId, kind, role, entry, owner_pid as ownerPid, owner_host as ownerHost, session_id as sessionId, started_at as startedAt, ended_at as endedAt, exit_code as exitCode FROM task_records WHERE task_id = ?"
      ),
      openTasks: db.prepare(
        "SELECT task_id as taskId, kind, role, entry, owner_pid as ownerPid, owner_host as ownerHost, session_id as sessionId, started_at as startedAt, ended_at as endedAt, exit_code as exitCode FROM task_records WHERE ended_at IS NULL ORDER BY started_at"
      ),
      insertProcess: db.prepare(
        "INSERT INTO process_records (pid, owner_host, entry) VALUES (?, ?, ?)",
      ),
      endProcess: db.prepare(
        "UPDATE process_records SET ended_at = datetime('now') WHERE id = ? AND ended_at IS NULL",
      ),
      openProcesses: db.prepare(
        "SELECT id, pid, owner_host as ownerHost, entry, started_at as startedAt, ended_at as endedAt FROM process_records WHERE ended_at IS NULL ORDER BY started_at",
      ),
    };
  }

  /**
   * Register one business/management task of this process.
   *
   * The id is minted here so the caller cannot invent one the registry never
   * wrote (task_budgets' foreign key depends on exactly that: a budget row
   * names a task that exists).
   */
  registerTask(req: { kind: string; role: TaskRole; entry: string; sessionId?: string }): RegisteredTask {
    const taskId = req.entry + "-" + randomUUID();
    this.stmts.insertTask.run(taskId, req.kind, req.role, req.entry, this.owner.pid, this.owner.host);
    if (req.sessionId) this.stmts.attachSession.run(req.sessionId, taskId);
    let finished = false;
    return {
      taskId,
      attachSession: (sessionId: string): void => {
        this.stmts.attachSession.run(sessionId, taskId);
      },
      finish: (opts?: { exitCode?: number }): void => {
        if (finished) return;
        finished = true;
        this.stmts.finishTask.run(opts?.exitCode ?? 0, taskId);
      },
    };
  }

  /** Register this process's own lifetime as a process record. */
  registerProcess(req: { entry: string }): RegisteredProcess {
    const info = this.stmts.insertProcess.run(this.owner.pid, this.owner.host, req.entry);
    const id = Number(info.lastInsertRowid);
    let ended = false;
    return {
      end: (): void => {
        if (ended) return;
        ended = true;
        this.stmts.endProcess.run(id);
      },
    };
  }

  taskById(taskId: string): TaskRecordRow | null {
    return (this.stmts.taskById.get(taskId) as TaskRecordRow | undefined) ?? null;
  }

  /** The owner probe both open-lists share: alive / dead / unknown, no guess. */
  private probeOwnerState(host: string, pid: number): "alive" | "dead" | "unknown" {
    if (host !== this.owner.host) return "unknown";
    return this.isOwnerAlive(pid) ? "alive" : "dead";
  }

  /**
   * Unfinished tasks, with the owner probe folded in: `ownerState` is
   * 'alive' (same host, running), 'dead' (same host, provably gone) or
   * 'unknown' (another host — this machine cannot confirm). A dead-owner row
   * is left as-is on purpose: clearing it would assert "the task ended" on no
   * evidence; reporting it is the honest reading an upgrade can block on.
   */
  openTasks(): Array<TaskRecordRow & { ownerState: "alive" | "dead" | "unknown" }> {
    const rows = this.stmts.openTasks.all() as TaskRecordRow[];
    return rows.map((row) => ({ ...row, ownerState: this.probeOwnerState(row.ownerHost, row.ownerPid) }));
  }

  /** Unfinished process records, same owner-probe annotation as openTasks. */
  openProcesses(): Array<ProcessRecordRow & { ownerState: "alive" | "dead" | "unknown" }> {
    const rows = this.stmts.openProcesses.all() as ProcessRecordRow[];
    return rows.map((row) => ({ ...row, ownerState: this.probeOwnerState(row.ownerHost, row.pid) }));
  }

  /**
   * Close the connection this registry OWNS. A borrowed registry (the session
   * store's seam, #303) refuses instead of tearing the engine's database out
   * from under it — a loud error beats a silently broken store.
   */
  close(): void {
    if (!this.ownsConnection) {
      throw new Error(
        "this task registry borrows the store's connection — close the store instead",
      );
    }
    this.db.close();
  }
}

/**
 * Open the shared registry on its own connection.
 *
 * Same cold-start discipline as the session store (bounded busy retry, WAL,
 * foreign keys, the one-transaction schema application): the registry can be
 * the FIRST opener of a brand-new database — the main program registers a
 * task before any command builds its engine — so it must be able to create
 * every table the schema owns, not just its own three. Running the whole
 * idempotent script keeps the two openers from drifting apart.
 */
export function openTaskRegistry(dbPath: string, opts: TaskRegistryOptions = {}): TaskRegistry {
  // #310: a pre-existing legacy file gets the snapshot-before-assembly rule
  // (see the import comment); a fresh/absent one takes no snapshot. The
  // outcome is ALSO the creator signal: "skipped-fresh" means the database
  // held no user tables when probed — absent, 0-byte, header-only, whatever.
  // That is exactly "every table that will exist after this call is mine",
  // which is what earning the layout marker means. existsSync alone was
  // wrong for this: the CLI's permission hygiene (ensureOwnerOnlyDb) creates
  // a 0-byte placeholder file BEFORE the registry opens, so "file exists" is
  // not "someone else owns its structure" (CI-caught on ubuntu, lane F).
  const pre = ensurePreMigrationBackup(dbPath);
  const isCreator = dbPath !== ":memory:"
    && (pre.status === "skipped-fresh" || pre.status === "skipped-no-session-data");
  const db = openDatabase(dbPath, { timeout: 5000 });
  const initDeadline = beginInit(db);
  withInitBusyRetry("journal_mode", () => db.pragma("journal_mode = WAL"), initDeadline);
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  let schema: string;
  try {
    // ESM dev mode: schema.sql sits next to the compiled module; CJS bundled
    // mode has no import.meta and uses the inlined copy (same source as the
    // session store).
    const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");
    schema = readFileSync(schemaPath, "utf8");
  } catch {
    schema = SCHEMA_SQL;
  }
  if (isCreator) {
    // The creator just builds the complete current schema — the marker is not
    // a claim about column migrations that ran, it is a claim about structure,
    // and the structure is current. Schema AND marker commit in ONE immediate
    // transaction on purpose: a concurrent prober never observes a created
    // database with tables but no marker (that shape — if it could occur — is
    // what the snapshot rule treats as legacy, i.e. a bogus shell backup).
    withInitBusyRetry("schema", () => {
      db.transaction((): void => {
        db.exec(schema);
        writeStoreLayout(db);
      }).immediate();
    }, initDeadline);
  } else {
    withInitBusyRetry("schema", () => execDdlAtomically(db, schema), initDeadline);
  }
  endInit(db);
  return new TaskRegistry(db, opts);
}
