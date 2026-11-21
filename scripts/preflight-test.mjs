#!/usr/bin/env node
// Preflight gate: before a commit or push, run the tests the change can break.
// That means every changed workspace package plus every package that depends
// on one of them. A change outside apps/ and packages/ (root config, scripts/,
// .github/, docs/) has no clear owner, so it falls back to the full suite.
//
// Called by .git/hooks/pre-commit-user and by .git/hooks/pre-push. GitButler's
// managed pre-commit chains to the former; `but push` and `git push` both run
// the latter. See AGENTS.md.
//
//   node scripts/preflight-test.mjs                      # work out the change from git
//   node scripts/preflight-test.mjs --pushed             # pre-push: read refs on stdin
//   node scripts/preflight-test.mjs --full               # always run everything
//   node scripts/preflight-test.mjs --dry-run --files a,b # print the plan, run nothing

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { failedTask, planPreflight } from "./preflight-plan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : (args[index + 1] ?? "");
};

const filesFromFlag = flag("--files");
if (filesFromFlag === "") {
  console.error("[preflight] --files needs a comma-separated list of paths");
  process.exit(1);
}

const UNKNOWN = Symbol("unreadable push");
let changed;
let unknownReason = "git could not name the change";
if (filesFromFlag !== null) {
  changed = filesFromFlag.split(",").map((file) => file.trim()).filter(Boolean);
} else {
  const pushed = args.includes("--pushed") ? filesOnPush() : null;
  if (pushed === UNKNOWN) {
    changed = null;
    unknownReason = "could not read the pushed commits";
  } else {
    changed = pushed ?? localFiles();
  }
}

const plan =
  changed === null
    ? { mode: "full", reason: unknownReason, files: [], packages: [] }
    : planPreflight(root, changed, { forceFull: args.includes("--full") });

if (plan.mode === "none") {
  console.log("[preflight] nothing to run: no changed files");
  process.exit(0);
}

if (plan.mode === "full") {
  console.log(`[preflight] full suite: ${plan.reason}`);
  if (plan.outside?.length) console.log(`[preflight] outside the packages: ${listFirst(plan.outside)}`);
} else {
  console.log(`[preflight] ${plan.files.length} changed file(s) in ${plan.touched.length} package(s)`);
  console.log(`[preflight] running ${plan.packages.length} package(s), changed + everything that depends on them:`);
  console.log(`[preflight]   ${plan.packages.join(", ")}`);
}

const turboArgs = ["exec", "turbo", "run", "test", "--concurrency=2"];
if (plan.mode === "incremental") turboArgs.push(...plan.packages.map((name) => `--filter=${name}`));

if (args.includes("--dry-run")) {
  console.log(`[preflight] dry run, would run: pnpm ${turboArgs.join(" ")}`);
  process.exit(0);
}

const started = Date.now();
const child = spawn("pnpm", turboArgs, {
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
  console.log(`\n[preflight] green in ${seconds}s (${plan.mode}${plan.mode === "incremental" ? `, ${plan.packages.length} packages` : ""})`);
}

// The pre-push hook gets the refs being pushed on stdin:
// "<local ref> <local sha> <remote ref> <remote sha>", one line per ref.
function filesOnPush() {
  if (process.stdin.isTTY) return null;
  let input;
  try {
    input = fs.readFileSync(0, "utf8");
  } catch {
    return null;
  }
  const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const files = new Set();
  for (const line of lines) {
    const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/);
    if (!localRef || !localSha || !remoteRef || !remoteSha) return UNKNOWN; // not a ref line: run everything
    if (/^0+$/.test(localSha)) continue; // deleting a ref runs nothing
    const base = /^0+$/.test(remoteSha) ? gitLine(["merge-base", localSha, "origin/HEAD"]) : remoteSha;
    if (!base) return UNKNOWN; // a new branch with no known base: run everything
    const changed = gitLines(["diff", "--name-only", "-z", "--no-renames", base, localSha]);
    if (changed === null) return UNKNOWN;
    for (const file of changed) files.add(file);
  }
  return [...files];
}

// Everything that is not already on origin/HEAD, plus the working tree.
function localFiles() {
  const head = gitLine(["rev-parse", "HEAD"]);
  const base = head && gitLine(["merge-base", "HEAD", "origin/HEAD"]);
  if (!head || !base) return null;

  const parts = [
    gitLines(["diff", "--name-only", "-z", "--no-renames", base, head]),
    gitLines(["diff", "--name-only", "-z", "--no-renames", "HEAD"]),
    gitLines(["ls-files", "--others", "--exclude-standard", "-z"]),
  ];
  if (parts.some((part) => part === null)) return null;
  return [...new Set(parts.flat())];
}

function gitLines(gitArgs) {
  const stdout = git(gitArgs);
  return stdout === null ? null : stdout.split("\0").filter(Boolean);
}

function gitLine(gitArgs) {
  const stdout = git(gitArgs);
  return stdout === null || stdout.trim() === "" ? null : stdout.trim();
}

function git(gitArgs) {
  const result = spawnSync("git", gitArgs, { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout : null;
}

function listFirst(files) {
  const shown = files.slice(0, 5).join(", ");
  return files.length > 5 ? `${shown}, +${files.length - 5} more` : shown;
}
