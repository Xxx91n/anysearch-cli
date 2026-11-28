// One sidecar lock, shared by the eval ledgers.
//
// The skip/gain ledger and the ship override ledger each carried a byte-identical copy of this
// logic and already drifted once, so the rules live here and both ask for them.
//
// The lock file holds one JSON claim, taken once and never refreshed: { pid, at }. Where hard links
// exist the claim is linked into place, so a lock file that is visible always holds a complete
// claim; where they do not, the file is created and then written, and a crash in between leaves it
// claim-less until the age rule clears it.
//
// Design: identity decides before age — probe dead reaps, alive keeps, unknown falls to age —
// because a claim is never refreshed, so age cannot tell a paused owner from a dead one.
// Design: reaping and releasing compare the exact claim text before deleting, so a lock that
// changed hands belongs to its new writer (#577). The re-read and the unlink are two calls, not
// one; what closes the gap is that a successor's claim always differs in pid or timestamp, so the
// comparison fails and the delete is skipped.
import { closeSync, linkSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { isPositiveWholeInt } from "@anysearch-cli/retriever";
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

// Only the hard-link step is substitutable: a test cannot make the real filesystem refuse hard
// links, and the fallback it triggers is otherwise never exercised.
export interface LedgerLockPrimitives {
  link(from: string, to: string): void;
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

// Codes that mean "this filesystem has no hard links". Everything else (EACCES, ENOSPC, ENOENT)
// is a real failure and must not be mistaken for a missing feature.
const NO_HARD_LINKS = new Set(["EPERM", "EOPNOTSUPP", "ENOTSUP", "ENOSYS", "EXDEV"]);

let warnedNoHardLinks = false;

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// A lock this process cannot read is a real failure and is thrown: looping on it would end in a
// timeout that blames the holder. mtime dates the other case — content that reads but carries no
// usable `at`, left behind by a writer that died between create and write.
function readLock(lockPath: string): LockSnapshot | null {
  let claim: string;
  try {
    claim = readFileSync(lockPath, "utf8");
  } catch (e) {
    // only "the file is not there" means the lock is gone; a lock this process cannot read is a
    // real failure, and looping on it would end in a timeout that blames the holder
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw e;
    return null;
  }
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
  if (isPositiveWholeInt(pid)) {
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

// true = this call owns the lock. The staging file already holds the claim, so nothing is written
// inside the retry loop and no lock is ever visible before its content exists.
function takeClaim(staging: string, lockPath: string, claim: string, link: LedgerLockPrimitives["link"]): boolean {
  try {
    link(staging, lockPath);
    return true;
  } catch (e) {
    const code = String((e as NodeJS.ErrnoException).code ?? "");
    if (code === "EEXIST") return false;
    if (!NO_HARD_LINKS.has(code)) throw e;
    if (!warnedNoHardLinks) {
      warnedNoHardLinks = true;
      console.error(
        "[ledger-lock] hard links unavailable in " + dirname(lockPath) + " (" + code +
        ") — falling back to create-then-write, so a crash mid-create can leave a claim-less lock",
      );
    }
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
  }
}

export function withLedgerLock<T>(
  lockPath: string,
  fn: () => T,
  primitives: LedgerLockPrimitives = { link: linkSync },
): T {
  mkdirSync(dirname(lockPath), { recursive: true });
  const claim = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });
  const staging = lockPath + "." + process.pid + "." + randomUUID() + ".tmp";
  const startedAt = Date.now();
  let lastOwner: Partial<LedgerLockRecord> | null = null;

  try {
    writeFileSync(staging, claim, "utf8");
    for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
      if (!takeClaim(staging, lockPath, claim, primitives.link)) {
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
  } finally {
    try { rmSync(staging, { force: true }); } catch { /* a leftover staging file is inert */ }
  }

  throw new LedgerLockTimeoutError(lockPath, lastOwner, Date.now() - startedAt);
}
