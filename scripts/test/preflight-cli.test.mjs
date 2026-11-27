import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { flushStreams } from "../preflight-flush.mjs";
import { gitIn } from "../preflight-git.mjs";
import { outputLabel, reportRunOutput } from "../preflight-output.mjs";
import { RETRY_LIMIT, writeStderr } from "../preflight-stderr.mjs";
import { assertOwnRepo } from "./preflight-git-fixture.mjs";
import { EXPECTED_ROOT_READERS } from "./preflight-root-readers.mjs";

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

// Design: 2 means the gate itself could not do its job, so a child that
// exits 2 is still a red run — forwarding it would turn "the tests failed" into
// "the gate is broken".
test("a red run reports 1 even when the child exited 2", () => {
  withFakePnpm({ code: 2, lines: [" Tasks:    1 failed"] }, (bin) => {
    const result = runCliIn(repoRoot, bin, ["--full"]);
    assert.equal(result.status, 1);
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

// The budget's three promises at once: the run stops, the tree goes with it, and
// the output stays on disk for the operator to read. The fake pnpm starts a child
// of its own, so "the whole tree" means more than the first process.
test("a suite that runs past its budget stops the tree and keeps the output", async () => {
  await withTempDir(async ({ dir, overrides }) => {
    await withPnpmShim(writeStallingPnpm, async (bin) => {
      const result = runCliIn(repoRoot, bin, ["--full"], {
        overrides: { ...overrides, ANS_PUSH_GATE_TIMEOUT: "4" },
      });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stdout, /suite budget: 4s, heartbeat every 1s/);
      // It says the run did not finish, and never calls it a failure.
      assert.match(result.stderr, /timed out after 4s: the suite did not finish/);
      assert.doesNotMatch(result.stderr, /blocked after/);
      // The file holds a prefix of a cut run, and its label says so: calling it
      // full output here would pass a partial record off as the whole run.
      assert.match(result.stderr, /partial output \(the run did not finish\): /);
      // The run is told how to finish the job, and the heartbeat proves it was
      // alive: one line is a coincidence, two are a sign of life.
      assert.match(result.stderr, /run the rest yourself: pnpm test/);
      const beats = result.stdout.match(/still running: \d+s elapsed/g) ?? [];
      assert.ok(beats.length >= 2, `one heartbeat is not a sign of life: ${result.stdout}`);
      const file = runOutputFile(result.stderr);
      assert.ok(file, `no output file named in: ${result.stderr}`);
      assert.ok(file.startsWith(dir), `the output file is not in the temp dir: ${file}`);
      assert.match(readFileSync(file, "utf8"), /suite started/);
      // The child the fake pnpm started went with the rest of the tree.
      const grandchild = Number(/GRANDCHILD=(\d+)/.exec(result.stdout)?.[1]);
      assert.ok(grandchild, `the fake pnpm never named its child: ${result.stdout}`);
      await waitGone(grandchild);
    });
  });
});

// A suite killed by something other than its budget — OOM, an operator's SIGTERM —
// leaves a prefix too. The gate sees no exit code, so the red branch is where the
// label can lie.
test(
  "a suite killed by a signal is not named as a full run",
  { skip: process.platform === "win32" ? "Windows has no signals to die from" : false },
  async () => {
    await withTempDir(async ({ overrides }) => {
      await withPnpmShim(writeSignalPnpm, async (bin) => {
        const result = runCliIn(repoRoot, bin, ["--full"], { overrides });
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /partial output \(the run did not finish\): /);
        assert.doesNotMatch(result.stderr, /full output: /);
        // The reason line must name the signal, not a task failure: nothing
        // failed, the process was killed from outside.
        assert.match(result.stderr, /blocked after \d+\.\ds: killed by SIGTERM, see the output file/);
      });
    });
  },
);

// A bounded wait for text a child writes after it exits: the exit event and the
// pipe's last bytes are separate events. The cap keeps a broken pipe from hanging
// the test.
async function waitForText(seen, limit) {
  const until = Date.now() + limit;
  while (Date.now() < until) {
    if (seen()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// The cap's reason for existing: a process outside the killed group keeps the
// pipe open, so the close event never fires. The gate must still answer — the
// wait is capped, and the answer must leave the process. POSIX only: `detached`
// gives the holder its own process group there; on Windows taskkill /t walks the
// parent tree and takes the holder with it, so this shape cannot be built.
test(
  "a budget answers even when a process outside the tree holds the pipe",
  { skip: process.platform === "win32" ? "Windows taskkill /t takes the holder too" : false },
  async () => {
    await withTempDir(async ({ overrides }) => {
      await withPnpmShim(writePipeHoldingPnpm, async (bin) => {
        // spawnSync would block until the holder closes the pipe, so this test
        // measures the gate's own exit instead of waiting for the streams.
        const env = gateEnv(bin, { ...overrides, ANS_PUSH_GATE_TIMEOUT: "2" });
        env.PREFLIGHT_SELF_TEST = "0";
        const gate = spawn(process.execPath, [join(repoRoot, "scripts", "preflight-test.mjs"), "--full"], {
          cwd: repoRoot,
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "";
        let err = "";
        gate.stdout.on("data", (chunk) => {
          out += chunk;
        });
        gate.stderr.on("data", (chunk) => {
          err += chunk;
        });
        const started = Date.now();
        // The cap is the test's own: without it a gate that never answers hangs
        // the run until CI's timeout instead of failing here.
        const code = await new Promise((resolve, reject) => {
          const cap = setTimeout(() => reject(new Error("the gate never exited")), 20000);
          gate.on("exit", (exitCode) => {
            clearTimeout(cap);
            resolve(exitCode);
          });
        });
        // Measure the gate's own exit first: the wait below adds up to five
        // seconds of polling that are not the gate's time.
        const waited = Date.now() - started;
        // The exit and the pipe's last bytes are separate events: wait for the
        // line the assertions read, bounded, before judging the answer.
        await waitForText(() => /timed out after 2s/.test(err), 5000);
        const holder = Number(/HOLDER=(\d+)/.exec(out)?.[1]);
        try {
          // 2s budget + 10s cap + flush; the holder's own minute is not the gate's.
          assert.ok(waited < 25000, `the gate waited ${waited}ms on a pipe holder`);
          assert.equal(code, 1, err);
          assert.match(err, /timed out after 2s/);
        } finally {
          if (holder) {
            try {
              process.kill(holder);
            } catch {}
          }
          gate.kill("SIGKILL");
        }
      });
    });
  },
);

// Design: the fixture prints more than the 64 KiB tail holds, so only the file can
// supply the count. The banner also pins the default budget and heartbeat.
test("a green run counts the tests from the file and deletes it", async () => {
  await withTempDir(async ({ dir, overrides }) => {
    await withPnpmShim(writeCountingPnpm, async (bin) => {
      const result = runCliIn(repoRoot, bin, ["--full"], { overrides });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /suite budget: 600s, heartbeat every 15s/);
      assert.match(result.stdout, /green in \d+\.\ds \(full\), 7 test\(s\)/);
      const leftovers = readdirSync(dir).filter((name) => name.endsWith(".log"));
      assert.deepEqual(leftovers, [], `the run left its output file behind: ${leftovers.join(", ")}`);
    });
  });
});

test("a red run shows the last 100 lines and names the output file", async () => {
  await withTempDir(async ({ overrides }) => {
    await withPnpmShim(writeNoisyFailingPnpm, async (bin) => {
      const result = runCliIn(repoRoot, bin, ["--full"], { overrides });
      assert.equal(result.status, 1, result.stderr);
      // The tail is a slice, not the whole run: the first line stays in the file.
      assert.match(result.stderr, /line 150/);
      assert.doesNotMatch(result.stderr, /line 001/);
      assert.match(result.stderr, /blocked after \d+\.\ds: @anysearch-cli\/kernel#test/);
      // The run ended and its file is whole, so the label promises the whole run.
      assert.match(result.stderr, /full output: /);
      const file = runOutputFile(result.stderr);
      assert.ok(file, `no output file named in: ${result.stderr}`);
      const whole = readFileSync(file, "utf8");
      assert.match(whole, /line 001/);
      assert.match(whole, /Failed: @anysearch-cli\/kernel#test/);
    });
  });
});

// A write that fails mid-run leaves a truncated file: that is not the run, and the
// label has to say so. The three labels are asked for directly because a real
// failed write is a disk-full event, not something a test can stage.
test("the output file's label names which of the three states it is in", () => {
  assert.equal(outputLabel({ failed: false, finished: true }), "full output");
  assert.equal(outputLabel({ failed: false, finished: false }), "partial output (the run did not finish)");
  assert.equal(outputLabel({ failed: true, finished: true }), "incomplete output file");
  assert.equal(outputLabel({ failed: true, finished: false }), "incomplete output file");
  // A caller that forgets to say the run finished must not be handed the label of
  // a whole run — and forgetting the whole argument is that mistake, not a crash.
  assert.equal(outputLabel({ failed: false }), "partial output (the run did not finish)");
  assert.equal(outputLabel(), "partial output (the run did not finish)");
  // A run that never opened a file gets no line at all, and the line carries the
  // label the state asked for.
  const lines = [];
  reportRunOutput(null, { write: (line) => lines.push(line) });
  reportRunOutput({ file: "/tmp/run.log", failed: true }, { write: (line) => lines.push(line), finished: true });
  assert.deepEqual(lines, ["[preflight] incomplete output file: /tmp/run.log"]);
});

// A run that printed nothing and left nothing in the file has neither a file's
// content nor a tail: the reason must say so instead of pointing at either.
test("a red run with no output at all points nowhere", () => {
  withFakePnpm({ code: 1, lines: [] }, (bin) => {
    const result = runCliIn(repoRoot, bin, ["--full"]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /blocked after \d+\.\ds: a task failed, no output to show/);
    assert.doesNotMatch(result.stderr, /see the output/);
    // A red run keeps its home and its file on purpose: a fixture is not an
    // operator's failed run, so the test takes them back.
    dropLeftoverHome(result);
  });
});

// Two packages failing at once is the common shape of a red full run: naming one
// of them would hide the other.
test("a red run with two failed tasks names both", () => {
  const lines = ["Failed: @anysearch-cli/kernel#test", "Failed: @anysearch-cli/cli#test"];
  withFakePnpm({ code: 1, lines }, (bin) => {
    const result = runCliIn(repoRoot, bin, ["--full"]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /blocked after \d+\.\ds: @anysearch-cli\/kernel#test, @anysearch-cli\/cli#test/,
    );
    dropLeftoverHome(result);
  });
});

test("a budget the gate cannot read stops the push", () => {
  withFakePnpm({ code: 0, lines: [] }, (bin) => {
    const result = runCliIn(repoRoot, bin, ["--full"], { overrides: { ANS_PUSH_GATE_TIMEOUT: "soon" } });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /blocked: ANS_PUSH_GATE_TIMEOUT is not a positive number of seconds: "soon"/);
  });
});

// setTimeout clamps past its ceiling to a millisecond, so a huge budget would
// stop the suite at once and call it a timeout. The gate refuses it instead.
test("a budget past the timer's ceiling stops the push", () => {
  withFakePnpm({ code: 0, lines: [] }, (bin) => {
    const result = runCliIn(repoRoot, bin, ["--full"], { overrides: { ANS_PUSH_GATE_TIMEOUT: "9999999999" } });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /blocked: ANS_PUSH_GATE_TIMEOUT is larger than the timer can take/);
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
    // The output file is kept too; the fixture takes both back.
    const file = runOutputFile(result.stderr);
    assert.ok(file, `no kept output file in: ${result.stderr}`);
    assert.equal(existsSync(file), true, "the kept output file is gone");
    dropLeftoverHome(result);
  });
});

test("an interrupted run keeps the test home and stops the whole tree", { skip: process.platform === "win32" }, async () => {
  await withWorkspace({ pnpm: writeSleepingPnpm }, async ({ root, bin }) => {
    const env = gateEnv(bin);
    // The workspace's own copy of the gate would otherwise run its self-test,
    // which needs the three group files it does not carry.
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
      // Ctrl-C cut the run, so the file is a prefix and named as one.
      assert.match(err, /partial output \(the run did not finish\): /);
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
      dropLeftoverHome({ stdout: out, stderr: err });
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
    assert.equal(result.status, 2);
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

// A root file with known readers is its own mode: the banner has to say why
// these packages and no others, and it must not claim a dependency closure that
// did not happen.
test("a root file with readers runs those packages, says why, and runs no self-test", async () => {
  await withWorkspace(
    {
      changed: "domains/docs.toml",
      echoArgs: true,
      extraPackages: {
        "apps/cli": { name: "@anysearch-cli/cli" },
        "apps/kernel": { name: "@anysearch-cli/kernel" },
        "apps/mcp": { name: "@anysearch-cli/mcp" },
        "apps/store": { name: "@anysearch-cli/store" },
      },
    },
    ({ root, bin }) => {
      const result = runCliIn(root, bin, [], { selfTest: true });
      assert.equal(result.status, 0, result.stderr);
      const readers = EXPECTED_ROOT_READERS.domains.join(", ");
      assert.ok(
        result.stdout.includes(`run: ${readers} (the packages whose tests read these root files)`),
        result.stdout,
      );
      for (const pkg of EXPECTED_ROOT_READERS.domains) {
        assert.ok(result.stdout.includes(`--filter=${pkg}`), pkg);
      }
      assert.match(result.stdout, /green in \d+\.\ds \(readers\)/);
      // The package the workspace also has does not join in: it does not read
      // the file, and no closure is applied here.
      assert.equal(result.stdout.includes("dsh-plugin"), false, result.stdout);
      // Neither does mcp, which the fixture also has: tests that declare a
      // domain set ANS_DOMAINS_DIR to their own temp dir, and clean tests
      // declare none, so its tests cannot see the repo-root TOMLs. (The no-arg
      // boots would follow a developer shell's ANS_DOMAIN; the gate clears
      // ans_* env before tests, and CI sets none.)
      assert.equal(result.stdout.includes("--filter=@anysearch-cli/mcp"), false, result.stdout);
      assert.equal(result.stdout.includes("running the gate's own tests"), false, result.stdout);
    },
  );
});

// The mixed case is the one with two reasons in the same banner: the changed
// package plus its dependents, and the readers of a root file. It is also where
// a reader could be wrongly amplified into its own dependents.
test("a root file plus a package file runs both, and the readers do not bring theirs", async () => {
  await withWorkspace(
    {
      changed: ["domains/docs.toml", "apps/dsh-plugin/src/index.ts"],
      echoArgs: true,
      extraPackages: {
        "apps/cli": { name: "@anysearch-cli/cli" },
        "apps/kernel": { name: "@anysearch-cli/kernel" },
        "apps/mcp": { name: "@anysearch-cli/mcp" },
        "apps/store": { name: "@anysearch-cli/store" },
        "apps/consumer": {
          name: "@anysearch-cli/consumer",
          dependencies: { "@anysearch-cli/kernel": "workspace:*" },
        },
      },
    },
    ({ root, bin }) => {
      const result = runCliIn(root, bin, []);
      assert.equal(result.status, 0, result.stderr);
      const ran = [...EXPECTED_ROOT_READERS.domains, "@anysearch-cli/dsh-plugin"].sort();
      assert.ok(
        result.stdout.includes(
          `run: ${ran.join(", ")} (the change plus its dependents, plus the readers of root files)`,
        ),
        result.stdout,
      );
      for (const pkg of ran) {
        assert.ok(result.stdout.includes(`--filter=${pkg}`), pkg);
      }
      assert.match(result.stdout, /green in \d+\.\ds \(incremental\)/);
      // mcp is in the workspace and untouched. Its domain tests use their own
      // ANS_DOMAINS_DIR, clean tests declare none, and the gate clears ans_*
      // env before tests, so it only reads the root domains as build input.
      assert.equal(result.stdout.includes("--filter=@anysearch-cli/mcp"), false, result.stdout);
      // consumer depends on kernel, a reader; it still does not run, because a
      // reader's dependents cannot see the root file.
      assert.equal(result.stdout.includes("--filter=@anysearch-cli/consumer"), false, result.stdout);
    },
  );
});

test("a root file whose reader is missing stops the push and says which", async () => {
  await withWorkspace({ changed: "domains/docs.toml" }, ({ root, bin }) => {
    // The fixture workspace has only dsh-plugin, so every reader domains names
    // is missing: a renamed package would otherwise filter turbo down to no
    // task and still exit 0, which reads as green.
    const result = runCliIn(root, bin, []);
    assert.equal(result.status, 2, result.stderr);
    assert.match(
      result.stderr,
      new RegExp(`blocked: no workspace package named: ${EXPECTED_ROOT_READERS.domains.join(", ")}`),
    );
    assert.match(result.stderr, /fix: ROOT_READERS names a package/);
    assert.match(result.stderr, /to push anyway: git push --no-verify/);
    assert.equal(result.stdout.includes("pnpm ran"), false);
    assert.equal(result.stdout.includes("full suite"), false);
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

test("a docs-only change says skipped, runs nothing, and never claims green", async () => {
  await withWorkspace({ changed: "docs/limitations.md" }, ({ root, bin }) => {
    // The fake pnpm fails and prints "pnpm ran", so a suite that started would
    // show up twice: in the exit code and in the output.
    const result = runCliIn(root, bin, [], { selfTest: true });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /skipped: all 1 changed file\(s\) are documentation — no test ran/);
    assert.match(result.stdout, /not a pass/);
    assert.equal(result.stdout.includes("pnpm ran"), false);
    assert.equal(result.stdout.includes("green"), false);
    assert.equal(result.stdout.includes("gate self-test"), false);
  });
});

// A change a package cannot own is skipped instead of spending the suite, and
// it never reads as green. The file is the gate's own test, so this also pins
// that the self-test no longer runs for scripts/.
test("a change no package owns is skipped, runs nothing, and never claims green", async () => {
  await withWorkspace({ changed: "scripts/test/preflight-plan.test.mjs" }, ({ root, bin }) => {
    const result = runCliIn(root, bin, [], { selfTest: true });
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /skipped: 1 changed file\(s\) belong to no workspace package — no test ran for the whole change/,
    );
    assert.match(result.stdout, /skipped files: scripts\/test\/preflight-plan\.test\.mjs/);
    assert.match(result.stdout, /not a pass/);
    assert.match(
      result.stdout,
      /this coverage is CI's: check-build runs the full suite when no package owns a file/,
    );
    assert.equal(result.stdout.includes("pnpm ran"), false);
    assert.equal(result.stdout.includes("running the gate's own tests"), false);
    assert.equal(result.stdout.includes("green"), false);
    assert.equal(result.stdout.includes("full suite:"), false);
  });
});

test("--full still runs the whole suite for a change no package owns", async () => {
  await withWorkspace({ changed: "scripts/release.mjs", pnpm: passingPnpm }, ({ root, bin }) => {
    const result = runCliIn(root, bin, ["--full"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /full suite: forced/);
    assert.match(result.stdout, /pnpm ran/);
    assert.match(result.stdout, /green in \d+\.\ds \(full\)/);
  });
});

// Design: ANS_PUSH_GATE=strict is the session-wide form of --full, and the mode
// hooks:status prints says so — one switch, one meaning.
test("ANS_PUSH_GATE=strict runs the whole suite without --full", async () => {
  await withWorkspace({ changed: "scripts/release.mjs", pnpm: passingPnpm }, ({ root, bin }) => {
    const result = runCliIn(root, bin, [], { overrides: { ANS_PUSH_GATE: "strict" } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /full suite: forced/);
    assert.match(result.stdout, /pnpm ran/);
    assert.match(result.stdout, /green in \d+\.\ds \(full\)/);
  });
});

// A package file next to an unowned one loses its run too: the whole change is
// skipped, and the line has to say so — otherwise the package half looks covered.
test("a package file next to an unowned one skips the whole change", async () => {
  await withWorkspace(
    { changed: ["apps/dsh-plugin/src/index.ts", "scripts/release.mjs"] },
    ({ root, bin }) => {
      const result = runCliIn(root, bin, []);
      assert.equal(result.status, 0, result.stderr);
      assert.match(
        result.stdout,
        /skipped: 1 changed file\(s\) belong to no workspace package — no test ran for the whole change/,
      );
      assert.match(result.stdout, /skipped files: scripts\/release\.mjs/);
      assert.equal(result.stdout.includes("pnpm ran"), false);
      assert.equal(result.stdout.includes("green"), false);
    },
  );
});

// A gate that cannot start pnpm is the gate failing: exit 2, not a red run.
// POSIX only — on Windows the gate spawns through a shell, so a missing pnpm is
// a child that exits non-zero instead of a spawn error, and this path cannot be
// reached there.
test(
  "a gate that cannot start pnpm exits 2",
  { skip: process.platform === "win32" ? "Windows runs pnpm through a shell" : false },
  async () => {
    // No pnpm anywhere on PATH: the fake bin dir is empty and PATH points at it.
    // --full needs no change set, so git being absent from PATH is fine too.
    await withWorkspace({ pnpm: () => {} }, ({ root, bin }) => {
      const result = runCliIn(root, bin, ["--full"], { overrides: { PATH: bin } });
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /could not start pnpm/);
      // This path keeps the throwaway home as well; clearKeptHome pins that and
      // takes it back.
      clearKeptHome(result);
    });
  },
);

// A damaged manifest is a fault, not a skip: it stops the push and names the
// file, because a green or skipped line here would hide a broken tree.
test("a broken manifest stops the push, names the file, and starts nothing", async () => {
  const files = { "apps/broken/package.json": "{ not json" };
  await withWorkspace({ files, changed: "apps/dsh-plugin/src/index.ts" }, ({ root, bin }) => {
    const result = runCliIn(root, bin, []);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /blocked: cannot read apps\/broken\/package\.json/);
    assert.match(result.stderr, /fix: repair it, then push again/);
    assert.match(result.stderr, /to push anyway: git push --no-verify/);
    assert.equal(result.stdout.includes("pnpm ran"), false);
    assert.equal(result.stdout.includes("full suite"), false);
  });
});

// Without the workspace declaration nothing can be attributed: same answer as
// a damaged manifest, and the fix names the file to repair.
test("a workspace with no declaration stops the push", async () => {
  await withWorkspace({ workspace: false, changed: "apps/dsh-plugin/src/index.ts" }, ({ root, bin }) => {
    const result = runCliIn(root, bin, []);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /blocked: no workspace packages found/);
    assert.match(result.stderr, /pnpm-workspace\.yaml names the workspace packages/);
    assert.equal(result.stdout.includes("pnpm ran"), false);
  });
});

test("a docs-only dry run also says skipped, not would run", async () => {
  await withWorkspace({ changed: "docs/limitations.md" }, ({ root, bin }) => {
    const result = runCliIn(root, bin, ["--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /skipped: all 1 changed file\(s\) are documentation/);
    assert.equal(result.stdout.includes("would run"), false);
  });
});

test("a pushed docs-only ref says skipped and runs nothing", async () => {
  await withWorkspace({ pushed: "docs/limitations.md" }, ({ root, bin, refs }) => {
    const result = runCliIn(root, bin, ["--pushed"], { input: refs, selfTest: true });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /skipped: all 1 changed file\(s\) are documentation — no test ran/);
    assert.equal(result.stdout.includes("pnpm ran"), false);
    assert.equal(result.stdout.includes("green"), false);
  });
});

test("docs next to a package file still run that package, not the suite", async () => {
  // Two changed files, one of them documentation: only the package lane runs,
  // and the banner must not claim the docs live inside that package.
  await withWorkspace(
    { changed: ["apps/dsh-plugin/src/index.ts", "docs/limitations.md"], echoArgs: true },
    ({ root, bin }) => {
      const result = runCliIn(root, bin, []);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /changed 2 file\(s\), running 1 package\(s\)/);
      assert.match(result.stdout, /run: @anysearch-cli\/dsh-plugin \(the change plus everything that depends on it\)/);
      assert.match(result.stdout, /green in \d+\.\ds \(incremental\)/);
    },
  );
});

test("the banner counts the packages that run, not just the changed one", async () => {
  // A downstream app makes touched and packages differ: a banner that counts
  // touched would say 1 here while the next line lists 2.
  const extraPackages = {
    "apps/consumer": {
      name: "@anysearch-cli/consumer",
      devDependencies: { "@anysearch-cli/dsh-plugin": "workspace:*" },
    },
  };
  await withWorkspace({ changed: "apps/dsh-plugin/src/index.ts", extraPackages, echoArgs: true }, ({ root, bin }) => {
    const result = runCliIn(root, bin, []);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /changed 1 file\(s\), running 2 package\(s\)/);
    assert.match(result.stdout, /run: @anysearch-cli\/consumer, @anysearch-cli\/dsh-plugin/);
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

test("--full still runs the suite when the change set cannot be read", async () => {
  // --full never consults the change set, so an unreadable one does not stop
  // it: that is what "run everything anyway" means.
  await withWorkspace({ pnpm: passingPnpm }, ({ root, bin }) => {
    const result = runCliIn(root, bin, ["--pushed", "--full"], { input: "not a ref line" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /full suite: could not read the pushed commits; the whole suite runs anyway/,
    );
    assert.match(result.stdout, /pnpm ran/);
  });
});

test("an unreadable push ref stops the push and names both ways out", async () => {
  await withWorkspace({}, ({ root, bin }) => {
    const result = runCliIn(root, bin, ["--pushed"], { input: "not a ref line" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /blocked: could not read the pushed commits/);
    assert.match(result.stderr, /fix: run `git fetch origin`, then `git remote set-head origin -a`/);
    assert.match(result.stderr, /to push anyway: git push --no-verify/);
    assert.equal(result.stdout.includes("pnpm ran"), false);
    assert.equal(result.stdout.includes("full suite"), false);
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

// The environment a gate run gets: the fixture's bin first on PATH and the
// operator's own gate settings removed, so a shell variable cannot change what a
// fixture asserts. One copy, so the two callers cannot drift apart.
function gateEnv(bin, overrides) {
  const env = { ...process.env };
  delete env.ANS_PUSH_GATE_TIMEOUT;
  delete env.PREFLIGHT_GATE_TESTS;
  delete env.PREFLIGHT_SELF_TEST;
  // Read PATH through process.env, which is case-insensitive on Windows: the
  // spread above keeps the original key's casing, so env.PATH can be undefined
  // and the real PATH would be dropped, hiding git from the child.
  env.PATH = `${bin}${delimiter}${process.env.PATH ?? ""}`;
  if (process.platform === "win32") env.Path = env.PATH;
  // A developer who exported the strict switch for their own pushes would turn
  // every incremental case here into a full run; the case that wants it passes
  // it through overrides.
  delete env.ANS_PUSH_GATE;
  if (overrides) Object.assign(env, overrides);
  return env;
}

function runCliIn(root, bin, args, { gateTests, selfTest = false, input, overrides } = {}) {
  const env = gateEnv(bin, overrides);
  if (gateTests || selfTest) {
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
function makeWorkspace({ changed, pushed, echoArgs = false, pnpm, files, extraPackages, workspace = true } = {}) {
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
    "preflight-output.mjs",
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
  if (workspace) write(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n');
  write(join(root, "apps", "dsh-plugin", "package.json"), JSON.stringify({ name: "@anysearch-cli/dsh-plugin" }));
  for (const [dir, manifest] of Object.entries(extraPackages ?? {})) {
    write(join(root, dir, "package.json"), JSON.stringify(manifest));
  }
  git(root, ["init", "-q"]);
  assertOwnRepo(root, rev(root, "--absolute-git-dir"));
  git(root, ["config", "user.email", "preflight@example.test"]);
  git(root, ["config", "user.name", "preflight"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "base"]);
  const base = rev(root, "HEAD");
  git(root, ["update-ref", "refs/remotes/origin/HEAD", base]);
  const changedFiles = [changed ?? pushed].flat().filter(Boolean);
  for (const file of changedFiles) write(join(root, file), file.endsWith(".md") ? "# limits\n" : "export const two = 2;\n");
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

function withFakePnpm(options, run) {
  return withPnpmShim((bin) => writeFakePnpm(bin, options), run);
}

function writeFakePnpm(bin, { code = 0, lines = [], echoArgs = false }) {
  const sh = ["#!/bin/sh", ...(echoArgs ? ['echo "$@"'] : lines.map((line) => `echo "${line}"`)), `exit ${code}`].join("\n");
  const cmd = ["@echo off", ...(echoArgs ? ["echo %*"] : lines.map((line) => `echo ${line}`)), `exit /b ${code}`].join("\r\n");
  writePnpmShim(bin, { sh, cmd });
}

// A stand-in pnpm written as a Node script, so a fixture can print text a .cmd
// cannot carry safely (the ℹ in a test summary) or keep a child of its own alive.
function writeNodePnpm(bin, name, body) {
  const script = join(bin, name);
  writeFileSync(script, body.join("\n"));
  writePnpmShim(bin, {
    sh: `#!/bin/sh\nexec "${process.execPath}" "${script}"\n`,
    cmd: `@echo off\r\n"${process.execPath}" "${script}"\r\n`,
  });
}

// A pnpm that never finishes and starts a child of its own, so the test can prove
// the budget killed the whole tree rather than the first process.
function writeStallingPnpm(bin) {
  writeNodePnpm(bin, "stall.mjs", [
    'import { spawn } from "node:child_process";',
    'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
    'console.log("suite started");',
    'console.log(`GRANDCHILD=${child.pid}`);',
    "setInterval(() => {}, 1000);",
    "",
  ]);
}

// A pnpm whose child escapes the killed process group and keeps the pipe open.
// The gate's close event can never fire on its own, so only the post-deadline cap
// can end the wait — and the answer must still leave the process.
function writePipeHoldingPnpm(bin) {
  writeNodePnpm(bin, "hold.mjs", [
    'import { spawn } from "node:child_process";',
    'const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "inherit", detached: true });',
    "child.unref();",
    'console.log(`HOLDER=${child.pid}`);',
    "setInterval(() => {}, 1000);",
    "",
  ]);
}

// A pnpm that prints two test summaries and passes: the green line's count is the
// sum of both, read from the file rather than from a tail in memory.
function writeCountingPnpm(bin) {
  // The summaries come first and more than the 64 KiB tail follows them, so only
  // the file on disk can supply the count.
  const lines = ['console.log("pnpm ran");', 'console.log("ℹ tests 3");', 'console.log("ℹ tests 4");'];
  for (let i = 0; i < 2000; i += 1) lines.push(`console.log("padding ${"x".repeat(60)} ${i}");`);
  lines.push("");
  writeNodePnpm(bin, "count.mjs", lines);
}

// A pnpm that dies of a signal instead of exiting: the gate gets no exit code, so
// the file it kept is a prefix of the run and has to be named as one.
function writeSignalPnpm(bin) {
  // The write has to land before the signal, or the gate reads an empty file and
  // the test fails for a reason the gate is right about.
  writeNodePnpm(bin, "signal.mjs", [
    'process.stdout.write("suite started" + "\\n", () => process.kill(process.pid, "SIGTERM"));',
    "",
  ]);
}

// A pnpm whose output is longer than the failure recap: 150 lines, then a failed
// task. The first lines prove the recap is a slice, not the whole run.
function writeNoisyFailingPnpm(bin) {
  const lines = [];
  for (let i = 1; i <= 150; i += 1) lines.push(`console.log("line ${String(i).padStart(3, "0")}");`);
  lines.push('console.log("Failed: @anysearch-cli/kernel#test");');
  lines.push("process.exitCode = 1;");
  writeNodePnpm(bin, "noisy.mjs", lines);
}

// Runs a fixture's shim against a throwaway bin dir. The caller's own assertions
// run inside, awaited, so the dir outlives them; it goes away afterwards either
// way.
function withPnpmShim(writeShim, run) {
  return withScratchDir("ans-preflight-bin-", (bin) => {
    writeShim(bin);
    return run(bin);
  });
}

// A throwaway directory removed when `run` returns or throws. A sync callback
// keeps its result and its throw; an async one is cleaned up when it settles.
function withScratchDir(prefix, run) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const drop = () => rmSync(dir, { recursive: true, force: true });
  let result;
  try {
    result = run(dir);
  } catch (error) {
    drop();
    throw error;
  }
  if (result && typeof result.then === "function") return result.finally(drop);
  drop();
  return result;
}

// A temp dir the gate's own temp files land in: the output file and the throwaway
// home both come from os.tmpdir(), so pointing TMPDIR/TEMP/TMP here keeps each
// test's evidence in one place the test deletes.
async function withTempDir(run) {
  await withScratchDir("ans-preflight-run-", (dir) =>
    run({ dir, overrides: { TMPDIR: dir, TEMP: dir, TMP: dir } }),
  );
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
// A red or timed-out run also keeps its output file. A fixture is not an
// operator's failed push, so the test takes back what the gate printed.
//
// Design: retry, then swallow a cleanup failure — a Windows file lock keeping the
// dir is not news this test reports, and throwing in the finally hides the
// assertion that ran before it.
function dropLeftoverHome(result) {
  const output = `${result.stdout}\n${result.stderr}`;
  const home =
    keptHome(output) ??
    /\[preflight\] could not delete the test home, left it at (.+?): /m.exec(output)?.[1];
  if (home) {
    try {
      rmSync(home.trim(), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {}
  }
  const file = runOutputFile(output);
  if (file) {
    try {
      rmSync(file, { force: true });
    } catch {}
  }
}

// The path the gate prints for a run's output file. A red or timed-out run keeps
// the file and names it; a green run deletes it and names nothing.
function runOutputFile(output) {
  const match = /\[preflight\] (?:full output|partial output[^:]*|incomplete output file): (.+)$/m.exec(output);
  return match ? match[1].trim() : null;
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

// Design: measure it by the child's own exit time — deleting the cap's
// clearTimeout leaves the in-process cases green, so only a process that had to
// sit out the cap shows the difference.
test("a finished flush does not keep the process alive", () => {
  const module = new URL("../preflight-flush.mjs", import.meta.url).href;
  const script = [
    `import { flushStreams } from ${JSON.stringify(module)};`,
    "await flushStreams([{ write: (_chunk, done) => done() }], 1000);",
  ].join("\n");
  const started = Date.now();
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.signal, null, "the child had to be killed");
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr);
  // Magnitude only: a fresh Node start stays well under this, a lingering cap
  // cannot.
  const waited = Date.now() - started;
  assert.ok(waited < 900, `the cap held the process for ${waited}ms`);
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
