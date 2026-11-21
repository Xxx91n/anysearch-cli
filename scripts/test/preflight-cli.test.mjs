import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    clearKeptHome(result);
  });
});

test("a green run reports the mode and how long it took", () => {
  withFakePnpm({ code: 0, lines: [" Tasks:    1 successful, 1 total"] }, (bin) => {
    const result = runCliIn(repoRoot, bin, ["--full"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /green in \d+\.\ds \(full\)/);
  });
});

test("a run gives the child a throwaway home and leaves the operator's home alone", () => {
  const operatorHome = mkdtempSync(join(tmpdir(), "ans-preflight-operator-"));
  const operatorDb = join(operatorHome, "anysearch.db");
  try {
    withWorkspace({ staged: "apps/dsh-plugin/src/index.ts", pnpm: (bin) => writeLeakyPnpm(bin, 0) }, ({ root, bin }) => {
      // Two runs in a row, like the ticket's acceptance: neither may write into
      // the home or the database path the operator actually uses. Windows env
      // names are case-insensitive, so the lowercase key is the harder case
      // there; POSIX only knows the exact name.
      const dbKey = process.platform === "win32" ? "ans_db_path" : "ANS_DB_PATH";
      for (let run = 1; run <= 2; run += 1) {
        const result = runCliIn(root, bin, ["--staged"], {
          overrides: { HOME: operatorHome, USERPROFILE: operatorHome, [dbKey]: operatorDb },
        });
        assert.equal(result.status, 0, result.stderr);
        const { home, profile } = childHomes(result.stdout);
        assert.ok(home, `run ${run} did not say which home it used: ${result.stdout}`);
        assert.equal(profile, home, "USERPROFILE and HOME must point at the same throwaway dir");
        assert.notEqual(home, operatorHome, "the gate handed the child the operator's own home");
        if (existsSync(home)) {
          // A locked file is allowed to keep the dir, but the gate must say so.
          assert.match(result.stderr, /could not delete the test home/, `run ${run} left ${home} behind without saying so`);
          rmSync(home, { recursive: true, force: true });
        }
      }
      assert.equal(existsSync(join(operatorHome, ".ans")), false, "the operator's own home was written to");
      assert.equal(existsSync(operatorDb), false, "the operator's ANS_DB_PATH was written to");
    });
  } finally {
    rmSync(operatorHome, { recursive: true, force: true });
  }
});

test("a red run keeps the test home and prints where it is", () => {
  withWorkspace({ pnpm: (bin) => writeLeakyPnpm(bin, 1) }, ({ root, bin }) => {
    const result = runCliIn(root, bin, ["--full"]);
    assert.equal(result.status, 1);
    const home = keptHome(result.stderr);
    assert.ok(home, `no kept test home in: ${result.stderr}`);
    assert.equal(existsSync(home), true, "the kept home is gone");
    assert.equal(existsSync(join(home, ".ans", "leak")), true, "the test's write did not land in the kept home");
    rmSync(home, { recursive: true, force: true });
  });
});

test("an interrupted run keeps the test home and stops pnpm", { skip: process.platform === "win32" }, async () => {
  const workspace = makeWorkspace({ pnpm: writeSleepingPnpm });
  try {
    const env = { ...process.env };
    env.PATH = `${workspace.bin}${delimiter}${process.env.PATH ?? ""}`;
    delete env.PREFLIGHT_GATE_TESTS;
    env.PREFLIGHT_SELF_TEST = "0";
    const gate = spawn(process.execPath, [join(workspace.root, "scripts", "preflight-test.mjs"), "--full"], {
      cwd: workspace.root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    gate.stderr.on("data", (chunk) => {
      err += chunk;
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`pnpm never started: ${err}`)), 10000);
      gate.stdout.on("data", (chunk) => {
        out += chunk;
        if (!out.includes("PNPM=")) return;
        clearTimeout(timer);
        resolve();
      });
    });
    gate.kill("SIGTERM");
    const code = await new Promise((resolve) => gate.on("close", resolve));
    assert.equal(code, 143, err);
    const home = keptHome(err);
    assert.ok(home, `no kept test home in: ${err}`);
    assert.equal(existsSync(join(home, ".ans", "leak")), true, "the leak is not in the kept home");
    await waitGone(Number(/^PNPM=(\d+)$/m.exec(out)[1]));
    rmSync(home, { recursive: true, force: true });
  } finally {
    dropWorkspace(workspace);
  }
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

test("the gate's own tests also run under the throwaway home", () => {
  const probeDir = mkdtempSync(join(tmpdir(), "ans-preflight-probe-"));
  const probe = join(probeDir, "home-probe.test.mjs");
  writeFileSync(
    probe,
    [
      'import assert from "node:assert/strict";',
      'import test from "node:test";',
      "",
      'test("the gate sees the throwaway home", () => {',
      '  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";',
      "  assert.match(home, /ans-preflight-home-/);",
      "});",
    ].join("\n"),
  );
  try {
    withFakePnpm({ code: 0, lines: [" Tasks:    1 successful, 1 total"] }, (bin) => {
      const result = runCliIn(repoRoot, bin, ["--full"], { gateTests: probe });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /the gate sees the throwaway home/);
    });
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
});

test("a red self-test blocks the run", () => {
  withFakePnpm({ code: 0, lines: [] }, (bin) => {
    const result = runCliIn(repoRoot, bin, ["--full"], { gateTests: "scripts/test/preflight-missing.test.mjs" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /the gate's own tests/);
    clearKeptHome(result);
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
    clearKeptHome(result);
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

function runCliIn(root, bin, args, { gateTests, selfTest = false, input, overrides } = {}) {
  const env = { ...process.env };
  // Read PATH through process.env, which is case-insensitive on Windows: the
  // spread above keeps the original key's casing, so env.PATH can be undefined
  // and the real PATH would be dropped, hiding git from the child.
  env.PATH = `${bin}${delimiter}${process.env.PATH ?? ""}`;
  if (process.platform === "win32") env.Path = env.PATH;
  if (overrides) Object.assign(env, overrides);
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

function withWorkspace(options = {}, run) {
  let workspace;
  try {
    workspace = makeWorkspace(options);
    run(workspace);
  } finally {
    if (workspace) dropWorkspace(workspace);
  }
}

// A stand-in workspace with one app and its scripts copied in. `staged` leaves
// the named file in the index; `pushed` commits it and returns the ref line a
// pre-push hook would send. `pnpm` writes a different fake pnpm when a test
// needs one; the default echoes its argv when echoArgs is set and fails
// otherwise.
function makeWorkspace({ staged, pushed, echoArgs = false, pnpm } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ans-preflight-ws-"));
  const bin = mkdtempSync(join(tmpdir(), "ans-preflight-bin-"));
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
  if (pnpm) pnpm(bin);
  else writeFakePnpm(bin, echoArgs ? { echoArgs: true } : { code: 1, lines: ["pnpm ran"] });
  return { root, bin, refs };
}

function dropWorkspace({ root, bin }) {
  rmSync(root, { recursive: true, force: true });
  rmSync(bin, { recursive: true, force: true });
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
  writePnpmShim(bin, { sh, cmd });
}

// A stand-in pnpm that writes where a sloppy test would: the home it was given,
// and the database path if the gate let that override through. It prints both
// home names so the test can see each one was redirected.
function writeLeakyPnpm(bin, code) {
  const sh = [
    "#!/bin/sh",
    'echo "HOME=$HOME"',
    'echo "PROFILE=$USERPROFILE"',
    'mkdir -p "$USERPROFILE/.ans"',
    'echo leak > "$USERPROFILE/.ans/leak"',
    'if [ -n "$ANS_DB_PATH" ]; then echo leak > "$ANS_DB_PATH"; fi',
    `exit ${code}`,
  ].join("\n");
  const cmd = [
    "@echo off",
    "echo HOME=%HOME%",
    "echo PROFILE=%USERPROFILE%",
    'mkdir "%USERPROFILE%\\.ans" 2>nul',
    'echo leak > "%USERPROFILE%\\.ans\\leak"',
    "if defined ANS_DB_PATH echo leak > \"%ANS_DB_PATH%\"",
    `exit /b ${code}`,
  ].join("\r\n");
  writePnpmShim(bin, { sh, cmd });
}

function writePnpmShim(bin, { sh, cmd }) {
  write(join(bin, "pnpm"), `${sh}\n`);
  write(join(bin, "pnpm.cmd"), `${cmd}\r\n`);
  chmodSync(join(bin, "pnpm"), 0o755);
}

// A stand-in pnpm that stays alive until the gate forwards the signal, and
// prints its pid so the test can prove it is gone afterwards. The pid line is
// last: the test signals as soon as it sees it, so everything before must be
// on disk by then.
function writeSleepingPnpm(bin) {
  const sh = [
    "#!/bin/sh",
    'echo "HOME=$HOME"',
    'echo "PROFILE=$USERPROFILE"',
    'mkdir -p "$USERPROFILE/.ans"',
    'echo leak > "$USERPROFILE/.ans/leak"',
    'echo "PNPM=$$"',
    "exec sleep 30",
  ].join("\n");
  write(join(bin, "pnpm"), `${sh}\n`);
  chmodSync(join(bin, "pnpm"), 0o755);
}

async function waitGone(pid) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`pnpm (${pid}) is still running after the gate exited`);
}

function childHomes(output) {
  const read = (name) => {
    const match = new RegExp(`^${name}=(.*)$`, "m").exec(output);
    return match ? match[1].trim() : null;
  };
  return { home: read("HOME"), profile: read("PROFILE") };
}

function keptHome(output) {
  const match = /\[preflight\] test home kept for inspection: (.+)$/m.exec(output);
  return match ? match[1].trim() : null;
}

// A red run keeps its test home on purpose; a fixture is not an operator's
// failed run, so the test deletes what the gate printed.
function clearKeptHome(result) {
  const home = keptHome(result.stderr);
  assert.ok(home, `no kept test home in: ${result.stderr}`);
  rmSync(home, { recursive: true, force: true });
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
}

function write(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}
