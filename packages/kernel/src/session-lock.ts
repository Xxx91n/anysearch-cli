// Cross-process session lock (#266, D12, T3).
//
// One PI session record has one writer: two processes appending to the same
// JSONL at once would interleave entries, so every run of a session with a
// durable PI record takes a lock before touching it. The lock is a directory
// (mkdir is atomic) under `<piSessionDir>/locks/<key>.lock` holding:
//
//   owner.json  { pid, host, startedAt } — the holder's identity
//   heartbeat   touched on a timer while the holder runs
//
// A plain directory-mtime lock mistakes a long but healthy run for a dead
// one and steals it. A waiter here reclaims only on real evidence:
//
//   same host + live pid      never reclaimed, however old the heartbeat is
//   same host + dead pid      reclaimed at the next poll — a confirmed-dead
//                             local owner cannot come back, so recovery does
//                             not wait out the stale window (D12)
//   other host / no identity  reclaimed only once the stale window has
//                             passed — the conservative rule for owners this
//                             machine cannot confirm. A lock without
//                             owner.json yet is fresh by directory mtime,
//                             which holds a just-created lock until its
//                             identity lands.
//
// Engineering values (#266): stale window 10 min (unconfirmable owners
// only), wait cap 120 s, heartbeat every clamp(stale/3, 100 ms, 5 s),
// waiter poll 50 ms. The short windows the tests use come from
// ANS_PI_LOCK_STALE_MS / ANS_PI_LOCK_TIMEOUT_MS and are test values, not
// production defaults.
//
// Release and heartbeat re-check owner.json: once a lock is reclaimed the
// directory belongs to its new holder, and the old holder must not delete it
// or keep refreshing its heartbeat (#266: release and reclaim only ever
// target the rightful holder). While a same-machine holder is alive its lock
// is never reclaimed, so the check-then-delete race is cross-machine only —
// a network-filesystem deployment has no evidence this round and is not
// claimed to be supported.
//
// Known boundary (deliberate): a same-host pid that was recycled to a new
// process reads as alive, so a dead owner's lock can outlive it until that
// pid disappears again. Identity here is pid+host; process start times are
// not portable in Node, so this edge is documented rather than guessed at.
// A live holder also never reclaims its own process's lock (defense in
// depth: the lock must not trust the in-process queue to be the only
// serializer), so a lock whose release failed keeps failing with "session
// busy" until the process exits — visible, not silent.

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";

/** Reclaim window for a lock whose owner this machine cannot confirm. */
export const SESSION_LOCK_STALE_MS = 10 * 60_000;
/** Same-session wait cap: past this the run fails with "session busy". */
export const SESSION_LOCK_WAIT_MS = 120_000;
/** Subdirectory of the PI session dir holding the per-session lock dirs. */
export const SESSION_LOCKS_DIRNAME = "locks";

const POLL_MS = 50;
const HEARTBEAT_MIN_MS = 100;
const HEARTBEAT_MAX_MS = 5_000;

export const SESSION_BUSY_MESSAGE =
  "Session is busy: another run still holds this session (possibly in another process); retry after it finishes.";

export interface SessionLockWindows {
  /** Override for SESSION_LOCK_STALE_MS. */
  staleMs?: number;
  /** Override for SESSION_LOCK_WAIT_MS. */
  waitMs?: number;
}

export function sessionLockStaleMs(windows: SessionLockWindows | undefined): number {
  return positiveMs(windows?.staleMs, SESSION_LOCK_STALE_MS);
}

export function sessionLockWaitMs(windows: SessionLockWindows | undefined): number {
  return positiveMs(windows?.waitMs, SESSION_LOCK_WAIT_MS);
}

function positiveMs(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Heartbeat cadence: a third of the stale window, clamped to [100 ms, 5 s]. */
export function heartbeatIntervalMs(staleMs: number): number {
  return Math.min(HEARTBEAT_MAX_MS, Math.max(HEARTBEAT_MIN_MS, Math.floor(staleMs / 3)));
}

interface LockOwner {
  pid: number;
  host: string;
  startedAt: number;
}

const OWNER_FILE = "owner.json";
const HEARTBEAT_FILE = "heartbeat";

function readLockOwner(lockPath: string): LockOwner | undefined {
  try {
    const raw = JSON.parse(readFileSync(join(lockPath, OWNER_FILE), "utf8")) as Partial<LockOwner>;
    if (!Number.isInteger(raw.pid) || (raw.pid as number) <= 0 || typeof raw.host !== "string") return undefined;
    return { pid: raw.pid as number, host: raw.host, startedAt: Number(raw.startedAt) || 0 };
  } catch {
    return undefined;
  }
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process exists but belongs to another user.
    return (e as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

/** Age of the freshest evidence in the lock: heartbeat mtime, else dir mtime. */
function lockAgeMs(lockPath: string, now: number): number {
  try {
    const heartbeat = join(lockPath, HEARTBEAT_FILE);
    return now - statSync(existsSync(heartbeat) ? heartbeat : lockPath).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Whether the lock at `lockPath` may be reclaimed right now — see the module
 * comment for the rule table. The one-line version: a live local owner is
 * never reclaimed, a confirmed-dead local owner is reclaimed at once, and
 * everyone else has to outlive the stale window.
 */
function reclaimableNow(lockPath: string, staleMs: number): boolean {
  const owner = readLockOwner(lockPath);
  if (owner && owner.host === hostname()) {
    return !pidIsAlive(owner.pid);
  }
  return lockAgeMs(lockPath, Date.now()) > staleMs;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Acquire the session lock at `lockPath`, giving up at `deadlineAt`
 * (Date.now() basis) with a "session busy" error. The returned function
 * releases the lock; it is safe to call after the lock was reclaimed (it
 * then removes nothing).
 */
export async function acquireSessionLock(
  lockPath: string,
  opts: { staleMs?: number; deadlineAt: number },
): Promise<() => void> {
  const staleMs = sessionLockStaleMs(opts);
  mkdirSync(dirname(lockPath), { recursive: true });
  for (;;) {
    try {
      mkdirSync(lockPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e;
      if (reclaimableNow(lockPath, staleMs)) {
        // The holder is provably gone, or the lock is unrecoverably old with
        // no verifiable owner. Sweep it and try to take its place; losing
        // the follow-up mkdir race to another waiter is fine — the loop then
        // waits like any other contender.
        try { rmSync(lockPath, { recursive: true, force: true }); } catch { /* swept by another waiter */ }
        await sleep(POLL_MS);
        continue;
      }
      if (Date.now() >= opts.deadlineAt) throw new Error(SESSION_BUSY_MESSAGE);
      await sleep(POLL_MS);
      continue;
    }
    // We hold it: publish our identity and start the heartbeat.
    let identityPublished = false;
    try {
      writeFileSync(join(lockPath, OWNER_FILE), JSON.stringify({
        pid: process.pid,
        host: hostname(),
        startedAt: Date.now(),
      }));
      identityPublished = true;
    } catch { /* degraded: the lock then lives and dies by the age rules */ }
    let beating = true;
    const beat = () => {
      if (!beating) return;
      try {
        // Stop touching files that may belong to a new holder: once the
        // recorded identity is not ours, this directory is no longer ours.
        if (!ownsLockDir(lockPath, identityPublished)) {
          beating = false;
          return;
        }
        writeFileSync(join(lockPath, HEARTBEAT_FILE), String(Date.now()));
      } catch {
        beating = false;
      }
    };
    beat();
    const timer = setInterval(beat, heartbeatIntervalMs(staleMs));
    timer.unref?.();
    return () => {
      beating = false;
      clearInterval(timer);
      // Delete only a lock we still own: with our identity on record, a
      // directory that now names someone else (or cannot be read) was
      // reclaimed while we ran and must survive.
      if (!ownsLockDir(lockPath, identityPublished)) return;
      try { rmSync(lockPath, { recursive: true, force: true }); } catch { /* already swept */ }
    };
  }
}

function ownsLockDir(lockPath: string, identityPublished: boolean): boolean {
  if (!identityPublished) return true;
  const owner = readLockOwner(lockPath);
  return owner !== undefined && owner.pid === process.pid && owner.host === hostname();
}
