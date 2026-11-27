#!/usr/bin/env node
// Preflight gate: before a push, run the tests the change can break.
// scripts/preflight-change.mjs names the change set; preflight-plan.mjs turns
// it into a package list. A change no package owns runs nothing and says it
// skipped; a repository the gate cannot read stops the push and says what to
// repair. Documentation runs nothing and says so too, and the root files whose
// readers the plan's table names run those readers — alone when the change is
// only root files, joined to the incremental set when it also touches packages.
//
// Design: no commit gate — a commit runs no tests, so fixing a message or
// splitting a commit costs no test run. A push runs this gate and a merge waits
// for one full run. See AGENTS.md.
//
// Design: the exit code is the answer — 0 = skipped or green, 1 = the run did
// not pass, 2 = the gate itself could not do its job. An interrupt keeps its
// signal's code (130/143) instead of borrowing one of the three, because a
// person pressing Ctrl-C did not fail a test. Nothing out of the gate's own
// control borrows 1 either: that would read as "the code is bad" when the
// truth is "nobody looked".
//
// The tests run on the working tree, not on the exact commit being pushed: an
// uncommitted edit can turn the gate green for code that is not in the push.
//
// Every test run gets a throwaway home: HOME and USERPROFILE point at a fresh
// temp dir, so a test that forgets its own sandbox writes there instead of the
// operator's ~/.ans. A green run deletes it; a red one keeps it and prints the
// path, so whatever the tests left behind can still be looked at.
//
// Called by the pre-push hook (with --pushed); `but push` and `git push` both
// run that hook. See AGENTS.md.
//
//   node scripts/preflight-test.mjs            # everything not on origin/HEAD, plus the tree
//   node scripts/preflight-test.mjs --pushed   # pre-push: the refs on stdin
//   node scripts/preflight-test.mjs --full     # always run the whole suite
//   node scripts/preflight-test.mjs --dry-run  # print the plan, run nothing

import { spawn, spawnSync } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveYaml } from "./check-workflows.mjs";
import { flushStreams } from "./preflight-flush.mjs";
import { localFiles, pushedFiles, PUSH_UNKNOWN } from "./preflight-change.mjs";
import { commandArgs } from "./preflight-command.mjs";
import { gitEnv } from "./preflight-git.mjs";
import { broken, planPreflight } from "./preflight-plan.mjs";
import { writeStderr } from "./preflight-stderr.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

// Design: a reader that went away (piping into head) turns every later write into
// an EPIPE, and Node raises it as an uncaught exception — the gate would die with
// a stack instead of its exit code. Its answer is the exit code, so a stream that
// cannot be written is not worth crashing over.
for (const stream of [process.stdout, process.stderr]) stream.on("error", () => {});

// Design: one `node --test` per group — a red group is named by the run that
// failed, instead of parsed out of a reporter.
//
// Design: a full run covers the shared judgments too — the gate is the only
// mechanical stop before a push, so a broken change policy or workflow checker
// should not wait for CI to notice. Incremental pushes skip all of it.
//
// PREFLIGHT_GATE_TESTS replaces the group list for the tests that drive this
// script with a fake pnpm.
function gateGroups() {
  const override = process.env.PREFLIGHT_GATE_TESTS;
  if (override) return [{ name: "PREFLIGHT_GATE_TESTS override", files: override.split(",") }];
  return [
    { name: "push gate", files: ["scripts/test/preflight-*.test.mjs"] },
    { name: "CI change policy", files: ["scripts/test/ci-changes.test.mjs"], shared: true },
    { name: "workflow checks", files: ["scripts/test/check-workflows.test.mjs"], shared: true },
  ];
}

const GATE_GROUPS = gateGroups();

// Name the groups, and say which ones are not the gate's own: those run here
// because a broken shared judgment is invisible until CI.
function describeGateGroups() {
  const names = (groups) => groups.map((group) => group.name).join(", ");
  const shared = GATE_GROUPS.filter((group) => group.shared);
  if (shared.length === 0) return names(GATE_GROUPS);
  return `${names(GATE_GROUPS.filter((group) => !group.shared))}, plus the shared judgments (${names(shared)})`;
}

function gateFileList() {
  return GATE_GROUPS.flatMap((group) => group.files).join(", ");
}

// Design: the old commit hook gets a notice, not a test run — a clone that
// still has pre-commit-user calls this with --staged and nothing else. Name the
// file to delete and exit 0, so the commit goes through; the install command in
// AGENTS.md removes the file anyway. Any other argument list is a real run, so
// `--staged --full` still runs the suite instead of being swallowed.
if (args.length === 1 && args[0] === "--staged") {
  console.log("[preflight] no commit gate: delete the old pre-commit-user hook (git rev-parse --git-path hooks); pushes still run this gate");
  process.exit(0);
}

// The repair for a change set git cannot name, in the order that actually fixes
// it: a stale base needs a fetch, and a clone that never had origin/HEAD (git
// init + fetch writes none) needs set-head, which a fetch cannot do. It sits
// above the call because planRun reads it.
const FETCH_FIRST =
  "run `git fetch origin`, then `git remote set-head origin -a` if origin/HEAD is still missing";

const plan = planRun();

if (plan.mode === "none") {
  console.log("[preflight] nothing to run: no changed files");
  process.exit(0);
}

// Design: a docs-only push exits here with no test child, and says skipped —
// never green, because a green line would read as evidence (#389's gate
// contract).
if (plan.mode === "docs") {
  console.log(`[preflight] skipped: all ${plan.files.length} changed file(s) are documentation — no test ran`);
  saySkippedIsNotAPass();
  process.exit(0);
}

// Design: a file no package owns is skipped, not run at full width — the old
// fallback spent the whole suite on a file nobody could name a reader for, then
// got killed or bypassed, so "nothing ran" read the same as "it failed". Like
// the docs skip it says skipped and never green. It also has to say that the
// whole change ran nothing: a package change next to an unowned file loses its
// run too, and a line counting only the unowned files would hide that.
if (plan.mode === "unowned") {
  console.log(
    `[preflight] skipped: ${plan.outside.length} changed file(s) belong to no workspace package — no test ran for the whole change`,
  );
  console.log(`[preflight] skipped files: ${listFirst(plan.outside)}`);
  saySkippedIsNotAPass();
  console.log("[preflight] this coverage is CI's: check-build runs the full suite when no package owns a file");
  console.log("[preflight] to run the whole suite here anyway: node scripts/preflight-test.mjs --full");
  process.exit(0);
}

// Design: a repository the gate cannot read stops the push with exit 2 — its
// own code, so 1 keeps meaning "a test went red". The reason names what it could
// not read, the fix names the repair, and --no-verify is the way past a gate
// that has no answer. CI still runs, so the escape hatch does not hide the
// change from anyone but the operator.
if (plan.mode === "broken") {
  writeStderr(`[preflight] blocked: ${plan.reason}`);
  writeStderr(`[preflight] fix: ${plan.fix}`);
  writeStderr("[preflight] to push anyway: git push --no-verify");
  process.exit(2);
}

if (plan.mode === "full") {
  console.log(`[preflight] full suite: ${plan.reason}`);
} else {
  console.log(`[preflight] changed ${plan.files.length} file(s), running ${plan.packages.length} package(s)`);
  console.log(`[preflight] run: ${plan.packages.join(", ")} (${runReason(plan)})`);
  console.log("[preflight] turbo runs tests in these packages only, not in the packages they depend on");
}

const runArgs = commandArgs(plan);
const selfTest = plan.mode === "full" && process.env.PREFLIGHT_SELF_TEST !== "0";

if (args.includes("--dry-run")) {
  console.log(`[preflight] dry run, would run: pnpm ${runArgs.join(" ")}`);
  if (selfTest) {
    console.log(`[preflight] dry run, would also run the gate's own tests: ${describeGateGroups()}`);
    console.log(`[preflight] dry run, gate self-test files: ${gateFileList()}`);
  }
  process.exit(0);
}

const started = Date.now();
const testHome = makeTestHome();
let child;
let interrupted = 0;

// An interrupt is not a green run. Keep the home, forward the signal so pnpm
// and turbo stop too, and let the child close before exiting — a hard exit
// here would leave them writing into the directory this run is keeping.
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.once(signal, () => {
    interrupted = code;
    reportKeptTestHome(testHome);
    stopChild(child, signal);
  });
}

// Design: the gate's own tests follow `full`, not `scripts/` — a change under
// scripts/ is now unowned, so it never gets here. The self-test measures 1m46s
// and does not fit a pre-push budget, and CI's check-build runs the same files
// on every push. --full still runs them, because a person asking for the strict
// run asked for the evidence too. PREFLIGHT_SELF_TEST=0 skips this for the test
// that drives the script with a fake pnpm; PREFLIGHT_GATE_TESTS replaces the
// group list so that test does not re-enter the whole suite.
if (selfTest) {
  // Design: the shared judgment that needs a YAML parser is asked for here, by
  // resolving the parser the same way check-workflows does — an uninstalled or
  // half-installed tree would otherwise report a broken judgment. Name the
  // command instead. PREFLIGHT_GATE_TESTS means a test supplied its own files.
  if (!process.env.PREFLIGHT_GATE_TESTS && !resolveYaml(root)) {
    removeTestHome(testHome);
    writeStderr("[preflight] blocked: no YAML parser under node_modules — run `pnpm install --ignore-scripts` first; the shared judgments and the suite both need the workspace dependencies");
    // Design: no parser means no answer, so this is exit 2, not 1.
    process.exit(2);
  }
  let result;
  try {
    result = await runGateTests();
  } catch (error) {
    result = { failed: [], tests: null, failure: `could not start the gate's own tests: ${error.message}` };
  }
  if (interrupted) await exitAfterFlush(interrupted);
  // Design: the two answers stay apart — a group that could not even start is the
  // gate failing (2), a group that ran and went red is a red test (1).
  if (result.failure) {
    writeStderr(`[preflight] ${result.failure}`);
    reportKeptTestHome(testHome);
    writeStderr("[preflight] blocked: the gate could not run its own tests");
    await exitAfterFlush(2);
  }
  if (result.failed.length > 0) {
    writeStderr(`[preflight] gate self-test failed: ${result.failed.map((group) => group.name).join(", ")}`);
    reportKeptTestHome(testHome);
    writeStderr("[preflight] blocked: the gate's own tests failed");
    await exitAfterFlush(1);
  }
  console.log(`[preflight] gate self-test green: ${describeCount(result.tests, GATE_GROUPS.length)}`);
}

child = spawn("pnpm", runArgs, {
  cwd: root,
  env: testHome.env,
  stdio: ["inherit", "pipe", "pipe"],
  shell: process.platform === "win32",
  detached: process.platform !== "win32",
});

const readTail = forwardKeepingTail(child, 64 * 1024);

let status;
try {
  status = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
} catch (error) {
  reportKeptTestHome(testHome);
  writeStderr(`[preflight] could not start pnpm: ${error.message}`);
  // Design: no test ran, so this is the gate failing, not the code — exit 2.
  process.exit(2);
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (interrupted) {
  process.exitCode = interrupted;
} else if (status !== 0) {
  const failed = failedTask(readTail());
  console.error(`\n[preflight] blocked after ${seconds}s: ${failed ?? "a task failed, see the output above"}`);
  reportKeptTestHome(testHome, console.error);
  // Design: a run that did not pass is 1 whatever pnpm exited with — its own
  // code is not the answer to "were the tests green", and forwarding a 2 here
  // would read as "the gate is broken" instead.
  process.exitCode = 1;
} else {
  console.log(`\n[preflight] green in ${seconds}s (${plan.mode})`);
  removeTestHome(testHome);
}

function readChange() {
  if (args.includes("--pushed")) {
    const input = readStdin();
    if (input === null) {
      return {
        unknown: "could not read the pushed refs",
        fix: "git handed the hook nothing on stdin — run this script by hand to name the change",
      };
    }
    const pushed = pushedFiles(root, input);
    if (pushed === PUSH_UNKNOWN) return { unknown: "could not read the pushed commits", fix: FETCH_FIRST };
    if (pushed !== null) return { files: pushed };
    const files = localFiles(root);
    if (files === null) return { unknown: "git could not name the change", fix: FETCH_FIRST };
    return { files, note: "no refs on stdin, looked at the working tree instead" };
  }
  const files = localFiles(root);
  return files === null ? { unknown: "git could not name the change", fix: FETCH_FIRST } : { files };
}

// The plan for a run.
//
// Design: `--full` never needs the change set — "run everything anyway" is exactly
// what it is for — so an unreadable change set does not stop it. Without `--full`,
// a change set git cannot name is a broken gate: nothing starts, and the reason
// and its repair go to the caller.
function planRun() {
  const change = readChange();
  if (change.note) console.log(`[preflight] ${change.note}`);
  const forceFull = args.includes("--full");
  if (!change.unknown) return planPreflight(root, change.files, { forceFull });
  if (forceFull) {
    return { mode: "full", reason: `${change.unknown}; --full runs everything anyway`, files: [], packages: [] };
  }
  // A change set git cannot name is the gate being broken: the push stops with
  // exit 2 and nothing starts.
  return broken(change.unknown, change.fix, []);
}

// turbo names a failed task on its summary line, e.g. "Failed: @scope/app#test".
function failedTask(output) {
  const match = /^Failed:\s*(.+)$/m.exec(output.replace(/\u001b\[[0-9;]*m/g, ""));
  return match ? match[1].trim() : null;
}

function readStdin() {
  if (process.stdin.isTTY) return "";
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return null;
  }
}

// Both skip paths say the same thing, so both say it with the same words.
function saySkippedIsNotAPass() {
  console.log("[preflight] a skipped run is not a pass: nothing here is evidence that the change is good");
}

function listFirst(files) {
  const shown = files.slice(0, 5).join(", ");
  return files.length > 5 ? `${shown}, +${files.length - 5} more` : shown;
}

// Why these packages and no others. Each mode that exists says what it is; the
// default is a guard for a mode this printer has not met yet, so it names the
// packages without borrowing a closure claim that did not happen.
function runReason(plan) {
  switch (plan.mode) {
    case "readers":
      return "the packages whose tests read these root files";
    case "incremental":
      if (plan.readers) return "the change plus its dependents, plus the readers of root files";
      return "the change plus everything that depends on it";
    default:
      return "the packages this change selected";
  }
}

// The child's whole home is a fresh temp dir, so a test that writes to ~/.ans
// without sandboxing its own run lands here instead of the operator's.
//
// Design: replace the child's whole home and drop every ANS_* — a test that
// resolves the home itself is covered too, and an operator's own ANS_DB_PATH
// or ANS_PI_SESSION_DIR cannot point a path back at the real user root;
// redirecting only ~/.ans or keeping ANS_LLM_* for live lanes was rejected
// because no test in the suite reads those keys from the runner.
//
// The repository pointers go too, so a test that makes its own repo cannot
// commit into the operator's checkout.
function makeTestHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ans-preflight-home-"));
  // turbo on Windows looks for its global config dir under
  // %USERPROFILE%\AppData\Roaming; a fresh temp home has no such layer and turbo
  // exits 1 ("Global config path not found.") before any task runs.
  //
  // Design: build that one layer, on Windows only — off Windows turbo does not
  // look there, and a real profile always has it.
  if (process.platform === "win32") fs.mkdirSync(path.join(home, "AppData", "Roaming"), { recursive: true });
  const realHome = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const env = gitEnv(process.env);
  // Windows env names are case-insensitive, so the filter is too: a lowercase
  // ans_db_path still resolves as ANS_DB_PATH in the child.
  for (const key of Object.keys(env)) {
    if (/^ans_/i.test(key)) delete env[key];
  }
  const corepack = corepackHome(env, realHome);
  if (corepack) env.COREPACK_HOME = corepack;
  env.HOME = home;
  env.USERPROFILE = home;
  return { home, env };
}

// Corepack, which the README names as a way to get the pinned pnpm, keeps its
// cache under HOME on Linux and macOS. Point it at the real cache so a gated
// run does not download pnpm again; Windows uses LOCALAPPDATA and is fine.
function corepackHome(env, home) {
  if (env.COREPACK_HOME || process.platform === "win32") return undefined;
  if (process.platform === "darwin") return path.join(home, "Library", "Caches", "node", "corepack");
  if (env.XDG_CACHE_HOME) return undefined;
  return path.join(home, ".cache", "node", "corepack");
}

// A red run keeps the home: the files in it are the evidence of what leaked.
// The default is the sync writer; a caller that lets the event loop drain
// passes console.error so the line stays behind pnpm's own stderr.
function reportKeptTestHome({ home }, write = writeStderr) {
  write(`[preflight] test home kept for inspection: ${home}`);
}

// Design: pin the reporter to spec — the total is read from the summary line it
// ends with, so a terminal and a pipe must print the same shape.
async function runGateTests() {
  console.log(`[preflight] running the gate's own tests: ${describeGateGroups()}`);
  console.log(`[preflight] gate self-test files: ${gateFileList()}`);
  const gateEnv = { ...testHome.env };
  delete gateEnv.NODE_TEST_CONTEXT;
  const failed = [];
  const counts = [];
  for (const group of GATE_GROUPS) {
    if (interrupted) break;
    child = spawn(process.execPath, ["--test", "--test-reporter=spec", ...group.files], {
      cwd: root,
      env: gateEnv,
      stdio: ["inherit", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const groupTail = forwardKeepingTail(child, 8 * 1024);
    let status;
    try {
      status = await new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", resolve);
      });
    } finally {
      child = null;
    }
    counts.push(testCount(groupTail()));
    if (status !== 0) failed.push(group);
  }
  // One unreadable count makes the total unknown: the rest do not add up to it,
  // and a partial sum would be reported as the whole.
  const tests = counts.every((count) => count !== null) ? counts.reduce((sum, count) => sum + count, 0) : null;
  return { failed, tests, failure: null };
}

// Forward both streams and keep the last bytes, so a caller can read a line out
// of output the operator has already seen. Design: decode through StringDecoder —
// a `ℹ` split across two chunks would otherwise fail the count's regex.
function forwardKeepingTail(source, limit) {
  let tail = "";
  for (const [stream, out] of [
    [source.stdout, process.stdout],
    [source.stderr, process.stderr],
  ]) {
    const decoder = new StringDecoder("utf8");
    stream.on("data", (chunk) => {
      out.write(chunk);
      tail = (tail + decoder.write(chunk)).slice(-limit);
    });
  }
  return () => tail;
}

// Design: the flush lives in preflight-flush.mjs so a test can give it a fake
// stream — preflight-stderr.mjs is there for the same reason.
async function exitAfterFlush(code) {
  await flushStreams([process.stdout, process.stderr]);
  process.exit(code);
}

// node's spec reporter prints "ℹ tests N" once per run. A run that printed so
// much the summary fell out of the tail reports no count rather than a wrong one.
function testCount(output) {
  const match = /^ℹ tests (\d+)$/m.exec(output.replace(/\u001b\[[0-9;]*m/g, ""));
  return match ? Number(match[1]) : null;
}

function describeCount(tests, count) {
  const groups = `${count} group${count === 1 ? "" : "s"}`;
  // Say the count is unknown instead of passing the group count off as it.
  return tests === null ? `${groups} (test count unreadable)` : `${tests} tests in ${groups}`;
}

// Stop the whole tree: pnpm's turbo and the tests it starts are grandchildren,
// and on Windows `shell: true` puts a cmd.exe between the gate and pnpm.
function stopChild(child, signal) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    // ESRCH: the group is gone. Darwin's EPERM means it is still draining, so
    // SIGKILL still gets a chance. Anything else cannot be signalled: report
    // and leave instead of waiting on a close that will never come.
    if (error.code === "ESRCH") return;
    if (!(error.code === "EPERM" && process.platform === "darwin")) {
      leaveUnstoppable(`could not signal the test process group: ${error.message}`);
    }
  }
  // A child that ignores the signal must not keep the gate alive.
  setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code === "ESRCH") return;
      // The group cannot be stopped, so waiting on its close would hang the
      // gate forever.
      leaveUnstoppable(`could not stop the test process group: ${error.message}`);
    }
  }, 5000).unref();
}

function leaveUnstoppable(message) {
  writeStderr(`[preflight] ${message}`);
  process.exit(interrupted || 1);
}

function removeTestHome({ home }) {
  try {
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (error) {
    // Design: a cleanup failure keeps the run green and prints where the dir
    // is — a Windows file lock is a handle, not a test failure; failing a
    // green run over it was rejected.
    console.error(`[preflight] could not delete the test home, left it at ${home}: ${error.message}`);
  }
}
