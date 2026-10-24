#!/usr/bin/env node
// Preflight: before a commit, run the tests of every workspace package the
// change touches. Invoked by .git/hooks/pre-commit-user (GitButler's managed
// pre-commit chains to it). Rationale: "tests must stay green" as prose kept
// getting skipped; as a gate it cannot be.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (args) => {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return (r.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean);
};

const changed = new Set([
  ...git(["diff", "--name-only", "HEAD"]),
  ...git(["diff", "--name-only", "--cached"]),
  ...git(["ls-files", "--others", "--exclude-standard"]),
]);

const pkgs = [...new Set(
  [...changed]
    .map((f) => f.split("/").slice(0, 2).join("/"))
    .filter((p) => /^(packages|apps)\/[^/]+$/.test(p) && existsSync(path.join(root, p, "package.json")))
)];

if (!pkgs.length) {
  console.log("[preflight] no workspace package touched — skipping package tests");
  process.exit(0);
}

// A package with no test script (e.g. dsh-plugin) has nothing to run.
const runnable = pkgs.filter((p) => {
  try { return Boolean(JSON.parse(readFileSync(path.join(root, p, "package.json"), "utf8")).scripts?.test); }
  catch { return false; }
});
if (!runnable.length) {
  console.log("[preflight] touched packages declare no test script — skipping");
  process.exit(0);
}

console.log("[preflight] running tests for: " + runnable.join(", "));
const args = ["exec", "turbo", "run", "test", ...runnable.map((p) => `--filter=./${p}`)];
const r = spawnSync("pnpm", args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
if (r.status !== 0) {
  console.error("\n[preflight] tests failed — commit blocked. Fix them, or bypass deliberately with `git commit --no-verify`.");
  process.exit(r.status ?? 1);
}
console.log("[preflight] green");