import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { localFiles, pushedFiles, PUSH_UNKNOWN } from "../preflight-change.mjs";
import { gitIn } from "../preflight-git.mjs";
import { assertOwnRepo } from "./preflight-git-fixture.mjs";

const ZEROS = "0".repeat(40);

test("a push reports the files its refs add", () => {
  withRepo((root) => {
    write(root, "packages/kernel/src/index.ts", "two\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "second"]);

    const head = rev(root, "HEAD");
    const base = rev(root, "HEAD~1");
    assert.deepEqual(pushedFiles(root, `refs/heads/x ${head} refs/heads/x ${base}`), ["packages/kernel/src/index.ts"]);
  });
});

test("deleting a ref runs nothing, and no refs falls back to the working tree", () => {
  withRepo((root) => {
    assert.deepEqual(pushedFiles(root, `refs/heads/x ${ZEROS} refs/heads/x ${rev(root, "HEAD")}`), []);
    assert.equal(pushedFiles(root, ""), null);
  });
});

test("a ref git cannot read asks the caller to stop", () => {
  withRepo((root) => {
    const head = rev(root, "HEAD");
    assert.equal(pushedFiles(root, "not a ref line"), PUSH_UNKNOWN);
    assert.equal(pushedFiles(root, `refs/heads/x ${head} refs/heads/x ${"d".repeat(40)}`), PUSH_UNKNOWN);
    // A new branch needs merge-base against origin/HEAD, which this fixture lacks.
    assert.equal(pushedFiles(root, `refs/heads/x ${head} refs/heads/x ${ZEROS}`), PUSH_UNKNOWN);
  });
});

test("no origin/HEAD asks the caller to stop", () => {
  withRepo((root) => {
    assert.equal(localFiles(root), null);
  });
});

test("outside a git repo the reader asks the caller to stop", () => {
  const dir = mkdtempSync(join(tmpdir(), "ans-preflight-nogit-"));
  try {
    assert.equal(localFiles(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an inherited GIT_DIR does not redirect the fixture or the reader", () => {
  withRepo((root) => {
    const decoy = mkdtempSync(join(tmpdir(), "ans-preflight-decoy-"));
    const saved = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
    try {
      git(decoy, ["init", "-q"]);
      git(decoy, ["config", "user.email", "decoy@example.test"]);
      git(decoy, ["config", "user.name", "decoy"]);
      git(decoy, ["config", "commit.gpgsign", "false"]);
      write(decoy, "decoy.txt", "decoy\n");
      git(decoy, ["add", "."]);
      git(decoy, ["commit", "-q", "-m", "decoy"]);
      const decoyHead = rev(decoy, "HEAD");

      git(root, ["update-ref", "refs/remotes/origin/main", rev(root, "HEAD")]);
      git(root, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);

      // What a pre-push hook in a linked worktree hands its child.
      process.env.GIT_DIR = join(decoy, ".git");
      process.env.GIT_WORK_TREE = root;

      write(root, "packages/kernel/src/index.ts", "two\n");
      git(root, ["add", "."]);
      git(root, ["commit", "-q", "-m", "second"]);

      assert.equal(rev(decoy, "HEAD"), decoyHead, "the fixture's commit landed in the decoy repo");
      assert.deepEqual(localFiles(root), ["packages/kernel/src/index.ts"]);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(decoy, { recursive: true, force: true });
    }
  });
});

test("two refs carrying the same file report it once", () => {
  withRepo((root) => {
    write(root, "packages/kernel/src/index.ts", "two\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "second"]);
    const head = rev(root, "HEAD");
    const base = rev(root, "HEAD~1");
    const refs = `refs/heads/x ${head} refs/heads/x ${base}\nrefs/heads/y ${head} refs/heads/y ${base}`;
    assert.deepEqual(pushedFiles(root, refs), ["packages/kernel/src/index.ts"]);
  });
});

test("a plain run reports commits above origin/HEAD plus the working tree", () => {
  withRepo((root) => {
    git(root, ["update-ref", "refs/remotes/origin/main", rev(root, "HEAD")]);
    git(root, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);

    write(root, "packages/kernel/src/index.ts", "two\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "second"]);
    write(root, "packages/store/notes.ts", "untracked\n");

    assert.deepEqual(localFiles(root).sort(), ["packages/kernel/src/index.ts", "packages/store/notes.ts"]);
  });
});

function withRepo(run) {
  const root = mkdtempSync(join(tmpdir(), "ans-preflight-git-"));
  try {
    git(root, ["init", "-q"]);
    assertOwnRepo(root, rev(root, "--absolute-git-dir"));
    git(root, ["config", "user.email", "preflight@example.test"]);
    git(root, ["config", "user.name", "preflight"]);
    git(root, ["config", "commit.gpgsign", "false"]);
    write(root, "apps/mcp/src/index.ts", "one\n");
    write(root, "packages/kernel/src/index.ts", "one\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "base"]);
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function git(root, args) {
  const result = gitIn(root, args);
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function rev(root, ref) {
  return git(root, ["rev-parse", ref]);
}

function write(root, file, content) {
  const target = join(root, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}
