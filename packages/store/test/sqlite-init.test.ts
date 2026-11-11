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
  initRetryDeadline,
  initRetryDelayMs,
  isBusyError,
  isBusyRetryExhausted,
  isDuplicateColumnError,
  withInitBusyRetry,
} from "../src/sqlite-init.js";

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

  console.log("sqlite-init: " + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}

main();
