// One sidecar lock, shared by the eval ledgers.
//
// The skip/gain ledger and the ship override ledger each carried a byte-identical copy of this
// logic and already drifted once, so the rules live here and both ask for them. The lock file
// holds one JSON claim, written when the lock is taken and never refreshed: { pid, at }.
//
// Design: identity decides before age — probe dead reaps, alive keeps, unknown falls to age —
// because a claim is never refreshed while it is held, so age cannot tell a paused owner from a
// dead one. Reaping a live owner's lock is how two writers ended up appending to one ledger (#577).
// Design: the claim is published with link(2) from a staging file, so a lock file that exists
// always holds a complete claim — a waiter never has to guess whether an empty file is a crash or
// a writer mid-create. Filesystems without hard links fall back to create-then-write.
// Design: reaping and releasing compare the file's exact claim text before deleting — a lock that
// changed hands in between belongs to whoever wrote that text, not to the reader that judged the
// previous one.
import { closeSync, linkSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { probePid } from "../process-liveness.js";

// A lock whose claim names no usable identity is reaped past this age. It bounds the wait on a
// damaged lock file; it is not evidence that a live holder is gone.
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

// A claim that cannot be read still has a date: the file's own mtime. That is what keeps two
// writers from deleting each other's lock in the moment between create and write.
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

function takeClaim(lockPath: string, claim: string): boolean {
  const staging = lockPath + "." + process.pid + "." + randomUUID() + ".tmp";
  writeFileSync(staging, claim, "utf8");
  try {
    linkSync(staging, lockPath);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    // no hard links on this filesystem (some network shares): fall back to create-then-write, the
    // one path where a lock file can be observed before its claim lands
    let fd: number | undefined;
    try {
      fd = openSync(lockPath, "wx");
    } catch (fallbackError) {
      if ((fallbackError as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw fallbackError;
    }
    try {
      writeFileSync(fd, claim, "utf8");
      return true;
    } catch (writeError) {
      try { closeSync(fd); } catch { /* already closed */ }
      fd = undefined;
      try { rmSync(lockPath, { force: true }); } catch { /* a later writer reaps it */ }
      throw writeError;
    } finally {
      if (fd !== undefined) { try { closeSync(fd); } catch { /* already closed */ } }
    }
  } finally {
    try { rmSync(staging, { force: true }); } catch { /* a leftover staging file is inert */ }
  }
}

export function withLedgerLock<T>(lockPath: string, fn: () => T): T {
  mkdirSync(dirname(lockPath), { recursive: true });
  const claim = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });
  const startedAt = Date.now();
  let lastOwner: Partial<LedgerLockRecord> | null = null;

  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    if (!takeClaim(lockPath, claim)) {
      const snapshot = readLock(lockPath);
      if (snapshot) {
        lastOwner = snapshot.owner;
        if (lockIsReapable(snapshot)) deleteIfClaim(lockPath, snapshot.claim);
      }
      sleep(LOCK_RETRY_MS);
      continue;
    }

    try {
      return fn();
    } finally {
      deleteIfClaim(lockPath, claim);
    }
  }

  throw new LedgerLockTimeoutError(lockPath, lastOwner, Date.now() - startedAt);
}
