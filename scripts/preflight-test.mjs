#!/usr/bin/env node
// Preflight gate: before a push, run the tests the change can break.
// scripts/preflight-change.mjs names the change set; preflight-plan.mjs turns
// it into a package list. A change outside apps/ and packages/ has no clear
// owner, so it falls back to the full suite.
//
// Design: no commit gate — a commit runs no tests, so fixing a message or
// splitting a commit costs no test run. A push runs this gate and a merge waits
// for one full run. See AGENTS.md.
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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { localFiles, pushedFiles, PUSH_UNKNOWN } from "./preflight-change.mjs";
import { commandArgs } from "./preflight-command.mjs";
import { gitEnv } from "./preflight-git.mjs";
import { planPreflight } from "./preflight-plan.mjs";
import { writeStderr } from "./preflight-stderr.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

// The gate's own tests, in groups: the gate is the only mechanical stop before
// a push, so the judgments it shares with CI run here too. CI's change policy
// decides which lanes a push needs and the workflow checker decides whether
// those lanes can start at all; a broken one used to stay green locally and
// surface only in the CI run this gate exists to spare. Each group runs on its
// own so a red one is named by construction instead of read back out of a
// reporter's prose. PREFLIGHT_GATE_TESTS replaces the whole list for the tests
// that drive this script with a fake pnpm.
function gateGroups() {
  const override = process.env.PREFLIGHT_GATE_TESTS;
  if (override) {
    const files = override.split(",");
    return [{ name: files.join(", "), files }];
  }
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

// Design: the old commit hook gets a notice, not a test run — a clone that
// still has pre-commit-user calls this with --staged and nothing else. Name the
// file to delete and exit 0, so the commit goes through; the install command in
// AGENTS.md removes the file anyway. Any other argument list is a real run, so
// `--staged --full` still runs the suite instead of being swallowed.
if (args.length === 1 && args[0] === "--staged") {
  console.log("[preflight] no commit gate: delete the old pre-commit-user hook (git rev-parse --git-path hooks); pushes still run this gate");
  process.exit(0);
}

const change = readChange();
if (change.note) console.log(`[preflight] ${change.note}`);
const plan = change.unknown
  ? { mode: "full", reason: change.unknown, files: [], packages: [] }
  : planPreflight(root, change.files, { forceFull: args.includes("--full") });

if (plan.mode === "none") {
  console.log("[preflight] nothing to run: no changed files");
  process.exit(0);
}

if (plan.mode === "full") {
  console.log(`[preflight] full suite: ${plan.reason}`);
  if (plan.outside?.length) console.log(`[preflight] outside the packages: ${listFirst(plan.outside)}`);
} else {
  console.log(`[preflight] changed ${plan.files.length} file(s) in ${plan.touched.length} package(s)`);
  console.log(`[preflight] run: ${plan.packages.join(", ")} (the change plus everything that depends on it)`);
  console.log("[preflight] turbo also tests what these packages depend on");
}

const runArgs = commandArgs(plan);
const selfTest = plan.mode === "full" && process.env.PREFLIGHT_SELF_TEST !== "0";

if (args.includes("--dry-run")) {
  console.log(`[preflight] dry run, would run: pnpm ${runArgs.join(" ")}`);
  if (selfTest) console.log(`[preflight] dry run, would also run the gate's own tests: ${describeGateGroups()}`);
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

// A scripts/ change falls back to pnpm test, which only knows the workspace
// packages — the gate's own tests have to run here or a broken gate ships.
// PREFLIGHT_SELF_TEST=0 skips this for the test that drives the script with a
// fake pnpm; PREFLIGHT_GATE_TESTS replaces the group list so that test does not
// re-enter the whole suite.
if (selfTest) {
  let result;
  try {
    result = await runGateTests();
  } catch (error) {
    result = { failed: [], tests: null, failure: `could not start the gate's own tests: ${error.message}` };
  }
  if (interrupted) process.exit(interrupted);
  if (result.failure || result.failed.length > 0) {
    const reason = result.failure ?? `gate self-test failed: ${result.failed.map((group) => group.name).join(", ")}`;
    writeStderr(`[preflight] ${reason}`);
    reportKeptTestHome(testHome);
    writeStderr("[preflight] blocked: the gate's own tests failed");
    process.exit(1);
  }
  console.log(`[preflight] gate self-test green: ${describeCount(result.tests)}`);
}

child = spawn("pnpm", runArgs, {
  cwd: root,
  env: testHome.env,
  stdio: ["inherit", "pipe", "pipe"],
  shell: process.platform === "win32",
  detached: process.platform !== "win32",
});

const tail = drain(child, 64 * 1024);

let status;
try {
  status = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
} catch (error) {
  reportKeptTestHome(testHome);
  writeStderr(`[preflight] could not start pnpm: ${error.message}`);
  process.exit(1);
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (interrupted) {
  process.exitCode = interrupted;
} else if (status !== 0) {
  const failed = failedTask(tail());
  console.error(`\n[preflight] blocked after ${seconds}s: ${failed ?? "a task failed, see the output above"}`);
  reportKeptTestHome(testHome, console.error);
  process.exitCode = status ?? 1;
} else {
  console.log(`\n[preflight] green in ${seconds}s (${plan.mode})`);
  removeTestHome(testHome);
}

function readChange() {
  if (args.includes("--pushed")) {
    const input = readStdin();
    if (input === null) return { unknown: "could not read the pushed refs" };
    const pushed = pushedFiles(root, input);
    if (pushed === PUSH_UNKNOWN) return { unknown: "could not read the pushed commits" };
    if (pushed !== null) return { files: pushed };
    const files = localFiles(root);
    if (files === null) return { unknown: "git could not name the change" };
    return { files, note: "no refs on stdin, looked at the working tree instead" };
  }
  const files = localFiles(root);
  return files === null ? { unknown: "git could not name the change" } : { files };
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

function listFirst(files) {
  const shown = files.slice(0, 5).join(", ");
  return files.length > 5 ? `${shown}, +${files.length - 5} more` : shown;
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

// Run each group and report which ones failed plus how many tests ran. The
// reporter is pinned to spec so the summary line the count comes from has one
// shape, on a terminal and down a pipe alike.
async function runGateTests() {
  console.log(`[preflight] running the gate's own tests: ${describeGateGroups()}`);
  const gateEnv = { ...testHome.env };
  delete gateEnv.NODE_TEST_CONTEXT;
  const failed = [];
  const counts = [];
  for (const group of GATE_GROUPS) {
    child = spawn(process.execPath, ["--test", "--test-reporter=spec", ...group.files], {
      cwd: root,
      env: gateEnv,
      stdio: ["inherit", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const tail = drain(child, 8 * 1024);
    let status;
    try {
      status = await new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", resolve);
      });
    } finally {
      child = null;
    }
    counts.push(testCount(tail()));
    if (status !== 0) failed.push(group);
    if (interrupted) break;
  }
  // An unreadable count is left out of the total rather than guessed at.
  const tests = counts.every((count) => count !== null) ? counts.reduce((sum, count) => sum + count, 0) : null;
  return { failed, tests, failure: null };
}

// Forward both streams and keep the last bytes, so a caller can read a line out
// of output the operator has already seen.
function drain(source, limit) {
  let tail = "";
  for (const [stream, out] of [
    [source.stdout, process.stdout],
    [source.stderr, process.stderr],
  ]) {
    stream.on("data", (chunk) => {
      out.write(chunk);
      tail = (tail + chunk).slice(-limit);
    });
  }
  return () => tail;
}

// node's spec reporter ends with "ℹ tests N"; TAP, which a non-terminal may
// still get, says "# tests N". Both are last, so the tail holds them.
function testCount(output) {
  const match = /^(?:ℹ|#) tests (\d+)$/m.exec(output.replace(/\u001b\[[0-9;]*m/g, ""));
  return match ? Number(match[1]) : null;
}

function describeCount(tests) {
  const groups = `${GATE_GROUPS.length} group${GATE_GROUPS.length === 1 ? "" : "s"}`;
  return tests === null ? groups : `${tests} tests in ${groups}`;
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
