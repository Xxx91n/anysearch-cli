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
//   same host + dead pid      reclaimed at the next poll
//   other host / no identity  reclaimed only once the stale window has
//                             passed — the conservative rule for owners this
//                             machine cannot confirm. A lock without
//                             owner.json yet is fresh by directory mtime,
//                             which holds a just-created lock until its
//                             identity lands.
//
// Production windows are SESSION_LOCK_STALE_MS / SESSION_LOCK_WAIT_MS and the
// heartbeat cadence is heartbeatIntervalMs. The short windows the tests use
// come from ANS_PI_LOCK_STALE_MS / ANS_PI_LOCK_TIMEOUT_MS and are test values,
// not production defaults.
//
// A network-filesystem session directory has no evidence this round and is
// not claimed to be supported: with no shared pid namespace the only rule
// left is the heartbeat window, and that path is untested across hosts.

// Design: identity is pid + host, not process start time — Node has no portable
// way to read a process start time, and guessing one would make the liveness
// check wrong in the common case rather than rarely wrong.
// Design: a confirmed-dead same-host owner is reclaimed at once — a dead pid on
// this machine cannot come back, so waiting out the stale window would only
// delay recovery; the window stays for owners this machine cannot confirm.
// Design: release and heartbeat re-check owner.json before touching the
// directory — once a lock is reclaimed it belongs to its new holder, and the
// old holder must neither delete it nor keep refreshing its heartbeat.
// Design: a live holder never reclaims its own process's lock — defense in
// depth, so the lock does not trust the in-process queue to be its only
// serializer; a lock whose release failed keeps failing with "session busy"
// until the process exits, which is visible rather than silent.
// Design: a same-host pid recycled to a new process reads as alive — that
// keeps a dead owner's lock longer than necessary, and is accepted because the
// alternative (guessing a start time) would be wrong more often.

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

/** Windows with the production defaults filled in. */
export interface ResolvedSessionLockWindows {
  staleMs: number;
  waitMs: number;
}

/**
 * Fill in the production defaults. Positive overrides win; anything else
 * (absent, non-finite, non-positive) keeps the default. Callers resolve once
 * and pass the result along, so a window value is validated in exactly one
 * place per run.
 */
export function resolveSessionLockWindows(windows: SessionLockWindows | undefined): ResolvedSessionLockWindows {
  return {
    staleMs: positiveMs(windows?.staleMs, SESSION_LOCK_STALE_MS),
    waitMs: positiveMs(windows?.waitMs, SESSION_LOCK_WAIT_MS),
  };
}

function positiveMs(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Heartbeat cadence: a third of the stale window, clamped to [100 ms, 5 s]. */
export function heartbeatIntervalMs(staleMs: number): number {
  return Math.min(HEARTBEAT_MAX_MS, Math.max(HEARTBEAT_MIN_MS, Math.floor(staleMs / 3)));
}

// The fields a rule reads. `startedAt` is also written into owner.json for
// whoever inspects a stuck lock by hand; no decision uses it, so it is not
// parsed back — a field no rule consumes would just invite one to.
interface LockOwner {
  pid: number;
  host: string;
}

const OWNER_FILE = "owner.json";
const HEARTBEAT_FILE = "heartbeat";

function readLockOwner(lockPath: string): LockOwner | undefined {
  try {
    const raw = JSON.parse(readFileSync(join(lockPath, OWNER_FILE), "utf8")) as Partial<LockOwner>;
    if (!Number.isInteger(raw.pid) || (raw.pid as number) <= 0 || typeof raw.host !== "string") return undefined;
    return { pid: raw.pid as number, host: raw.host };
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
 * Acquire the session lock at `lockPath`, giving up after `windows.waitMs` with
 * a "session busy" error. `windows` is already resolved (see
 * resolveSessionLockWindows). The returned function releases the lock; it is
 * safe to call after the lock was reclaimed (it then removes nothing).
 */
export async function acquireSessionLock(
  lockPath: string,
  windows: ResolvedSessionLockWindows,
): Promise<() => void> {
  const { staleMs } = windows;
  const deadlineAt = Date.now() + windows.waitMs;
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
      if (Date.now() >= deadlineAt) throw new Error(SESSION_BUSY_MESSAGE);
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
