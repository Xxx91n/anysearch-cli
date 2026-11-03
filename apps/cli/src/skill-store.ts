// Minimal Agent Skill installer (#109, parent #30, T6 decision #92; concurrency
// hardening #137). Design: install from a local Git checkout into skills/synced/,
// with one installed.json manifest — a directory convention, not a package
// manager. The sibling skills/<name>/ space belongs to user-authored skills. This
// module never reads or writes domain TOML: installation is NOT Skill Active List
// activation.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync, cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync,
  realpathSync, renameSync, rmSync, writeFileSync, type Stats,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseDocument } from "yaml";
import { atomicRename } from "./fs-atomic";

export interface SkillOptions {
  home?: string;
  cwd?: string;
  project?: boolean;
  /** Sink for non-fatal reconciliation notices (recovery hints); nothing is thrown through it. */
  notice?: (message: string) => void;
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

/** Owner record written into the lock directory for ownership checks and stale recovery. */
export interface LockOwner {
  token: string;
  pid: number;
  host: string;
  startedAt: string;
  /** PID namespace of the holder, where the platform exposes one (Linux). */
  pidNamespace?: string;
}

/** Classification of the process recorded in a lock owner file. */
export type HolderState = "alive" | "dead" | "indeterminate";

/** Read the recorded lock owner, or undefined when the record is absent or malformed. */
export function readLockOwner(lock: string): LockOwner | undefined {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(lock, "owner.json"), "utf8"));
    if (isRecord(raw) && typeof raw.token === "string" && raw.token.length > 0
      && Number.isInteger(raw.pid) && (raw.pid as number) > 0
      && typeof raw.host === "string" && typeof raw.startedAt === "string"
      && (raw.pidNamespace === undefined
        || (typeof raw.pidNamespace === "string" && raw.pidNamespace.length > 0))) {
      return {
        token: raw.token,
        pid: raw.pid as number,
        host: raw.host,
        startedAt: raw.startedAt,
        ...(typeof raw.pidNamespace === "string" ? { pidNamespace: raw.pidNamespace } : {}),
      };
    }
  } catch {
    // Unreadable owner records still block the operation; they are never "stale".
  }
  return undefined;
}

/**
 * Identity of this process's PID namespace, when the platform exposes one.
 * Design: a matching hostname does not prove that the recorded pid is visible in
 * this process's PID space — a sandbox can reuse the host name with its own pid
 * space, where a live holder's pid reads as ESRCH and its lock would be reclaimed
 * mid-operation. Linux exposes the namespace inode through /proc; platforms
 * without PID namespaces return undefined, and there the pid probe stays
 * authoritative because the host has a single pid space.
 */
export function pidNamespaceIdentity(): string | undefined {
  if (process.platform !== "linux") return undefined;
  try {
    return readlinkSync("/proc/self/ns/pid");
  } catch {
    return undefined;
  }
}

// Design: `process.kill(pid, 0)` is the only staleness signal. EPERM means the pid
// exists under another user (alive), ESRCH means it is provably gone in this PID
// namespace, and anything else (reused pid included) is treated as indeterminate
// rather than guessed — a lock is never removed on a hunch.
/** Classify a recorded pid without signalling the process. */
export function probeHolder(pid: number): HolderState {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return "dead";
    if (code === "EPERM") return "alive";
    return "indeterminate";
  }
}

/** Describe the recorded lock holder when the owner file is readable. */
function describeLockHolder(lock: string): string {
  const owner = readLockOwner(lock);
  return owner ? ` (pid ${owner.pid} on ${owner.host})` : "";
}

/** Canonical contention failure: name the lock and its recorded holder. */
function contended(lock: string): never {
  fail(`another skill operation is running in this scope${describeLockHolder(lock)}: ${lock}. If no ans skill process is running, remove that directory and retry.`);
}

/** Injectable edges of stale-lock recovery (tests drive the race branches deterministically). */
export interface ReclaimSeam {
  rename?: (from: string, to: string) => void;
  probe?: (pid: number) => HolderState;
  localHost?: () => string;
  pidNamespace?: () => string | undefined;
}

/** Whether a reclaim removed the stale lock, left a holder in place, or lost the rename race. */
export type ReclaimOutcome = "reclaimed" | "held" | "lost";

// Design: reclaim requires the same host and PID namespace, and never deletes a
// lock it cannot prove dead.
// The owner token is re-read immediately before the rename, and the quarantined
// directory is verified afterwards: if a new holder took over in that window the
// directory is restored (or the operation stops) instead of being deleted.
// Design: no heartbeat or time-based expiry — a time window cannot tell a slow live
// holder from a dead one, so a held lock is never removed merely because it is old.
/** Reclaim a lock whose recorded holder is provably dead on this host. */
export function reclaimStaleLock(managed: string, seam: ReclaimSeam = {}): ReclaimOutcome {
  const lock = join(managed, MANIFEST_LOCK);
  const rename = seam.rename ?? renameSync;
  const probe = seam.probe ?? probeHolder;
  const localHost = (seam.localHost ?? hostname)();
  const observed = readLockOwner(lock);
  if (!observed) {
    fail(`another skill operation holds ${lock} but its owner record is unreadable, so it cannot be proven stale. If no ans skill process is running, remove that directory and retry.`);
  }
  if (observed.host !== localHost) {
    fail(`another skill operation is running in this scope${describeLockHolder(lock)}: ${lock}. The lock was recorded by host ${observed.host}, not ${localHost}, so its process cannot be probed from here and it is not reclaimed automatically. If that host is gone, remove that directory and retry.`);
  }
  // Design: same host is not enough — a different PID namespace makes a live
  // holder's pid look dead here. Both sides must report the same identity: absent
  // on both is one pid space (non-Linux platforms), present on one side only is
  // unprovable and stays fail-closed.
  const localNamespace = (seam.pidNamespace ?? pidNamespaceIdentity)();
  if (observed.pidNamespace !== localNamespace) {
    fail(`another skill operation is running in this scope${describeLockHolder(lock)}: ${lock}. The lock records PID namespace ${observed.pidNamespace ?? "unrecorded"} while this process sees ${localNamespace ?? "none"}, so its holder cannot be proven dead from here. If no ans skill process is running, remove that directory and retry.`);
  }
  const state = probe(observed.pid);
  if (state === "alive") return "held";
  if (state === "indeterminate") {
    fail(`cannot determine whether the process holding ${lock}${describeLockHolder(lock)} is still running; refusing to reclaim a lock that may be live. If no ans skill process is running, remove that directory and retry.`);
  }
  // Only the lock that was just read may be reclaimed: a changed token means the
  // holder we proved dead is already gone and someone else owns the lock now.
  if (readLockOwner(lock)?.token !== observed.token) return "held";

  const quarantine = join(managed, `${MANIFEST_LOCK}.reclaim-${randomUUID()}`);
  try {
    rename(lock, quarantine);
  } catch (error) {
    // Another reclaimer moved it first: the path is free, so the caller may retry.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "lost";
    fail(`could not move the stale lock aside: ${lock} (${(error as Error).message}). If no ans skill process is running, remove that directory and retry.`);
  }
  if (readLockOwner(quarantine)?.token !== observed.token) {
    // A new holder owned the directory by the time it moved: put it back untouched.
    try {
      rename(quarantine, lock);
    } catch (error) {
      fail(`a new skill operation took over ${lock} while a stale lock was being reclaimed, and the displaced lock could not be restored (${(error as Error).message}). Inspect ${quarantine} before retrying.`);
    }
    return "held";
  }
  // Best effort: a leftover quarantine is installer-owned residue that the next
  // reconciliation pass removes, so it must not block the acquisition.
  try {
    rmSync(quarantine, { recursive: true, force: true });
  } catch {
    // ignored on purpose — see above
  }
  return "reclaimed";
}

// Design: one coarse lock per managed root — mkdir is atomic on local filesystems,
// the lock spans reconciliation → manifest read → publish/remove → write, and
// contention fails closed instead of deleting a lock that may be live.
/** Acquire the exclusive manifest lock and return its release function. */
export function acquireManifestLock(managed: string): () => void {
  const lock = join(managed, MANIFEST_LOCK);
  const token = randomUUID();
  for (let attempt = 0; ; attempt += 1) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Exactly one reclaim attempt: a second EEXIST means another process won the
      // race (or a live holder appeared) and must not be cut in front of.
      if (attempt > 0) contended(lock);
      if (reclaimStaleLock(managed) === "held") contended(lock);
    }
  }
  try {
    const pidNamespace = pidNamespaceIdentity();
    const owner: LockOwner = {
      token, pid: process.pid, host: hostname(), startedAt: new Date().toISOString(),
      ...(pidNamespace ? { pidNamespace } : {}),
    };
    writeFileSync(join(lock, "owner.json"), JSON.stringify(owner), { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    rmSync(lock, { recursive: true, force: true });
    throw error;
  }
  return () => {
    // Release only the lock we still own; a manually reclaimed lock must survive.
    if (readLockOwner(lock)?.token === token) rmSync(lock, { recursive: true, force: true });
  };
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

// Design: read commands must not fail because a mutation holds the lock, so the
// guarded phase is skipped instead of throwing when the lock is busy or unreadable.
/** Run a read-path action under the lock only when it is free. */
function tryWithManifestLock<T>(managed: string, action: () => T): T | undefined {
  let release: (() => void) | undefined;
  try {
    release = acquireManifestLock(managed);
    return action();
  } catch {
    return undefined;
  } finally {
    release?.();
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

/** True when the managed root holds nothing but the lock we hold. */
function isEmptyManagedRoot(managed: string): boolean {
  return !readdirSync(managed).some((entry) => entry !== MANIFEST_LOCK);
}

/**
 * True when a manifest-less root holds nothing but the lock and installer-owned
 * residue — never operator content. Used by the read path, which cannot delete
 * while another process holds the lock: an abandoned first install reads as an
 * empty scope instead of a fail-closed manifest error, and nothing is removed.
 */
function holdsOnlyInstallerResidue(managed: string): boolean {
  return !readdirSync(managed).some((entry) => entry !== MANIFEST_LOCK
    && !STAGING_ENTRY.test(entry) && !MANIFEST_TEMP_ENTRY.test(entry) && !QUARANTINE_ENTRY.test(entry));
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

/** Atomically replace installed.json via a same-directory temporary file and rename. */
function writeManifest(managed: string, manifest: SkillManifest): void {
  const temporary = join(managed, `.installed-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(manifest, null, 2) + "\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
    // Design: the temp file lives next to the manifest (no EXDEV) and the commit
    // point stays "rename onto the published name" — the retry never overwrites
    // anything but that target.
    atomicRename(temporary, manifestIn(managed));
  } finally {
    rmSync(temporary, { force: true });
  }
}

// Startup reconciliation (#137). Design: only installer-shaped transient entries
// are removed — staging (never manifest-recorded, because the manifest is written
// after the publication rename), a manifest temp file when no installed.json was
// published, and quarantine directories left by a reclaim. Everything else,
// including random-named .uninstall-* backups, is operator territory: it is
// reported, never deleted, and the fail-closed manifest rules stay in force.
/** Installer-generated entry names; anything else in synced/ belongs to the operator. */
const STAGING_ENTRY = /^\.install-[A-Za-z0-9]{6}$/;
const MANIFEST_TEMP_ENTRY = /^\.installed-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;
const QUARANTINE_ENTRY = /^\.installed\.lock\.reclaim-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BACKUP_ENTRY = /^\.uninstall-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Outcome of one reconciliation pass; `removed` are the installer-owned entries it deleted. */
export interface ReconcileReport {
  removed: string[];
  notices: string[];
}

/** Names recorded in the manifest whose installed directory is absent, read best-effort. */
function recordedSkillsWithoutDirectory(managed: string): string[] {
  try {
    return Object.keys(readManifest(managed).skills).filter((name) => !statIfPresent(join(managed, name)));
  } catch {
    // A corrupt manifest is reported by the caller's own read, not by reconciliation.
    return [];
  }
}

/**
 * Remove installer-owned residue from an interrupted run and report backups that
 * cannot be attributed. The caller holds the manifest lock, so no other installer
 * process is writing any entry seen here; a clean scope reports zero removals.
 */
export function reconcileManagedRoot(managed: string): ReconcileReport {
  const entries = readdirSync(managed, { withFileTypes: true });
  const manifestPublished = Boolean(statIfPresent(manifestIn(managed)));
  const report: ReconcileReport = { removed: [], notices: [] };
  for (const entry of entries) {
    const name = entry.name;
    if (name === MANIFEST_LOCK) continue;
    const residue = STAGING_ENTRY.test(name)
      || QUARANTINE_ENTRY.test(name)
      // Design: an unpublished manifest is the documented recovery boundary — a
      // temp file beside a published installed.json is left for the operator.
      || (!manifestPublished && MANIFEST_TEMP_ENTRY.test(name));
    if (!residue) continue;
    try {
      // Design: a leftover must never turn into a failed install/uninstall. Retry
      // the transient Windows handle codes briefly, then report and keep going.
      rmSync(join(managed, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      report.removed.push(name);
    } catch (error) {
      report.notices.push(`could not remove installer residue ${join(managed, name)}: ${(error as Error).message}. Remove it manually once no ans skill process is running.`);
    }
  }
  const backups = entries.filter((entry) => BACKUP_ENTRY.test(entry.name)).map((entry) => entry.name);
  if (backups.length > 0) {
    const orphaned = recordedSkillsWithoutDirectory(managed);
    if (orphaned.length > 0) {
      // Design: backup names are random, so ownership is never guessed: the notice
      // points at the backups and the operator decides which one to restore.
      report.notices.push(
        `skill ${orphaned.join(", ")} is recorded in ${manifestIn(managed)} but its directory is missing; `
        + `${backups.length} untracked .uninstall-* backup(s) in ${managed} are never deleted automatically. `
        + "Inspect them and rename the matching one back to <name>/ if it belongs there, or run "
        + `"ans skill uninstall ${orphaned[0]}" to drop the stale entry when no backup remains.`,
      );
    }
  }
  return report;
}

/** Reconcile inside the lock and forward recovery hints to the caller's notice sink. */
function reconcileWithinLock(managed: string, opts: SkillOptions): ReconcileReport {
  const report = reconcileManagedRoot(managed);
  for (const message of report.notices) opts.notice?.(message);
  return report;
}

/**
 * Best-effort reconciliation for read commands: only when the managed root exists
 * and the lock is free, so list/validate never fail because a mutation is in
 * flight and never delete anything under another process's lock.
 */
function reconcileForRead(managed: string, opts: SkillOptions): void {
  if (!statIfPresent(managed)) return;
  try {
    requireScopeAnchors(managed);
    tryWithManifestLock(managed, () => {
      for (const message of reconcileManagedRoot(managed).notices) opts.notice?.(message);
    });
  } catch {
    // Read paths stay read-only when the scope cannot be locked or inspected; the
    // manifest read that follows reports anything durable.
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

/** Run a read-only Git inspection command in the source checkout. */
function git(source: string, args: string[]): string {
  try {
    // Design: provenance collection is data-only — repository-configured
    // fsmonitor helpers are disabled so `git status` cannot execute checkout code.
    return execFileSync("git", ["-c", "core.fsmonitor=false", "-C", source, ...args], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
      timeout: 10_000, maxBuffer: 16 * 1024 * 1024,
    }).trim();
  } catch (error) {
    const e = error as NodeJS.ErrnoException & { stderr?: Buffer | string };
    if (e.code === "ENOENT") fail("Git is required to record the source commit; install Git and retry.");
    const detail = e.stderr ? String(e.stderr).trim() : e.message;
    fail(`cannot inspect Git source ${source}: ${detail}`);
  }
}

/** Record the source path, HEAD commit, exact tag if present, and dirty state. */
function provenance(source: string): Omit<InstalledSkill, "name"> {
  // Design: compare native-canonical paths — on Windows, plain realpath keeps
  // 8.3 short names while Git reports the long toplevel, so `relative` would
  // wrongly place the source outside its repository.
  const repository = realpathSync.native(git(source, ["rev-parse", "--show-toplevel"]));
  if (!contains(repository, realpathSync.native(source))) fail(`source is outside its Git working tree: ${source}`);
  const commit = git(source, ["rev-parse", "--verify", "HEAD^{commit}"]);
  // Exact tags only; lexical ordering makes multiple tags deterministic. A tag
  // is supplementary: the full commit is always recorded, even without a tag.
  const tag = git(source, ["tag", "--points-at", "HEAD", "--sort=refname"]).split(/\r?\n/).filter(Boolean)[0];
  const dirty = git(source, ["status", "--porcelain", "--untracked-files=all", "--ignored", "--", "."]).length > 0;
  return { source, commit, dirty, ...(tag ? { tag } : {}) };
}

/** Check lexical containment to prevent installing a directory into itself. */
function contains(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel));
}

/** Install a local Git skill directory into the managed scope without activating it. */
export function installSkill(sourceArgument: string, opts: SkillOptions = {}): InstalledSkill {
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
  const metadata = provenance(source);
  const managed = managedSkillsRoot(opts);
  const target = join(managed, name);
  if (contains(source, target)) fail("source contains its installation destination; choose a separate skill directory");
  prepareManagedRoot(opts);
  return withManifestLock(managed, () => {
    reconcileWithinLock(managed, opts);
    const manifest = readManifestForInstall(managed);
    if (Object.hasOwn(manifest.skills, name) || statIfPresent(target)) {
      fail(`skill ${name} already exists in this scope; uninstall it first (existing files were not overwritten)`);
    }

    const staging = mkdtempSync(join(managed, ".install-"));
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
      atomicRename(payload, target);
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

/** List only manifest-recorded installations, sorted by name. */
export function listInstalledSkills(opts: SkillOptions = {}): InstalledSkill[] {
  const managed = managedSkillsRoot(opts);
  if (!statIfPresent(managed)) return [];
  // Startup reconciliation on the read path runs only when the scope is safe to
  // lock; a contended scope still lists what the manifest records.
  reconcileForRead(managed, opts);
  if (!statIfPresent(manifestIn(managed))) {
    // Design: an empty managed root (e.g. a failed first install) is an empty
    // scope — only real untracked entries keep the fail-closed manifest error.
    requireScopeAnchors(managed);
    if (isEmptyManagedRoot(managed) || holdsOnlyInstallerResidue(managed)) return [];
  }
  return Object.values(readManifest(managed).skills).sort((a, b) => a.name.localeCompare(b.name));
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
    reconcileForRead(managed, opts);
    const entry = readManifest(managed).skills[selectedName];
    if (!entry) fail(`skill ${selectedName} is not recorded in ${skillManifestPath(opts)}`);
    entries = [entry];
  } else {
    entries = listInstalledSkills(opts);
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
    reconcileWithinLock(managed, opts);
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
    const backup = join(managed, `.uninstall-${randomUUID()}`);
    atomicRename(target, backup);
    try {
      delete manifest.skills[name];
      writeManifest(managed, manifest);
    } catch (error) {
      // The backup name is ours and unique; the rename back is the rollback of record.
      atomicRename(backup, target);
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
