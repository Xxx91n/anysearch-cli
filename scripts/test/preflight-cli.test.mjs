import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scripts = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(scripts, "..");

test("a red run exits non-zero and names the failed task", () => {
  withFakePnpm({ code: 1, lines: [" Tasks:    1 successful, 1 failed", "\u001b[31mFailed:\u001b[0m @anysearch-cli/kernel#test"] }, (bin) => {
    const result = runCliIn(repoRoot, bin, ["--full"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /@anysearch-cli\/kernel#test/);
  });
});

test("a green run reports the mode and how long it took", () => {
  withFakePnpm({ code: 0, lines: [" Tasks:    1 successful, 1 total"] }, (bin) => {
    const result = runCliIn(repoRoot, bin, ["--full"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /green in \d+\.\ds \(full\)/);
  });
});

test("a full run runs the gate's own tests first", () => {
  withFakePnpm({ code: 0, lines: [" Tasks:    1 successful, 1 total"] }, (bin) => {
    const result = runCliIn(repoRoot, bin, ["--full"], { gateTests: "scripts/test/preflight-plan.test.mjs" });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /\[preflight\] running the gate's own tests: scripts\/test\/preflight-plan\.test\.mjs/);
    // The child's reporter output must reach this pipe, not vanish.
    assert.match(result.stdout, /# pass \d+|✔/);
  });
});

test("a red self-test blocks the run", () => {
  withFakePnpm({ code: 0, lines: [] }, (bin) => {
    const result = runCliIn(repoRoot, bin, ["--full"], { gateTests: "scripts/test/preflight-missing.test.mjs" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /the gate's own tests/);
  });
});

test("a full dry run also announces the gate's own tests", () => {
  withFakePnpm({ code: 1, lines: ["pnpm ran"] }, (bin) => {
    const result = runCliIn(repoRoot, bin, ["--full", "--dry-run"], { selfTest: true });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /would run: pnpm test/);
    assert.match(result.stdout, /would also run the gate's own tests: scripts\/test\/preflight-\*\.test\.mjs/);
    assert.equal(result.stdout.includes("pnpm ran"), false);
  });
});

test("an incremental dry run prints the selected packages and the turbo command", () => {
  withWorkspace({ staged: "apps/dsh-plugin/src/index.ts" }, ({ root, bin }) => {
    const result = runCliIn(root, bin, ["--staged", "--dry-run"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /run: @anysearch-cli\/dsh-plugin/);
    assert.match(
      result.stdout,
      /would run: pnpm exec turbo run test --concurrency=2 --filter=@anysearch-cli\/dsh-plugin/,
    );
    // The fake pnpm would fail the run if the dry run actually called it.
    assert.equal(result.stdout.includes("pnpm ran"), false);
  });
});

test("an incremental run hands pnpm one filter per selected package", () => {
  withWorkspace({ staged: "apps/dsh-plugin/src/index.ts", echoArgs: true }, ({ root, bin }) => {
    const result = runCliIn(root, bin, ["--staged"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /--filter=@anysearch-cli\/dsh-plugin/);
    assert.match(result.stdout, /green in \d+\.\ds \(incremental\)/);
  });
});

test("nothing staged reports nothing to run", () => {
  withWorkspace({}, ({ root, bin }) => {
    const result = runCliIn(root, bin, ["--staged"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /nothing to run/);
    assert.equal(result.stdout.includes("pnpm ran"), false);
  });
});

test("a pushed ref runs the gate on the files it carries", () => {
  withWorkspace({ pushed: "apps/dsh-plugin/src/index.ts", echoArgs: true }, ({ root, bin, refs }) => {
    const result = runCliIn(root, bin, ["--pushed"], { input: refs });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /run: @anysearch-cli\/dsh-plugin/);
    assert.match(result.stdout, /--filter=@anysearch-cli\/dsh-plugin/);
  });
});

test("an unreadable push ref runs the full suite", () => {
  withWorkspace({}, ({ root, bin }) => {
    const result = runCliIn(root, bin, ["--pushed"], { input: "not a ref line" });
    assert.equal(result.status, 1); // the fixture's fake pnpm exits 1
    assert.match(result.stdout, /full suite: could not read the pushed commits/);
    assert.match(result.stdout, /pnpm ran/);
  });
});

test("no refs on stdin falls back to the working tree and says so", () => {
  withWorkspace({ pushed: "apps/dsh-plugin/src/index.ts", echoArgs: true }, ({ root, bin }) => {
    const result = runCliIn(root, bin, ["--pushed"], { input: "" });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /no refs on stdin, looked at the working tree instead/);
    assert.match(result.stdout, /run: @anysearch-cli\/dsh-plugin/);
  });
});

function runCliIn(root, bin, args, { gateTests, selfTest = false, input } = {}) {
  const env = { ...process.env };
  // Read PATH through process.env, which is case-insensitive on Windows: the
  // spread above keeps the original key's casing, so env.PATH can be undefined
  // and the real PATH would be dropped, hiding git from the child.
  env.PATH = `${bin}${delimiter}${process.env.PATH ?? ""}`;
  if (process.platform === "win32") env.Path = env.PATH;
  delete env.PREFLIGHT_GATE_TESTS;
  if (gateTests || selfTest) {
    delete env.PREFLIGHT_SELF_TEST;
    if (gateTests) env.PREFLIGHT_GATE_TESTS = gateTests;
  } else {
    // A full run would re-enter this file's own tests through the self-test.
    env.PREFLIGHT_SELF_TEST = "0";
  }
  return spawnSync(process.execPath, [join(root, "scripts", "preflight-test.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
    env,
    input,
  });
}

// A stand-in workspace with one app and its scripts copied in. `staged` leaves
// the named file in the index; `pushed` commits it and returns the ref line a
// pre-push hook would send. The fake pnpm echoes its argv when echoArgs is set
// and fails otherwise.
function withWorkspace({ staged, pushed, echoArgs = false } = {}, run) {
  const root = mkdtempSync(join(tmpdir(), "ans-preflight-ws-"));
  const bin = mkdtempSync(join(tmpdir(), "ans-preflight-bin-"));
  try {
    mkdirSync(join(root, "scripts"));
    for (const name of ["preflight-test.mjs", "preflight-change.mjs", "preflight-plan.mjs", "preflight-command.mjs"]) {
      copyFileSync(join(scripts, name), join(root, "scripts", name));
    }
    write(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n');
    write(join(root, "apps", "dsh-plugin", "package.json"), JSON.stringify({ name: "@anysearch-cli/dsh-plugin" }));
    git(root, ["init", "-q"]);
    let refs;
    if (staged) {
      write(join(root, staged), "export const one = 1;\n");
      git(root, ["add", staged]);
    } else if (pushed) {
      git(root, ["config", "user.email", "preflight@example.test"]);
      git(root, ["config", "user.name", "preflight"]);
      git(root, ["config", "commit.gpgsign", "false"]);
      git(root, ["add", "."]);
      git(root, ["commit", "-q", "-m", "base"]);
      const base = rev(root, "HEAD");
      git(root, ["update-ref", "refs/remotes/origin/HEAD", base]);
      write(join(root, pushed), "export const two = 2;\n");
      git(root, ["add", "."]);
      git(root, ["commit", "-q", "-m", "change"]);
      refs = `refs/heads/x ${rev(root, "HEAD")} refs/heads/x ${base}`;
    }
    writeFakePnpm(bin, echoArgs ? { echoArgs: true } : { code: 1, lines: ["pnpm ran"] });
    run({ root, bin, refs });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
}

function rev(root, ref) {
  const result = spawnSync("git", ["rev-parse", ref], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `git rev-parse ${ref}: ${result.stderr}`);
  return result.stdout.trim();
}

function withFakePnpm({ code = 0, lines = [] }, run) {
  const bin = mkdtempSync(join(tmpdir(), "ans-preflight-bin-"));
  try {
    writeFakePnpm(bin, { code, lines });
    run(bin);
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
}

function writeFakePnpm(bin, { code = 0, lines = [], echoArgs = false }) {
  const sh = ["#!/bin/sh", ...(echoArgs ? ['echo "$@"'] : lines.map((line) => `echo "${line}"`)), `exit ${code}`].join("\n");
  const cmd = ["@echo off", ...(echoArgs ? ["echo %*"] : lines.map((line) => `echo ${line}`)), `exit /b ${code}`].join("\r\n");
  write(join(bin, "pnpm"), `${sh}\n`);
  write(join(bin, "pnpm.cmd"), `${cmd}\r\n`);
  chmodSync(join(bin, "pnpm"), 0o755);
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
}

function write(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}
