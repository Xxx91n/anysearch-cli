// Cold-start SQLite initialization: bounded retry for busy/locked steps.
//
// Two processes opening one brand-new database at the same instant can both
// arrive at the first write-ish step (the WAL switch, the schema DDL) and one
// of them gets SQLITE_BUSY. The connection's own busy_timeout does not cover
// every such step: the WAL transition in particular was observed throwing
// "database is locked" after waiting, not quietly queueing. Without a retry the
// second process dies and the host sees a randomly missing MCP server (#257).
//
// A second, related failure showed up while reproducing this: creating the FTS5
// virtual tables statement-by-statement lets the other connection change the
// schema underneath, which surfaces as SQLITE_SCHEMA ("vtable constructor
// failed"). That is not a busy error and must not be retried, so the schema
// script is applied atomically instead (see execDdlAtomically).
//
// Policy values are fixed here, not read from the environment, so a released
// build cannot be reconfigured into a different startup contract:
//   - INIT_RETRY_MAX_ATTEMPTS = 5  (first attempt + 4 retries)
//   - backoff 100 / 200 / 400 / 800 ms, summed 1500 ms
//   - INIT_BUSY_TIMEOUT_MS = 500   (SQLite's own wait inside each attempt)
//   - INIT_RETRY_WINDOW_MS = 6000  (hard cap on when a retry may START)
// The wall-clock limit per store is therefore "window plus at most one attempt's
// own wait": an attempt that is already running when the window passes is not
// followed by another one, it surfaces its own error. Measured on this host
// (Windows, better-sqlite3 13.0.3): a single journal_mode=WAL attempt against a
// fresh database held by another connection fails after ~1.2-1.4 s regardless of
// busy_timeout, and a 15 s external lock ends one store's init in ~6.8 s after 4
// attempts. So the honest upper bound per store is roughly 7.5 s, not the 4 s the
// attempt budget alone suggests.
//
// Each store takes its own deadline: createEngine() opens the session store and
// then the observation store, so a cold start where BOTH are contended can wait
// about twice that. The two windows are not merged into one on purpose — the
// second store has to be allowed to retry even when the first already used up
// its window, otherwise a slow first open would leave the second with no
// tolerance at all.
//
// Only SQLITE_BUSY / SQLITE_LOCKED and their sub-codes are retried, matching the
// ticket contract. Retrying is safe here because every attempt restarts from
// scratch (each init step is idempotent: IF NOT EXISTS, or a duplicate-column
// check), so unlike the batch-write path a stale-snapshot retry is meaningful.
// Every other initialization error is surfaced unchanged and immediately — a
// locked database must never be reported as a successful start.

import type Database from "better-sqlite3";

/** Attempts per initialization step: one real try plus this many-1 retries. */
export const INIT_RETRY_MAX_ATTEMPTS = 5;
/** First backoff delay; doubled per retry up to INIT_RETRY_MAX_DELAY_MS. */
export const INIT_RETRY_BASE_DELAY_MS = 100;
/** Ceiling for the doubling backoff. */
export const INIT_RETRY_MAX_DELAY_MS = 800;
/** SQLite-side wait used during initialization (the connection keeps STEADY after). */
export const INIT_BUSY_TIMEOUT_MS = 500;
/** Wall-clock cap: no retry starts after this much time has passed since init began. */
export const INIT_RETRY_WINDOW_MS = 6000;
/** Row-lock wait restored once initialization is done — the pre-#257 contract. */
export const STEADY_BUSY_TIMEOUT_MS = 5000;

/**
 * Starts the initialization phase on an open handle: lowers SQLite's own wait
 * and takes this store's retry deadline.
 *
 * Both stores (session and observation) open the same file, so both go through
 * this pair. Keeping it in one place is what stops the two envelopes from drifting
 * apart — a mismatch here is invisible until a contended cold start.
 *
 * @param db Open handle.
 * @returns The absolute deadline to pass to `withInitBusyRetry`.
 */
export function beginInit(db: Database.Database): number {
  const deadlineAt = initRetryDeadline();
  db.pragma("busy_timeout = " + INIT_BUSY_TIMEOUT_MS);
  return deadlineAt;
}

/**
 * Ends the initialization phase: restores the steady-state row-lock wait.
 *
 * @param db Open handle.
 */
export function endInit(db: Database.Database): void {
  db.pragma("busy_timeout = " + STEADY_BUSY_TIMEOUT_MS);
}

const BUSY_CODE_PREFIXES = ["SQLITE_BUSY", "SQLITE_LOCKED"] as const;

/**
 * True for the SQLite error classes the initialization retry is allowed to absorb.
 *
 * The code decides when one is present: an error carrying a real non-busy code
 * is never retried, even if its text happens to mention a lock. Only errors with
 * no code at all fall back to the message, which covers a driver or wrapper that
 * lost the code while keeping the wording.
 *
 * @param error Value thrown by better-sqlite3.
 * @returns whether the caller may retry the same step.
 */
export function isBusyError(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === "string" && code.length > 0) {
    return BUSY_CODE_PREFIXES.some((p) => code === p || code.startsWith(p + "_"));
  }
  const message = (error as Error)?.message ?? "";
  return /database is locked|database table is locked/i.test(message);
}

/** True only for "this column already exists", the idempotent-replay signal. */
export function isDuplicateColumnError(error: unknown): boolean {
  return /duplicate column name/i.test((error as Error)?.message ?? "");
}

/**
 * Backoff before retry number `attempt` (0 = the first retry).
 *
 * @param attempt Zero-based retry index.
 * @returns Delay in milliseconds, capped at INIT_RETRY_MAX_DELAY_MS.
 */
export function initRetryDelayMs(attempt: number): number {
  return Math.min(INIT_RETRY_BASE_DELAY_MS * 2 ** attempt, INIT_RETRY_MAX_DELAY_MS);
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Applies a whole DDL script in ONE IMMEDIATE transaction.
 *
 * Why not a plain `db.exec(sql)`: two processes creating a fresh database at the
 * same time each ran the script statement by statement, so one of them could
 * find the database changed by the other mid-script. Measured on this host
 * against the session schema (40 rounds of two concurrent fresh opens): plain
 * exec produced SQLITE_BUSY in 2 rounds and SQLITE_SCHEMA ("vtable constructor
 * failed: …_fts") in another run; the same script in one immediate transaction
 * produced zero failures. SQLITE_SCHEMA is not a busy error and is correctly not
 * retried, so the fix belongs here: either the whole schema lands or none of it
 * does, and the other connection waits on the transaction instead of racing it.
 *
 * BEGIN IMMEDIATE takes the write lock up front, which is what makes the waiting
 * connection block (and why the busy retry around this call still matters).
 *
 * @param db Open handle.
 * @param sql Idempotent DDL script (CREATE … IF NOT EXISTS throughout).
 */
export function execDdlAtomically(db: Database.Database, sql: string): void {
  db.transaction(() => { db.exec(sql); }).immediate();
}

/**
 * True for a failure produced by `withInitBusyRetry` running out of retries.
 *
 * Call sites that intentionally degrade to a warning (a data problem retrying
 * cannot fix) still must not let a *busy* exhaustion pass silently: that would
 * be exactly the "printed database is locked, then claimed a successful start"
 * behaviour #257 forbids. Distinguish the two with this predicate.
 *
 * @param error Value caught around a `withInitBusyRetry` call.
 * @returns whether the failure was a bounded-retry exhaustion, not the original error kind.
 */
export function isBusyRetryExhausted(error: unknown): boolean {
  const cause = (error as { cause?: unknown })?.cause;
  return cause !== undefined && isBusyError(cause);
}

/**
 * Runs one initialization step, retrying only busy/locked failures within the window.
 *
 * Blocks the thread between attempts (better-sqlite3 is synchronous, and startup
 * has no work to interleave).
 *
 * @param label Step name used in the failure message ("journal_mode", "schema", …).
 * @param step The idempotent work to run.
 * @param deadlineAt Absolute epoch ms after which no retry starts.
 * @returns Whatever `step` returned.
 * @throws The original error unchanged when it is not a busy error, or a wrapper
 *   that keeps the real busy error as `cause` when attempts or the window run out.
 */
export function withInitBusyRetry<T>(label: string, step: () => T, deadlineAt: number): T {
  for (let attempt = 0; ; attempt++) {
    try {
      return step();
    } catch (error) {
      if (!isBusyError(error)) throw error;
      const nextAttempt = attempt + 1;
      if (nextAttempt >= INIT_RETRY_MAX_ATTEMPTS || Date.now() >= deadlineAt) {
        const real = (error as Error)?.message ?? String(error);
        const wrapped = new Error(
          "sqlite init step \"" + label + "\" still busy after " + nextAttempt +
          " attempts (window " + INIT_RETRY_WINDOW_MS + "ms): " + real,
          { cause: error },
        );
        const code = (error as { code?: unknown })?.code;
        if (typeof code === "string") (wrapped as { code?: string }).code = code;
        throw wrapped;
      }
      sleepSync(initRetryDelayMs(attempt));
    }
  }
}

/** Absolute deadline for the initialization phase that starts now. */
export function initRetryDeadline(now: number = Date.now()): number {
  return now + INIT_RETRY_WINDOW_MS;
}
