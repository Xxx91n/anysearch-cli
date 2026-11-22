#!/usr/bin/env node
// The push gate's hook, one command each:
//
//   pnpm hooks:install   copy scripts/hooks/pre-push-user into the hooks dir git uses
//   pnpm hooks:status    say whether that hook is there, executable, and current
//
// GitButler owns pre-commit and post-checkout. Nothing here writes either one,
// so a commit still runs no tests. The old commit hook of ours (pre-commit-user)
// is removed when it is found, because a clone that still has it calls the gate
// on every commit. See AGENTS.md.
//
// The hook content is repo-agnostic: it finds the repo root itself at run time,
// so the same file works in a clone, a worktree, or a copy.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const HOOK = "pre-push";
export const SOURCE = path.join("scripts", "hooks", "pre-push-user");
const OLD_COMMIT_HOOK = "pre-commit-user";
const OUR_MARK = "preflight-test.mjs";
const INSTALL = "pnpm hooks:install";

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

/** The repository a command runs in, wherever inside it the caller stands. */
export function repoRootOf(cwd) {
  const out = git(cwd, ["rev-parse", "--show-toplevel"]);
  return out ? path.resolve(cwd, out) : null;
}

/** The hooks directory git actually reads: core.hooksPath when set, else .git/hooks. */
export function hooksDirOf(root) {
  const out = git(root, ["rev-parse", "--git-path", "hooks"]);
  return out ? path.resolve(root, out) : null;
}

/** The script an installed hook runs, written as scripts/preflight-test.mjs --pushed. */
export function hookTarget(text) {
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*exec\s+.*?(scripts[\\/]preflight-[^\s"']+\.mjs)["']?(?:\s+(.*))?$/);
    if (!match) continue;
    const script = match[1].replace(/\\/g, "/");
    const flags = (match[2] ?? "").trim();
    return flags ? `${script} ${flags}` : script;
  }
  return null;
}

function readSource() {
  try {
    return fs.readFileSync(path.join(sourceRoot, SOURCE), "utf8");
  } catch {
    return null;
  }
}

function readHook(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function isExecutable(file) {
  try {
    return (fs.statSync(file).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function makeExecutable(file) {
  try {
    fs.chmodSync(file, 0o755);
    return null;
  } catch (error) {
    return error.message;
  }
}

function removeOldCommitHook(dir) {
  const file = path.join(dir, OLD_COMMIT_HOOK);
  try {
    fs.rmSync(file);
    return { file };
  } catch (error) {
    return error.code === "ENOENT" ? null : { file, error: error.message };
  }
}

/**
 * What the push hook looks like right now.
 *
 * state: ok | missing | stale | not-executable | foreign | unknown.
 * unknown means the question cannot be answered (no repo, no git, no source).
 */
export function prePushStatus({ targetRoot = repoRootOf(process.cwd()) } = {}) {
  if (!targetRoot) return { state: "unknown", reason: "not inside a git repo" };
  const dir = hooksDirOf(targetRoot);
  if (!dir) return { state: "unknown", reason: `git could not name the hooks directory under ${targetRoot}` };
  const source = readSource();
  if (source === null) return { state: "unknown", dir, reason: `${SOURCE} is missing from ${sourceRoot}` };

  const hookPath = path.join(dir, HOOK);
  const installed = readHook(hookPath);
  if (installed === null) return { state: "missing", dir, hookPath };

  const target = hookTarget(installed);
  if (!installed.includes(OUR_MARK)) return { state: "foreign", dir, hookPath, target };
  if (installed !== source) return { state: "stale", dir, hookPath, target };
  if (process.platform !== "win32" && !isExecutable(hookPath)) return { state: "not-executable", dir, hookPath, target };
  return { state: "ok", dir, hookPath, target };
}

/**
 * Put the current push hook in place. Running it again changes nothing.
 *
 * state: installed | current | replaced | refused | unknown.
 * refused means someone else's pre-push is in the way; only --force replaces it.
 */
export function installHook({ targetRoot = repoRootOf(process.cwd()), force = false } = {}) {
  if (!targetRoot) return { state: "unknown", reason: "not inside a git repo" };
  const dir = hooksDirOf(targetRoot);
  if (!dir) return { state: "unknown", reason: `git could not name the hooks directory under ${targetRoot}` };
  const source = readSource();
  if (source === null) return { state: "unknown", dir, reason: `${SOURCE} is missing from ${sourceRoot}` };

  const hookPath = path.join(dir, HOOK);
  const existing = readHook(hookPath);
  if (existing !== null && !existing.includes(OUR_MARK) && !force) {
    return { state: "refused", dir, hookPath, target: hookTarget(existing) };
  }

  const removed = removeOldCommitHook(dir);
  fs.mkdirSync(dir, { recursive: true });

  if (existing === source) {
    const chmodError = makeExecutable(hookPath);
    return { state: "current", dir, hookPath, target: hookTarget(existing), removed, chmodError };
  }

  fs.writeFileSync(hookPath, source, { mode: 0o755 });
  const chmodError = makeExecutable(hookPath);
  return { state: existing === null ? "installed" : "replaced", dir, hookPath, target: hookTarget(source), removed, chmodError };
}

function reportInstall(result) {
  switch (result.state) {
    case "installed":
      console.log(`[hooks] pre-push installed: ${result.hookPath}`);
      break;
    case "current":
      console.log(`[hooks] pre-push already installed and current: ${result.hookPath}`);
      break;
    case "replaced":
      console.log(`[hooks] pre-push replaced with the current script: ${result.hookPath}`);
      break;
    case "refused":
      console.error(`[hooks] another pre-push hook is in the way: ${result.hookPath}`);
      console.error(`[hooks] move that file away first, or replace it with: ${INSTALL} --force`);
      return 2;
    default:
      console.error(`[hooks] cannot install: ${result.reason ?? result.state}`);
      return 2;
  }

  if (result.target) console.log(`[hooks] runs: ${result.target}`);
  if (result.chmodError) console.error(`[hooks] installed but could not add the execute bit: ${result.chmodError}`);
  if (result.removed?.error) console.error(`[hooks] could not remove the old commit hook ${result.removed.file}: ${result.removed.error}`);
  else if (result.removed) console.log(`[hooks] removed the old commit hook: ${result.removed.file}`);
  if (fs.existsSync(path.join(result.dir, "pre-commit"))) console.log("[hooks] pre-commit belongs to GitButler, left alone");
  return 0;
}

function reportStatus(result) {
  switch (result.state) {
    case "ok":
      console.log(`[hooks] pre-push installed: ${result.hookPath}`);
      if (result.target) console.log(`[hooks] runs: ${result.target}`);
      return 0;
    case "missing":
      console.error(`[hooks] pre-push is missing: ${result.hookPath}`);
      break;
    case "stale":
      console.error(`[hooks] pre-push is not the current script: ${result.hookPath}`);
      break;
    case "not-executable":
      console.error(`[hooks] pre-push is not executable: ${result.hookPath}`);
      break;
    case "foreign":
      console.error(`[hooks] pre-push is another script, not ours: ${result.hookPath}`);
      break;
    default:
      console.error(`[hooks] cannot tell: ${result.reason ?? result.state}`);
      return 2;
  }
  console.error(`[hooks] install it: ${INSTALL}`);
  return 1;
}

const isEntry = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isEntry) {
  const [command, ...flags] = process.argv.slice(2);
  if (command === "install") process.exit(reportInstall(installHook({ force: flags.includes("--force") })));
  if (command === "status") process.exit(reportStatus(prePushStatus()));
  console.error("[hooks] usage: node scripts/preflight-hooks.mjs install [--force] | status");
  process.exit(2);
}
