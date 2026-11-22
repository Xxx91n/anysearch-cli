#!/usr/bin/env node
// The push gate's hook, one command each:
//
//   pnpm hooks:install   copy scripts/hooks/pre-push-user into the hooks dir git uses
//   pnpm hooks:status    say whether that hook is there, executable, and current
//
// Run them at the repo root; from a subdirectory, `pnpm -w hooks:install` and
// `pnpm -w hooks:status` run the root scripts.
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
const INSTALL = "pnpm hooks:install";

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) return { error: `cannot run git: ${result.error.message}` };
  if (result.status !== 0) return { error: "not inside a git repo" };
  const out = result.stdout.trim();
  return out ? { out } : { error: "not inside a git repo" };
}

function repoRootOf(cwd) {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);
  return result.error ? result : { root: path.resolve(cwd, result.out) };
}

/** The hooks directory git actually reads: core.hooksPath when set, else .git/hooks. */
function hooksDirOf(root) {
  const result = git(root, ["rev-parse", "--git-path", "hooks"]);
  return result.error
    ? { error: `cannot find the hooks directory: ${result.error}` }
    : { dir: path.resolve(root, result.out) };
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

/**
 * Design: our hook is a shebang, comments, and exactly one exec of the gate —
 * nothing else. Matching the file name alone would claim a hand-written hook
 * that merely mentions the script, and then silently overwrite it.
 */
function isOurs(text) {
  const command = hookCommand(text);
  if (!command || !/scripts[\\/]preflight-test\.mjs/.test(command)) return false;
  return text
    .split(/\r?\n/)
    .every((line) => line.trim() === "" || line.trim().startsWith("#") || line.trim() === command);
}

/**
 * Design: current means the same exec line, not the same bytes — linked
 * worktrees share one hooks directory, so the installed copy often comes from a
 * sibling checkout and differs only in comments. Only the exec line changes
 * what the hook runs, so only the exec line can be out of date.
 */
function runsCurrentScript(text, currentCommand) {
  return hookCommand(text) === currentCommand;
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
  const repo = repoRootOf(process.cwd());
  if (repo.error) return { reason: repo.error };
  const hooks = hooksDirOf(repo.root);
  if (hooks.error) return { reason: hooks.error };

  const source = readText(path.join(sourceRoot, HOOK_SOURCE));
  if (source.error?.code === "ENOENT") return { dir: hooks.dir, reason: `${HOOK_SOURCE} is missing from ${sourceRoot}` };
  if (source.error) return { dir: hooks.dir, reason: `cannot read ${HOOK_SOURCE}: ${source.error.message}` };

  const command = hookCommand(source.text);
  if (!command) return { dir: hooks.dir, reason: `${HOOK_SOURCE} has no exec line` };
  return { dir: hooks.dir, source: source.text, command };
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

  const target = hookTarget(hookCommand(installed.text));
  if (!isOurs(installed.text)) return { state: "foreign", dir: found.dir, hookPath, target };
  if (!runsCurrentScript(installed.text, found.command)) return { state: "stale", dir: found.dir, hookPath, target };
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
  if (exists && !isOurs(installed.text) && !force) {
    return { state: "refused", dir: found.dir, hookPath, target: hookTarget(hookCommand(installed.text)) };
  }

  // Design: the old pre-commit-user is deleted, GitButler's pre-commit never is
  // — pre-commit belongs to GitButler, and a clone that still holds our old
  // commit hook would run tests on every commit.
  const removed = removeOldCommitHook(found.dir);
  fs.mkdirSync(found.dir, { recursive: true });

  // Same behaviour, possibly older comments: leave the bytes as they are, so
  // two checkouts sharing one hooks directory do not rewrite each other.
  const current = exists && runsCurrentScript(installed.text, found.command);
  if (!current) fs.writeFileSync(hookPath, found.source, { mode: 0o755 });

  // Windows has no execute bit for git to read, so there is nothing to set.
  const chmodError = process.platform !== "win32" && !isExecutable(hookPath) ? makeExecutable(hookPath) : null;

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

function installHint(force) {
  const command = force ? `${INSTALL} --force` : INSTALL;
  return `${command} (from the repo root; pnpm -w ${command} from a subdirectory)`;
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
    console.error(`[hooks] move that file away first, or replace it with: ${installHint(true)}`);
    return 2;
  }

  console.log(`[hooks] ${INSTALLED_LINE[result.state]}: ${result.hookPath}`);
  if (result.target) console.log(`[hooks] runs: ${result.target}`);
  if (result.chmodError) console.error(`[hooks] could not add the execute bit: ${result.chmodError}`);
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
  const foreign = result.state === "foreign";
  console.error(`[hooks] ${foreign ? "replace it with" : "install it"}: ${installHint(foreign)}`);
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
