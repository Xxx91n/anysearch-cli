#!/usr/bin/env node
// The push gate's hook: `pnpm hooks:install` puts it in place, `pnpm hooks:status`
// says whether it is there, executable, and current. AGENTS.md describes both.
//
// Design: status also answers what a push from this checkout would run and what
// waiting for it costs — a person who knows the mode before they push does not
// meet it as a surprise, and the answer comes from the same pure plan the gate
// itself asks instead of a second copy of the rules.
//
// GitButler owns pre-commit and post-checkout, so nothing here writes either one.
//
// The hook content is repo-agnostic: it finds the repo root itself at run time,
// so the same file works in a clone, a worktree, or a copy.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { localFiles } from "./preflight-change.mjs";
import { planPreflight, strictPushGate } from "./preflight-plan.mjs";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = "pre-push";
const HOOK_SOURCE = path.join("scripts", "hooks", "pre-push-user");
const OLD_COMMIT_HOOK = "pre-commit-user";

// Design: a hook is ours when it carries our banner, not when its shape or a
// file name looks right — a hand-written hook that happens to mention the gate
// stays untouched, and our own hook keeps its banner across versions. The
// second banner is what hooks installed before this command existed carry.
const OWN_BANNERS = ["# anysearch push gate", "# anysearch pre-push"];

// The gate script, matched in the two places that care: what a hook runs, and
// whether a hook is ours. One pattern, so a rename cannot split them.
const GATE_SCRIPT = /scripts[\\/]preflight-[^\s"']+\.mjs/;
const GATE_COMMAND = new RegExp(`(${GATE_SCRIPT.source})["']?(?:\\s+(.*))?$`);

function firstLine(text) {
  return text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
}

function revParse(cwd, args, what) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) return { error: `cannot run git: ${result.error.message}` };
  if (result.status !== 0) {
    const why = firstLine(result.stderr) || (result.signal ? `git killed by ${result.signal}` : `git exited ${result.status}`);
    return { error: `${what}: ${why}` };
  }
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
 * What a hook's exec line runs: the gate script, repo-relative with forward
 * slashes, and the arguments it gets. Null when the line is not a gate command
 * status can follow, which is the only way the three readers below disagree.
 *
 * Design: this parse feeds the `runs:` line, the mode's `--full` test and the
 * script status reports on. `isOurs` stays looser on purpose (see below), so the
 * two are not the same question: an exec line we cannot parse still belongs to a
 * hook we wrote.
 */
function gateCommandOf(command) {
  const match = (command ?? "").match(GATE_COMMAND);
  if (!match) return null;
  const args = (match[2] ?? "").trim().split(/\s+/).filter(Boolean);
  return { script: match[1].replace(/\\/g, "/"), args };
}

/**
 * What the hook runs, as a person reads it: scripts/preflight-test.mjs --pushed
 * for ours. Anyone else's is quoted as written — an exec line, or its first
 * command — because naming it is the point even when the shape is unfamiliar.
 */
function hookTarget(text) {
  const command = hookCommand(text);
  if (!command) return commandLines(text)[0] ?? null;
  const gate = gateCommandOf(command);
  if (!gate) return command;
  return [gate.script, ...gate.args].join(" ");
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
  if (!OWN_BANNERS.some((prefix) => banner?.startsWith(prefix))) return false;
  // A note that starts like our banner still has to mention the gate to be ours.
  // Loose on purpose: an exec line that gained something status cannot parse is
  // still our hook, and install has to be able to put it back.
  return GATE_SCRIPT.test(hookCommand(text) ?? "");
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
  return { dir: hooks.dir, root: repo.root, source: source.text };
}

/**
 * What the push hook looks like right now.
 *
 * state: ok | missing | stale | not-executable | foreign | unknown | unfollowable.
 * unknown means the question cannot be answered (no repo, unreadable file);
 * unfollowable means the hook is ours and current, yet its exec line is not a gate
 * command — only a hook source written that way gets there.
 *
 * `root` is the checkout the hook is installed in, which is where a push reads
 * its gate script and its change set from — not the copy of this file that ran.
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

  const command = hookCommand(installed.text) ?? "";
  const hook = {
    dir: place.dir,
    root: place.root,
    hookPath,
    command,
    gate: gateCommandOf(command),
    target: hookTarget(installed.text),
  };
  if (isEmptyHook(installed.text)) return { state: "empty", ...hook };
  if (!isOurs(installed.text)) return { state: "foreign", ...hook };
  if (!runsCurrentScript(installed.text, place.source)) return { state: "stale", ...hook };
  if (process.platform !== "win32" && !isExecutable(hookPath)) return { state: "not-executable", ...hook };
  // Ours and current, yet the exec line is not a gate command: only a hook source
  // written this way gets here, and status has no mode to report for it.
  if (!hook.gate) return { state: "unfollowable", ...hook };
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

  // Same code, possibly older comments: leave the bytes as they are, so two
  // checkouts sharing one hooks directory do not rewrite each other.
  const current = exists && runsCurrentScript(installed.text, place.source);
  try {
    fs.mkdirSync(place.dir, { recursive: true });
    if (!current) fs.writeFileSync(hookPath, place.source, { mode: 0o755 });
  } catch (error) {
    return { state: "unknown", dir: place.dir, hookPath, reason: `cannot write ${hookPath}: ${error.message}` };
  }

  // Design: the old pre-commit-user is deleted only after the push hook is
  // written, so a failed write leaves the clone untouched. GitButler's own
  // pre-commit is never touched.
  const removed = removeOldCommitHook(place.dir);

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
  stale: "pre-push is out of date, its code differs from the source",
  "not-executable": "pre-push is not executable",
  foreign: "pre-push is another script, not ours",
};

// What a push of this checkout would run: a mode line and a wait-budget line per
// answer `pushPreview` can give.
//
// Design: the keys are the plan's own mode names, plus `unknown` for a change set
// git cannot name — a key the plan answers with and this table lacks reads as
// "cannot tell", never as a healthy line, and `broken` never reaches the table
// because the caller prints the gate's own blocked/reason/fix for it. Each entry
// holds both lines, so neither can be printed without the other.
const INCREMENTAL_MODE = "mode: incremental — a change inside a package runs that package and every package that depends on it";
const INCREMENTAL_WITH_READERS =
  "mode: incremental — a package change runs that package and its dependents, plus the packages whose tests read a changed root file";

// Design: the numbers are measured, not promised — store's tests alone take about
// 4m15s and the whole suite takes 6 to 9 minutes on Windows, so a calling tool's
// timeout short of them kills a run that would have passed and reads afterwards
// like a red gate.
const PACKAGE_SECONDS = 600;
const FULL_SECONDS = 900;
const STORE_RUN = "4m15s";
const FULL_RUN = "6 to 9 minutes";
const PACKAGE_WAIT = `wait budget: up to ${PACKAGE_SECONDS}s for the packages this push runs (store alone measures about ${STORE_RUN}); set the calling tool's timeout to 0, which means no cap, or to at least ${PACKAGE_SECONDS}`;
const FULL_WAIT = `wait budget: ${FULL_RUN} on Windows for the whole suite; set the calling tool's timeout to 0, which means no cap, or to at least ${FULL_SECONDS}`;
const NOTHING_RUNS = "wait budget: none — nothing runs";

const MODE_REPORT = {
  none: { mode: "mode: nothing to run — no changed files", wait: NOTHING_RUNS },
  docs: { mode: "mode: nothing to run — every changed file is documentation", wait: NOTHING_RUNS },
  unowned: {
    mode: "mode: advisory — a change no package owns only warns and nothing runs; CI's check-build covers that change",
    wait: NOTHING_RUNS,
  },
  readers: {
    mode: "mode: incremental — a changed root file runs only the packages whose tests read it",
    wait: PACKAGE_WAIT,
  },
  incremental: { mode: INCREMENTAL_MODE, wait: PACKAGE_WAIT },
  full: {
    mode: "mode: full — every push runs the whole suite (ANS_PUSH_GATE=strict, or --full in the hook's source)",
    wait: FULL_WAIT,
  },
  unknown: {
    mode: "mode: unknown — git cannot name this change (no HEAD, or no origin/HEAD to compare against)",
    wait: "wait budget: unknown — a push still runs what its refs carry",
  },
};

/**
 * The two lines for a plan, or null when the table has no answer for its mode.
 *
 * Design: a change that carries package files and root files runs both sets, so
 * its line names the readers too — a line promising only the package and its
 * dependents would under-report the run the person is budgeting for.
 */
function modeReport(plan) {
  const report = MODE_REPORT[plan.mode];
  if (!report) return null;
  if (plan.mode === "incremental" && plan.readers?.length) return { ...report, mode: INCREMENTAL_WITH_READERS };
  return report;
}

/**
 * The plan a push of this checkout would run, or `unknown` when git cannot name
 * the change. `broken` carries the plan's reason and fix.
 *
 * Design: the two switches that run everything on every push decide the mode
 * before any change set matters — `ANS_PUSH_GATE=strict` in this shell, or `--full`
 * in the hook's exec line, which a repo can install by putting it in
 * `scripts/hooks/pre-push-user` and running `hooks:install`.
 *
 * Design: the change set is what a plain gate run reads, everything not on
 * origin/HEAD plus the working tree — this checkout's change, not every change a
 * push can carry: `git push origin other-branch` sends commits HEAD does not have,
 * and no local read can see them.
 */
function pushPreview(root, gate) {
  // The same argument list the gate itself reads with `args.includes("--full")`.
  if (strictPushGate() || gate.args.includes("--full")) return { mode: "full" };
  const files = localFiles(root);
  if (files === null) return { mode: "unknown" };
  return planPreflight(root, files);
}

/**
 * The gate script the hook names, and whether this checkout can load it: the file
 * is there, it parses, and every module it imports relatively is there too.
 *
 * Design: loading stops short of running — the gate would read a change set and
 * start tests, while a tree that cannot load the module fails before its first
 * line anyway.
 */
function gateScriptCheck(root, script) {
  const file = path.join(root, script);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return { file, problem: "the gate script is not in this checkout" };
  }
  if (!stat.isFile()) return { file, problem: "the gate script is not a file" };
  const problem = loadProblem(file);
  return problem ? { file, problem: problem.problem, detail: problem.detail } : { file };
}

/** The first reason node could not load `file` — a parse error, or a relative import that is gone. */
function loadProblem(file, seen = new Set()) {
  const key = path.resolve(file);
  if (seen.has(key)) return null;
  seen.add(key);

  const check = spawnSync(process.execPath, ["--check", key], { encoding: "utf8" });
  if (check.error) return { problem: "cannot run node on the gate script", detail: check.error.message };
  if (check.status !== 0) return { problem: "the gate script does not parse", detail: syntaxErrorLine(check.stderr) };

  const source = readText(key);
  if (source.error) return { problem: "cannot read the gate script", detail: source.error.message };
  for (const specifier of relativeImports(source.text)) {
    const target = path.resolve(path.dirname(key), specifier);
    let stat;
    try {
      stat = fs.statSync(target);
    } catch {
      return { problem: "the gate script imports a file that is not there", detail: target };
    }
    if (!stat.isFile()) return { problem: "the gate script imports a directory", detail: target };
    const deeper = loadProblem(target, seen);
    if (deeper) return deeper;
  }
  return null;
}

// The relative specifiers a module imports or re-exports: `from "./x.mjs"`, a
// bare `import "./x.mjs"`, and `import("./x.mjs")`. A bare or `node:` specifier
// is the installed workspace's own and is not this checkout's to check.
function relativeImports(text) {
  const found = new Set();
  for (const match of text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.[^"'\n]+)["']/g)) found.add(match[1]);
  return [...found];
}

/** The `SyntaxError: …` line node prints, not the file:line header or the source echo. */
function syntaxErrorLine(stderr) {
  const line = String(stderr)
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .find((candidate) => /^\w*Error\b/.test(candidate));
  return line ?? firstLine(String(stderr));
}

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
  if (result.state === "unfollowable") {
    // The installed copy matches the source here, so reinstalling changes nothing:
    // the line to repair is the one in the source file.
    console.error(`[hooks] cannot follow the hook's exec line: ${result.command || result.hookPath}`);
    console.error(`[hooks] a push still runs it; fix ${HOOK_SOURCE}, then ${installHint(false)}`);
    return 2;
  }
  if (result.state === "ok") {
    console.log(`[hooks] pre-push installed: ${result.hookPath}`);
    if (result.target) console.log(`[hooks] runs: ${result.target}`);

    const script = gateScriptCheck(result.root, result.gate.script);
    if (script.problem) {
      console.error(`[hooks] blocked: ${script.problem}: ${script.detail ?? script.file}`);
      console.error("[hooks] fix: restore it in this checkout — a push aborts inside the hook without it");
      return 2;
    }

    const preview = pushPreview(result.root, result.gate);
    if (preview.mode === "broken") {
      // Design: the hook is fine and the repository is not, so the words and the
      // exit code are the gate's own — nothing was looked at, which is 2, never
      // 1's "the code is bad".
      console.error("[hooks] blocked: the gate cannot read this repository");
      console.error(`[hooks] reason: ${preview.reason}`);
      console.error(`[hooks] fix: ${preview.fix}`);
      return 2;
    }
    const report = modeReport(preview);
    if (!report) {
      console.error(`[hooks] cannot tell: the gate answered a mode status has no line for ("${preview.mode}")`);
      return 2;
    }
    console.log(`[hooks] ${report.mode}`);
    console.log(`[hooks] ${report.wait}`);
    return 0;
  }

  console.error(`[hooks] ${STATUS_PROBLEM[result.state]}: ${result.hookPath}`);
  if (result.target) console.error(`[hooks] runs: ${result.target}`);
  const foreign = result.state === "foreign";
  console.error(`[hooks] ${foreign ? "replace it with" : "install it"}: ${installHint(foreign)}`);
  return 1;
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    const self = fs.realpathSync.native(fileURLToPath(import.meta.url));
    const entry = fs.realpathSync.native(path.resolve(process.argv[1]));
    return process.platform === "win32" ? self.toLowerCase() === entry.toLowerCase() : self === entry;
  } catch {
    return false;
  }
}

const FLAGS = { install: ["--force"], status: [] };

if (isEntryPoint()) {
  const [command, ...flags] = process.argv.slice(2);
  const allowed = Object.hasOwn(FLAGS, command) ? FLAGS[command] : null;
  if (!allowed || flags.some((flag) => !allowed.includes(flag))) {
    console.error("[hooks] usage: node scripts/preflight-hooks.mjs install [--force] | status");
    process.exit(2);
  }
  if (command === "install") process.exit(reportInstall(installHook({ force: flags.includes("--force") })));
  process.exit(reportStatus(prePushStatus()));
}
