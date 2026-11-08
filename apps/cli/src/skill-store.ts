// Minimal Agent Skill installer (#109, parent #30, T6 decision #92).
// Design: install from a local Git checkout into skills/synced/, with one
// installed.json manifest — a directory convention, not a package manager.
// The sibling skills/<name>/ space belongs to user-authored skills. This module
// never reads or writes domain TOML: installation is NOT active skill list activation.

import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync, cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync,
  realpathSync, renameSync, rmSync, writeFileSync, type Stats,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import { parseDocument } from "yaml";
import { atomicRename as renameWithRetry, renameSeam, setRenameSeam, sleepSync } from "./fs-atomic";

export interface SkillOptions {
  home?: string;
  cwd?: string;
  project?: boolean;
}

export interface InstalledSkill {
  name: string;
  /** Absolute path of the selected directory in a local Git checkout. */
  source: string;
  /** HEAD when copied; dirty=true means the copy also contained uncommitted changes. */
  commit: string;
  tag?: string;
  dirty: boolean;
}

export interface SkillManifest {
  version: 1;
  skills: Record<string, InstalledSkill>;
}

export interface SkillValidation {
  name: string;
  ok: boolean;
  error?: string;
}

export class SkillError extends Error {
  constructor(message: string, readonly exitCode: 1 | 2 = 1) {
    super(message);
    this.name = "SkillError";
  }
}

function fail(message: string, exitCode: 1 | 2 = 1): never {
  throw new SkillError(message, exitCode);
}

/** Return lstat metadata, or undefined when the path does not exist. */
function statIfPresent(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Require a real directory, rejecting files and symlinks before filesystem authority is granted. */
function requireDirectory(path: string, label: string): void {
  const stat = statIfPresent(path);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
    fail(`${label} must be a real directory, not a file or symlink: ${path}`);
  }
}

/** Require a regular file, rejecting directories and symlinks. */
function requireFile(path: string, label: string): void {
  const stat = statIfPresent(path);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
    fail(`${label} must be a regular, non-symlink file: ${path}`);
  }
}

/** Resolve the selected scope's skills root (user or project). */
export function skillsRoot(opts: SkillOptions = {}): string {
  return opts.project
    ? join(resolve(opts.cwd ?? process.cwd()), ".anysearch", "skills")
    : join(resolve(opts.home ?? homedir()), ".anysearch-cli", "skills");
}

/** Resolve the machine-managed synced/ directory inside the selected scope. */
export function managedSkillsRoot(opts: SkillOptions = {}): string {
  return join(skillsRoot(opts), "synced");
}

/** Resolve the manifest path inside a managed root. */
function manifestIn(managed: string): string {
  return join(managed, "installed.json");
}

/** Resolve the installed.json manifest path for the selected scope. */
export function skillManifestPath(opts: SkillOptions = {}): string {
  return manifestIn(managedSkillsRoot(opts));
}

/** Lock directory that serializes manifest read-modify-write within one scope. */
const MANIFEST_LOCK = ".installed.lock";
/** Staging prefix used by install before the atomic publish rename. */
const STAGING_PREFIX = ".install-";
/** Temp-manifest prefix used by writeManifest before the atomic replace. */
const MANIFEST_TEMP_PREFIX = ".installed-";
/** Prefix for a stale lock moved aside during reclamation. */
const LOCK_RECLAIM_PREFIX = `${MANIFEST_LOCK}.reclaim-`;
/** Guard that serializes reclaimers; only its holder may move the canonical lock. */
const RECLAIM_GUARD = `${MANIFEST_LOCK}.reclaiming`;
/** Prefix for a lock being built with its owner record before publication. */
const LOCK_PENDING_PREFIX = `${MANIFEST_LOCK}.pending-`;
/** Uninstall backup prefix; contents are never deleted without a manifest entry. */
const UNINSTALL_PREFIX = ".uninstall-";

// Design (#146): reconciliation matches the exact names the installer generates,
// never a prefix. Everything else in synced/ belongs to the operator: a prefix
// match would delete a hand-made `.installed-notes.tmp` or an `.install-archive/`
// directory kept next to an abandoned staging run, so the shapes are matched
// exactly, and the same predicates answer "is this root empty?" so the emptiness
// check and the delete decision can never disagree. A residue name from an older
// build is a false negative — it is left in place and reported, never deleted.
// Leaving a file is recoverable; deleting the wrong one is not.
// Exported so the contract test can assert these against the names mkdtempSync
// and randomUUID actually produce on every CI platform.
/** `.install-XXXXXX` from `mkdtempSync(join(managed, STAGING_PREFIX))`. */
export const STAGING_ENTRY = /^\.install-[A-Za-z0-9]{6}$/;
/** `.installed.lock.pending-XXXXXX` from `mkdtempSync(join(managed, LOCK_PENDING_PREFIX))`. */
export const LOCK_PENDING_ENTRY = /^\.installed\.lock\.pending-[A-Za-z0-9]{6}$/;
/**
 * `.installed-<uuid v4>.tmp` from `writeManifest`'s `randomUUID()` temp file.
 * `randomUUID()` only emits version-4 UUIDs with RFC 4122 variant bits, so the
 * version and variant nibbles are pinned too: a hand-made file carrying another
 * UUID version is not something the installer can have written.
 */
export const MANIFEST_TEMP_ENTRY =
  /^\.installed-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/;
/** `.installed.lock.reclaim-<uuid v4>` from the quarantine rename during reclamation. */
export const QUARANTINE_ENTRY =
  /^\.installed\.lock\.reclaim-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Rename backoff lives in fs-atomic (#145): the Windows/POSIX retryability gate is
// an explicit `platform` seam field there — not object identity on a default IO —
// so the POSIX-only-EBUSY semantics is directly testable. Re-exported under the
// historical names so existing skill-store callers keep working.
export { renameWithRetry, renameSeam, setRenameSeam };
export type { RenameSeam } from "./fs-atomic";
/** @deprecated use `renameSeam` / `setRenameSeam`; kept so existing callers keep working. */
export const skillRenameIO = renameSeam;

// Design: names are single path segments on every supported OS — the Agent Skills
// naming rule also excludes traversal, absolute paths, Windows device names and separators.
/** Assert a safe Agent Skill name usable as a single directory segment. */
function requireName(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(value)
    || value.includes("--") || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(value)) {
    fail("skill name must be 1–64 lowercase letters/digits, with single hyphens, and not a reserved device name");
  }
}

/** Check that a manifest source is an absolute, control-character-free path string. */
function printablePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && isAbsolute(value)
    && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Check for a non-null, non-array object record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Fail closed on a corrupt manifest without changing installed files. */
function corruptManifest(path: string, detail: string): never {
  fail(`invalid skill manifest ${path}: ${detail}. No files were changed; repair the manifest before retrying.`);
}

// Design: destructive operations authenticate the entire manifest before touching
// any directory — missing, malformed and schema-invalid manifests all fail closed,
// and deletion targets are never rediscovered by scanning the filesystem.
/** Fail with the canonical missing-manifest message. */
function missingManifest(managed: string): never {
  fail(`skill manifest is missing: ${manifestIn(managed)}. Refusing to guess installation targets; no files were removed.`);
}

/** Read and schema-validate the manifest, validating the scope anchor before trusting it. */
function readManifest(managed: string): SkillManifest {
  const path = manifestIn(managed);
  const stat = statIfPresent(path);
  if (!stat) missingManifest(managed);
  requireScopeAnchors(managed);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`skill manifest must be a regular, non-symlink file: ${path}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    corruptManifest(path, (error as Error).message);
  }
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.skills)) {
    corruptManifest(path, "expected version 1 and a skills object");
  }
  const skills: Record<string, InstalledSkill> = Object.create(null);
  for (const [key, value] of Object.entries(raw.skills)) {
    if (!isRecord(value)) corruptManifest(path, `entry ${key} must be an object`);
    try {
      requireName(key);
    } catch (error) {
      corruptManifest(path, (error as Error).message);
    }
    const { name, source, commit, tag, dirty } = value;
    if (name !== key || !printablePath(source)
      || typeof commit !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)
      || typeof dirty !== "boolean"
      || (tag !== undefined && (typeof tag !== "string" || !tag.trim() || /[\u0000-\u001f\u007f]/.test(tag)))) {
      corruptManifest(path, `entry ${key} has invalid name/source/commit/tag/dirty fields`);
    }
    skills[key] = {
      name: key,
      source,
      commit,
      dirty,
      ...(tag !== undefined ? { tag } : {}),
    };
  }
  return { version: 1, skills };
}

/** Derive the skills root from a managed synced/ path. */
function skillsRootFromManaged(managed: string): string {
  return resolve(managed, "..");
}

// Design: the selected scope anchor (.anysearch / .anysearch-cli) is part of the
// trust boundary — a project-controlled .anysearch symlink must not alias the
// user store, so it is validated before manifest read/write/delete authority.
/** Derive the scope anchor (.anysearch / .anysearch-cli) from a managed path. */
function scopeRootFromManaged(managed: string): string {
  return resolve(managed, "..", "..");
}

/** Require a non-symlink scope anchor, including Windows junction/reparse redirection. */
function requireScopeRoot(scope: string): void {
  requireDirectory(scope, "scope root");
  const expected = join(realpathSync(resolve(scope, "..")), basename(scope));
  const actual = realpathSync(scope);
  const same = process.platform === "win32" ? actual.toLowerCase() === expected.toLowerCase() : actual === expected;
  if (!same) fail(`scope root must not be a symlink or junction: ${scope}`);
}

/** Validate the scope anchor, skills root and managed root before granting filesystem authority. */
function requireScopeAnchors(managed: string): void {
  requireScopeRoot(scopeRootFromManaged(managed));
  requireDirectory(skillsRootFromManaged(managed), "skills root");
  requireDirectory(managed, "managed skills root");
}

/** Owner record written into the lock directory for diagnostics and ownership checks. */
interface LockOwner {
  token: string;
  pid: number;
  host: string;
  startedAt: string;
  /** Stable machine identity; missing means fail-closed. */
  machineId?: string;
  /** Boot identity; a different boot proves the recorded process is gone. */
  bootId?: string;
  /** PID-namespace identity; a different namespace makes liveness undecidable. */
  namespace?: string;
}

export interface PidIdentity {
  bootId: string;
  namespace: string;
}

/** Identity of this process's boot and PID namespace, or undefined when unavailable. */
export function pidIdentity(): PidIdentity | undefined {
  if (process.platform !== "linux") return undefined;
  try {
    const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    const namespace = readlinkSync("/proc/self/ns/pid");
    return bootId && namespace ? { bootId, namespace } : undefined;
  } catch {
    return undefined;
  }
}

/** Stable machine identity independent of hostname(); undefined when unavailable. */
export function machineId(): string | undefined {
  try {
    if (process.platform === "linux") {
      const id = readFileSync("/etc/machine-id", "utf8").trim();
      // Accept only a valid 32-char lowercase hex ID; reject placeholders (all zeros).
      return /^[0-9a-f]{32}$/.test(id) && id !== "00000000000000000000000000000000" ? id : undefined;
    }
    if (process.platform === "win32") {
      const out = execFileSync("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], { encoding: "utf8", timeout: 5000 });
      const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/);
      const guid = m?.[1];
      // Reject all-zero placeholder GUIDs (e.g. unprovisioned VMs).
      return guid && guid !== "00000000-0000-0000-0000-000000000000" ? guid : undefined;
    }
    if (process.platform === "darwin") {
      const out = execFileSync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], { encoding: "utf8", timeout: 5000 });
      const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      return m?.[1] || undefined;
    }
  } catch {
    // Unavailable — fail closed in probeLockOwner.
  }
  return undefined;
}

/** Read the recorded lock owner, or undefined when the record is absent or malformed. */
function readLockOwner(lock: string): LockOwner | undefined {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(lock, "owner.json"), "utf8"));
    if (isRecord(raw) && typeof raw.token === "string" && typeof raw.pid === "number"
      && typeof raw.host === "string" && typeof raw.startedAt === "string"
      && (raw.machineId === undefined || typeof raw.machineId === "string")
      && (raw.bootId === undefined || typeof raw.bootId === "string")
      && (raw.namespace === undefined || typeof raw.namespace === "string")) {
      return {
        token: raw.token, pid: raw.pid, host: raw.host, startedAt: raw.startedAt,
        ...(raw.machineId !== undefined ? { machineId: raw.machineId } : {}),
        ...(raw.bootId !== undefined ? { bootId: raw.bootId } : {}),
        ...(raw.namespace !== undefined ? { namespace: raw.namespace } : {}),
      };
    }
  } catch {
    // Diagnostics only: an unreadable owner file still blocks the operation.
  }
  return undefined;
}

/** Describe the recorded lock holder when the owner file is readable. */
function describeLockHolder(lock: string): string {
  const owner = readLockOwner(lock);
  return owner ? ` (pid ${owner.pid} on ${owner.host})` : "";
}

type LockState = "alive" | "dead" | "unknown";

// Design: staleness = pid liveness on the machine, boot, and PID namespace that
// wrote the lock — not age, so a long-running install never needs a heartbeat. A
// stable machine identity must match before boot-ID or PID checks; a different boot
// proves death; a different namespace or an unreadable owner is undecidable and stays
// fail-closed.
/** Classify a lock owner as alive, provably dead, or undecidable. */
function probeLockOwner(owner: LockOwner | undefined): LockState {
  if (!owner || !Number.isInteger(owner.pid) || owner.pid <= 0) return "unknown";
  // Design: compare a stable machine identity before hostname, boot-ID, or PID
  // probing — two hosts that share a managed root and happen to use the same
  // hostname must not reclaim each other's live locks.
  const mid = machineId();
  if (!owner.machineId || !mid || owner.machineId !== mid) return "unknown";
  const identity = pidIdentity();
  if (owner.bootId && identity && owner.bootId !== identity.bootId) return "dead";
  // Containers can share a hostname but not a PID namespace, and ESRCH inside one
  // namespace says nothing about a pid in another.
  if (owner.namespace !== identity?.namespace) return "unknown";
  try {
    process.kill(owner.pid, 0);
    return "alive";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return "dead";
    // EPERM means the process exists but belongs to another user.
    if (code === "EPERM") return "alive";
    return "unknown";
  }
}

// Design: an exclusive, owner-recorded guard serializes reclaimers — the holder
// re-reads the token before moving the lock, and the quarantine rename plus token
// re-check afterwards restore a lock that changed hands, so a possibly live lock is
// never removed.
/** Move a provably dead lock aside; false means another reclaimer is active. */
function reclaimDeadLock(managed: string, lock: string, observed: LockOwner, owner: LockOwner): boolean {
  const guard = join(managed, RECLAIM_GUARD);
  if (!acquireReclaimGuard(managed, guard, owner)) return false;
  try {
    // Only the guard holder may move the lock, so this re-read cannot be acted on
    // once another process has republished a live lock.
    const current = readLockOwner(lock);
    if (!current || current.token !== observed.token) return false;
    const quarantine = join(managed, `${LOCK_RECLAIM_PREFIX}${randomUUID()}`);
    try {
      renameWithRetry(lock, quarantine);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    const moved = readLockOwner(quarantine);
    if (moved?.token !== observed.token) {
      // The lock changed hands: restore it only into a free path; a single attempt
      // avoids sleeping out the retry budget while a new holder owns the lock.
      if (statIfPresent(lock)) {
        fail(`skill lock changed hands while reclaiming it; inspect ${quarantine} and ${lock} before retrying.`);
      }
      try {
        renameSync(quarantine, lock);
      } catch {
        fail(`skill lock could not be restored while reclaiming it; inspect ${quarantine} and ${lock} before retrying.`);
      }
      fail(`skill lock changed hands while reclaiming it; another skill operation is running${describeLockHolder(lock)}. Retry when it finishes.`);
    }
    rmSync(quarantine, { recursive: true, force: true });
    return true;
  } finally {
    releaseOwnedLock(guard, owner.token);
  }
}

/** Publish the reclaim guard; false means another reclaimer already holds it. */
function acquireReclaimGuard(managed: string, guard: string, owner: LockOwner): boolean {
  if (createLockDirectory(managed, guard, owner)) return true;
  const observed = readLockOwner(guard);
  const state = probeLockOwner(observed);
  if (state === "alive") return false;
  if (state !== "dead" || !observed) {
    fail(`skill lock reclaim guard cannot be proven dead: ${guard}. Inspect it and remove the directory if no ans skill process is running.`);
  }
  // Design: recover a dead guard through the same unique-rename election as a lock —
  // two reclaimers must not both delete and republish it.
  const quarantine = join(managed, `${LOCK_RECLAIM_PREFIX}${randomUUID()}`);
  try {
    renameWithRetry(guard, quarantine);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  const moved = readLockOwner(quarantine);
  if (moved?.token !== observed.token) {
    // Design: never swallow a displaced guard — restore it, or fail closed, because
    // two concurrent reclaimers could otherwise move locks at the same time.
    if (statIfPresent(guard)) {
      fail(`skill lock reclaim guard changed hands; inspect ${quarantine} and ${guard} before retrying.`);
    }
    try {
      renameWithRetry(quarantine, guard);
    } catch {
      fail(`skill lock reclaim guard could not be restored; inspect ${quarantine} and ${guard} before retrying.`);
    }
    return false;
  }
  rmSync(quarantine, { recursive: true, force: true });
  return createLockDirectory(managed, guard, owner);
}

/** Remove a lock only while it still carries the caller's token. */
export function releaseOwnedLock(lock: string, token: string): boolean {
  // A manually reclaimed or replaced lock must survive its old holder's release.
  if (readLockOwner(lock)?.token !== token) return false;
  rmSync(lock, { recursive: true, force: true });
  return true;
}

/** Publish a lock that already contains its owner record; false means contention. */
function createLockDirectory(managed: string, lock: string, owner: LockOwner): boolean {
  // Design: publish the lock with its owner in one rename and refuse to replace an
  // existing path — POSIX would otherwise take over an empty directory an older
  // build may still be filling. A rename failure here is ordinary contention, not a
  // transient publishing error, so it fails fast instead of using the 60s budget.
  const pending = mkdtempSync(join(managed, LOCK_PENDING_PREFIX));
  try {
    writeFileSync(join(pending, "owner.json"), JSON.stringify(owner), { encoding: "utf8", flag: "wx", mode: 0o600 });
    if (statIfPresent(lock)) return false;
    try {
      renameSync(pending, lock);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST" || code === "ENOTEMPTY" || code === "EPERM" || code === "EBUSY") return false;
      throw error;
    }
  } finally {
    rmSync(pending, { recursive: true, force: true });
  }
}

/** Acquire the exclusive manifest lock and return its release function. */
function acquireManifestLock(managed: string): () => void;
/** Acquire the lock, or return undefined when a live holder makes cleanup unsafe. */
function acquireManifestLock(managed: string, skipOnContention: true): (() => void) | undefined;
// Design: one coarse directory lock per managed root, published atomically with its
// owner record — it serializes read → publish/remove → write, never evicts a live
// holder, and reclaims only a pid proven dead on this host and PID namespace;
// contention fails closed instead of deleting a lock that may be live.
function acquireManifestLock(managed: string, skipOnContention = false): (() => void) | undefined {
  const lock = join(managed, MANIFEST_LOCK);
  const token = randomUUID();
  const identity = pidIdentity();
  const mid = machineId();
  let reclaimBusy = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const owner: LockOwner = {
      token, pid: process.pid, host: hostname(), startedAt: new Date().toISOString(),
      ...(mid ? { machineId: mid } : {}),
      ...(identity ? { bootId: identity.bootId, namespace: identity.namespace } : {}),
    };
    if (createLockDirectory(managed, lock, owner)) {
      return () => {
        releaseOwnedLock(lock, token);
      };
    }
    const observed = readLockOwner(lock);
    const state = probeLockOwner(observed);
    if (state === "dead" && observed) {
      if (!reclaimDeadLock(managed, lock, observed, owner)) {
        reclaimBusy = true;
        sleepSync(5);
      }
      continue;
    }
    if (skipOnContention) return undefined;
    if (state === "alive") {
      fail(`another skill operation is running in this scope${describeLockHolder(lock)}: ${lock}. Retry when it finishes.`);
    }
    if (observed && observed.host !== hostname()) {
      fail(`another skill operation may be running in this scope${describeLockHolder(lock)}: ${lock}. The lock was created on ${observed.host}, so it cannot be proven dead from ${hostname()}; automatic reclamation is limited to this host. If no ans skill process is running there, remove that directory and retry.`);
    }
    fail(`another skill operation may be running in this scope: ${lock}. The owner record is incomplete, from another machine, from another PID namespace, unreadable, or the lock path could not be published, so the lock cannot be proven dead. If no ans skill process is running on the machine that created it, remove that directory and retry.`);
  }
  if (skipOnContention) return undefined;
  if (reclaimBusy) {
    fail(`a stale-lock reclaim is in progress in this scope: ${join(managed, RECLAIM_GUARD)}. Retry when it finishes.`);
  }
  fail(`another skill operation is running in this scope${describeLockHolder(lock)}: ${lock}. Retry when it finishes.`);
}

/** Run one manifest read-modify-write under the scope lock, releasing it on every path. */
function withManifestLock<T>(managed: string, action: () => T): T {
  const release = acquireManifestLock(managed);
  try {
    return action();
  } finally {
    release();
  }
}

/** Create the managed root only after validating existing scope/skills/synced directories. */
function prepareManagedRoot(opts: SkillOptions): string {
  const root = skillsRoot(opts);
  const managed = managedSkillsRoot(opts);
  const scope = scopeRootFromManaged(managed);
  if (statIfPresent(scope)) requireScopeRoot(scope);
  if (statIfPresent(root)) requireDirectory(root, "skills root");
  if (statIfPresent(managed)) requireDirectory(managed, "managed skills root");
  mkdirSync(root, { recursive: true });
  mkdirSync(managed, { recursive: true });
  return managed;
}

// Design: a lock pending publication and the reclaim guard are not content — they are
// inert installer bookkeeping, so they must not block bootstrapping a scope. The
// pending name is matched exactly, so an operator's `.installed.lock.pending-<notes>`
// is content like any other file and keeps the scope fail-closed.
/** True when the managed root holds nothing but the lock (or inert bookkeeping). */
function isEmptyManagedRoot(managed: string): boolean {
  return !readdirSync(managed).some((entry) => entry !== MANIFEST_LOCK
    && entry !== RECLAIM_GUARD && !LOCK_PENDING_ENTRY.test(entry));
}

/** True when a name is installer-owned staging or a temp manifest. */
function isInstallerResidue(entry: string): boolean {
  return STAGING_ENTRY.test(entry) || MANIFEST_TEMP_ENTRY.test(entry);
}

// Design: residue cleanup is limited to a scopeless store (no manifest) — only then
// can no installation claim the staging copy or temp manifest. A dead reclaim
// quarantine is installer-owned too; a possibly live one is reported, never deleted.
// Backups, unknown entries and unrecorded skill directories stay for the operator.
/** Remove installer-owned residue; caller holds the manifest lock. */
function reconcileManagedRoot(managed: string): void {
  if (statIfPresent(manifestIn(managed))) return;
  for (const entry of readdirSync(managed)) {
    if (!QUARANTINE_ENTRY.test(entry)) continue;
    const quarantine = join(managed, entry);
    if (probeLockOwner(readLockOwner(quarantine)) !== "dead") {
      fail(`a reclaimed skill lock may still be live: ${quarantine}. Inspect it before removing.`);
    }
    rmSync(quarantine, { recursive: true, force: true });
  }
  // Design: an unpublished lock is inert unless its recorded owner is provably dead —
  // only then is removing the directory safe.
  for (const entry of readdirSync(managed)) {
    if (!LOCK_PENDING_ENTRY.test(entry)) continue;
    const pending = join(managed, entry);
    if (probeLockOwner(readLockOwner(pending)) === "dead") {
      rmSync(pending, { recursive: true, force: true });
    }
  }
  for (const entry of readdirSync(managed)) {
    if (isInstallerResidue(entry)) rmSync(join(managed, entry), { recursive: true, force: true });
  }
}

/** True when the managed root holds a dead lock or installer residue. */
function hasStaleLockOrResidue(managed: string): boolean {
  const entries = readdirSync(managed);
  if (entries.includes(MANIFEST_LOCK)) {
    const owner = readLockOwner(join(managed, MANIFEST_LOCK));
    if (owner && probeLockOwner(owner) === "dead") return true;
  }
  // A manifest-bearing store keeps its residue and quarantines for the operator;
  // only a scopeless store is reconciled automatically.
  if (statIfPresent(manifestIn(managed))) return false;
  if (entries.some((entry) => QUARANTINE_ENTRY.test(entry))) return true;
  // Design: only a provably dead unpublished lock needs a lock cycle — a live or
  // malformed one is inert and must not make reads contend with a starting writer.
  if (entries.some((entry) => LOCK_PENDING_ENTRY.test(entry)
    && probeLockOwner(readLockOwner(join(managed, entry))) === "dead")) return true;
  return entries.some(isInstallerResidue);
}

/** Best-effort reconciliation for read-only commands; never waits for a live writer. */
function maintainManagedRoot(managed: string): void {
  // Design: a clean scope stays untouched — reads take the lock only when a dead
  // lock or installer residue actually needs cleanup.
  if (!hasStaleLockOrResidue(managed)) return;
  const release = acquireManifestLock(managed, true);
  if (!release) return;
  try {
    reconcileManagedRoot(managed);
  } finally {
    release();
  }
}

/** Validate the scope anchors, then reconcile opportunistically. */
function maintainScope(managed: string): void {
  requireScopeAnchors(managed);
  maintainManagedRoot(managed);
}

/** Read an existing manifest, or bootstrap one only in an empty managed root. */
function readManifestForInstall(managed: string): SkillManifest {
  requireScopeAnchors(managed);
  if (!statIfPresent(manifestIn(managed))) {
    // Only a genuinely empty managed root may bootstrap a new manifest. An
    // orphaned directory is not permission to forget or overwrite its owner.
    // The lock we hold is not content.
    if (!isEmptyManagedRoot(managed)) {
      fail(`skill manifest is missing in a non-empty managed directory: ${managed}. Refusing to overwrite untracked installations.`);
    }
    return { version: 1, skills: Object.create(null) };
  }
  return readManifest(managed);
}

/** Atomically replace installed.json via a temporary file and rename. */
function writeManifest(managed: string, manifest: SkillManifest): void {
  const temporary = join(managed, `${MANIFEST_TEMP_PREFIX}${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(manifest, null, 2) + "\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameWithRetry(temporary, manifestIn(managed));
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Validate YAML syntax and the name used as the install directory; not a full skill linter. */
export function validateSkillFile(path: string): string {
  requireFile(path, "SKILL.md");
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) fail(`SKILL.md must start with YAML frontmatter delimited by ---: ${path}`);
  let frontmatter: unknown;
  try {
    const document = parseDocument(match[1], { version: "1.2", uniqueKeys: true });
    if (document.errors.length > 0) fail(document.errors[0].message);
    frontmatter = document.toJS({ maxAliasCount: 100 });
  } catch (error) {
    fail(`invalid YAML frontmatter in ${path}: ${(error as Error).message}`);
  }
  if (!isRecord(frontmatter)) fail(`SKILL.md frontmatter must be a YAML mapping: ${path}`);
  const name: unknown = frontmatter.name;
  requireName(name);
  return name;
}

/** Upper bound for a Git inspection child; a hung probe must fail, not hang installs. */
const GIT_TIMEOUT_MS = 10_000;
/** Grace period between the early-stop SIGTERM and the SIGKILL fallback. */
const GIT_KILL_GRACE_MS = 1_000;
/** Bound on buffered status stderr, kept only to explain a failure. */
const STATUS_STDERR_LIMIT = 8 * 1024;

/** Variables that redirect Git away from `-C <source>`: inherited values must not choose the repository. */
const REPOSITORY_LOCATION_ENV = [
  "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
] as const;

/** Build a Git child environment whose repository discovery comes from `-C` alone. */
function gitEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const key of REPOSITORY_LOCATION_ENV) delete env[key];
  return env;
}

/** Map a Git inspection failure to an actionable installer error. */
function inspectionError(source: string, error: unknown): SkillError {
  const e = error as (NodeJS.ErrnoException & { stderr?: Buffer | string }) | undefined;
  if (e?.code === "ENOENT") return new SkillError("Git is required to record the source commit; install Git and retry.");
  const detail = e?.stderr ? String(e.stderr).trim() : String(e?.message ?? error);
  return new SkillError(`cannot inspect Git source ${source}: ${detail}`);
}

/** Run a read-only Git inspection command in the source checkout. */
function git(source: string, args: string[]): string {
  try {
    // Design: provenance collection is data-only — repository-configured
    // fsmonitor helpers are disabled so `git status` cannot execute checkout code.
    return execFileSync("git", ["-c", "core.fsmonitor=false", "-C", source, ...args], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: gitEnv(),
      timeout: GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024,
    }).trim();
  } catch (error) {
    throw inspectionError(source, error);
  }
}

// Design: read both local and worktree config scopes — they are the two files a
// checkout can control, while global/system filters stay user-trusted.
/** List checkout-controlled config keys matching a pattern; exit status 1 means none. */
function gitConfigKeys(source: string, pattern: string): string[] {
  try {
    const output = execFileSync("git", [
      "-c", "core.fsmonitor=false", "-C", source,
      "config", "--show-scope", "--get-regexp", "--name-only", pattern,
    ], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
      env: gitEnv(), timeout: GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024,
    }).trim();
    return output.split(/\r?\n/).filter(Boolean)
      .map((line) => line.split("\t"))
      .filter((parts) => parts.length === 2 && (parts[0] === "local" || parts[0] === "worktree"))
      .map((parts) => parts[1]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException & { status?: number }).status === 1) return [];
    throw inspectionError(source, error);
  }
}

/** Narrow child-process surface of the streaming `git status` probe. */
export interface StatusProbeChild {
  stdout: Readable;
  stderr: Readable;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

/** Child factory for the dirty probe; injectable so the bound can be tested. */
export type StatusProbeSpawn = (
  command: string,
  args: string[],
  options: { stdio: ["ignore", "pipe", "pipe"]; windowsHide: true; env: NodeJS.ProcessEnv },
) => StatusProbeChild;

/** Spawn the real Git child for the bounded dirty probe. */
const defaultStatusProbeSpawn: StatusProbeSpawn = (command, args, options) =>
  spawn(command, args, options) as unknown as StatusProbeChild;

// Test seam (__setStatusProbeForTest): production always spawns real Git with the default bound.
let statusProbeHooks: { spawn?: StatusProbeSpawn; timeoutMs?: number } | null = null;

/** Replace the dirty-probe child factory and timeout in tests (#138 bounded-output regression). */
export function __setStatusProbeForTest(hooks: { spawn?: StatusProbeSpawn; timeoutMs?: number } | null): void {
  statusProbeHooks = hooks;
}

/**
 * Decide whether the selected source directory has tracked, staged, untracked or
 * ignored changes without buffering Git's listing (#138).
 *
 * Only the existence of the first entry matters, so `git status` is spawned with
 * a bounded read: as soon as one porcelain line arrives the child is stopped and
 * the remaining output is never collected. A checkout with tens of megabytes of
 * ignored entries therefore cannot exhaust a buffer or turn a usable source into
 * a provenance failure. Stopping the child is an intentional early exit, not a
 * Git failure — a non-zero exit before any entry, a spawn error or a timeout
 * still fails the install before anything is published.
 */
function isDirty(source: string): Promise<boolean> {
  const args = ["-c", "core.fsmonitor=false", "-C", source, "status", "--porcelain", "--untracked-files=all", "--ignored", "--ignore-submodules=all", "--", "."];
  const timeoutMs = statusProbeHooks?.timeoutMs ?? GIT_TIMEOUT_MS;
  return new Promise<boolean>((resolve, reject) => {
    const spawnChild = statusProbeHooks?.spawn ?? defaultStatusProbeSpawn;
    // Design: the same scrubbed environment as `git()` — `commit`, `tag` and
    // `dirty` must all describe the selected checkout. GIT_OPTIONAL_LOCKS=0 keeps
    // `git status` from refreshing and rewriting the index: the probe terminates
    // the child as soon as dirtiness is known, and interrupting an index refresh
    // could leave a stale .git/index.lock in the user's checkout.
    const env = gitEnv({ GIT_OPTIONAL_LOCKS: "0" });
    let child: StatusProbeChild;
    try {
      child = spawnChild("git", args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env });
    } catch (error) {
      reject(inspectionError(source, error));
      return;
    }
    let stderr = "";
    let entrySeen = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    // Design: never resolve on "we sent a signal". A child that ignores SIGTERM
    // is escalated to SIGKILL, so the probe never leaves an orphaned Git process.
    const stop = (signal: NodeJS.Signals) => {
      try {
        child.kill(signal);
      } catch {
        // The close/timeout path still decides the outcome.
      }
    };
    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      child.stdout.removeAllListeners("data");
      child.stdout.pause();
      action();
    };
    timer = setTimeout(() => {
      settle(() => reject(new SkillError(
        `cannot inspect Git source ${source}: git status did not finish within ${timeoutMs}ms. `
        + "No files were installed; retry, or check why Git hangs in that checkout.",
      )));
      stop("SIGKILL");
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (settled || entrySeen) return;
      // Design: porcelain entries are never whitespace-only; ignoring blank
      // chunks keeps the previous trimmed-output comparison intact.
      if (!/\S/.test(chunk)) return;
      entrySeen = true;
      // Early stop: drop the pipe so nothing further is buffered, then end Git.
      child.stdout.removeAllListeners("data");
      child.stdout.pause();
      stop("SIGTERM");
      killTimer = setTimeout(() => stop("SIGKILL"), GIT_KILL_GRACE_MS);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < STATUS_STDERR_LIMIT) stderr = (stderr + chunk).slice(0, STATUS_STDERR_LIMIT);
    });
    // Design: `on` (not `once`) — a second error after a kill must not crash the
    // installer as an unhandled 'error' event.
    child.on("error", (error) => {
      settle(() => {
        if (entrySeen) resolve(true);
        else reject(inspectionError(source, error));
      });
      stop("SIGKILL");
    });
    child.on("close", (code, signal) => {
      settle(() => {
        if (entrySeen) return resolve(true);
        if (code === 0) return resolve(false);
        const outcome = signal ? `git status was terminated by ${signal}` : `git status exited with code ${code}`;
        reject(new SkillError(`cannot inspect Git source ${source}: ${outcome}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
      });
    });
  });
}

/** Record the source path, HEAD commit, exact tag if present, and dirty state. */
async function provenance(source: string): Promise<Omit<InstalledSkill, "name">> {
  // Design: compare native-canonical paths — on Windows, plain realpath keeps
  // 8.3 short names while Git reports the long toplevel, so `relative` would
  // wrongly place the source outside its repository.
  const repository = realpathSync.native(git(source, ["rev-parse", "--show-toplevel"]));
  if (!contains(repository, realpathSync.native(source))) fail(`source is outside its Git working tree: ${source}`);
  const commit = git(source, ["rev-parse", "--verify", "HEAD^{commit}"]);
  // Exact tags only; lexical ordering makes multiple tags deterministic. A tag
  // is supplementary: the full commit is always recorded, even without a tag.
  const tag = git(source, ["tag", "--points-at", "HEAD", "--sort=refname"]).split(/\r?\n/).filter(Boolean)[0];
  // Design: `git status` re-hashes stat-dirty files and therefore runs repo-defined
  // filter.<name>.clean/process drivers even with fsmonitor off — those are
  // attacker-controlled code, so a source that defines any is refused before status.
  const filters = gitConfigKeys(source, "^filter\\..*\\.(clean|process)$");
  if (filters.length > 0) {
    fail(`source repository defines Git content filters (${filters.join(", ")}); refusing to run status on it. Remove those definitions from the repository's local or worktree Git config, or install an export without .git.`);
  }
  const dirty = await isDirty(source);
  return { source, commit, dirty, ...(tag ? { tag } : {}) };
}

/** Check lexical containment to prevent installing a directory into itself. */
function contains(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel));
}

/** Install a local Git skill directory into the managed scope without activating it. */
export async function installSkill(sourceArgument: string, opts: SkillOptions = {}): Promise<InstalledSkill> {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(sourceArgument) || /^git@[^:]+:/.test(sourceArgument)) {
    fail("only local Git checkout directories are supported; clone and checkout the desired commit/tag first", 2);
  }
  let source: string;
  try {
    source = realpathSync(resolve(opts.cwd ?? process.cwd(), sourceArgument));
  } catch {
    fail(`source directory does not exist: ${sourceArgument}`, 2);
  }
  requireDirectory(source, "source");
  // Design: a source path is persisted in installed.json, whose validator
  // rejects control characters — reject it here so an install cannot brick the scope.
  if (!printablePath(source)) fail("source directory path must be absolute and free of control characters");
  const name = validateSkillFile(join(source, "SKILL.md"));
  const metadata = await provenance(source);
  const managed = managedSkillsRoot(opts);
  const target = join(managed, name);
  if (contains(source, target)) fail("source contains its installation destination; choose a separate skill directory");
  prepareManagedRoot(opts);
  return withManifestLock(managed, () => {
    reconcileManagedRoot(managed);
    const manifest = readManifestForInstall(managed);
    if (Object.hasOwn(manifest.skills, name) || statIfPresent(target)) {
      fail(`skill ${name} already exists in this scope; uninstall it first (existing files were not overwritten)`);
    }

    const staging = mkdtempSync(join(managed, STAGING_PREFIX));
    // Design: cpSync rejects an existing destination when errorOnExist is set —
    // copy into a fresh child so the staging directory stays a cleanup envelope.
    const payload = join(staging, "payload");
    let directoryPublished = false;
    let manifestPublished = false;
    try {
      // Design: never execute source code — copy files only: no dependency
      // resolution, lifecycle scripts, remote fetches, or escaping symlinks.
      cpSync(source, payload, {
        recursive: true, force: false, errorOnExist: true,
        filter: (from) => {
          if (basename(from) === ".git") return false;
          if (lstatSync(from).isSymbolicLink()) fail(`source contains a symlink; copy a self-contained skill directory: ${from}`);
          return true;
        },
      });
      // Design: the published root is chmod 0700 after the copy — install copies
      // ignored files too, so it must not inherit a world-traversable source
      // mode, matching the old mkdtemp staging semantics.
      chmodSync(payload, 0o700);
      if (validateSkillFile(join(payload, "SKILL.md")) !== name) fail("source name changed during installation; retry");
      renameWithRetry(payload, target);
      directoryPublished = true;
      const entry: InstalledSkill = { name, ...metadata };
      manifest.skills[name] = entry;
      writeManifest(managed, manifest);
      manifestPublished = true;
      return entry;
    } catch (error) {
      if (directoryPublished && !manifestPublished) rmSync(target, { recursive: true, force: true });
      throw error;
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  });
}

/** Installed entries plus recovery hints for the CLI. */
export interface SkillListing {
  skills: InstalledSkill[];
  warnings: string[];
}

/** Hints for recorded skills whose directory is gone; backups are never guessed. */
function missingDirectoryWarnings(managed: string, entries: InstalledSkill[]): string[] {
  const missing = entries.filter((entry) => !statIfPresent(join(managed, entry.name)));
  if (missing.length === 0) return [];
  const backups = readdirSync(managed).filter((name) => name.startsWith(UNINSTALL_PREFIX));
  return missing.map((entry) => {
    return backups.length > 0
      ? `skill ${entry.name} is recorded in installed.json but its directory is missing; an interrupted uninstall may have left ${backups.join(", ")}. Rename the matching backup back to ${entry.name}/ before retrying.`
      : `skill ${entry.name} is recorded in installed.json but its directory is missing; run "ans skill uninstall ${entry.name}" to drop the stale entry.`;
  });
}

/** Reconcile residue when safe, then read the manifest-backed listing. */
function readInstallationListing(opts: SkillOptions): SkillListing {
  const managed = managedSkillsRoot(opts);
  if (!statIfPresent(managed)) return { skills: [], warnings: [] };
  // Design: read commands clean only while holding the lock — a live writer keeps
  // the read path lock-free, since the manifest replace is an atomic rename.
  maintainScope(managed);
  if (!statIfPresent(manifestIn(managed)) && isEmptyManagedRoot(managed)) return { skills: [], warnings: [] };
  const skills = Object.values(readManifest(managed).skills).sort((a, b) => a.name.localeCompare(b.name));
  return { skills, warnings: missingDirectoryWarnings(managed, skills) };
}

/** List installed skills together with recovery hints. */
export function inspectInstalledSkills(opts: SkillOptions = {}): SkillListing {
  return readInstallationListing(opts);
}

/** Resolve an installed directory and verify it stays inside the managed root. */
function installedDirectory(managed: string, name: string): string {
  requireName(name);
  const target = join(managed, name);
  requireDirectory(target, `installed skill ${name}`);
  if (realpathSync(target) !== join(realpathSync(managed), name)) fail(`installed skill escapes the managed directory: ${name}`);
  return target;
}

/** Validate installed SKILL.md frontmatter for one or all manifest entries. */
export function validateInstalledSkills(opts: SkillOptions = {}, selectedName?: string): SkillValidation[] {
  const managed = managedSkillsRoot(opts);
  let entries: InstalledSkill[];
  if (selectedName !== undefined) {
    requireName(selectedName);
    if (statIfPresent(managed)) maintainScope(managed);
    const entry = readManifest(managed).skills[selectedName];
    if (!entry) fail(`skill ${selectedName} is not recorded in ${skillManifestPath(opts)}`);
    entries = [entry];
  } else {
    entries = readInstallationListing(opts).skills;
  }
  return entries.map((entry) => {
    try {
      const nameInFile = validateSkillFile(join(installedDirectory(managed, entry.name), "SKILL.md"));
      if (nameInFile !== entry.name) fail(`frontmatter name ${nameInFile} does not match manifest name ${entry.name}`);
      return { name: entry.name, ok: true };
    } catch (error) {
      return { name: entry.name, ok: false, error: (error as Error).message };
    }
  });
}

/** Uninstall only a manifest-recorded directory, rolling back if manifest publication fails. */
export function uninstallSkill(name: string, opts: SkillOptions = {}): InstalledSkill {
  requireName(name);
  const managed = managedSkillsRoot(opts);
  // Design: a missing managed root cannot hold a lock — report the canonical
  // missing manifest error instead of creating directories for a failed operation.
  if (!statIfPresent(managed)) missingManifest(managed);
  requireScopeAnchors(managed);
  return withManifestLock(managed, () => {
    // Design: uninstall never reconciles — cleanup is manifest-gated and uninstall
    // requires a manifest, so only the lock acquisition above can reclaim here.
    const manifest = readManifest(managed);
    const entry = manifest.skills[name];
    if (!entry) fail(`skill ${name} is not recorded in ${skillManifestPath(opts)}; no files were removed`);
    // Design: a recorded directory that is already gone leaves nothing to
    // delete — drop the entry so manifest and filesystem agree again.
    if (!statIfPresent(join(managed, name))) {
      delete manifest.skills[name];
      writeManifest(managed, manifest);
      return entry;
    }
    const target = installedDirectory(managed, name);
    const backup = join(managed, `${UNINSTALL_PREFIX}${randomUUID()}`);
    renameWithRetry(target, backup);
    try {
      delete manifest.skills[name];
      writeManifest(managed, manifest);
    } catch (error) {
      renameWithRetry(backup, target);
      throw error;
    }
    try {
      rmSync(backup, { recursive: true, force: true });
    } catch (error) {
      fail(`skill ${name} was removed from the manifest, but its backup could not be deleted: ${backup}. Remove that backup manually. ${(error as Error).message}`);
    }
    return entry;
  });
}
