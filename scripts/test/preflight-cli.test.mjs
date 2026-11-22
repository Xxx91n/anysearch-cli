import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { RETRY_LIMIT, writeStderr } from "../preflight-stderr.mjs";

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

test("a run gives the child a throwaway home and leaves the operator's home alone", async () => {
  const operatorHome = mkdtempSync(join(tmpdir(), "ans-preflight-operator-"));
  const operatorDb = join(operatorHome, "anysearch.db");
  try {
    await withWorkspace({ changed: "apps/dsh-plugin/src/index.ts", pnpm: (bin) => writeLeakyPnpm(bin, 0) }, ({ root, bin }) => {
      // Two runs in a row, like the ticket's acceptance: neither may write into
      // the home or the database path the operator actually uses. Windows env
      // names are case-insensitive, so the lowercase key is the harder case
      // there; POSIX only knows the exact name.
      const dbKey = process.platform === "win32" ? "ans_db_path" : "ANS_DB_PATH";
      for (let run = 1; run <= 2; run += 1) {
        const result = runCliIn(root, bin, [], {
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

test("the throwaway home gets turbo's config dir on Windows only", async () => {
  await withWorkspace({ changed: "apps/dsh-plugin/src/index.ts", pnpm: writeTurboConfigProbePnpm }, ({ root, bin }) => {
    const result = runCliIn(root, bin, []);
    try {
      assert.equal(result.status, 0, result.stderr);
      const reported = /^TURBO_CONFIG_DIR_PRESENT=(yes|no)\r?$/m.exec(result.stdout)?.[1];
      // Off Windows the home keeps exactly what it had.
      assert.equal(reported, process.platform === "win32" ? "yes" : "no", `in: ${result.stdout}`);
    } finally {
      dropLeftoverHome(result);
    }
  });
});

// The probe above pins the layer the fix adds; this one makes the repo's real
// turbo find it, so a turbo that looks somewhere else fails here instead of on
// an operator's push. Windows only: the failure cannot happen off Windows.
test(
  "the real turbo starts under the throwaway home",
  { skip: process.platform !== "win32" ? "Windows only" : turboEntry() === null && "turbo is not installed" },
  async () => {
    await withWorkspace({ changed: "apps/dsh-plugin/src/index.ts", pnpm: writeRealTurboPnpm }, ({ root, bin }) => {
      const result = runCliIn(root, bin, []);
      try {
        // Any turbo failure blocks the gate, the missing config dir included,
        // so exit 0 is the signal. Pinning turbo's banner wording would turn a
        // turbo upgrade into a red that looks like a home problem.
        assert.equal(result.status, 0, result.stderr);
      } finally {
        dropLeftoverHome(result);
      }
    });
  },
);

test("a red run keeps the test home and prints where it is", async () => {
  await withWorkspace({ pnpm: (bin) => writeLeakyPnpm(bin, 1) }, ({ root, bin }) => {
    const result = runCliIn(root, bin, ["--full"]);
    assert.equal(result.status, 1);
    const home = keptHome(result.stderr);
    assert.ok(home, `no kept test home in: ${result.stderr}`);
    assert.equal(existsSync(home), true, "the kept home is gone");
    assert.equal(existsSync(join(home, ".ans", "leak")), true, "the test's write did not land in the kept home");
    rmSync(home, { recursive: true, force: true });
  });
});

test("an interrupted run keeps the test home and stops the whole tree", { skip: process.platform === "win32" }, async () => {
  await withWorkspace({ pnpm: writeSleepingPnpm }, async ({ root, bin }) => {
    const env = { ...process.env };
    env.PATH = `${bin}${delimiter}${process.env.PATH ?? ""}`;
    delete env.PREFLIGHT_GATE_TESTS;
    env.PREFLIGHT_SELF_TEST = "0";
    const gate = spawn(process.execPath, [join(root, "scripts", "preflight-test.mjs"), "--full"], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    gate.stderr.on("data", (chunk) => {
      err += chunk;
    });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`pnpm never started: ${err}`)), 10000);
        gate.stdout.on("data", (chunk) => {
          out += chunk;
          if (!/^GRANDCHILD=\d+$/m.test(out)) return;
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
      await waitGone(Number(/^GRANDCHILD=(\d+)$/m.exec(out)[1]));
    } finally {
      gate.kill("SIGKILL");
      // pnpm is the group leader (the gate spawns it detached), so one group
      // kill takes the grandchild with it; killing the grandchild's own pid as
      // a group would target an unrelated group number on a busy machine.
      const pnpm = /^PNPM=(\d+)$/m.exec(out);
      if (pnpm) {
        try {
          process.kill(-Number(pnpm[1]), "SIGKILL");
        } catch {}
      }
      const home = keptHome(err);
      if (home) rmSync(home, { recursive: true, force: true });
    }
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

test("an incremental dry run prints the selected packages and the turbo command", async () => {
  await withWorkspace({ changed: "apps/dsh-plugin/src/index.ts" }, ({ root, bin }) => {
    const result = runCliIn(root, bin, ["--dry-run"]);
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

test("an incremental run hands pnpm one filter per selected package", async () => {
  await withWorkspace({ changed: "apps/dsh-plugin/src/index.ts", echoArgs: true }, ({ root, bin }) => {
    const result = runCliIn(root, bin, []);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /--filter=@anysearch-cli\/dsh-plugin/);
    assert.match(result.stdout, /green in \d+\.\ds \(incremental\)/);
  });
});

test("a clean tree reports nothing to run", async () => {
  await withWorkspace({}, ({ root, bin }) => {
    const result = runCliIn(root, bin, []);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /nothing to run/);
    assert.equal(result.stdout.includes("pnpm ran"), false);
  });
});

test("the old --staged flag names the hook to delete and runs nothing", async () => {
  await withWorkspace({ changed: "apps/dsh-plugin/src/index.ts" }, ({ root, bin }) => {
    const result = runCliIn(root, bin, ["--staged"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /delete the old pre-commit-user hook/);
    assert.equal(result.stdout.includes("pnpm ran"), false);
  });
});

test("--staged next to another mode flag runs that mode, not the notice", async () => {
  await withWorkspace({ changed: "apps/dsh-plugin/src/index.ts", echoArgs: true }, ({ root, bin }) => {
    const result = runCliIn(root, bin, ["--staged", "--full"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /\[preflight\] full suite: /);
    assert.equal(result.stdout.includes("no commit gate"), false);
  });
});

test("a pushed ref runs the gate on the files it carries", async () => {
  await withWorkspace({ pushed: "apps/dsh-plugin/src/index.ts", echoArgs: true }, ({ root, bin, refs }) => {
    const result = runCliIn(root, bin, ["--pushed"], { input: refs });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /run: @anysearch-cli\/dsh-plugin/);
    assert.match(result.stdout, /--filter=@anysearch-cli\/dsh-plugin/);
  });
});

test("an unreadable push ref runs the full suite", async () => {
  await withWorkspace({}, ({ root, bin }) => {
    const result = runCliIn(root, bin, ["--pushed"], { input: "not a ref line" });
    assert.equal(result.status, 1); // the fixture's fake pnpm exits 1
    assert.match(result.stdout, /full suite: could not read the pushed commits/);
    assert.match(result.stdout, /pnpm ran/);
    clearKeptHome(result);
  });
});

test("no refs on stdin falls back to the working tree and says so", async () => {
  await withWorkspace({ pushed: "apps/dsh-plugin/src/index.ts", echoArgs: true }, ({ root, bin }) => {
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

async function withWorkspace(options = {}, run) {
  let workspace;
  try {
    workspace = makeWorkspace(options);
    await run(workspace);
  } finally {
    if (workspace) dropWorkspace(workspace);
  }
}

// A stand-in workspace with one app and its scripts copied in, on an initial
// commit that origin/HEAD also points at. `changed` leaves the named file
// uncommitted in the working tree; `pushed` commits it and returns the ref line
// a pre-push hook would send. `pnpm` writes a different fake pnpm when a test
// needs one; the default echoes its argv when echoArgs is set and fails
// otherwise.
function makeWorkspace({ changed, pushed, echoArgs = false, pnpm } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ans-preflight-ws-"));
  const bin = mkdtempSync(join(tmpdir(), "ans-preflight-bin-"));
  mkdirSync(join(root, "scripts"));
  for (const name of [
    "preflight-test.mjs",
    "preflight-change.mjs",
    "preflight-plan.mjs",
    "preflight-command.mjs",
    "preflight-stderr.mjs",
  ]) {
    copyFileSync(join(scripts, name), join(root, "scripts", name));
  }
  write(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n');
  write(join(root, "apps", "dsh-plugin", "package.json"), JSON.stringify({ name: "@anysearch-cli/dsh-plugin" }));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "preflight@example.test"]);
  git(root, ["config", "user.name", "preflight"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "base"]);
  const base = rev(root, "HEAD");
  git(root, ["update-ref", "refs/remotes/origin/HEAD", base]);
  const changedFile = changed ?? pushed;
  if (changedFile) write(join(root, changedFile), "export const two = 2;\n");
  let refs;
  if (pushed) {
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

// A stand-in pnpm that reports whether the home it was handed carries the
// config dir turbo resolves from the user profile. turbo exits 1 with "Global
// config path not found." before running any task when that dir is missing, so
// a gated run is only green if it is there.
function writeTurboConfigProbePnpm(bin) {
  const sh = [
    "#!/bin/sh",
    'if [ -d "$USERPROFILE/AppData/Roaming" ]; then echo TURBO_CONFIG_DIR_PRESENT=yes; else echo TURBO_CONFIG_DIR_PRESENT=no; fi',
    "exit 0",
  ].join("\n");
  const cmd = [
    "@echo off",
    'if exist "%USERPROFILE%\\AppData\\Roaming\\" (echo TURBO_CONFIG_DIR_PRESENT=yes) else (echo TURBO_CONFIG_DIR_PRESENT=no)',
    "exit /b 0",
  ].join("\r\n");
  writePnpmShim(bin, { sh, cmd });
}

// A stand-in pnpm that runs the repo's own turbo instead: `test --dry` resolves
// every package and prints the plan without running a task, so the gate stays
// fast while turbo still has to locate its global config dir in the home the
// gate handed it.
function writeRealTurboPnpm(bin) {
  const entry = turboEntry();
  const sh = ["#!/bin/sh", `cd "${repoRoot}"`, `exec "${process.execPath}" "${entry}" run test --dry`].join("\n");
  const cmd = [
    "@echo off",
    `cd /d "${repoRoot}"`,
    `"${process.execPath}" "${entry}" run test --dry`,
    "exit /b %ERRORLEVEL%",
  ].join("\r\n");
  writePnpmShim(bin, { sh, cmd });
}

// A gate run can leave its home behind two ways: a red run says it kept it for
// inspection, and a green run that could not delete it says where it left it.
//
// Design: retry, then swallow a cleanup failure — a Windows file lock keeping the
// dir is not news this test reports, and throwing in the finally hides the
// assertion that ran before it.
function dropLeftoverHome(result) {
  const output = `${result.stdout}\n${result.stderr}`;
  const home =
    keptHome(output) ??
    /\[preflight\] could not delete the test home, left it at (.+?): /m.exec(output)?.[1];
  if (!home) return;
  try {
    rmSync(home.trim(), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {}
}

function turboEntry() {
  const entry = join(repoRoot, "node_modules", "turbo", "bin", "turbo");
  return existsSync(entry) ? entry : null;
}

function writePnpmShim(bin, { sh, cmd }) {
  write(join(bin, "pnpm"), `${sh}\n`);
  write(join(bin, "pnpm.cmd"), `${cmd}\r\n`);
  chmodSync(join(bin, "pnpm"), 0o755);
}

// A stand-in pnpm that starts a grandchild, stays alive until the gate
// forwards the signal, and prints both pids so the test can prove the whole
// group is gone. The pid lines are last: the test signals as soon as it sees
// the grandchild, so everything before must be on disk by then.
function writeSleepingPnpm(bin) {
  const sh = [
    "#!/bin/sh",
    'echo "HOME=$HOME"',
    'echo "PROFILE=$USERPROFILE"',
    'mkdir -p "$USERPROFILE/.ans"',
    'echo leak > "$USERPROFILE/.ans/leak"',
    "sleep 30 &",
    'echo "PNPM=$$"',
    'echo "GRANDCHILD=$!"',
    "wait",
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
// failed run, so the test deletes what the gate printed. The home is dropped
// before the assertion, so a failing assertion does not leave the dir behind.
function clearKeptHome(result) {
  const home = keptHome(result.stderr);
  dropLeftoverHome(result);
  assert.ok(home, `no kept test home in: ${result.stderr}`);
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
}

function write(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

// These cases pin the retry loop without a real stalled pipe.
test("a full stderr pipe is retried until the whole line is written", () => {
  const chunks = [];
  let refusals = 0;
  writeStderr("kept at /tmp/ans-home", {
    write(fd, bytes, offset) {
      if (refusals < 2) {
        refusals += 1;
        throw Object.assign(new Error("full"), { code: "EAGAIN" });
      }
      const slice = bytes.subarray(offset);
      chunks.push(slice);
      return slice.length;
    },
    pause() {},
  });
  assert.equal(Buffer.concat(chunks).toString(), "kept at /tmp/ans-home\n");
  assert.equal(refusals, 2);
});

test("a pipe that never drains gives up at the cap, then ends the line", { timeout: 5000 }, () => {
  const attempts = [];
  writeStderr("kept at /tmp/ans-home", {
    write(fd, bytes, offset) {
      attempts.push(bytes.subarray(offset).toString());
      if (attempts.length === 1) return 4;
      throw Object.assign(new Error("full"), { code: "EAGAIN" });
    },
    pause() {},
  });
  assert.equal(attempts.at(-1), "\n");
  // One partial write, then a full retry budget for the rest of the line and
  // another for the newline. A changed cap or a dropped counter lands here.
  assert.equal(attempts.length, 1 + (RETRY_LIMIT + 1) * 2);
});

test("an error other than EAGAIN is not retried", () => {
  let calls = 0;
  writeStderr("kept at /tmp/ans-home", {
    write() {
      calls += 1;
      throw Object.assign(new Error("bad fd"), { code: "EBADF" });
    },
    pause() {},
  });
  assert.equal(calls, 1);
});
