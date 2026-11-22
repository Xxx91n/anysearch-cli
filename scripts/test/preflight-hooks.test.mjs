import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scripts = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(scripts, "..");
const cli = join(scripts, "preflight-hooks.mjs");
const source = readFileSync(join(repoRoot, "scripts", "hooks", "pre-push-user"), "utf8");

function withTemp(fn) {
  const base = mkdtempSync(join(tmpdir(), "ans-hooks-"));
  try {
    return fn(base);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** A repo nobody has installed a hook into yet, plus its clone. */
function freshClone(base) {
  const origin = join(base, "origin");
  mkdirSync(origin);
  git(origin, ["init", "-q", "--initial-branch=main"]);
  const clone = join(base, "clone");
  const result = spawnSync("git", ["clone", "-q", origin, clone], { encoding: "utf8" });
  assert.equal(result.status, 0, `git clone failed: ${result.stderr}`);
  return clone;
}

function run(cwd, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}

test("a fresh clone says the hook is missing until one command installs it", () => {
  withTemp((base) => {
    const clone = freshClone(base);
    const before = run(clone, ["status"]);
    assert.equal(before.status, 1, before.stderr);
    assert.match(before.stderr, /pre-push is missing/);

    const install = run(clone, ["install"]);
    assert.equal(install.status, 0, install.stderr);
    assert.match(install.stdout, /pre-push installed/);

    const hook = join(clone, ".git", "hooks", "pre-push");
    assert.equal(readFileSync(hook, "utf8"), source);

    const after = run(clone, ["status"]);
    assert.equal(after.status, 0, after.stderr);
    assert.match(after.stdout, /scripts\/preflight-test\.mjs --pushed/);
  });
});

test("the commands find the repo from a subdirectory, not only the root", () => {
  withTemp((base) => {
    const clone = freshClone(base);
    const nested = join(clone, "apps", "cli");
    mkdirSync(nested, { recursive: true });
    assert.equal(run(nested, ["install"]).status, 0);
    assert.equal(run(nested, ["status"]).status, 0);
  });
});

test("installing twice is not an error and does not rewrite the file", () => {
  withTemp((base) => {
    const clone = freshClone(base);
    assert.equal(run(clone, ["install"]).status, 0);

    const hook = join(clone, ".git", "hooks", "pre-push");
    const stamp = statSync(hook).mtimeMs;
    const again = run(clone, ["install"]);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /already installed and current/);
    assert.equal(statSync(hook).mtimeMs, stamp, "a second install rewrote the hook");
  });
});

test("install never touches GitButler's pre-commit and clears our old commit hook", () => {
  withTemp((base) => {
    const clone = freshClone(base);
    const hooks = join(clone, ".git", "hooks");
    const preCommit = join(hooks, "pre-commit");
    const gbutler = "#!/bin/sh\n# GitButler owns this file\nexit 0\n";
    writeFileSync(preCommit, gbutler);
    const oldCommitHook = join(hooks, "pre-commit-user");
    writeFileSync(oldCommitHook, "#!/bin/sh\nexit 0\n");

    const install = run(clone, ["install"]);
    assert.equal(install.status, 0, install.stderr);
    assert.equal(readFileSync(preCommit, "utf8"), gbutler, "pre-commit was written to");
    assert.equal(existsSync(oldCommitHook), false, "the old commit hook is still there");
    assert.match(install.stdout, /left alone/);
  });
});

test("a hook left behind by an older script is reported, and install refreshes it", () => {
  withTemp((base) => {
    const clone = freshClone(base);
    assert.equal(run(clone, ["install"]).status, 0);
    const hook = join(clone, ".git", "hooks", "pre-push");
    writeFileSync(hook, readFileSync(hook, "utf8").replace(/^exec .*$/m, (line) => `${line} --old`));

    const stale = run(clone, ["status"]);
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /older script line/);

    assert.equal(run(clone, ["install"]).status, 0);
    assert.equal(readFileSync(hook, "utf8"), source);
    assert.equal(run(clone, ["status"]).status, 0);
  });
});

test("a hook whose comments moved on is still current, and install leaves the bytes alone", () => {
  withTemp((base) => {
    const clone = freshClone(base);
    assert.equal(run(clone, ["install"]).status, 0);
    const hook = join(clone, ".git", "hooks", "pre-push");
    // A sibling worktree installed from a different commit: same exec line,
    // different comments. That cannot change what the hook runs.
    const edited = `${readFileSync(hook, "utf8")}
# installed by another checkout
`;
    writeFileSync(hook, edited);
    const stamp = statSync(hook).mtimeMs;

    const status = run(clone, ["status"]);
    assert.equal(status.status, 0, status.stderr);

    const install = run(clone, ["install"]);
    assert.equal(install.status, 0, install.stderr);
    assert.match(install.stdout, /already installed and current/);
    assert.equal(readFileSync(hook, "utf8"), edited, "install rewrote a hook that already runs the right script");
    assert.equal(statSync(hook).mtimeMs, stamp);
  });
});

test("someone else's pre-push is reported, and install refuses to overwrite it without --force", () => {
  withTemp((base) => {
    const clone = freshClone(base);
    const hook = join(clone, ".git", "hooks", "pre-push");
    const theirs = "#!/bin/sh\necho mine\n";
    writeFileSync(hook, theirs);

    const status = run(clone, ["status"]);
    assert.equal(status.status, 1);
    assert.match(status.stderr, /another script, not ours/);

    const refused = run(clone, ["install"]);
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /--force/);
    assert.equal(readFileSync(hook, "utf8"), theirs, "a hook we do not own was overwritten");

    const forced = run(clone, ["install", "--force"]);
    assert.equal(forced.status, 0, forced.stderr);
    assert.equal(readFileSync(hook, "utf8"), source);
  });
});

test("a hand-written hook that only mentions the gate is still someone else's", () => {
  withTemp((base) => {
    const clone = freshClone(base);
    const hook = join(clone, ".git", "hooks", "pre-push");
    const theirs = [
      "#!/bin/sh",
      "# wrapper, see scripts/preflight-test.mjs",
      "echo theirs",
      'exec node "$(git rev-parse --show-toplevel)/scripts/preflight-test.mjs" --pushed',
      "",
    ].join("\n");
    writeFileSync(hook, theirs);

    const status = run(clone, ["status"]);
    assert.equal(status.status, 1, status.stdout + status.stderr);
    assert.match(status.stderr, /another script, not ours/);

    assert.equal(run(clone, ["install"]).status, 2);
    assert.equal(readFileSync(hook, "utf8"), theirs, "a hand-written hook was overwritten");
  });
});

test("install goes where git reads hooks, including a core.hooksPath directory", () => {
  withTemp((base) => {
    const clone = freshClone(base);
    mkdirSync(join(clone, ".githooks"));
    git(clone, ["config", "core.hooksPath", ".githooks"]);

    const install = run(clone, ["install"]);
    assert.equal(install.status, 0, install.stderr);
    assert.equal(readFileSync(join(clone, ".githooks", "pre-push"), "utf8"), source);
    assert.equal(existsSync(join(clone, ".git", "hooks", "pre-push")), false, "the hook landed where git does not read it");
    assert.equal(run(clone, ["status"]).status, 0);
  });
});

test("outside a git repo it says it cannot tell instead of guessing", () => {
  withTemp((base) => {
    const status = run(base, ["status"]);
    assert.equal(status.status, 2);
    assert.match(status.stderr, /cannot tell/);
    assert.equal(run(base, ["install"]).status, 2);
  });
});

test("a hook without the execute bit is reported, and install fixes it", { skip: process.platform === "win32" }, () => {
  withTemp((base) => {
    const clone = freshClone(base);
    assert.equal(run(clone, ["install"]).status, 0);
    const hook = join(clone, ".git", "hooks", "pre-push");
    chmodSync(hook, 0o644);

    const status = run(clone, ["status"]);
    assert.equal(status.status, 1);
    assert.match(status.stderr, /not executable/);

    assert.equal(run(clone, ["install"]).status, 0);
    assert.notEqual(statSync(hook).mode & 0o111, 0, "install left the hook unexecutable");
    assert.equal(run(clone, ["status"]).status, 0);
  });
});
