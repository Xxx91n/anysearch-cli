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
//   same host + confirmed dead   reclaimed at the next poll
//   same host + confirmed alive  never reclaimed, however old the heartbeat is
//   same host + probe unknown    reclaimed only once the stale window has
//                                passed — the pid says nothing, so the
//                                heartbeat is the only evidence left, and a
//                                holder that is really running keeps it fresh
//   other host / no identity     reclaimed only once the stale window has
//                                passed — the conservative rule for an owner
//                                this machine has no pid evidence about. A lock
//                                without owner.json yet is fresh by directory
//                                mtime, which holds a just-created lock until
//                                its identity lands.
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
// Design: liveness is the store's one rule (#570) — only a same-host ESRCH
// proves the owner is gone, and EPERM proves the process exists for another
// user, so neither of those two is ever aged out. A probe that cannot classify
// the pid proves nothing either way: that owner is judged by the same heartbeat
// window as a foreign one (#576), so a run that died without a reclaimable pid
// recovers on its own, while a holder that is still running keeps the window
// fresh and is left alone.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { probePid } from "@anysearch-cli/store/process-liveness";

/**
 * Reclaim window for an owner this machine has no pid evidence about — another
 * host, or a missing/unreadable identity. A same-host owner that merely cannot
 * be proven dead is never aged out.
 */
export const SESSION_LOCK_STALE_MS = 10 * 60_000;
/** #317: no automatic wait; callers must explicitly request a positive cap. */
export const SESSION_LOCK_WAIT_MS = 0;
/** Subdirectory of the PI session dir holding the per-session lock dirs. */
export const SESSION_LOCKS_DIRNAME = "locks";
/**
 * Subdirectory holding the chat-attempt leases (#299). A separate directory
 * from `locks`: the run lock serializes the JSONL append, while this lease
 * covers the whole attempt including the two chat_projects writes. Same
 * session, two different questions — one path each, so they never nest.
 */
export const SESSION_LEASE_DIRNAME = "leases";

const POLL_MS = 50;
const HEARTBEAT_MIN_MS = 100;
const HEARTBEAT_MAX_MS = 5_000;

export const SESSION_BUSY_MESSAGE =
  "Session is busy: another run still holds this session (possibly in another process); retry after it finishes.";

/**
 * The busy sentence a waiter raises, naming the lock directory it could not
 * take.
 *
 * The path is the point: a lock whose owner left no pid this machine can
 * confirm outlives its stale window, and clearing one by hand is the last
 * resort. A sentence that only says "retry later" leaves the user waiting for
 * a run that will never end.
 */
function sessionBusyMessage(lockPath: string): string {
  return SESSION_BUSY_MESSAGE + " Lock: " + lockPath
    + ". If you are sure that process is gone, delete that lock directory and retry.";
}

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
    waitMs: windows?.waitMs === 0 ? 0 : positiveMs(windows?.waitMs, SESSION_LOCK_WAIT_MS),
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
 * The directory already belongs to a reachable holder. Separate from other
 * failures so the waiting path can poll and the one-shot path can answer
 * "busy" instead of retrying: only this one means "someone else has it".
 *
 * Carries the lock directory so the message can name it: contention is the one
 * failure a person can clear by hand, and they cannot clear a path they were
 * never shown.
 */
class LockHeldError extends Error {
  constructor(readonly lockPath: string) {
    super(sessionBusyMessage(lockPath));
    this.name = "LockHeldError";
  }
}

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
 * comment for the rule table. The one-line version: a local owner that is
 * confirmed alive is never reclaimed; a confirmed-dead local owner is reclaimed
 * at once; an owner this machine has no usable pid evidence about — another
 * host, a missing or unreadable identity, or a probe that cannot classify the
 * pid — has to outlive the stale window.
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
    const liveness = probePid(owner.pid);
    if (liveness === "dead") return true;
    if (liveness === "alive") return false;
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
 * Try to take the directory at `lockPath`, allowing one immediate sweep of a
 * holder this machine can prove is gone. Never sleeps.
 *
 * Returns the release function on success, or null when a reachable holder has
 * it right now. Filesystem faults still throw: "I could not even try" is a
 * different answer from "someone else has it", and merging them would report a
 * permissions problem as a busy session.
 */
function takeLockDir(lockPath: string, staleMs: number): (() => void) | null {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(lockPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e;
      // One sweep, no poll. A live local holder is never reclaimable, so this
      // cannot take a running session away from someone.
      if (!sweepStaleLock(lockPath, staleMs)) return null;
      // The directory is gone: loop once to race on mkdir like anyone else.
      continue;
    }
    return publishOwnership(lockPath, staleMs);
  }
  // Someone else won the mkdir race after our sweep.
  return null;
}

/**
 * Mark the directory we just created as ours and start its heartbeat.
 *
 * The identity write is not best-effort: a lock without a readable owner.json
 * cannot be verified on release, so the holder must give the directory back
 * instead of running with a lock anyone could delete.
 */
function publishOwnership(lockPath: string, staleMs: number): () => void {
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
    // it alone and just fail this attempt.
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

/**
 * Acquire a lease that is refused the moment it is held — no waiting, no
 * polling (#299).
 *
 * Two chat attempts on one session must not both believe they own the
 * session's completion state. The waiting form below is right for a turn that
 * queues behind a running one; this form is right for an attempt that has not
 * started yet, because a caller that cannot start has nothing to wait for.
 *
 * A holder this machine can prove is gone is still swept at once, so a killed
 * process does not lock its session out until someone restarts something.
 */
export async function acquireSessionLease(
  leasePath: string,
  windows: ResolvedSessionLockWindows,
): Promise<() => void> {
  mkdirSync(dirname(leasePath), { recursive: true });
  const release = takeLockDir(leasePath, windows.staleMs);
  if (!release) throw new LockHeldError(leasePath);
  return release;
}

/**
 * True when the error came from a lease that someone else is holding right
 * now (as opposed to a filesystem fault). The caller decides the wording; this
 * only answers "was it contention?".
 */
export function isSessionBusy(error: unknown): boolean {
  return error instanceof LockHeldError;
}

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
    // Try once even with a zero cap: an uncontended session can start. After
    // contention, the cap bounds retries; zero never enters the polling path.
    const release = takeLockDir(lockPath, staleMs);
    if (release) return release;
    if (Date.now() >= deadlineAt) throw new LockHeldError(lockPath);
    await sleep(POLL_MS);
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
