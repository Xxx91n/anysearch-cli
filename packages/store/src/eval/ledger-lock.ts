// One sidecar lock, shared by the eval ledgers.
//
// The skip/gain ledger and the ship override ledger each carried a byte-identical copy of this
// logic and already drifted once, so the rules live here and both ask for them. The lock file
// holds one JSON claim, written when the lock is taken and never refreshed: { pid, at }.
//
// Design: identity decides before age — probe dead reaps, alive keeps, unknown falls to age —
// because a claim is never refreshed while it is held, so its age cannot separate a paused owner
// (asleep, at a breakpoint, on a wedged network path) from a dead one. Reaping a live owner's lock
// is how two writers ended up appending to one ledger (#577).
// Design: reaping and releasing compare the file's exact claim text before deleting — a lock that
// changed hands in between belongs to whoever wrote that text, not to the reader that judged the
// previous one.
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { probePid } from "../process-liveness.js";

// A lock with no usable identity is reaped past this age. It bounds the wait on a claim whose
// owner cannot be probed at all; it is not evidence that a live holder is gone.
export const LEDGER_LOCK_MAX_AGE_MS = 5 * 60 * 1000;

const LOCK_ATTEMPTS = 100;
const LOCK_RETRY_MS = 25;

export interface LedgerLockRecord {
  pid: number;
  at: string;
}

export class LedgerLockTimeoutError extends Error {
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
  }
}

interface LockSnapshot {
  claim: string;
  owner: Partial<LedgerLockRecord> | null;
  ageMs: number | null;
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Unreadable content is not "nobody owns this": the file's own mtime still dates it, and that is
// what keeps two writers from deleting each other's lock in the moment between create and write.
function readLock(lockPath: string): LockSnapshot | null {
  let claim: string;
  try { claim = readFileSync(lockPath, "utf8"); } catch { return null; }
  let owner: Partial<LedgerLockRecord> | null = null;
  try {
    const parsed = JSON.parse(claim) as { pid?: unknown; at?: unknown } | null;
    if (parsed && typeof parsed === "object") {
      owner = {};
      if (typeof parsed.pid === "number") owner.pid = parsed.pid;
      if (typeof parsed.at === "string") owner.at = parsed.at;
    }
  } catch { owner = null; }
  // the claim's own `at` dates the holder's word; mtime only dates a claim too broken to carry one.
  // A clock that ran ahead then reads as "not old yet", which waits rather than steals.
  const at = owner?.at ? Date.parse(owner.at) : Number.NaN;
  let ageMs: number | null = Number.isFinite(at) ? Date.now() - at : null;
  if (ageMs === null) {
    try { ageMs = Date.now() - statSync(lockPath).mtimeMs; } catch { /* raced away */ }
  }
  return { claim, owner, ageMs };
}

// 0 and negative pids are process groups on POSIX, so probing them answers about the caller, not
// the owner. Only a positive pid is an identity worth a probe.
function lockIsReapable(snapshot: LockSnapshot): boolean {
  const pid = snapshot.owner?.pid;
  if (typeof pid === "number" && Number.isInteger(pid) && pid > 0) {
    const liveness = probePid(pid);
    if (liveness === "dead") return true;
    if (liveness === "alive") return false;
  }
  return snapshot.ageMs !== null && snapshot.ageMs > LEDGER_LOCK_MAX_AGE_MS;
}

function deleteIfClaim(lockPath: string, expected: string): void {
  let current: string;
  try { current = readFileSync(lockPath, "utf8"); } catch { return; }
  if (current !== expected) return;
  try { rmSync(lockPath, { force: true }); } catch { /* the next writer re-judges it */ }
}

export function withLedgerLock<T>(lockPath: string, fn: () => T): T {
  mkdirSync(dirname(lockPath), { recursive: true });
  const claim = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });
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
        if (lockIsReapable(snapshot)) deleteIfClaim(lockPath, snapshot.claim);
      }
      sleep(LOCK_RETRY_MS);
      continue;
    }

    try {
      writeFileSync(fd, claim, "utf8");
      closeSync(fd);
    } catch (e) {
      try { closeSync(fd); } catch { /* already closed */ }
      // nobody else can own a lock this call just created, so drop it instead of leaving a
      // claim-less file for the next writer to date by mtime
      try { rmSync(lockPath, { force: true }); } catch { /* a later writer reaps it by age */ }
      throw e;
    }

    try {
      return fn();
    } finally {
      deleteIfClaim(lockPath, claim);
    }
  }

  throw new LedgerLockTimeoutError(lockPath, lastOwner, Date.now() - startedAt);
}
