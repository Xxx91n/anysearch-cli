// Cross-process session lock (#266, D12, T3).
//
// One PI session record has one writer: two processes appending to the same
// JSONL at once would interleave entries, so every run of a session with a
// durable PI record takes a lock before touching it. The lock is a directory
// (mkdir is atomic) under `<piSessionDir>/locks/<key>.lock` holding:
//
//   owner.json  { pid, host, lockedAt } — the holder's identity
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
//                                running holder keeps refreshing it. A failed
//                                heartbeat write stops the beat for good, so
//                                this window is a last resort, not a promise.
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
import { probePid, type PidLiveness } from "@anysearch-cli/store/process-liveness";
import { isPositiveWholeInt } from "./num";

/**
 * Reclaim window for an owner this machine has no pid evidence about — another
 * host, a missing or unreadable identity, or a pid the probe cannot classify.
 * A same-host owner the probe confirms alive is never aged out.
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

/** The marker every busy answer starts with, so a log filter can find them all
 *  even when the sentence after it has to change. */
export const SESSION_BUSY_MARKER = "Session is busy: ";

export const SESSION_BUSY_MESSAGE =
  SESSION_BUSY_MARKER + "another run still holds this session (possibly in another process); retry after it finishes.";

/** Who holds the lock, and what the probe said about it. Best effort: an
 *  identity that is missing or unreadable is simply not described. */
export interface SessionBusyFacts {
  holder?: SessionLockHolder;
  /** Only a same-host holder can be probed; absent means nobody to ask. */
  liveness?: PidLiveness;
}

function readSessionBusyFacts(lockPath: string): SessionBusyFacts {
  let holder: SessionLockHolder | undefined;
  try {
    holder = readSessionLockHolder(lockPath);
  } catch {
    return {};
  }
  if (!holder) return {};
  return holder.host === hostname()
    ? { holder, liveness: probePid(holder.pid) }
    : { holder };
}

/**
 * The busy sentence: who holds the lock, where it lives, and the one way out.
 *
 * The way out is worded for what the probe actually said, because one sentence
 * cannot be true for all four: a confirmed-alive holder must not be told to
 * delete a running run's lock, a confirmed-dead one must not be told to wait
 * for a process that is gone, and a lock with no readable identity has no
 * "that process" to point at.
 */
function lockBusyMessage(lockPath: string, facts: SessionBusyFacts): string {
  const holder = facts.holder
    ? " Holder: pid " + facts.holder.pid + " on " + facts.holder.host + holderNote(facts) + "."
    : "";
  if (facts.liveness === "dead") {
    // The marker without its usual tail: "retry after it finishes" would name a
    // process this waiter just proved is gone.
    return SESSION_BUSY_MARKER + "this session's lock is still held." + holder
      + " Lock: " + lockPath + ". That process is gone, so delete that lock directory and retry.";
  }
  if (facts.liveness === "alive") {
    return SESSION_BUSY_MESSAGE + holder + " Lock: " + lockPath
      + ". If that pid no longer belongs to that run, delete that lock directory and retry.";
  }
  const advice = facts.holder
    ? " If you are sure that process is gone, delete that lock directory and retry."
    : " If you are sure nobody is using it, delete that lock directory and retry.";
  return SESSION_BUSY_MESSAGE + holder + " Lock: " + lockPath + "." + advice;
}

/** What the holder line adds: whether it is still running, and when the lock
 *  was taken. */
function holderNote(facts: SessionBusyFacts): string {
  const lockedAt = facts.holder?.lockedAt;
  const notes = [
    facts.liveness === "alive" ? "still running" : "",
    lockedAt === undefined ? "" : "lock taken at " + new Date(lockedAt).toISOString(),
  ].filter(Boolean);
  return notes.length > 0 ? " (" + notes.join(", ") + ")" : "";
}

/** What a host needs to word the collision itself. Undefined for any other
 *  error, so a caller can tell contention from a filesystem fault. */
export function sessionBusyFacts(error: unknown): SessionBusyFacts | undefined {
  return error instanceof LockHeldError ? error.facts : undefined;
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

/**
 * Who a lock names. `lockedAt` is when the lock was taken — not when the
 * process started — and only the busy message reads it. No reclaim decision
 * uses it.
 */
export interface SessionLockHolder {
  pid: number;
  host: string;
  lockedAt?: number;
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
  constructor(readonly facts: SessionBusyFacts, lockPath: string) {
    super(lockBusyMessage(lockPath, facts));
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

function readSessionLockHolder(lockPath: string): SessionLockHolder | undefined {
  let text: string;
  try {
    text = readFileSync(join(lockPath, OWNER_FILE), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
    throw new UnreadableOwnerError("owner.json exists but cannot be read");
  }
  try {
    const raw = JSON.parse(text) as Partial<SessionLockHolder> & { startedAt?: unknown };
    if (!isPositiveWholeInt(raw.pid) || typeof raw.host !== "string") {
      throw new UnreadableOwnerError("owner.json has no usable identity");
    }
    // Best effort, unlike the identity above: a missing or unusable time only
    // costs the message that one detail. `startedAt` is the field's older name,
    // still present in locks written before the rename.
    const lockedAt = readableTime(raw.lockedAt) ?? readableTime(raw.startedAt);
    return lockedAt === undefined
      ? { pid: raw.pid as number, host: raw.host }
      : { pid: raw.pid as number, host: raw.host, lockedAt };
  } catch (e) {
    if (e instanceof UnreadableOwnerError) throw e;
    throw new UnreadableOwnerError("owner.json is not valid JSON");
  }
}

/**
 * A timestamp the message can print, or undefined. A value outside what a Date
 * can represent makes `toISOString()` throw, which would turn a "session busy"
 * answer into an unreadable crash on the way out.
 */
function readableTime(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return undefined;
  return Number.isFinite(new Date(value).getTime()) ? value : undefined;
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
  let owner: SessionLockHolder | undefined;
  try {
    owner = readSessionLockHolder(lockPath);
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
      lockedAt: Date.now(),
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
  if (!release) throw new LockHeldError(readSessionBusyFacts(leasePath), leasePath);
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
    if (Date.now() >= deadlineAt) throw new LockHeldError(readSessionBusyFacts(lockPath), lockPath);
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
  const owner = readSessionLockHolder(lockPath);
  return owner !== undefined && owner.pid === process.pid && owner.host === hostname();
}
