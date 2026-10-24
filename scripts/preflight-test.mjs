#!/usr/bin/env node
// Preflight: before a commit/push, run the FULL workspace test suite.
// Invoked by .git/hooks/pre-commit-user and .git/hooks/pre-push (GitButler's
// managed pre-commit chains to the former; `but push` and `git push` both run
// the latter).
// Why the full suite instead of filtered package tests:
//   1. `turbo run test --filter=./<pkg>` only pulls UPSTREAM deps
//      (turbo.json: test.dependsOn: ["^test", "build"]), so a change in
//      packages/kernel never ran apps/cli's tests — the exact class of the
//      anysearch.mdc regression (lower layer changed, host contract broke).
//   2. When a change touched only scripts/, .github/ or root config, the
//      touched-package set was empty and the gate exited 0, skipping
//      everything.
// A gate that can silently pass is not a gate; the full suite (13 tasks,
// ~5m21s) is the accepted cost. One behaviour, always the same.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

console.log("[preflight] running the full workspace test suite (turbo run test)");
const r = spawnSync("pnpm", ["test"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
if (r.status !== 0) {
  console.error("\n[preflight] tests failed — blocked. Fix the tests before committing or pushing.");
  process.exit(r.status ?? 1);
}
console.log("[preflight] green");
