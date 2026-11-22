import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gitEnv } from "../preflight-git.mjs";

const scripts = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(scripts, "..");
const cli = join(scripts, "preflight-hooks.mjs");
const source = readFileSync(join(repoRoot, "scripts", "hooks", "pre-push-user"), "utf8");
const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

const hookPath = (cwd) => join(cwd, ".git", "hooks", "pre-push");

/** A temp dir whose git sees no config of the operator's, plus a fresh clone in it. */
function withSandbox(fn) {
  const base = mkdtempSync(join(tmpdir(), "ans-hooks-"));
  const home = join(base, "home");
  const empty = join(base, "gitconfig-empty");
  mkdirSync(home, { recursive: true });
  writeFileSync(empty, "");
  // A global core.hooksPath, or a repository exported by the caller, would send
  // installs outside the sandbox — and --force could then overwrite a real hook
  // on the operator's machine.
  const env = gitEnv(process.env);
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    GIT_CONFIG_GLOBAL: empty,
    GIT_CONFIG_SYSTEM: empty,
    GIT_CONFIG_NOSYSTEM: "1",
  });
  const git = (cwd, args) => {
    const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
    assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
    return result.stdout.trim();
  };
  const run = (cwd, args, command = cli) => spawnSync(process.execPath, [command, ...args], { cwd, env, encoding: "utf8" });
  const clone = () => {
    const origin = join(base, "origin");
    mkdirSync(origin);
    git(origin, ["init", "-q", "--initial-branch=main"]);
    const dir = join(base, "clone");
    const result = spawnSync("git", ["clone", "-q", origin, dir], { cwd: base, env, encoding: "utf8" });
    assert.equal(result.status, 0, `git clone failed: ${result.stderr}`);
    return dir;
  };

  try {
    return fn({ base, env, git, run, clone });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function installOk(box, cwd, ...flags) {
  const result = box.run(cwd, ["install", ...flags]);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

/** A clone that holds the script itself, the way a real checkout does. */
function withScriptsIn(clone) {
  mkdirSync(join(clone, "scripts", "hooks"), { recursive: true });
  copyFileSync(join(repoRoot, "package.json"), join(clone, "package.json"));
  copyFileSync(cli, join(clone, "scripts", "preflight-hooks.mjs"));
  copyFileSync(join(repoRoot, "scripts", "hooks", "pre-push-user"), join(clone, "scripts", "hooks", "pre-push-user"));
  return join(clone, "scripts", "preflight-hooks.mjs");
}

test("package.json wires both commands to this script", () => {
  assert.equal(manifest.scripts["hooks:install"], "node scripts/preflight-hooks.mjs install");
  assert.equal(manifest.scripts["hooks:status"], "node scripts/preflight-hooks.mjs status");
});

test("a fresh clone says the hook is missing until one command installs it", () => {
  withSandbox((box) => {
    const clone = box.clone();
    const before = box.run(clone, ["status"]);
    assert.equal(before.status, 1, before.stderr);
    assert.match(before.stderr, /pre-push is missing/);
    assert.match(before.stderr, /pnpm -w hooks:install from a subdirectory/);

    installOk(box, clone);

    assert.equal(readFileSync(hookPath(clone), "utf8"), source);

    const after = box.run(clone, ["status"]);
    assert.equal(after.status, 0, after.stderr);
    assert.match(after.stdout, /runs: scripts\/preflight-test\.mjs --pushed/);
  });
});

test("the commands find the repo from a subdirectory, not only the root", () => {
  withSandbox((box) => {
    const clone = box.clone();
    const nested = join(clone, "apps", "cli");
    mkdirSync(nested, { recursive: true });
    installOk(box, nested);
    const status = box.run(nested, ["status"]);
    assert.equal(status.status, 0, status.stderr);
  });
});

test("installing twice is not an error and does not rewrite the file", () => {
  withSandbox((box) => {
    const clone = box.clone();
    installOk(box, clone);

    const stamp = statSync(hookPath(clone)).mtimeMs;
    const again = installOk(box, clone);
    assert.match(again.stdout, /already installed and current/);
    assert.equal(statSync(hookPath(clone)).mtimeMs, stamp, "a second install rewrote the hook");
  });
});

test("install never touches GitButler's pre-commit and clears our old commit hook", () => {
  withSandbox((box) => {
    const clone = box.clone();
    const hooks = join(clone, ".git", "hooks");
    const preCommit = join(hooks, "pre-commit");
    const gbutler = "#!/bin/sh\n# GitButler owns this file\nexit 0\n";
    writeFileSync(preCommit, gbutler);
    const oldCommitHook = join(hooks, "pre-commit-user");
    writeFileSync(oldCommitHook, "#!/bin/sh\nexit 0\n");

    const install = installOk(box, clone);
    assert.equal(readFileSync(preCommit, "utf8"), gbutler, "pre-commit was written to");
    assert.equal(existsSync(oldCommitHook), false, "the old commit hook is still there");
    assert.match(install.stdout, /left alone/);
  });
});

test("a hook left behind by an older script is reported, and install refreshes it", () => {
  withSandbox((box) => {
    const clone = box.clone();
    installOk(box, clone);
    writeFileSync(hookPath(clone), readFileSync(hookPath(clone), "utf8").replace(/^exec .*$/m, (line) => `${line} --old`));

    const stale = box.run(clone, ["status"]);
    assert.equal(stale.status, 1, stale.stderr);
    assert.match(stale.stderr, /out of date, its code differs/);

    const install = installOk(box, clone);
    assert.match(install.stdout, /replaced with the current script/);
    assert.equal(readFileSync(hookPath(clone), "utf8"), source);
    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 0, status.stderr);
  });
});

test("a hook whose comments moved on is still current, and install leaves the bytes alone", () => {
  withSandbox((box) => {
    const clone = box.clone();
    installOk(box, clone);
    // A sibling worktree installed from a different commit: same code, other
    // comments. That cannot change what the hook does.
    const edited = `${readFileSync(hookPath(clone), "utf8")}\n# installed by another checkout\n`;
    writeFileSync(hookPath(clone), edited);
    const stamp = statSync(hookPath(clone)).mtimeMs;

    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 0, status.stderr);

    const install = installOk(box, clone);
    assert.match(install.stdout, /already installed and current/);
    assert.equal(readFileSync(hookPath(clone), "utf8"), edited, "install rewrote a hook that already runs the right code");
    assert.equal(statSync(hookPath(clone)).mtimeMs, stamp);
  });
});

test("someone else's pre-push is reported, and install refuses to overwrite it without --force", () => {
  withSandbox((box) => {
    const clone = box.clone();
    const theirs = "#!/bin/sh\necho mine\n";
    writeFileSync(hookPath(clone), theirs);

    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 1);
    assert.match(status.stderr, /another script, not ours/);

    const refused = box.run(clone, ["install"]);
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /--force/);
    assert.equal(readFileSync(hookPath(clone), "utf8"), theirs, "a hook we do not own was overwritten");

    installOk(box, clone, "--force");
    assert.equal(readFileSync(hookPath(clone), "utf8"), source);
  });
});

test("a copy that gained a command is out of date, and install brings it back", () => {
  withSandbox((box) => {
    const clone = box.clone();
    installOk(box, clone);
    // Still our hook (banner and exec are ours), but it runs something the
    // source does not: comments may differ between checkouts, commands may not.
    writeFileSync(hookPath(clone), readFileSync(hookPath(clone), "utf8").replace(/^exec /m, "set -e\nexec "));

    const stale = box.run(clone, ["status"]);
    assert.equal(stale.status, 1, stale.stderr);
    assert.match(stale.stderr, /out of date/);
    assert.match(stale.stderr, /runs: scripts\/preflight-test\.mjs --pushed/);

    installOk(box, clone);
    assert.equal(readFileSync(hookPath(clone), "utf8"), source);
  });
});

test("a changed shebang counts as a different hook", () => {
  withSandbox((box) => {
    const clone = box.clone();
    installOk(box, clone);
    writeFileSync(hookPath(clone), readFileSync(hookPath(clone), "utf8").replace("#!/bin/sh", "#!/bin/bash"));

    const stale = box.run(clone, ["status"]);
    assert.equal(stale.status, 1, stale.stderr);
    assert.match(stale.stderr, /out of date, its code differs/);

    installOk(box, clone);
    assert.equal(readFileSync(hookPath(clone), "utf8"), source);
  });
});

test("status names what a hook runs even when it is not our command", () => {
  withSandbox((box) => {
    const clone = box.clone();
    writeFileSync(hookPath(clone), "#!/bin/sh\nexec ./scripts/gate.sh\n");

    const foreign = box.run(clone, ["status"]);
    assert.equal(foreign.status, 1);
    assert.match(foreign.stderr, /another script, not ours/);
    assert.match(foreign.stderr, /runs: exec \.\/scripts\/gate\.sh/);
  });
});

test("a banner outside the header is a note, not ownership", () => {
  withSandbox((box) => {
    const clone = box.clone();
    const theirs = ["#!/bin/sh", "# mine", "# notes: this used to be", "# anysearch push gate", "echo theirs", ""].join("\n");
    writeFileSync(hookPath(clone), theirs);

    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 1);
    assert.match(status.stderr, /another script, not ours/);
    const refused = box.run(clone, ["install"]);
    assert.equal(refused.status, 2, refused.stderr);
    assert.equal(readFileSync(hookPath(clone), "utf8"), theirs);
  });
});

test("a header banner that does not run the gate is still someone else's", () => {
  withSandbox((box) => {
    const clone = box.clone();
    const theirs = "#!/bin/sh\n# anysearch pre-push: disabled on this box\nexit 0\n";
    writeFileSync(hookPath(clone), theirs);

    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 1);
    assert.match(status.stderr, /another script, not ours/);
    const refused = box.run(clone, ["install"]);
    assert.equal(refused.status, 2, refused.stderr);
    assert.equal(readFileSync(hookPath(clone), "utf8"), theirs);
  });
});

test("a hand-written hook that only mentions the gate is still someone else's", () => {
  withSandbox((box) => {
    const clone = box.clone();
    const theirs = [
      "#!/bin/sh",
      "# wrapper, see scripts/preflight-test.mjs",
      "echo theirs",
      'exec node "$(git rev-parse --show-toplevel)/scripts/preflight-test.mjs" --pushed',
      "",
    ].join("\n");
    writeFileSync(hookPath(clone), theirs);

    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 1, status.stderr);
    const refused = box.run(clone, ["install"]);
    assert.equal(refused.status, 2, refused.stderr);
    assert.equal(readFileSync(hookPath(clone), "utf8"), theirs, "a hand-written hook was overwritten");
  });
});

test("an empty pre-push is nobody's hook: status says so and install replaces it", () => {
  withSandbox((box) => {
    const clone = box.clone();
    writeFileSync(hookPath(clone), "");

    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 1);
    assert.match(status.stderr, /pre-push is an empty file/);

    installOk(box, clone);
    assert.equal(readFileSync(hookPath(clone), "utf8"), source);
  });
});

test("a hook with no exec line still has its command named", () => {
  withSandbox((box) => {
    const clone = box.clone();
    writeFileSync(hookPath(clone), "#!/bin/sh\n. _/husky.sh\nnpm test\n");

    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 1);
    assert.match(status.stderr, /another script, not ours/);
    assert.match(status.stderr, /runs: \. _\/husky\.sh/);
  });
});

test("install goes where git reads hooks, including a core.hooksPath directory", () => {
  withSandbox((box) => {
    const clone = box.clone();
    mkdirSync(join(clone, ".githooks"));
    box.git(clone, ["config", "core.hooksPath", ".githooks"]);

    installOk(box, clone);
    assert.equal(readFileSync(join(clone, ".githooks", "pre-push"), "utf8"), source);
    assert.equal(existsSync(hookPath(clone)), false, "the hook landed where git does not read it");
    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 0, status.stderr);
  });
});

test("outside a git repo it says it cannot tell instead of guessing", () => {
  withSandbox((box) => {
    const empty = join(box.base, "not-a-repo");
    mkdirSync(empty);

    const status = box.run(empty, ["status"]);
    assert.equal(status.status, 2);
    assert.match(status.stderr, /cannot tell/);
    const refused = box.run(empty, ["install"]);
    assert.equal(refused.status, 2, refused.stderr);
  });
});

test("an unknown command is a usage error, not a silent success", () => {
  withSandbox((box) => {
    const clone = box.clone();
    for (const args of [[], ["instal"], ["status", "--wat"], ["constructor"], ["toString", "--force"]]) {
      const result = box.run(clone, args);
      assert.equal(result.status, 2, `${args.join(" ") || "(no args)"} exited ${result.status}`);
      assert.match(result.stderr, /usage:/);
    }
  });
});

test("a clone that holds the script runs both commands itself", () => {
  withSandbox((box) => {
    const clone = box.clone();
    const local = withScriptsIn(clone);

    const before = box.run(clone, ["status"], local);
    assert.equal(before.status, 1, before.stderr);

    const install = box.run(clone, ["install"], local);
    assert.equal(install.status, 0, install.stderr);

    const after = box.run(clone, ["status"], local);
    assert.equal(after.status, 0, after.stderr);
    assert.equal(readFileSync(hookPath(clone), "utf8"), source);
  });
});

test("the documented pnpm commands reach the script, --force included", (t) => {
  withSandbox((box) => {
    const clone = box.clone();
    withScriptsIn(clone);
    const pnpm = (args) =>
      spawnSync("pnpm", args, { cwd: clone, env: box.env, encoding: "utf8", shell: process.platform === "win32" });

    const probe = pnpm(["-v"]);
    if (probe.error || probe.status !== 0) {
      // The only check that the command AGENTS.md documents works must run in
      // CI, so a missing pnpm there is a failure, not a skip.
      if (process.env.CI) assert.fail(`pnpm is not on PATH in CI: ${probe.error?.message ?? probe.stderr}`);
      t.skip("pnpm is not on PATH here");
      return;
    }

    const before = pnpm(["hooks:status"]);
    assert.equal(before.status, 1, before.stderr);

    const install = pnpm(["hooks:install"]);
    assert.equal(install.status, 0, install.stderr);

    const after = pnpm(["hooks:status"]);
    assert.equal(after.status, 0, after.stderr);

    const theirs = "#!/bin/sh\necho mine\n";
    writeFileSync(hookPath(clone), theirs);
    const refused = pnpm(["hooks:install"]);
    assert.notEqual(refused.status, 0, `pnpm swallowed the refusal: ${refused.stderr}`);
    assert.equal(readFileSync(hookPath(clone), "utf8"), theirs, refused.stderr);

    const forced = pnpm(["hooks:install", "--force"]);
    assert.equal(forced.status, 0, `pnpm did not pass --force through: ${forced.stderr}`);
    assert.equal(readFileSync(hookPath(clone), "utf8"), source);
  });
});

test("a hook without the execute bit is reported, and install fixes it", { skip: process.platform === "win32" }, () => {
  withSandbox((box) => {
    const clone = box.clone();
    installOk(box, clone);
    chmodSync(hookPath(clone), 0o644);

    const status = box.run(clone, ["status"]);
    assert.equal(status.status, 1, status.stderr);
    assert.match(status.stderr, /not executable/);

    installOk(box, clone);
    assert.notEqual(statSync(hookPath(clone)).mode & 0o111, 0, "install left the hook unexecutable");
    const fixed = box.run(clone, ["status"]);
    assert.equal(fixed.status, 0, fixed.stderr);
  });
});
