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

// Design: a hook is ours when it carries our banner, not when its shape or a
// file name looks right — a hand-written hook that happens to mention the gate
// stays untouched, and our own hook keeps its banner across versions. The
// second banner is what hooks installed before this command existed carry.
const OWN_BANNERS = ["# anysearch push gate", "# anysearch pre-push"];

function firstLine(text) {
  return text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
}

function revParse(cwd, args, what) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) return { error: `cannot run git: ${result.error.message}` };
  if (result.status !== 0) return { error: `${what}: ${firstLine(result.stderr)}` };
  const out = result.stdout.trim();
  return out ? { out } : { error: `${what}: git printed nothing` };
}

function repoRoot(cwd) {
  const result = revParse(cwd, ["rev-parse", "--show-toplevel"], "cannot find the repo");
  return result.error ? result : { root: path.resolve(cwd, result.out) };
}

/** The hooks directory git actually reads: core.hooksPath when set, else .git/hooks. */
function hooksDir(root) {
  const result = revParse(root, ["rev-parse", "--git-path", "hooks"], "cannot find the hooks directory");
  return result.error ? result : { dir: path.resolve(root, result.out) };
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

/** The lines that do something, the shebang included: it picks the interpreter. */
function codeLines(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const code = lines.filter((line) => line !== "" && !line.startsWith("#"));
  if (lines[0]?.startsWith("#!")) code.unshift(lines[0]);
  return code;
}

/** Everything the hook actually does. */
function hookCode(text) {
  return codeLines(text).join("\n");
}

/** What it does beyond picking an interpreter. */
function commandLines(text) {
  return codeLines(text).filter((line) => !line.startsWith("#!"));
}

/**
 * What the hook runs, as a person reads it: scripts/preflight-test.mjs --pushed
 * for ours. Anyone else's is quoted as written — an exec line, or its first
 * command — because naming it is the point even when the shape is unfamiliar.
 */
function hookTarget(text) {
  const command = hookCommand(text);
  if (!command) return commandLines(text)[0] ?? null;
  const match = command.match(/(scripts[\\/]preflight-[^\s"']+\.mjs)["']?(?:\s+(.*))?$/);
  if (!match) return command;
  const script = match[1].replace(/\\/g, "/");
  const flags = (match[2] ?? "").trim();
  return flags ? `${script} ${flags}` : script;
}

/** A file that runs nothing (a shebang alone included) is nobody's hook. */
function isEmptyHook(text) {
  return commandLines(text).length === 0;
}

function isOurs(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  // Design: our banner is the first line after the shebang — a mention further
  // down is a note about our hook, not our hook. The shebang itself is not
  // checked here: it is part of the code, so a changed one reads as out of date.
  const banner = lines[lines[0]?.startsWith("#!") ? 1 : 0];
  return OWN_BANNERS.some((prefix) => banner?.startsWith(prefix));
}

/**
 * Design: current means the same code lines, not the same bytes — linked
 * worktrees share one hooks directory, so the installed copy often comes from a
 * sibling checkout and differs in its comments. A comment cannot change what
 * the hook does; a changed command can, so the command lines decide.
 */
function runsCurrentScript(text, sourceText) {
  return hookCode(text) === hookCode(sourceText);
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

/** Where the hook goes and what the current source does, or why neither is known. */
function locate() {
  const repo = repoRoot(process.cwd());
  if (repo.error) return { reason: repo.error };
  const hooks = hooksDir(repo.root);
  if (hooks.error) return { reason: hooks.error };

  const source = readText(path.join(sourceRoot, HOOK_SOURCE));
  if (source.error?.code === "ENOENT") return { dir: hooks.dir, reason: `${HOOK_SOURCE} is missing from ${sourceRoot}` };
  if (source.error) return { dir: hooks.dir, reason: `cannot read ${HOOK_SOURCE}: ${source.error.message}` };
  if (!hookCode(source.text)) return { dir: hooks.dir, reason: `${HOOK_SOURCE} runs nothing` };
  return { dir: hooks.dir, source: source.text };
}

/**
 * What the push hook looks like right now.
 *
 * state: ok | missing | stale | not-executable | foreign | unknown.
 * unknown means the question cannot be answered (no repo, unreadable file).
 */
function prePushStatus() {
  const place = locate();
  if (place.reason) return { state: "unknown", reason: place.reason };

  const hookPath = path.join(place.dir, HOOK);
  const installed = readText(hookPath);
  if (installed.error?.code === "ENOENT") return { state: "missing", dir: place.dir, hookPath };
  if (installed.error) {
    return { state: "unknown", dir: place.dir, hookPath, reason: `cannot read ${hookPath}: ${installed.error.message}` };
  }

  const hook = { dir: place.dir, hookPath, target: hookTarget(installed.text) };
  if (isEmptyHook(installed.text)) return { state: "empty", ...hook };
  if (!isOurs(installed.text)) return { state: "foreign", ...hook };
  if (!runsCurrentScript(installed.text, place.source)) return { state: "stale", ...hook };
  if (process.platform !== "win32" && !isExecutable(hookPath)) return { state: "not-executable", ...hook };
  return { state: "ok", ...hook };
}

/**
 * Put the current push hook in place. Running it again changes nothing.
 *
 * state: installed | current | replaced | refused | unknown.
 * refused means someone else's pre-push is in the way; only --force replaces it.
 */
function installHook({ force = false } = {}) {
  const place = locate();
  if (place.reason) return { state: "unknown", reason: place.reason };

  const hookPath = path.join(place.dir, HOOK);
  const installed = readText(hookPath);
  if (installed.error && installed.error.code !== "ENOENT") {
    return { state: "unknown", dir: place.dir, hookPath, reason: `cannot read ${hookPath}: ${installed.error.message}` };
  }
  const exists = !installed.error;

  // Design: a pre-push that is not ours is left alone unless --force is given —
  // such a hook (husky, a hand-written one) may do real work, and this command
  // is only asked to put our hook in place, not to delete someone else's.
  if (exists && !isEmptyHook(installed.text) && !isOurs(installed.text) && !force) {
    return { state: "refused", dir: place.dir, hookPath, target: hookTarget(installed.text) };
  }

  // Design: the old pre-commit-user is deleted, GitButler's pre-commit never is
  // — pre-commit belongs to GitButler, and a clone that still holds our old
  // commit hook would run tests on every commit.
  const removed = removeOldCommitHook(place.dir);
  // Same code, possibly older comments: leave the bytes as they are, so two
  // checkouts sharing one hooks directory do not rewrite each other.
  const current = exists && runsCurrentScript(installed.text, place.source);
  try {
    fs.mkdirSync(place.dir, { recursive: true });
    if (!current) fs.writeFileSync(hookPath, place.source, { mode: 0o755 });
  } catch (error) {
    return { state: "unknown", dir: place.dir, hookPath, reason: `cannot write ${hookPath}: ${error.message}` };
  }

  // Windows has no execute bit for git to read, so there is nothing to set.
  const chmodError = process.platform !== "win32" && !isExecutable(hookPath) ? makeExecutable(hookPath) : null;

  return {
    state: !exists ? "installed" : current ? "current" : "replaced",
    dir: place.dir,
    hookPath,
    target: hookTarget(place.source),
    removed,
    chmodError,
    preCommit: fs.existsSync(path.join(place.dir, "pre-commit")),
  };
}

function installHint(force) {
  const script = force ? "hooks:install --force" : "hooks:install";
  return `pnpm ${script} at the repo root, or pnpm -w ${script} from a subdirectory`;
}

const INSTALLED_LINE = {
  installed: "pre-push installed",
  current: "pre-push already installed and current",
  replaced: "pre-push replaced with the current script",
};

const STATUS_PROBLEM = {
  missing: "pre-push is missing",
  empty: "pre-push is an empty file",
  stale: "pre-push is out of date, it runs older commands",
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
  if (result.removed?.error) console.error(`[hooks] could not remove the old commit hook ${result.removed.file}: ${result.removed.error}`);
  else if (result.removed) console.log(`[hooks] removed the old commit hook: ${result.removed.file}`);
  if (result.preCommit) console.log("[hooks] pre-commit belongs to GitButler, left alone");
  if (result.chmodError) {
    // git skips a hook it cannot execute, so this is a failed install, not a note.
    console.error(`[hooks] could not add the execute bit, so git would skip it: ${result.chmodError}`);
    return 1;
  }
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
  if (result.target) console.error(`[hooks] runs: ${result.target}`);
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
