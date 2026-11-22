#!/usr/bin/env node
// The push gate's hook, one command each:
//
//   pnpm hooks:install   copy scripts/hooks/pre-push-user into the hooks dir git uses
//   pnpm hooks:status    say whether that hook is there, executable, and current
//
// Run them at the repo root; from a subdirectory, `pnpm -w` runs the root script.
//
// GitButler owns pre-commit and post-checkout. Nothing here writes either one,
// so a commit still runs no tests. See AGENTS.md.
//
// The hook content is repo-agnostic: it finds the repo root itself at run time,
// so the same file works in a clone, a worktree, or a copy.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = "pre-push";
const HOOK_SOURCE = path.join("scripts", "hooks", "pre-push-user");
const OLD_COMMIT_HOOK = "pre-commit-user";
const OUR_HOOK_MARK = "preflight-test.mjs";
const INSTALL = "pnpm hooks:install";

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function repoRootOf(cwd) {
  const out = git(cwd, ["rev-parse", "--show-toplevel"]);
  return out ? path.resolve(cwd, out) : null;
}

/** The hooks directory git actually reads: core.hooksPath when set, else .git/hooks. */
function hooksDirOf(root) {
  const out = git(root, ["rev-parse", "--git-path", "hooks"]);
  return out ? path.resolve(root, out) : null;
}

function readText(file) {
  try {
    return { text: fs.readFileSync(file, "utf8") };
  } catch (error) {
    return { error: { code: error.code, message: error.message } };
  }
}

/** The one line that decides what the hook runs. Comments cannot change it. */
function hookCommand(text) {
  const line = text.split(/\r?\n/).find((candidate) => /^\s*exec\s/.test(candidate));
  return line ? line.trim() : null;
}

/** That line as a person reads it: scripts/preflight-test.mjs --pushed. */
function hookTarget(command) {
  const match = command?.match(/(scripts[\\/]preflight-[^\s"']+\.mjs)["']?(?:\s+(.*))?$/);
  if (!match) return null;
  const script = match[1].replace(/\\/g, "/");
  const flags = (match[2] ?? "").trim();
  return flags ? `${script} ${flags}` : script;
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

/** Where the hook goes and what the current source runs, or why neither is known. */
function locate() {
  const root = repoRootOf(process.cwd());
  if (!root) return { reason: "not inside a git repo" };
  const dir = hooksDirOf(root);
  if (!dir) return { reason: `git could not name the hooks directory under ${root}` };
  const source = readText(path.join(sourceRoot, HOOK_SOURCE));
  if (source.error?.code === "ENOENT") return { dir, reason: `${HOOK_SOURCE} is missing from ${sourceRoot}` };
  if (source.error) return { dir, reason: `cannot read ${HOOK_SOURCE}: ${source.error.message}` };
  return { dir, source: source.text, command: hookCommand(source.text) };
}

/**
 * What the push hook looks like right now.
 *
 * state: ok | missing | stale | not-executable | foreign | unknown.
 * unknown means the question cannot be answered (no repo, unreadable file).
 */
function prePushStatus() {
  const found = locate();
  if (found.reason) return { state: "unknown", reason: found.reason };

  const hookPath = path.join(found.dir, HOOK);
  const installed = readText(hookPath);
  if (installed.error?.code === "ENOENT") return { state: "missing", dir: found.dir, hookPath };
  if (installed.error) {
    return { state: "unknown", dir: found.dir, hookPath, reason: `cannot read ${hookPath}: ${installed.error.message}` };
  }

  const command = hookCommand(installed.text);
  const target = hookTarget(command);
  if (!installed.text.includes(OUR_HOOK_MARK)) return { state: "foreign", dir: found.dir, hookPath, target };
  // Design: status compares the exec line, not the whole file — linked
  // worktrees share one hooks directory, so the installed copy often comes from
  // a sibling checkout and differs only in comments. Only the exec line changes
  // what the hook runs, so only the exec line can be out of date.
  if (command !== found.command) return { state: "stale", dir: found.dir, hookPath, target };
  if (process.platform !== "win32" && !isExecutable(hookPath)) return { state: "not-executable", dir: found.dir, hookPath, target };
  return { state: "ok", dir: found.dir, hookPath, target };
}

/**
 * Put the current push hook in place. Running it again changes nothing.
 *
 * state: installed | current | replaced | refused | unknown.
 * refused means someone else's pre-push is in the way; only --force replaces it.
 */
function installHook({ force = false } = {}) {
  const found = locate();
  if (found.reason) return { state: "unknown", reason: found.reason };

  const hookPath = path.join(found.dir, HOOK);
  const installed = readText(hookPath);
  if (installed.error && installed.error.code !== "ENOENT") {
    return { state: "unknown", dir: found.dir, hookPath, reason: `cannot read ${hookPath}: ${installed.error.message}` };
  }
  const exists = !installed.error;

  // Design: a pre-push that is not ours is left alone unless --force is given —
  // such a hook (husky, a hand-written one) may do real work, and this command
  // is only asked to put our hook in place, not to delete someone else's.
  if (exists && !installed.text.includes(OUR_HOOK_MARK) && !force) {
    return { state: "refused", dir: found.dir, hookPath, target: hookTarget(hookCommand(installed.text)) };
  }

  // Design: the old pre-commit-user is deleted, GitButler's pre-commit never is
  // — pre-commit belongs to GitButler, and a clone that still holds our old
  // commit hook would run tests on every commit.
  const removed = removeOldCommitHook(found.dir);
  fs.mkdirSync(found.dir, { recursive: true });

  const current = exists && hookCommand(installed.text) === found.command;
  let chmodError = null;
  if (current) {
    // Same behaviour, possibly older comments: leave the bytes as they are, so
    // two checkouts sharing one hooks directory do not rewrite each other.
    if (process.platform !== "win32" && !isExecutable(hookPath)) chmodError = makeExecutable(hookPath);
  } else {
    fs.writeFileSync(hookPath, found.source, { mode: 0o755 });
    // Windows has no execute bit for git to read, so there is nothing to set.
    if (process.platform !== "win32") chmodError = makeExecutable(hookPath);
  }

  return {
    state: !exists ? "installed" : current ? "current" : "replaced",
    dir: found.dir,
    hookPath,
    target: hookTarget(found.command),
    removed,
    chmodError,
    preCommit: fs.existsSync(path.join(found.dir, "pre-commit")),
  };
}

const INSTALLED_LINE = {
  installed: "pre-push installed",
  current: "pre-push already installed and current",
  replaced: "pre-push replaced with the current script",
};

const STATUS_PROBLEM = {
  missing: "pre-push is missing",
  stale: "pre-push is out of date, it runs an older script line",
  "not-executable": "pre-push is not executable",
  foreign: "pre-push is another script, not ours",
};

function reportInstall(result) {
  if (result.state === "unknown") {
    console.error(`[hooks] cannot install: ${result.reason}`);
    return 2;
  }
  if (result.state === "refused") {
    console.error(`[hooks] another pre-push hook is in the way: ${result.hookPath}`);
    console.error(`[hooks] move that file away first, or replace it with: ${INSTALL} --force`);
    return 2;
  }

  console.log(`[hooks] ${INSTALLED_LINE[result.state]}: ${result.hookPath}`);
  if (result.target) console.log(`[hooks] runs: ${result.target}`);
  if (result.chmodError) console.error(`[hooks] installed but could not add the execute bit: ${result.chmodError}`);
  if (result.removed?.error) console.error(`[hooks] could not remove the old commit hook ${result.removed.file}: ${result.removed.error}`);
  else if (result.removed) console.log(`[hooks] removed the old commit hook: ${result.removed.file}`);
  if (result.preCommit) console.log("[hooks] pre-commit belongs to GitButler, left alone");
  return 0;
}

function reportStatus(result) {
  if (result.state === "unknown") {
    console.error(`[hooks] cannot tell: ${result.reason}`);
    return 2;
  }
  if (result.state === "ok") {
    console.log(`[hooks] pre-push installed: ${result.hookPath}`);
    if (result.target) console.log(`[hooks] runs: ${result.target}`);
    return 0;
  }

  console.error(`[hooks] ${STATUS_PROBLEM[result.state]}: ${result.hookPath}`);
  console.error(`[hooks] ${result.state === "foreign" ? "replace it with" : "install it"}: ${INSTALL}${result.state === "foreign" ? " --force" : ""}`);
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
