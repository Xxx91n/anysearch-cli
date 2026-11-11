// #257 cold-start policy units (D12).
//
// These pin the contract the ticket asks to be written down and bounded:
// which errors may be retried, how long between attempts, the attempt cap, the
// wall-clock cap, and that the real busy error stays reachable on the thrown
// wrapper. Plain `node --test`, assert-counting convention (no framework).
import {
  INIT_BUSY_TIMEOUT_MS,
  INIT_RETRY_BASE_DELAY_MS,
  INIT_RETRY_MAX_ATTEMPTS,
  INIT_RETRY_MAX_DELAY_MS,
  INIT_RETRY_WINDOW_MS,
  STEADY_BUSY_TIMEOUT_MS,
  beginInit,
  endInit,
  execDdlAtomically,
  initRetryDeadline,
  initRetryDelayMs,
  isBusyError,
  isBusyRetryExhausted,
  isDuplicateColumnError,
  withForeignKeysOff,
  withInitBusyRetry,
} from "../src/sqlite-init.js";
import Database from "better-sqlite3";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

function busyError(code = "SQLITE_BUSY", message = "database is locked") {
  const e = new Error(message) as Error & { code?: string };
  e.code = code;
  return e;
}

function main() {
  // --- published policy values (the ticket wants them recorded, not implicit) ---
  assert(INIT_RETRY_MAX_ATTEMPTS === 5, "attempt cap is 5 (one try + four retries)");
  assert(INIT_BUSY_TIMEOUT_MS === 500, "init-phase SQLite wait is 500ms, not the 5000ms steady-state wait");
  assert(INIT_RETRY_WINDOW_MS === 6000, "wall-clock window is 6000ms");
  assert(initRetryDelayMs(0) === 100, "first retry waits 100ms");
  assert(initRetryDelayMs(1) === 200, "second retry waits 200ms");
  assert(initRetryDelayMs(2) === 400, "third retry waits 400ms");
  assert(initRetryDelayMs(3) === 800, "fourth retry waits 800ms (cap)");
  assert(initRetryDelayMs(20) === INIT_RETRY_MAX_DELAY_MS, "backoff never exceeds the cap");
  assert(initRetryDelayMs(0) === INIT_RETRY_BASE_DELAY_MS, "base delay matches the constant");

  // --- which errors may be absorbed ---
  assert(isBusyError(busyError("SQLITE_BUSY", "database is locked")), "SQLITE_BUSY is retryable");
  assert(isBusyError(busyError("SQLITE_BUSY_SNAPSHOT", "snapshot")), "SQLITE_BUSY_SNAPSHOT sub-code is retryable");
  assert(isBusyError(busyError("SQLITE_LOCKED", "database table is locked")), "SQLITE_LOCKED is retryable");
  assert(isBusyError(busyError("SQLITE_LOCKED_SHAREDCACHE", "shared cache lock")), "SQLITE_LOCKED sub-code is retryable");
  assert(isBusyError(new Error("database is locked")), "bare 'database is locked' message counts (no code attached)");
  assert(isBusyError(new Error("database table is locked")), "bare 'database table is locked' message counts");
  assert(!isBusyError(busyError("SQLITE_CANTOPEN", "unable to open database file")), "SQLITE_CANTOPEN is NOT retryable");
  assert(!isBusyError(busyError("SQLITE_CONSTRAINT", "constraint failed")), "SQLITE_CONSTRAINT is NOT retryable");
  assert(!isBusyError(busyError("SQLITE_READONLY", "attempt to write a readonly database")), "SQLITE_READONLY is NOT retryable");
  assert(!isBusyError(new Error("disk I/O error")), "plain IO errors are NOT retryable");
  // A real non-busy code wins over a lock-sounding message: only code-less
  // errors fall back to the text, so a mislabelled failure is never retried.
  assert(!isBusyError(busyError("SQLITE_CONSTRAINT", "database is locked constraints")), "a non-busy code is never retried, even if the text says locked");
  assert(!isBusyError(busyError("SQLITE_CANTOPEN", "database is locked")), "CANTOPEN with a misleading message is still not retryable");
  assert(!isBusyError(null) && !isBusyError(undefined), "null/undefined are not busy errors");

  assert(isDuplicateColumnError(new Error("duplicate column name: archived")), "duplicate column name is recognised");
  assert(!isDuplicateColumnError(new Error("no such column: archived")), "other schema errors are not swallowed as duplicate-column");

  // --- success path and the non-busy rethrow ---
  {
    let calls = 0;
    const v = withInitBusyRetry("probe", () => { calls++; return 42; }, initRetryDeadline());
    assert(v === 42 && calls === 1, "a step that succeeds runs once and returns its value");
  }
  {
    const real = busyError("SQLITE_CONSTRAINT", "constraint failed");
    let calls = 0;
    let same = false;
    try {
      withInitBusyRetry("probe", () => { calls++; throw real; }, initRetryDeadline());
    } catch (e) {
      same = e === real;
    }
    assert(calls === 1 && same, "a non-busy error is surfaced unchanged after ONE attempt (identity preserved, no retry)");
  }

  // --- transient busy recovers ---
  {
    let calls = 0;
    const v = withInitBusyRetry("probe", () => {
      calls++;
      if (calls < 3) throw busyError();
      return "ok";
    }, initRetryDeadline());
    assert(v === "ok" && calls === 3, "two busy failures then success (3 attempts) is the recoverable case");
  }

  // --- attempts exhausted: wrapped, cause kept, code kept, timing bounded ---
  {
    const t0 = Date.now();
    let calls = 0;
    const real = busyError();
    let thrown: (Error & { code?: string; cause?: unknown }) | undefined;
    try {
      withInitBusyRetry("schema", () => { calls++; throw real; }, initRetryDeadline());
    } catch (e) { thrown = e as Error & { code?: string; cause?: unknown }; }
    const elapsed = Date.now() - t0;
    assert(calls === INIT_RETRY_MAX_ATTEMPTS, "exhausting the cap takes exactly 5 attempts (got " + calls + ")");
    assert(thrown !== undefined, "exhausted retries throw instead of returning");
    assert(String(thrown?.message).includes("schema"), "thrown message names the step that stayed busy");
    assert(String(thrown?.message).includes("5 attempts"), "thrown message states the attempt count");
    assert(thrown?.code === "SQLITE_BUSY", "thrown wrapper keeps the SQLite code");
    assert(thrown?.cause === real, "thrown wrapper keeps the real busy error as cause (nothing swallowed)");
    // 100+200+400+800 = 1500ms of backoff across four retries.
    assert(elapsed >= 1500, "backoff is actually awaited between attempts (elapsed " + elapsed + "ms)");
    assert(elapsed < 6000, "attempt-exhaustion path finishes well inside the wall-clock window (" + elapsed + "ms)");
  }

  // --- wall-clock window: an already-past deadline forbids any retry ---
  {
    let calls = 0;
    let thrown: (Error & { code?: string; cause?: unknown }) | undefined;
    try {
      withInitBusyRetry("journal_mode", () => { calls++; throw busyError(); }, Date.now() - 1);
    } catch (e) { thrown = e as Error & { code?: string }; }
    assert(calls === 1, "a past deadline allows exactly one attempt and no retry (got " + calls + ")");
    assert(thrown?.cause instanceof Error, "window exhaustion still carries the real error as cause");
  }

  // --- the backoff must not start an attempt after the window closed ---
  {
    // Deadline lands partway through the first backoff (100ms): the sleep crosses
    // it, so the loop must give up instead of making a second attempt.
    let calls = 0;
    const budgetMs = 40;
    let thrown: unknown;
    try {
      withInitBusyRetry("journal_mode", () => { calls++; throw busyError(); }, Date.now() + budgetMs);
    } catch (e) { thrown = e; }
    assert(calls === 1, "a backoff that crosses the deadline makes no further attempt (got " + calls + ")");
    assert(isBusyRetryExhausted(thrown), "crossing the window throws the same wrapped exhaustion");
  }
  {
    // Control: with time to spare the same step retries, so the case above is
    // discriminated by the deadline and not by something else.
    let calls = 0;
    const v = withInitBusyRetry("journal_mode", () => {
      calls++;
      if (calls < 2) throw busyError();
      return "ok";
    }, Date.now() + INIT_RETRY_WINDOW_MS);
    assert(v === "ok" && calls === 2, "the same two-attempt case succeeds when the window allows it");
  }

  // --- deadline arithmetic ---
  {
    const d = initRetryDeadline(1000);
    assert(d === 1000 + INIT_RETRY_WINDOW_MS, "deadline is start + window");
    assert(initRetryDeadline() > Date.now(), "a deadline taken now lies in the future");
  }

  // --- the fail-open call sites must be able to tell exhaustion from a data error ---
  {
    const dataError = busyError("SQLITE_CONSTRAINT", "UNIQUE constraint failed: budget_ledger.session_id");
    // Shaped exactly like the wrapper withInitBusyRetry throws.
    const exhausted = new Error("wrapped", { cause: busyError() });
    assert(!isBusyRetryExhausted(dataError), "a plain data error is not retry exhaustion (fail-open path stays)");
    assert(!isBusyRetryExhausted(new Error("no cause")), "an error with no cause is not retry exhaustion");
    assert(!isBusyRetryExhausted(null) && !isBusyRetryExhausted(undefined), "null/undefined are not retry exhaustion");
    assert(isBusyRetryExhausted(exhausted), "a busy cause marks retry exhaustion, so the start must fail");
    // End-to-end: the real wrapper produces what the predicate recognises.
    let wrapped: unknown;
    try { withInitBusyRetry("probe", () => { throw busyError(); }, initRetryDeadline()); } catch (e) { wrapped = e; }
    assert(isBusyRetryExhausted(wrapped), "the real wrapper's output is recognised as exhaustion");
  }

  // --- the init envelope both stores share ---
  {
    const db = new Database(":memory:");
    try {
      const deadline = beginInit(db);
      const during = db.pragma("busy_timeout", { simple: true });
      assert(during === INIT_BUSY_TIMEOUT_MS, "beginInit lowers the row-lock wait to the init value (got " + String(during) + ")");
      assert(deadline > Date.now(), "beginInit hands back a future deadline");
      endInit(db);
      const after = db.pragma("busy_timeout", { simple: true });
      assert(after === STEADY_BUSY_TIMEOUT_MS, "endInit restores the steady-state wait (got " + String(after) + ")");
      assert(after === 5000, "the steady-state wait is the pre-#257 5s contract");
    } finally {
      db.close();
    }
  }

  // --- foreign keys are restored on BOTH paths (busy retry keeps the connection alive) ---
  {
    const db = new Database(":memory:");
    try {
      let seenDuring = -1;
      withForeignKeysOff(db, () => {
        seenDuring = db.pragma("foreign_keys", { simple: true }) as number;
      });
      assert(seenDuring === 0, "enforcement is off while the swap runs (got " + seenDuring + ")");
      assert((db.pragma("foreign_keys", { simple: true }) as number) === 1,
        "enforcement is back on after the swap");
    } finally {
      db.close();
    }
  }
  {
    const db = new Database(":memory:");
    try {
      // The failure path is the one that matters: a busy exhaustion inside the
      // swap leaves the connection alive, so a missed restore would disable
      // cascades for the rest of the process.
      let threw = false;
      try {
        withForeignKeysOff(db, () => { throw busyError(); });
      } catch { threw = true; }
      assert(threw, "a throwing swap propagates the error (it is retried, not swallowed)");
      assert((db.pragma("foreign_keys", { simple: true }) as number) === 1,
        "enforcement is restored even when the swap throws");
    } finally {
      db.close();
    }
  }

  // --- schema DDL lands atomically: all of it, or none of it ---
  {
    const db = new Database(":memory:");
    try {
      execDdlAtomically(db, "CREATE TABLE ok_a (x INTEGER); CREATE TABLE ok_b (y INTEGER);");
      const ok = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name LIKE 'ok_%'").get() as { n: number };
      assert(ok.n === 2, "a valid script creates every statement (got " + ok.n + ")");
    } finally {
      db.close();
    }
  }
  {
    const db = new Database(":memory:");
    try {
      // The third statement is invalid, so the whole script must roll back.
      let threw = false;
      try {
        execDdlAtomically(db, "CREATE TABLE roll_a (x INTEGER); CREATE TABLE roll_b (y INTEGER); CREATE TABLE oops (this is not sql;");
      } catch { threw = true; }
      assert(threw, "a broken script throws instead of half-applying");
      const left = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name LIKE 'roll_%'").get() as { n: number };
      assert(left.n === 0, "nothing from the broken script survives — no half-initialized schema (got " + left.n + ")");
    } finally {
      db.close();
    }
  }
  {
    const db = new Database(":memory:");
    try {
      // The vtable failures that motivated this showed up when the script ran
      // statement by statement; the atomic form must tolerate a re-run.
      execDdlAtomically(db, "CREATE TABLE IF NOT EXISTS rerun (x INTEGER);");
      execDdlAtomically(db, "CREATE TABLE IF NOT EXISTS rerun (x INTEGER);");
      const n = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'rerun'").get() as { n: number };
      assert(n.n === 1, "an idempotent script is safe to apply twice (got " + n.n + ")");
    } finally {
      db.close();
    }
  }

  console.log("sqlite-init: " + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}

main();
