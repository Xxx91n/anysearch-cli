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
// Called by the pre-push hook (with --pushed); `but push` and `git push` both
// run that hook. See AGENTS.md.
//
//   node scripts/preflight-test.mjs            # everything not on origin/HEAD, plus the tree
//   node scripts/preflight-test.mjs --pushed   # pre-push: the refs on stdin
//   node scripts/preflight-test.mjs --full     # always run the whole suite
//   node scripts/preflight-test.mjs --dry-run  # print the plan, run nothing

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { localFiles, pushedFiles, PUSH_UNKNOWN } from "./preflight-change.mjs";
import { commandArgs } from "./preflight-command.mjs";
import { planPreflight } from "./preflight-plan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const GATE_TESTS = (process.env.PREFLIGHT_GATE_TESTS ?? "scripts/test/preflight-*.test.mjs").split(",");

// Design: the old commit hook gets a notice, not a test run — a clone that
// still has pre-commit-user calls this with --staged. Name the file to delete
// and exit 0, so the commit goes through; the install command in AGENTS.md
// removes the file anyway.
if (args.includes("--staged")) {
  console.log("[preflight] no commit gate: delete the old pre-commit-user hook; pushes still run this gate");
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
  if (selfTest) console.log(`[preflight] dry run, would also run the gate's own tests: ${GATE_TESTS.join(", ")}`);
  process.exit(0);
}

const started = Date.now();

// A scripts/ change falls back to pnpm test, which only knows the workspace
// packages — the gate's own tests have to run here or a broken gate ships.
// PREFLIGHT_SELF_TEST=0 skips this for the test that drives the script with a
// fake pnpm; PREFLIGHT_GATE_TESTS narrows the list so that test does not
// re-enter the whole suite.
if (selfTest) {
  console.log(`[preflight] running the gate's own tests: ${GATE_TESTS.join(", ")}`);
  const gateEnv = { ...process.env };
  delete gateEnv.NODE_TEST_CONTEXT;
  const gate = spawnSync(process.execPath, ["--test", ...GATE_TESTS], { cwd: root, env: gateEnv, stdio: "inherit" });
  if (gate.status !== 0) {
    console.error("[preflight] blocked: the gate's own tests failed");
    process.exit(gate.status ?? 1);
  }
}

const child = spawn("pnpm", runArgs, {
  cwd: root,
  stdio: ["inherit", "pipe", "pipe"],
  shell: process.platform === "win32",
});

let tail = "";
for (const [stream, out] of [
  [child.stdout, process.stdout],
  [child.stderr, process.stderr],
]) {
  stream.on("data", (chunk) => {
    out.write(chunk);
    tail = (tail + chunk).slice(-64 * 1024);
  });
}

let status;
try {
  status = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
} catch (error) {
  console.error(`[preflight] could not start pnpm: ${error.message}`);
  process.exit(1);
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (status !== 0) {
  const failed = failedTask(tail);
  console.error(`\n[preflight] blocked after ${seconds}s: ${failed ?? "a task failed, see the output above"}`);
  process.exitCode = status ?? 1;
} else {
  console.log(`\n[preflight] green in ${seconds}s (${plan.mode})`);
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
