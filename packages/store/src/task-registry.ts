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
import { beginInit, endInit, execDdlAtomically, isDuplicateColumnError, withInitBusyRetry } from "./sqlite-init";
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

/**
 * #309: a task registration refused because an upgrade closed admission.
 *
 * It is its own error type, not a generic throw, because every entry must tell
 * "this did not start" apart from "this failed": the caller refuses the run and
 * says so (`errorKind: "upgrade-in-progress"` on MCP, a named exit on the CLI),
 * and it must never be mistaken for a broken registry (which fails open) or an
 * upstream failure (which retries).
 */
export class AdmissionClosedError extends Error {
  readonly gate: UpgradeGateState;
  constructor(gate: UpgradeGateState) {
    super(
      "upgrade in progress: new task admission is closed (" +
      "gate " + gate.gateId + " opened " + gate.openedAt +
      " by pid " + gate.openedByPid + " on " + gate.openedByHost +
      ") — refused, not queued. " +
      "If no upgrade is actually running (a paused `ans upgrade wait` was interrupted): ans upgrade cancel",
    );
    this.name = "AdmissionClosedError";
    this.gate = gate;
  }
}

/** #309: the open admission gate as a reader sees it. */
export interface UpgradeGateState {
  gateId: string;
  openedAt: string;
  openedByPid: number;
  openedByHost: string;
  note: string | null;
}

/**
 * Where a task row came from (#307).
 *
 * - `independent`: work a caller asked for (a command, one tool call).
 * - `follow-up`: work that exists because another request finished — a hook's
 *   project-index write, the policy audit that rides a /policy read. It may
 *   start after its parent ended; that is what post-work looks like, and it is
 *   still work an upgrade must wait out.
 */
export type TaskOrigin = "independent" | "follow-up";

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

/**
 * How long an ENDED row is kept, for BOTH registry tables (#309, #343). One
 * window, because two would drift the first time someone tuned one.
 *
 * Ended rows are history: 30 days answers "what ran last month" and keeps the
 * tables bounded. Open TASK rows are never pruned at any age — they are the
 * blocking criterion. Open PROCESS rows survive too, unless this host can prove
 * the pid is gone (see `processPrunePlan`). Dismissed rows are kept: the
 * dismissal is the only evidence a human looked at them.
 *
 * Pruning is never automatic. Only an operator's `ans upgrade prune` deletes,
 * and it snapshots first.
 */
export const HISTORY_RETENTION_DAYS = 30;

export interface TaskRecordRow {
  taskId: string;
  kind: string;
  role: TaskRole;
  entry: string;
  ownerPid: number;
  ownerHost: string;
  /** Best-effort context handle, attached while the task was running. */
  sessionId: string | null;
  /** #307: independent work or post-work of another task. */
  origin: TaskOrigin;
  /** #307: the task this follow-up belongs to, or null when it could not be named. */
  parentTaskId: string | null;
  startedAt: string;
  /** NULL = still running, or crashed before finishing. */
  endedAt: string | null;
  exitCode: number | null;
  /** #309: an operator acknowledged this open row; it is not a blocker any more. */
  dismissedAt: string | null;
  dismissedReason: string | null;
}

export interface ProcessRecordRow {
  id: number;
  pid: number;
  ownerHost: string;
  entry: string;
  /**
   * #311: the build this process started on. `null` for a build made before the
   * column existed — reported as unknown, never back-filled from disk.
   */
  build: string | null;
  startedAt: string;
  /** NULL = still running. */
  endedAt: string | null;
}

/**
 * #343: why this host may delete a process row.
 *
 * `closed-aged` — the process wrote its end, and the row is past the window.
 * `open-gone-aged` — the row is past the window AND this host proved the pid is
 * no longer running (the crash case: the host killed the child before it could
 * write its end).
 */
export type ProcessPruneReason = "closed-aged" | "open-gone-aged";

/**
 * #343: one pass of the process-table cleanup, as decisions rather than actions
 * so `--dry-run` and the real run read the same one. The kept side is counts,
 * not rows: every caller reports "why these stay" as a number.
 */
export interface ProcessPrunePlan {
  /** Rows this host can delete, with the reason each one qualified. */
  deletable: Array<{ row: ProcessRecordRow; reason: ProcessPruneReason }>;
  /** Rows too young to touch, whatever their state. */
  withinWindow: number;
  /** Open rows whose pid is still in use: kept, because the pid may be reused. */
  pidInUse: number;
  /** Open rows from another host: this machine cannot prove anything about them. */
  otherHost: number;
}

/** An open task and how to end it. `finish` is idempotent (a second call is a no-op). */
export interface RegisteredTask {
  taskId: string;
  /**
   * #307: how the parent link landed. `"linked"` = the named parent row exists
   * and this follow-up points at it; `"unknown"` = a parent was named but no
   * such row exists (another host, a pruned database, a typo), so the row
   * records no link rather than a dangling one. `"none"` = independent work.
   */
  parentLink: "linked" | "unknown" | "none";
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
    gate: Database.Statement;
    openGate: Database.Statement;
    closeGate: Database.Statement;
    adoptGate: Database.Statement;
    dismissTask: Database.Statement;
    dismissableTasks: Database.Statement;
    agedFinishedTasks: Database.Statement;
    agedFinishedTasksHeldByChildren: Database.Statement;
    allTaskIds: Database.Statement;
    parentReferences: Database.Statement;
    pruneFinishedTasks: Database.Statement;
    // #343: the process table's cleanup. Rows are picked by age+state, then
    // deleted one id at a time under the SAME predicate — a row that changed
    // between the plan and the delete (its owner wrote the end) simply does not
    // match any more, which is the safe direction.
    agedClosedProcesses: Database.Statement;
    agedOpenProcesses: Database.Statement;
    inWindowProcesses: Database.Statement;
    deleteProcessRow: Database.Statement;
  };
  private readonly owner: { pid: number; host: string };
  private readonly isOwnerAlive: (pid: number) => boolean;
  private readonly ownsConnection: boolean;

  constructor(private db: Database.Database, opts: TaskRegistryOptions = {}) {
    this.owner = opts.owner ?? { pid: process.pid, host: hostname() };
    this.isOwnerAlive = opts.isOwnerAlive ?? pidIsAlive;
    this.ownsConnection = opts.ownsConnection ?? true;
    const taskColumns =
      "task_id as taskId, kind, role, entry, owner_pid as ownerPid, owner_host as ownerHost, " +
      "session_id as sessionId, origin, parent_task_id as parentTaskId, started_at as startedAt, " +
      "ended_at as endedAt, exit_code as exitCode, dismissed_at as dismissedAt, dismissed_reason as dismissedReason";
    const processColumns =
      "id, pid, owner_host as ownerHost, entry, build, started_at as startedAt, ended_at as endedAt";
    this.stmts = {
      // ended_at IS NULL in the WHERE keeps `finish` from rewriting history:
      // a task that already reported its end keeps the code it ended with.
      insertTask: db.prepare(
        "INSERT INTO task_records (task_id, kind, role, entry, owner_pid, owner_host, origin, parent_task_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ),
      finishTask: db.prepare(
        "UPDATE task_records SET ended_at = datetime('now'), exit_code = ? WHERE task_id = ? AND ended_at IS NULL",
      ),
      // Only while running: attaching to finished history would silently
      // rewrite what the task was recorded against.
      attachSession: db.prepare(
        "UPDATE task_records SET session_id = ? WHERE task_id = ? AND ended_at IS NULL",
      ),
      taskById: db.prepare("SELECT " + taskColumns + " FROM task_records WHERE task_id = ?"),
      openTasks: db.prepare("SELECT " + taskColumns + " FROM task_records WHERE ended_at IS NULL ORDER BY started_at"),
      insertProcess: db.prepare(
        "INSERT INTO process_records (pid, owner_host, entry, build) VALUES (?, ?, ?, ?)",
      ),
      endProcess: db.prepare(
        "UPDATE process_records SET ended_at = datetime('now') WHERE id = ? AND ended_at IS NULL",
      ),
      openProcesses: db.prepare(
        "SELECT " + processColumns + " FROM process_records WHERE ended_at IS NULL ORDER BY started_at",
      ),
      gate: db.prepare(
        "SELECT gate_id as gateId, opened_at as openedAt, opened_by_pid as openedByPid, opened_by_host as openedByHost, note FROM upgrade_gate WHERE id = 1",
      ),
      openGate: db.prepare(
        "INSERT INTO upgrade_gate (id, gate_id, opened_by_pid, opened_by_host, note) VALUES (1, ?, ?, ?, ?) " +
        "ON CONFLICT (id) DO NOTHING",
      ),
      closeGate: db.prepare("DELETE FROM upgrade_gate WHERE id = 1"),
      // Takeover of a gate whose opener is provably gone: the pause stays, the
      // holder becomes the process that is actually waiting on it.
      adoptGate: db.prepare(
        "UPDATE upgrade_gate SET opened_by_pid = ?, opened_by_host = ?, note = COALESCE(?, note) WHERE id = 1 AND gate_id = ?",
      ),
      // A dismissal never writes ended_at: the row stays open and keeps its
      // owner, and the reason says a human made the call. A task that finished
      // in the meantime cannot be dismissed (nothing to dismiss).
      dismissTask: db.prepare(
        "UPDATE task_records SET dismissed_at = datetime('now'), dismissed_reason = ? WHERE task_id = ? AND ended_at IS NULL AND dismissed_at IS NULL",
      ),
      dismissableTasks: db.prepare(
        "SELECT " + taskColumns + " FROM task_records WHERE ended_at IS NULL AND dismissed_at IS NULL ORDER BY started_at",
      ),
      // #309: audit history past the retention window. `ended_at IS NOT NULL`
      // is load-bearing — an open row is the blocking criterion and must
      // survive any age.
      agedFinishedTasks: db.prepare(
        "SELECT task_id as taskId, kind, ended_at as endedAt FROM task_records " +
        "WHERE ended_at IS NOT NULL AND ended_at < datetime('now', ?) ORDER BY ended_at",
      ),
      // FK-safe on purpose: `parent_task_id` references this same table with no
      // ON DELETE action, so deleting a parent that a SURVIVING row still points
      // at aborts the whole transaction. Such parents are skipped instead of
      // having the live row's link rewritten — losing the attribution of an open
      // row is worse than keeping one old finished row.
      allTaskIds: db.prepare("SELECT task_id as taskId FROM task_records"),
      parentReferences: db.prepare(
        "SELECT task_id as taskId, parent_task_id as parentTaskId FROM task_records WHERE parent_task_id IS NOT NULL",
      ),
      pruneFinishedTasks: db.prepare(
        "DELETE FROM task_records WHERE ended_at IS NOT NULL AND ended_at < datetime('now', ?) " +
        "AND task_id NOT IN (SELECT parent_task_id FROM task_records WHERE parent_task_id IS NOT NULL)",
      ),
      agedFinishedTasksHeldByChildren: db.prepare(
        "SELECT COUNT(*) as n FROM task_records WHERE ended_at IS NOT NULL AND ended_at < datetime('now', ?) " +
        "AND task_id IN (SELECT parent_task_id FROM task_records WHERE parent_task_id IS NOT NULL)",
      ),
      // #343: same age rule as the task table, no parent links to respect (no
      // foreign key points at process_records, and `entry` is a free string).
      agedClosedProcesses: db.prepare(
        "SELECT " + processColumns + " FROM process_records " +
        "WHERE ended_at IS NOT NULL AND ended_at < datetime('now', ?) ORDER BY ended_at",
      ),
      // An open row's only timestamp is started_at, so that is its age.
      agedOpenProcesses: db.prepare(
        "SELECT " + processColumns + " FROM process_records " +
        "WHERE ended_at IS NULL AND started_at < datetime('now', ?) ORDER BY started_at",
      ),
      // Rows that are still history-in-the-making: too young to delete. Counted
      // only, because reporting them one by one is what this ticket exists to stop.
      inWindowProcesses: db.prepare(
        "SELECT COUNT(*) as n FROM process_records WHERE " +
        "(ended_at IS NOT NULL AND ended_at >= datetime('now', ?)) OR " +
        "(ended_at IS NULL AND started_at >= datetime('now', ?))",
      ),
      // One statement, both reasons: the age predicate is written ONCE, so
      // changing the window cannot leave the preview and the delete disagreeing.
      // A row that changed state since the plan no longer matches, and stays.
      deleteProcessRow: db.prepare(
        "DELETE FROM process_records WHERE id = ? AND (" +
        "(ended_at IS NOT NULL AND ended_at < datetime('now', ?)) OR " +
        "(ended_at IS NULL AND started_at < datetime('now', ?)))",
      ),
    };
  }

  /**
   * Register one business/management task of this process.
   *
   * The id is minted here so the caller cannot invent one the registry never
   * wrote (task_budgets' foreign key depends on exactly that: a budget row
   * names a task that exists).
   *
   * #307: `origin: "follow-up"` plus `parentTaskId` records work that exists
   * because another task finished. The parent id comes from outside this
   * process, so it is VERIFIED before it is written: a parent row that does not
   * exist is recorded as no link (`parentLink: "unknown"`) instead of a dangling
   * reference or a made-up id.
   */
  registerTask(req: {
    kind: string;
    role: TaskRole;
    entry: string;
    sessionId?: string;
    origin?: TaskOrigin;
    parentTaskId?: string;
  }): RegisteredTask {
    const taskId = req.entry + "-" + randomUUID();
    const origin: TaskOrigin = req.origin ?? "independent";
    // A parent id on INDEPENDENT work is a caller bug: nothing links a root task
    // to another root. Say so instead of dropping it silently — the caller then
    // sees a thrown error, not a row that quietly lost its attribution.
    if (origin !== "follow-up" && req.parentTaskId) {
      throw new Error(
        "registerTask: parentTaskId is only meaningful for follow-up work (kind=" + req.kind +
        ", origin=" + origin + "); pass origin: \"follow-up\" or omit the parent",
      );
    }
    // The parent id comes from outside this process, so it is verified before it
    // is written: a row that does not exist here records NO link.
    let parentTaskId: string | null = null;
    let parentLink: RegisteredTask["parentLink"] = "none";
    if (req.parentTaskId) {
      if (this.taskById(req.parentTaskId)) {
        parentTaskId = req.parentTaskId;
        parentLink = "linked";
      } else {
        parentLink = "unknown";
      }
    }
    // #309: the gate read and the row insert are ONE immediate transaction, so
    // a task can never start on a reading an upgrade already invalidated. This
    // is the "check then start" hole the ticket names: without the transaction,
    // an upgrade could close admission between our SELECT and our INSERT and
    // wait forever on work it never admitted.
    //
    // Who is admitted while the gate is open: management work (the commands
    // that report and drive the upgrade itself) and follow-up work of requests
    // that were already accepted (their tails must finish — dropping them is
    // the data loss the gate exists to avoid). Everyone else is refused, and
    // the refusal is an error, never a queue and never an auto-replay.
    const admittedOn = (): UpgradeGateState | null => {
      if (req.role === "management" || origin === "follow-up") return null;
      return this.gateState();
    };
    const gate = this.db.transaction((): UpgradeGateState | null => {
      const open = admittedOn();
      if (open) return open;
      this.stmts.insertTask.run(taskId, req.kind, req.role, req.entry, this.owner.pid, this.owner.host, origin, parentTaskId);
      return null;
    }).immediate();
    if (gate) throw new AdmissionClosedError(gate);
    if (req.sessionId) this.stmts.attachSession.run(req.sessionId, taskId);
    let finished = false;
    return {
      taskId,
      parentLink,
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

  /** #309: the open admission gate, or null when admission is open. */
  gateState(): UpgradeGateState | null {
    return (this.stmts.gate.get() as UpgradeGateState | undefined) ?? null;
  }

  /**
   * #309: close admission. Idempotent — a second call keeps the gate that is
   * already open (and its identity), because "there is an upgrade in progress"
   * is the fact both callers want, and swapping the gate id mid-flight would
   * make waiters unable to say which pause they observed.
   */
  openGate(req: { note?: string } = {}): UpgradeGateState {
    const existing = this.gateState();
    if (existing) {
      // A gate left behind by an interrupted `wait` still names the process that
      // died. Returning it unchanged would make this call announce a pause whose
      // holder does not exist, and the diagnostics would keep saying "nobody is
      // upgrading" while a fresh wait is sitting right there. Only a provably
      // dead same-host owner is adopted; a live one (someone else is upgrading)
      // and an unprovable one (another host) are left alone.
      if (this.probeOwnerState(existing.openedByHost, existing.openedByPid) !== "dead") return existing;
      const adopted = this.db.transaction((): UpgradeGateState | null => {
        const changes = this.stmts.adoptGate.run(this.owner.pid, this.owner.host, req.note ?? null, existing.gateId).changes;
        // Zero changes means the row is gone: someone ran `cancel` between the
        // read above and this transaction. Admission is open now, so returning
        // the stale gate would announce a pause that no longer exists — the same
        // mistake as fabricating one.
        return changes === 0 ? null : this.gateState();
      }).immediate();
      if (!adopted) {
        throw new Error("openGate: the gate disappeared while it was being taken over (admission is open)");
      }
      return adopted;
    }
    const gateId = "upgrade-" + randomUUID();
    this.db.transaction((): void => {
      this.stmts.openGate.run(gateId, this.owner.pid, this.owner.host, req.note ?? null);
    }).immediate();
    // Re-read: another process may have won the race (ON CONFLICT DO NOTHING),
    // and whatever row is there now is the gate everyone must agree on. If there
    // is no row at all the write did not land — say so instead of returning a
    // gate nobody wrote, which would let a caller announce a pause that is not in
    // effect.
    const written = this.gateState();
    if (!written) {
      throw new Error("openGate: the gate row could not be read back after writing it — admission is NOT closed");
    }
    return written;
  }

  /**
   * Run several reads as ONE WAL snapshot.
   *
   * The statements are individually consistent but not mutually: a task that
   * ends between two of them can appear in one list and not the other, and a
   * machine-readable report must not carry two contradictory moments. A
   * deferred transaction gives the reader a stable snapshot without taking a
   * write lock.
   */
  consistentRead<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * #309: the gate plus whether the process that opened it is still running.
   *
   * A `wait` that was interrupted (Ctrl-C, closed terminal) leaves the gate
   * closed, and then every business command is refused until someone reopens it.
   * `ownerState` is what lets the diagnostics say "nobody is upgrading, this is
   * your own leftover" instead of implying an upgrade is in progress:
   * `alive` / `dead` (same host) / `unknown` (another host, unprovable).
   *
   * Nothing clears the gate automatically. A dead opener is strong evidence but
   * still a decision to reopen, and `ans upgrade cancel` is that decision.
   */
  gateOwnerState(): { gate: UpgradeGateState; ownerState: "alive" | "dead" | "unknown" } | null {
    const gate = this.gateState();
    if (!gate) return null;
    return { gate, ownerState: this.probeOwnerState(gate.openedByHost, gate.openedByPid) };
  }

  /** #309: reopen admission. Returns whether a gate was actually open. */
  closeGate(): boolean {
    const info = this.db.transaction((): number => this.stmts.closeGate.run().changes).immediate();
    return info > 0;
  }

  /**
   * #309: unfinished work that blocks an upgrade.
   *
   * Business tasks only: a management command (a status read, the upgrade
   * itself) is not work an upgrade has to wait out. Dismissed rows are excluded
   * by the operator's explicit decision, not by any liveness guess. Follow-up
   * work IS included — a hook's index write is still a write in flight.
   */
  blockingTasks(): Array<TaskRecordRow & { ownerState: "alive" | "dead" | "unknown" }> {
    // openTasks() already folds in the owner probe; re-probing here would ask
    // the OS twice about the same pid and let the two answers disagree.
    return this.openTasks().filter((row) => row.role === "business" && row.dismissedAt === null);
  }

  /** #309: open rows an operator may acknowledge (undismissed, unfinished). */
  dismissableTasks(): Array<TaskRecordRow & { ownerState: "alive" | "dead" | "unknown" }> {
    const rows = this.stmts.dismissableTasks.all() as TaskRecordRow[];
    return rows.map((row) => ({ ...row, ownerState: this.probeOwnerState(row.ownerHost, row.ownerPid) }));
  }

  /**
   * #309: acknowledge one open row as unresolvable, with a mandatory reason.
   *
   * This is the ONLY way a leftover stops blocking without an end write, and it
   * is deliberately manual: the row keeps its NULL `ended_at` (nothing here
   * claims the task finished), and the reason travels with it so a later reader
   * sees a human decision instead of a silent sweep. Returns false when the row
   * is not dismissed by this call (already ended, already dismissed, or unknown).
   */
  dismissTask(taskId: string, reason: string): boolean {
    const why = reason.trim();
    if (!why) throw new Error("dismissTask: a reason is required — dismissing says a human gave up on this row");
    return this.db.transaction((): boolean => this.stmts.dismissTask.run(why, taskId).changes > 0).immediate();
  }

  /**
   * #309: finished rows older than the retention window, as a preview.
   *
   * `olderThanDays` defaults to HISTORY_RETENTION_DAYS. An open row is
   * never listed, however old — it is a blocker, not history.
   */
  agedFinishedTasks(olderThanDays: number = HISTORY_RETENTION_DAYS): Array<{ taskId: string; kind: string; endedAt: string }> {
    const days = requirePositiveDays(olderThanDays);
    return this.stmts.agedFinishedTasks.all("-" + days + " days") as Array<{ taskId: string; kind: string; endedAt: string }>;
  }

  /**
   * What `pruneFinishedTasks` would do, without deleting anything.
   *
   * Computed with the SAME rule the delete loop applies — a row goes only when
   * no SURVIVING row points at it, and removing one generation can free the
   * next — so a chain of aged rows reports "both go", not "one goes, one is
   * held". Read-only: one deferred read transaction (a stable WAL snapshot),
   * no write lock, nothing to roll back.
   */
  previewPrune(olderThanDays: number = HISTORY_RETENTION_DAYS): {
    wouldPrune: Array<{ taskId: string; kind: string; endedAt: string }>;
    wouldHold: Array<{ taskId: string; kind: string; endedAt: string }>;
  } {
    const days = requirePositiveDays(olderThanDays);
    const window = "-" + days + " days";
    // The three reads must come from ONE snapshot: a follow-up link written
    // between them would appear in allTaskIds but not in parentReferences, the
    // fixed point would never learn about it, and the preview would promise to
    // delete a row the real prune (which sees the finished database) keeps.
    return this.consistentRead(() => {
      const aged = this.stmts.agedFinishedTasks.all(window) as Array<{ taskId: string; kind: string; endedAt: string }>;
      const references = this.stmts.parentReferences.all() as Array<{ taskId: string; parentTaskId: string }>;

      const agedIds = new Set(aged.map((r) => r.taskId));
      // A row survives if it is not aged, or if an aged row that survives points
      // at it. Start with everything that is not aged, then grow to a fixed point.
      const surviving = new Set<string>(
        (this.stmts.allTaskIds.all() as Array<{ taskId: string }>)
          .map((r) => r.taskId)
          .filter((id) => !agedIds.has(id)),
      );
      let grew = true;
      while (grew) {
        grew = false;
        for (const ref of references) {
          if (!agedIds.has(ref.parentTaskId) || surviving.has(ref.parentTaskId)) continue;
          if (surviving.has(ref.taskId)) {
            surviving.add(ref.parentTaskId);
            grew = true;
          }
        }
      }
      return {
        wouldPrune: aged.filter((r) => !surviving.has(r.taskId)),
        wouldHold: aged.filter((r) => surviving.has(r.taskId)),
      };
    });
  }

  /**
   * #309: delete finished rows older than the retention window.
   *
   * Returns how many rows went and how many aged rows stayed because a
   * surviving row still points at them. The CALLER must have built a recovery
   * point first (`ans upgrade prune` snapshots the whole database before this);
   * this method deliberately takes no snapshot of its own, so a caller cannot
   * mistake "the registry searched nothing" for "history is recoverable".
   *
   * Open rows are untouched by the WHERE clause, so a crash mid-prune can never
   * delete work an upgrade is waiting for.
   */
  pruneFinishedTasks(olderThanDays: number = HISTORY_RETENTION_DAYS): { removed: number; heldByChildren: number } {
    const days = requirePositiveDays(olderThanDays);
    const window = "-" + days + " days";
    return this.db.transaction((): { removed: number; heldByChildren: number } => {
      // One pass only removes the outermost generation: a parent is still
      // referenced by its child when the statement starts. Repeated passes peel
      // the history one level at a time, oldest references last. Bounded so a
      // pathological chain cannot spin here.
      let removed = 0;
      for (let pass = 0; pass < 32; pass++) {
        const changes = this.stmts.pruneFinishedTasks.run(window).changes;
        removed += changes;
        if (changes === 0) break;
      }
      // Aged rows kept because a surviving row still links to them. Reported, not
      // silently dropped: the operator should be able to tell "nothing to prune"
      // from "something is holding these back".
      const heldByChildren = (this.stmts.agedFinishedTasksHeldByChildren.get(window) as { n: number }).n;
      return { removed, heldByChildren };
    }).immediate();
  }

  /**
   * #343: what the process-table half of `ans upgrade prune` would do.
   *
   * Read-only, one deferred read snapshot. The rules (settled on the ticket):
   *
   * - ENDED and past the window: history, deletable.
   * - OPEN and past the window: deletable ONLY when this host proves the pid is
   *   gone. A row on another host stays (unprovable), and a row whose pid is
   *   still in use stays too — the pid may have been reused by an unrelated
   *   process, and a false "still running" costs one stale line, while deleting
   *   a row that describes a live entry loses the only evidence it exists.
   * - Within the window: kept, whatever the state.
   *
   * The number of within-window rows is a count, not a list: printing hundreds
   * of young rows is exactly the noise the ticket is removing from the report.
   *
   * Design: an open row is deletable only on PROOF (same host + pid gone + past
   * the window), never on age alone — #343 option 1 ("never touch an open row")
   * leaves the crash residue growing forever (this host gains ~20 a day), and
   * option 3 (dismiss each row by hand) asks a human to click through them.
   */
  processPrunePlan(olderThanDays: number = HISTORY_RETENTION_DAYS): ProcessPrunePlan {
    const days = requirePositiveDays(olderThanDays);
    const window = "-" + days + " days";
    return this.consistentRead(() => {
      const deletable: ProcessPrunePlan["deletable"] = [];
      for (const row of this.stmts.agedClosedProcesses.all(window) as ProcessRecordRow[]) {
        deletable.push({ row, reason: "closed-aged" });
      }
      let pidInUse = 0;
      let otherHost = 0;
      for (const row of this.stmts.agedOpenProcesses.all(window) as ProcessRecordRow[]) {
        const ownerState = this.probeOwnerState(row.ownerHost, row.pid);
        if (ownerState === "dead") deletable.push({ row, reason: "open-gone-aged" });
        else if (ownerState === "alive") pidInUse++;
        else otherHost++;
      }
      const withinWindow = (this.stmts.inWindowProcesses.get(window, window) as { n: number }).n;
      return { deletable, withinWindow, pidInUse, otherHost };
    });
  }

  /**
   * #343: delete the rows a `processPrunePlan` marked deletable.
   *
   * Takes the plan instead of recomputing it so the dry-run the operator just
   * read and the run that deletes are the same judgment, not two. Each DELETE
   * still re-checks age and state in SQL: a row whose owner wrote its end
   * between the plan and this call no longer matches (it is young history now,
   * not proven-gone work) and is left alone. The caller takes the recovery
   * snapshot first — same rule as `pruneFinishedTasks`.
   */
  pruneProcessRecords(plan: ProcessPrunePlan, olderThanDays: number = HISTORY_RETENTION_DAYS): {
    removed: number;
    closed: number;
    openGone: number;
  } {
    const days = requirePositiveDays(olderThanDays);
    const window = "-" + days + " days";
    return this.db.transaction((): { removed: number; closed: number; openGone: number } => {
      const counts = { removed: 0, closed: 0, openGone: 0 };
      for (const entry of plan.deletable) {
        const changes = this.stmts.deleteProcessRow.run(entry.row.id, window, window).changes;
        if (changes === 0) continue;
        counts.removed += changes;
        if (entry.reason === "closed-aged") counts.closed += changes;
        else counts.openGone += changes;
      }
      return counts;
    }).immediate();
  }

  /**
   * Register this process's own lifetime as a process record.
   *
   * `build` is the build this process is executing, captured by the caller at
   * start. It is written once: a later `end()` only stamps the end, so the row
   * keeps saying which code this process was running for its whole life (#311).
   */
  registerProcess(req: { entry: string; build?: string }): RegisteredProcess {
    const info = this.stmts.insertProcess.run(this.owner.pid, this.owner.host, req.entry, req.build ?? null);
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
   * Close the connection this registry opened.
   *
   * A registry borrowed from the session store does nothing here: the store owns
   * that handle and closes it. Calling this twice is a no-op either way, and
   * using a borrowed registry after the store closed throws on the closed
   * database rather than silently pretending a write happened.
   */
  close(): void {
    if (!this.ownsConnection) return;
    this.db.close();
  }
}

/**
 * #307/#309/#311: bring an existing registry up to the current shape.
 *
 * Both openers call this: the registry can be the first process to touch an old
 * file, and the session store can be the first to assemble one. Keeping it in
 * this module means the two never disagree about the column set.
 *
 * `origin` gets a NOT NULL default so every existing row reads as
 * 'independent' — that is what those rows really were (nothing wrote
 * post-work links before #307), not a guess. `parent_task_id` stays nullable
 * on purpose: a follow-up whose parent cannot be named must record no link.
 * #309's dismissal columns are nullable and default NULL: an old open row has
 * NOT been acknowledged by anyone, so it must start as a blocker. #311's
 * `process_records.build` is nullable for the same reason in the other
 * direction: an old row never recorded a build, and inventing one would let a
 * stale process pass for current.
 *
 * Indexes are created AFTER the ALTERs; placing them in schema.sql would make
 * them run before the columns exist and fail to open an old database (the #277
 * lesson).
 */
export function migrateTaskRegistryColumns(db: Database.Database, initDeadline: number): void {
  const step = (ddl: string): void => {
    try {
      withInitBusyRetry("task registry columns", () => db.exec(ddl), initDeadline);
    } catch (e) {
      if (isDuplicateColumnError(e)) return;
      throw e;
    }
  };
  step("ALTER TABLE task_records ADD COLUMN origin TEXT NOT NULL DEFAULT 'independent' CHECK (origin IN ('independent', 'follow-up'))");
  step("ALTER TABLE task_records ADD COLUMN parent_task_id TEXT REFERENCES task_records(task_id)");
  step("ALTER TABLE task_records ADD COLUMN dismissed_at TEXT");
  step("ALTER TABLE task_records ADD COLUMN dismissed_reason TEXT");
  step("ALTER TABLE process_records ADD COLUMN build TEXT");
  step("CREATE INDEX IF NOT EXISTS idx_task_records_parent ON task_records(parent_task_id) WHERE parent_task_id IS NOT NULL");
}

/** Reject a retention window that would silently mean something else. */
function requirePositiveDays(days: number): number {
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error("history retention must be a positive number of days (got " + String(days) + ")");
  }
  return days;
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
  // #307/#311: an existing database's registry predates the follow-up columns
  // and the process build column. New files already carry them from the CREATE
  // TABLE above, so these ALTERs are the migration and a duplicate column is
  // absorbed (the schema objects here run before every ALTER, so both
  // statements live outside createTaskTables).
  migrateTaskRegistryColumns(db, initDeadline);
  endInit(db);
  return new TaskRegistry(db, opts);
}
