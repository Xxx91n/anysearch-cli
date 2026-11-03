// Minimal Agent Skill installer (#109, parent #30, T6 decision #92).
// Design: install from a local Git checkout into skills/synced/, with one
// installed.json manifest — a directory convention, not a package manager.
// The sibling skills/<name>/ space belongs to user-authored skills. This module
// never reads or writes domain TOML: installation is NOT Skill Active List activation.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  renameSync, rmSync, writeFileSync, type Stats,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
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

/** Read an existing manifest, or bootstrap one only in an empty managed root. */
function readManifestForInstall(managed: string): SkillManifest {
  requireScopeAnchors(managed);
  if (!statIfPresent(manifestIn(managed))) {
    // Only a genuinely empty managed root may bootstrap a new manifest. An
    // orphaned directory is not permission to forget or overwrite its owner.
    // The lock we hold is not content.
    if (readdirSync(managed).some((entry) => entry !== MANIFEST_LOCK)) {
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
  const repository = realpathSync(git(source, ["rev-parse", "--show-toplevel"]));
  if (!contains(repository, source)) fail(`source is outside its Git working tree: ${source}`);
  const commit = git(source, ["rev-parse", "--verify", "HEAD^{commit}"]);
  // Exact tags only; lexical ordering makes multiple tags deterministic. A tag
  // is supplementary: the full commit is always recorded, even without a tag.
  const tag = git(source, ["tag", "--points-at", "HEAD", "--sort=refname"]).split(/\r?\n/).filter(Boolean)[0];
  const dirty = git(source, ["status", "--porcelain", "--untracked-files=all", "--", "."]).length > 0;
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
  const name = validateSkillFile(join(source, "SKILL.md"));
  const metadata = provenance(source);
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
    let directoryPublished = false;
    let manifestPublished = false;
    try {
      // Design: never execute source code — copy files only: no dependency
      // resolution, lifecycle scripts, remote fetches, or escaping symlinks.
      cpSync(source, staging, {
        recursive: true, force: false, errorOnExist: true,
        filter: (from) => {
          if (basename(from) === ".git") return false;
          if (lstatSync(from).isSymbolicLink()) fail(`source contains a symlink; copy a self-contained skill directory: ${from}`);
          return true;
        },
      });
      if (validateSkillFile(join(staging, "SKILL.md")) !== name) fail("source name changed during installation; retry");
      renameSync(staging, target);
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
