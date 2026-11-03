// Minimal Agent Skill installer (#109, parent #30, T6 decision #92).
// Design: install from a local Git checkout into skills/synced/, with one
// installed.json manifest — a directory convention, not a package manager.
// The sibling skills/<name>/ space belongs to user-authored skills. This module
// never reads or writes domain TOML: installation is NOT Skill Active List activation.

import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync, cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  renameSync, rmSync, writeFileSync, type Stats,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import { parseDocument } from "yaml";

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
}

/** Read the recorded lock owner, or undefined when the record is absent or malformed. */
function readLockOwner(lock: string): LockOwner | undefined {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(lock, "owner.json"), "utf8"));
    if (isRecord(raw) && typeof raw.token === "string" && typeof raw.pid === "number"
      && typeof raw.host === "string" && typeof raw.startedAt === "string") {
      return { token: raw.token, pid: raw.pid, host: raw.host, startedAt: raw.startedAt };
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

// Design: one coarse lock per managed root — mkdir is atomic on local
// filesystems, the lock spans manifest read → publish/remove → write, and
// contention fails closed instead of deleting a lock that may be live.
/** Acquire the exclusive manifest lock and return its release function. */
function acquireManifestLock(managed: string): () => void {
  const lock = join(managed, MANIFEST_LOCK);
  const token = randomUUID();
  try {
    mkdirSync(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      fail(`another skill operation is running in this scope${describeLockHolder(lock)}: ${lock}. If no ans skill process is running, remove that directory and retry.`);
    }
    throw error;
  }
  try {
    const owner: LockOwner = { token, pid: process.pid, host: hostname(), startedAt: new Date().toISOString() };
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
  const temporary = join(managed, `.installed-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(manifest, null, 2) + "\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(temporary, manifestIn(managed));
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
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
      timeout: GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024,
    }).trim();
  } catch (error) {
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
  const args = ["-c", "core.fsmonitor=false", "-C", source, "status", "--porcelain", "--untracked-files=all", "--ignored", "--", "."];
  const timeoutMs = statusProbeHooks?.timeoutMs ?? GIT_TIMEOUT_MS;
  return new Promise<boolean>((resolve, reject) => {
    const spawnChild = statusProbeHooks?.spawn ?? defaultStatusProbeSpawn;
    // Design: GIT_OPTIONAL_LOCKS=0 keeps `git status` from refreshing and
    // rewriting the index. The probe terminates the child as soon as dirtiness is
    // known, and interrupting an index refresh could leave a stale
    // .git/index.lock in the user's checkout.
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
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
      renameSync(payload, target);
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
  if (!statIfPresent(manifestIn(managed))) {
    // Design: an empty managed root (e.g. a failed first install) is an empty
    // scope — only real untracked entries keep the fail-closed manifest error.
    requireScopeAnchors(managed);
    if (isEmptyManagedRoot(managed)) return [];
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
    renameSync(target, backup);
    try {
      delete manifest.skills[name];
      writeManifest(managed, manifest);
    } catch (error) {
      renameSync(backup, target);
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
