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
// Design: a reclaim MOVES the directory before deleting it — read-then-delete
// could remove a lock a competing waiter created in the gap, so the atomic
// rename picks one winner and the loser sees ENOENT.
// Design: release and heartbeat re-check owner.json before touching the
// directory — once a lock is reclaimed it belongs to its new holder, and the
// old holder must neither delete it nor keep refreshing its heartbeat.
// Design: a holder that cannot write its identity gives the lock back and fails
// the run — a lock nobody can verify on release is worse than no lock.
// Design: the wait deadline is checked at the top of every poll, including the
// reclaim path — a sweep that keeps failing must still end as "session busy",
// never as an unbounded retry.
// Design: a live holder never reclaims its own process's lock — defense in
// depth, so the lock does not trust the in-process queue to be its only
// serializer; a lock whose release failed keeps failing with "session busy"
// until the process exits, which is visible rather than silent.
// Design: a same-host pid recycled to a new process reads as alive — that
// keeps a dead owner's lock longer than necessary, and is accepted because the
// alternative (guessing a start time) would be wrong more often.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
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

/**
 * The holder's identity, or undefined when there is none to read.
 *
 * A missing file and an unreadable one are different facts and must not
 * collapse into the same answer: missing means the lock predates its identity
 * (or the directory was just swept), which the age rules may still judge;
 * unreadable means this machine cannot confirm who holds it, and treating that
 * as "no identity" would let a live holder's heartbeat stop forever and then
 * let a waiter reclaim a run that is still going (#266: identity unknown is
 * handled conservatively, never as "dead").
 */
class UnreadableOwnerError extends Error {}

function readLockOwner(lockPath: string): LockOwner | undefined {
  let text: string;
  try {
    text = readFileSync(join(lockPath, OWNER_FILE), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
    throw new UnreadableOwnerError("owner.json exists but cannot be read");
  }
  try {
    const raw = JSON.parse(text) as Partial<LockOwner>;
    if (!Number.isInteger(raw.pid) || (raw.pid as number) <= 0 || typeof raw.host !== "string") {
      throw new UnreadableOwnerError("owner.json has no usable identity");
    }
    return { pid: raw.pid as number, host: raw.host };
  } catch (e) {
    if (e instanceof UnreadableOwnerError) throw e;
    throw new UnreadableOwnerError("owner.json is not valid JSON");
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
 *
 * An owner.json that exists but cannot be read counts as "cannot confirm":
 * this waiter falls back to the age rule, and while the file stays unreadable
 * the holder's own heartbeat stops refreshing it, so the window does expire.
 * The alternative — treating the read failure as "no identity" — is the same
 * fallback minus the guarantee that something eventually moves, which is what
 * this branch keeps.
 */
function reclaimableNow(lockPath: string, staleMs: number): boolean {
  let owner: LockOwner | undefined;
  try {
    owner = readLockOwner(lockPath);
  } catch {
    return lockAgeMs(lockPath, Date.now()) > staleMs;
  }
  if (owner && owner.host === hostname()) {
    return !pidIsAlive(owner.pid);
  }
  return lockAgeMs(lockPath, Date.now()) > staleMs;
}

/**
 * Sweep a lock this waiter judged reclaimable, without ever deleting a
 * replacement.
 *
 * A read-then-delete is not safe: a competing waiter can sweep the dead
 * directory and create its own in the gap, and the delete then removes the
 * new holder's lock — two writers on one session, the exact failure this
 * lock exists to prevent. So the directory is first *moved* to a unique
 * graveyard path (rename is atomic, and exactly one waiter can win it), and
 * only that moved directory is deleted. Once the rename wins, `lockPath`
 * is gone and everyone races on `mkdir` like normal.
 *
 * Returns true when the directory was swept (now or by another waiter),
 * false when the sweep could not happen (a live/fresh owner appeared, or
 * the filesystem refused the rename) — the caller then falls through to its
 * deadline check instead of retrying forever.
 */
function sweepStaleLock(lockPath: string, staleMs: number): boolean {
  if (!reclaimableNow(lockPath, staleMs)) return false;
  const graveyard = lockPath + ".swept-" + process.pid + "-" + Math.floor(Math.random() * 1e9);
  try {
    renameSync(lockPath, graveyard);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    // ENOENT: another waiter already swept it — not a failure for this waiter.
    // Anything else (permissions, a locked file) means the lock stays; do not
    // loop on it.
    return code === "ENOENT";
  }
  try {
    rmSync(graveyard, { recursive: true, force: true });
  } catch {
    // The moved directory is now unreachable as a lock, so a failed delete is
    // cosmetic: it can no longer be claimed or block anyone. Leaving it beats
    // turning cleanup into the caller's problem.
  }
  return true;
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
    // The deadline is checked at the TOP of every iteration, so every path —
    // a live holder, a reclaim sweep, or a sweep that keeps failing — ends at
    // "session busy" instead of spinning forever (#266: the wait has a cap).
    if (Date.now() >= deadlineAt) throw new Error(SESSION_BUSY_MESSAGE);
    try {
      mkdirSync(lockPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e;
      // Sweep a dead/unconfirmable holder; a live local holder is never
      // touched here, so the loop simply waits for it.
      if (!sweepStaleLock(lockPath, staleMs)) {
        await sleep(POLL_MS);
        continue;
      }
      // The directory is gone: try to take its place immediately.
      continue;
    }
    // We hold it: publish our identity, then start the heartbeat. The identity
    // write is not best-effort: a lock without a readable owner.json cannot be
    // verified on release, so the holder must give the directory back instead
    // of running with a lock anyone could delete (#266: release and reclaim
    // only ever target the rightful holder).
    try {
      writeFileSync(join(lockPath, OWNER_FILE), JSON.stringify({
        pid: process.pid,
        host: hostname(),
        startedAt: Date.now(),
      }));
    } catch (e) {
      // ENOENT here means the directory we created is already gone — another
      // waiter swept it (its stale window elapsed while we were between mkdir
      // and this write) and may already have put its own lock in its place.
      // Deleting `lockPath` then would delete that new holder's lock, so leave
      // it alone and just fail this attempt: the caller retries and races on
      // mkdir like anyone else.
      const gone = (e as NodeJS.ErrnoException)?.code === "ENOENT";
      if (!gone) {
        try { rmSync(lockPath, { recursive: true, force: true }); } catch { /* swept */ }
      }
      throw new Error("Session lock could not record its owner; refusing to run without a verifiable lock.");
    }
    let beating = true;
    const beat = () => {
      if (!beating) return;
      let stillOurs: boolean;
      try {
        stillOurs = ownsLockDir(lockPath);
      } catch {
        // A transient read failure (a competing process rewriting the file,
        // a filesystem hiccup) says nothing about ownership. Stopping the
        // heartbeat here would be the worst possible reaction: the lock would
        // age out while its holder is still running, and the next waiter would
        // reclaim a live run. Skip this beat and try again on the next tick.
        return;
      }
      // Stop touching files that belong to a new holder: a directory that no
      // longer names us was reclaimed while we ran.
      if (!stillOurs) {
        beating = false;
        return;
      }
      try {
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
      // Delete only a lock we still own: a directory that now names someone
      // else was reclaimed while we ran and must survive. A read failure means
      // we cannot prove ownership, so the safe action is to leave it alone —
      // an unreleased lock ages out, a wrongly deleted one hands the session
      // to two writers.
      let stillOurs: boolean;
      try {
        stillOurs = ownsLockDir(lockPath);
      } catch {
        return;
      }
      if (!stillOurs) return;
      try { rmSync(lockPath, { recursive: true, force: true }); } catch { /* already swept */ }
    };
  }
}

// The identity is written before the lock is handed back, and a failed write
// aborts the acquisition, so by the time this runs a readable owner.json is
// the only legitimate state: a directory that does not name us was reclaimed
// by someone else and must not be touched.
//
// Throws UnreadableOwnerError when the file exists but cannot be read. Callers
// decide what that means for them — the heartbeat skips a beat, release leaves
// the lock alone — because neither can prove ownership and guessing either way
// is unsafe.
function ownsLockDir(lockPath: string): boolean {
  const owner = readLockOwner(lockPath);
  return owner !== undefined && owner.pid === process.pid && owner.host === hostname();
}
