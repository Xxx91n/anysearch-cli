#!/usr/bin/env node
// Preflight gate: before a commit or push, run the tests the change can break.
// The change set comes from git (staged files for a commit, the pushed refs for
// a push, the working tree for a plain run); scripts/preflight-plan.mjs turns
// it into a package list. A change outside apps/ and packages/ has no clear
// owner, so it falls back to the full suite.
//
// The tests run on the working tree, not on the exact commit being pushed: an
// uncommitted edit can turn the gate green for code that is not in the push.
//
// Every run gets a throwaway home: HOME and USERPROFILE point at a fresh temp
// dir, so a test that forgets its own sandbox writes there instead of the
// operator's ~/.ans. A green run deletes it; a red one keeps it and prints the
// path, so whatever the tests left behind can still be looked at.
//
// Called by .git/hooks/pre-commit-user (with --staged) and by
// .git/hooks/pre-push (with --pushed). GitButler's managed pre-commit chains to
// the former; `but push` and `git push` both run the latter. See AGENTS.md.
//
//   node scripts/preflight-test.mjs            # everything not on origin/HEAD, plus the tree
//   node scripts/preflight-test.mjs --staged   # pre-commit: the staged files
//   node scripts/preflight-test.mjs --pushed   # pre-push: the refs on stdin
//   node scripts/preflight-test.mjs --full     # always run the whole suite
//   node scripts/preflight-test.mjs --dry-run  # print the plan, run nothing

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { localFiles, pushedFiles, stagedFiles, PUSH_UNKNOWN } from "./preflight-change.mjs";
import { commandArgs } from "./preflight-command.mjs";
import { planPreflight } from "./preflight-plan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const GATE_TESTS = (process.env.PREFLIGHT_GATE_TESTS ?? "scripts/test/preflight-*.test.mjs").split(",");

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
const testHome = makeTestHome();

// A scripts/ change falls back to pnpm test, which only knows the workspace
// packages — the gate's own tests have to run here or a broken gate ships.
// PREFLIGHT_SELF_TEST=0 skips this for the test that drives the script with a
// fake pnpm; PREFLIGHT_GATE_TESTS narrows the list so that test does not
// re-enter the whole suite.
if (selfTest) {
  console.log(`[preflight] running the gate's own tests: ${GATE_TESTS.join(", ")}`);
  const gateEnv = { ...testHome.env };
  delete gateEnv.NODE_TEST_CONTEXT;
  const gate = spawnSync(process.execPath, ["--test", ...GATE_TESTS], { cwd: root, env: gateEnv, stdio: "inherit" });
  if (gate.status !== 0) {
    leaveTestHome(testHome);
    console.error("[preflight] blocked: the gate's own tests failed");
    process.exit(gate.status ?? 1);
  }
}

const child = spawn("pnpm", runArgs, {
  cwd: root,
  env: testHome.env,
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
  leaveTestHome(testHome);
  console.error(`[preflight] could not start pnpm: ${error.message}`);
  process.exit(1);
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (status !== 0) {
  const failed = failedTask(tail);
  console.error(`\n[preflight] blocked after ${seconds}s: ${failed ?? "a task failed, see the output above"}`);
  leaveTestHome(testHome);
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
  const files = args.includes("--staged") ? stagedFiles(root) : localFiles(root);
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
// without sandboxing its own run lands here instead of the operator's. Every
// ANS_* is dropped first, like apps/plugin/test/server-sandbox.ts: an
// operator's own ANS_DB_PATH or ANS_PI_SESSION_DIR would otherwise point a
// path back at the real user root and make the temp home useless.
function makeTestHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ans-preflight-home-"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^ANS_/.test(key)));
  return { home, env: { ...env, HOME: home, USERPROFILE: home } };
}

// A red run keeps the home: the files in it are the evidence of what leaked.
function leaveTestHome({ home }) {
  console.error(`[preflight] test home kept for inspection: ${home}`);
}

function removeTestHome({ home }) {
  try {
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (error) {
    // The tests passed, so a locked file is not worth failing the gate over —
    // but the directory is still there, and the operator should know where.
    console.error(`[preflight] could not delete the test home, left it at ${home}: ${error.message}`);
  }
}
