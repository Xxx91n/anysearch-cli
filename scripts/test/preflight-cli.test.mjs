import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { flushStreams } from "../preflight-flush.mjs";
import { gitIn } from "../preflight-git.mjs";
import { RETRY_LIMIT, writeStderr } from "../preflight-stderr.mjs";
import { assertOwnRepo } from "./preflight-git-fixture.mjs";

const scripts = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(scripts, "..");

// A stand-in for the files the gate's groups look for: one trivial test each,
// except the first, which holds two — so "N tests in M groups" cannot pass when
// the gate prints the group count in both slots. The failing one differs by that
// one assertion only, which is the point: one broken judgment, one red.
const PASSING_GATE_TEST = [
  'import assert from "node:assert/strict";',
  'import test from "node:test";',
  "",
  'test("a stand-in judgment", () => {',
  "  assert.equal(1, 1);",
  "});",
  "",
].join("\n");

const TWO_TEST_GATE_TEST = [
  PASSING_GATE_TEST,
  'test("a second stand-in judgment", () => {',
  "  assert.equal(2, 2);",
  "});",
  "",
].join("\n");

const FAILING_GATE_TEST = PASSING_GATE_TEST.replace("assert.equal(1, 1);", "assert.equal(1, 2);");

// The group names the gate must print. One copy, so a wording change lands in
// one place instead of leaving two assertions to drift apart.
const GATE_GROUP_NAMES = "push gate, plus the shared judgments (CI change policy, workflow checks)";

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

// The pointers a hook can hand the gate, with the values it would hand them.
const REPOSITORY_POINTERS = {
  GIT_DIR: "/elsewhere",
  GIT_WORK_TREE: "/elsewhere",
  GIT_INDEX_FILE: "/elsewhere",
  GIT_CONFIG_COUNT: "1",
};

test("a run does not hand the suite the caller's repository pointers", async () => {
  const names = Object.keys(REPOSITORY_POINTERS);
  await withWorkspace({ changed: "apps/dsh-plugin/src/index.ts", pnpm: (bin) => writeRepoProbePnpm(bin, names) }, ({ root, bin }) => {
    const result = runCliIn(root, bin, [], { overrides: REPOSITORY_POINTERS });
    assert.equal(result.status, 0, result.stderr);
    for (const name of names) {
      assert.match(result.stdout, new RegExp(`^${name}=\\[\\]$`, "m"), `${name} reached the suite`);
    }
  });
});
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
    // The override replaces the group list, and the files line says which files
    // it actually runs.
    assert.ok(result.stdout.includes("running the gate's own tests: PREFLIGHT_GATE_TESTS override"), result.stdout);
    assert.match(result.stdout, /\[preflight\] gate self-test files: scripts\/test\/preflight-plan\.test\.mjs/);
    // The child's reporter output must reach this pipe, not vanish.
    assert.match(result.stdout, /# pass \d+|✔/);
  });
});

// The two shared judgments are the ones the gate and CI both read: a broken
// change policy or workflow checker used to pass every local push and show up
// only in the CI run the gate exists to spare.
test("a full run also runs the shared judgments and reports how many tests ran", async () => {
  const files = gateTestFiles();
  await withWorkspace({ pnpm: passingPnpm, files }, ({ root, bin }) => {
    const result = runCliIn(root, bin, ["--full"], { selfTest: true });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(`running the gate's own tests: ${GATE_GROUP_NAMES}`), result.stdout);
    // The files line names the shared judgment, whatever else it lists.
    assert.match(result.stdout, /\[preflight\] gate self-test files: .*scripts\/test\/ci-changes\.test\.mjs/);
    // Four stand-in tests across three groups, so the group count cannot stand
    // in for the total and still pass.
    assert.ok(result.stdout.includes("gate self-test green: 4 tests in 3 groups"), result.stdout);
    // The suite still runs after the self-test.
    assert.match(result.stdout, /pnpm ran/);
  });
});

// One shared group goes red: the gate names that group, and only that one. The
// stand-in has to sit at the real `check-workflows` path for it to be seen at
// all, so this also pins the path.
test("a red shared judgment names only the group it belongs to", async () => {
  const files = gateTestFiles({ "scripts/test/check-workflows.test.mjs": FAILING_GATE_TEST });
  await withWorkspace({ pnpm: passingPnpm, files }, ({ root, bin }) => {
    const result = runCliIn(root, bin, ["--full"], { selfTest: true });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[preflight\] gate self-test failed: workflow checks$/m);
    // The other shared group passed, so naming it would be a lie.
    assert.equal(result.stderr.includes("CI change policy"), false, result.stderr);
    assert.match(result.stderr, /blocked: the gate's own tests failed/);
    // A red self-test blocks before the suite: the fake pnpm never got a word.
    assert.equal(result.stdout.includes("pnpm ran"), false);
    clearKeptHome(result);
  });
});

// The gate's own group can go red too, and it must not borrow the shared
// judgments' names.
test("a red push gate names its own group", async () => {
  const files = gateTestFiles({ "scripts/test/preflight-plan.test.mjs": FAILING_GATE_TEST });
  await withWorkspace({ pnpm: passingPnpm, files }, ({ root, bin }) => {
    const result = runCliIn(root, bin, ["--full"], { selfTest: true });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[preflight\] gate self-test failed: push gate$/m);
    assert.equal(result.stderr.includes("CI change policy"), false, result.stderr);
    // The suite never starts: the self-test stopped the run.
    assert.equal(result.stdout.includes("pnpm ran"), false);
    clearKeptHome(result);
  });
});

// Design: the guard asks for a parser, not for a node_modules directory — a tree
// with the directory but no parser cannot answer either, and calling that a
// broken judgment sends the operator to the wrong place.
test("a full run without a resolvable parser says which command to run", async () => {
  await withWorkspace({ pnpm: passingPnpm }, ({ root, bin }) => {
    rmSync(join(root, "node_modules", ".pnpm"), { recursive: true, force: true });
    const result = runCliIn(root, bin, ["--full"], { selfTest: true });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no YAML parser under node_modules — run `pnpm install --ignore-scripts` first/);
    assert.equal(result.stderr.includes("gate self-test failed"), false, result.stderr);
    assert.equal(result.stdout.includes("pnpm ran"), false);
  });
});

test("an incremental push does not pay for the gate's own tests", async () => {
  await withWorkspace({ changed: "apps/dsh-plugin/src/index.ts", pnpm: passingPnpm }, ({ root, bin }) => {
    const result = runCliIn(root, bin, [], { selfTest: true });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /green in \d+\.\ds \(incremental\)/);
    assert.equal(result.stdout.includes("running the gate's own tests"), false);
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
    assert.ok(result.stdout.includes(`would also run the gate's own tests: ${GATE_GROUP_NAMES}`), result.stdout);
    assert.match(result.stdout, /\[preflight\] dry run, gate self-test files: .*scripts\/test\/check-workflows\.test\.mjs/);
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

test("a clean tree reports nothing to run and runs no self-test", async () => {
  await withWorkspace({}, ({ root, bin }) => {
    const result = runCliIn(root, bin, [], { selfTest: true });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /nothing to run/);
    assert.equal(result.stdout.includes("pnpm ran"), false);
    assert.equal(result.stdout.includes("gate self-test"), false);
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
function makeWorkspace({ changed, pushed, echoArgs = false, pnpm, files } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ans-preflight-ws-"));
  const bin = mkdtempSync(join(tmpdir(), "ans-preflight-bin-"));
  mkdirSync(join(root, "scripts"));
  for (const name of [
    "preflight-test.mjs",
    "check-workflows.mjs",
    "preflight-flush.mjs",
    "preflight-change.mjs",
    "preflight-git.mjs",
    "preflight-plan.mjs",
    "preflight-command.mjs",
    "preflight-stderr.mjs",
  ]) {
    copyFileSync(join(scripts, name), join(root, "scripts", name));
  }
  for (const [name, content] of Object.entries(files ?? {})) write(join(root, name), content);
  // The gate refuses a full run without the YAML parser a shared judgment
  // resolves, so the fixture ships one in the layout pnpm uses.
  const yaml = join(root, "node_modules", ".pnpm", "yaml@0.0.0", "node_modules", "yaml");
  write(join(yaml, "package.json"), JSON.stringify({ name: "yaml", version: "0.0.0", main: "index.js" }));
  write(join(yaml, "index.js"), "module.exports = {};\n");
  write(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n');
  write(join(root, "apps", "dsh-plugin", "package.json"), JSON.stringify({ name: "@anysearch-cli/dsh-plugin" }));
  git(root, ["init", "-q"]);
  assertOwnRepo(root, rev(root, "--absolute-git-dir"));
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
  const result = gitIn(root, ["rev-parse", ref]);
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

// A stand-in pnpm that passes and says it ran, so a test can tell whether the
// suite started at all.
function passingPnpm(bin) {
  writeFakePnpm(bin, { code: 0, lines: ["pnpm ran"] });
}

// The gate's group files, one passing stand-in each; an override swaps in a
// failing body for the group under test. The first holds two tests, so a test
// can tell the test total apart from the group count.
function gateTestFiles(overrides = {}) {
  return {
    "scripts/test/preflight-plan.test.mjs": TWO_TEST_GATE_TEST,
    "scripts/test/ci-changes.test.mjs": PASSING_GATE_TEST,
    "scripts/test/check-workflows.test.mjs": PASSING_GATE_TEST,
    ...overrides,
  };
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

// A stand-in pnpm that reports which repository pointers it inherited, so the
// test can prove the gate dropped them.
function writeRepoProbePnpm(bin, names) {
  const sh = [
    "#!/bin/sh",
    ...names.map((name) => `echo "${name}=[\${${name}:-}]"`),
    "exit 0",
  ].join("\n");
  const cmd = ["@echo off", ...names.map((name) => `echo ${name}=[%${name}%]`), "exit /b 0"].join("\r\n");
  writePnpmShim(bin, { sh, cmd });
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
  const result = gitIn(root, args);
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
}

function write(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

// The flush before a red exit: a stream whose reader went away must not turn the
// exit into a throw, and a stream that never answers must not hang the gate.
test("a stream that throws on the flush counts as flushed", async () => {
  await flushStreams([
    {
      write() {
        throw Object.assign(new Error("gone"), { code: "EPIPE" });
      },
    },
  ]);
});

test("a stream that never answers gives up at the cap", async () => {
  const started = Date.now();
  await flushStreams([{ write() {} }], 20);
  // The cap is the thing under test: ignoring the argument and waiting the
  // default second instead would land far above this bound. 700ms leaves room
  // for a loaded CI box without letting a hardcoded 1000 through.
  const waited = Date.now() - started;
  assert.ok(waited >= 10 && waited < 700, `waited ${waited}ms`);
});

// A flush that finished must not leave the cap pending: deleting the clearTimeout
// keeps the in-process cases green, so this measures the thing the fix buys — a
// process that did its flush exits instead of sitting out the cap.
test("a finished flush does not keep the process alive", () => {
  const module = pathToFileURL(join(scripts, "preflight-flush.mjs")).href;
  const script = `import { flushStreams } from ${JSON.stringify(module)}; await flushStreams([{ write: (_chunk, done) => done() }], 1000);`;
  const started = Date.now();
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  const waited = Date.now() - started;
  assert.equal(result.status, 0, result.stderr);
  assert.ok(waited < 800, `the pending cap held the process for ${waited}ms`);
});

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
