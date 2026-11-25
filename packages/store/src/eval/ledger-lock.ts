// One sidecar lock, shared by the eval ledgers.
//
// The skip/gain ledger and the ship override ledger each carried a byte-identical copy of this
// logic and already drifted once, so the rules live here and both ask for them.
//
// The lock file holds one JSON record, written when the lock is taken and never refreshed:
// { pid, at }. Because nothing refreshes it, age alone says nothing about whether the holder is
// still working — a paused or sleeping process keeps a very old record. Identity decides first:
//
//   probe says dead     -> reap, the owner is gone
//   probe says alive    -> keep, however old the record is
//   probe says nothing  -> fall back to age, the only case age was ever good for
//
// Reaping re-reads the record and deletes only the exact text it judged, so a lock another writer
// put down in between survives. Releasing deletes the file only while it still holds the record
// this call wrote, so a lock that changed hands is never removed by its previous owner.
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { probePid } from "../process-liveness.js";

// A lock with no usable identity is reaped past this age. It bounds the wait on a record whose
// owner cannot be probed at all; it is not evidence that a live holder is gone.
export const LEDGER_LOCK_MAX_AGE_MS = 5 * 60 * 1000;

const LOCK_ATTEMPTS = 100;
const LOCK_RETRY_MS = 25;

export interface LedgerLockRecord {
  pid: number;
  at: string;
}

export class LedgerLockTimeoutError extends Error {
  readonly lockPath: string;
  readonly owner: Partial<LedgerLockRecord> | null;

  constructor(lockPath: string, owner: Partial<LedgerLockRecord> | null, waitedMs: number) {
    const heldBy = owner && typeof owner.pid === "number"
      ? " (held by pid " + owner.pid + (owner.at ? " since " + owner.at : "") + ")"
      : "";
    super(
      "ledger lock busy after " + waitedMs + "ms: " + lockPath + heldBy +
      " — the holder is alive or could not be proved gone, so the lock was left alone. " +
      "If you know that process is gone, delete the lock file and retry",
    );
    this.name = "LedgerLockTimeoutError";
    this.lockPath = lockPath;
    this.owner = owner;
  }
}

interface LockSnapshot {
  record: string;
  owner: Partial<LedgerLockRecord> | null;
  ageMs: number | null;
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Unreadable content is not "nobody owns this": the file's own mtime still dates it, and that is
// what keeps two writers from deleting each other's lock in the moment between create and write.
function readLock(lockPath: string): LockSnapshot | null {
  let record: string;
  try { record = readFileSync(lockPath, "utf8"); } catch { return null; }
  let owner: Partial<LedgerLockRecord> | null = null;
  try {
    const parsed = JSON.parse(record) as { pid?: unknown; at?: unknown } | null;
    if (parsed && typeof parsed === "object") {
      owner = {};
      if (typeof parsed.pid === "number") owner.pid = parsed.pid;
      if (typeof parsed.at === "string") owner.at = parsed.at;
    }
  } catch { owner = null; }
  // the record's own `at` dates the holder's claim; mtime only dates a record too broken to carry
  // one. A clock that ran ahead then reads as "not old yet", which waits rather than steals.
  const at = owner?.at ? Date.parse(owner.at) : Number.NaN;
  let ageMs: number | null = Number.isFinite(at) ? Date.now() - at : null;
  if (ageMs === null) {
    try { ageMs = Date.now() - statSync(lockPath).mtimeMs; } catch { /* raced away */ }
  }
  return { record, owner, ageMs };
}

// 0 and negative pids are process groups on POSIX, so probing them answers about the caller, not
// the owner. Only a positive pid is an identity worth a probe.
function ownerIsGone(snapshot: LockSnapshot): boolean {
  const pid = snapshot.owner?.pid;
  if (typeof pid === "number" && Number.isInteger(pid) && pid > 0) {
    const liveness = probePid(pid);
    if (liveness === "dead") return true;
    if (liveness === "alive") return false;
  }
  return snapshot.ageMs !== null && snapshot.ageMs > LEDGER_LOCK_MAX_AGE_MS;
}

function reapIfUnchanged(lockPath: string, judged: string): void {
  let current: string;
  try { current = readFileSync(lockPath, "utf8"); } catch { return; }
  if (current !== judged) return; // the lock changed hands after the read that judged it
  try { rmSync(lockPath, { force: true }); } catch { /* the next attempt re-judges */ }
}

function releaseIfOurs(lockPath: string, record: string): void {
  try {
    if (readFileSync(lockPath, "utf8") !== record) return; // not this call's lock any more
  } catch { return; }
  try { rmSync(lockPath, { force: true }); } catch { /* the next writer reaps it */ }
}

export function withLedgerLock<T>(lockPath: string, fn: () => T): T {
  mkdirSync(dirname(lockPath), { recursive: true });
  const record = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });
  const startedAt = Date.now();
  let lastOwner: Partial<LedgerLockRecord> | null = null;

  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    let fd: number | undefined;
    try {
      fd = openSync(lockPath, "wx");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const snapshot = readLock(lockPath);
      if (snapshot) {
        lastOwner = snapshot.owner;
        if (ownerIsGone(snapshot)) reapIfUnchanged(lockPath, snapshot.record);
      }
      sleep(LOCK_RETRY_MS);
      continue;
    }

    try {
      writeFileSync(fd, record, "utf8");
      closeSync(fd);
    } catch (e) {
      try { closeSync(fd); } catch { /* already closed */ }
      // nobody else can own a lock this call just created, so drop it instead of leaving a
      // record-less file for the next writer to date by mtime
      try { rmSync(lockPath, { force: true }); } catch { /* a later writer reaps it by age */ }
      throw e;
    }

    try {
      return fn();
    } finally {
      releaseIfOurs(lockPath, record);
    }
  }

  throw new LedgerLockTimeoutError(lockPath, lastOwner, Date.now() - startedAt);
}
