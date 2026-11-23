// scripts/check-skills.mjs: what the exit codes mean (0 every skill passes /
// 1 a rule broke, nothing was found, or nothing was checked / 2 the check could
// not run), which files discovery finds, and the cases that have to go red.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gitEnv } from "../preflight-git.mjs";

const CLI = fileURLToPath(new URL("../check-skills.mjs", import.meta.url));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Run the checker the way CI does: one plain node process, no build first.
 * `root` swaps in another checkout for the no-argument discovery mode.
 */
function check(args = [], { cwd = ROOT, root, env: extra } = {}) {
  const env = { ...process.env };
  // A stray export on the developer's machine must not choose the tree, and the
  // child has to do its own tsx re-entry. `extra` is for tests that hand the
  // checker a poisoned environment on purpose.
  delete env.ANS_CHECK_SKILLS_TSX;
  if (root) env.ANS_CHECK_SKILLS_ROOT = root;
  else delete env.ANS_CHECK_SKILLS_ROOT;
  Object.assign(env, extra ?? {});
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: "utf8", timeout: 120_000 });
  if (result.error || result.signal) {
    throw new Error(`check-skills did not finish: ${result.error ? result.error.message : result.signal}`);
  }
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** True when the permission bits just set did not deny a directory listing (root). */
function canListDirectory(dir) {
  try {
    readdirSync(dir);
    return true;
  } catch {
    return false;
  }
}

/** True when the permission bits just set did not actually deny a read (root). */
function canStillRead(file) {
  try {
    readFileSync(file);
    return true;
  } catch {
    return false;
  }
}

/** Run a Git command in a fixture repository and insist it worked. */
function git(cwd, args) {
  // gitEnv drops GIT_DIR, GIT_CONFIG_* and friends, so `-C` alone picks the repo.
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: gitEnv(), timeout: 30_000 });
  // A timed-out or signalled child has no stderr to show, so name what happened.
  const why = result.error
    ? result.error.message
    : result.signal ?? (String(result.stderr).trim() || `exit ${result.status}`);
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${why}`);
}

/** Write one skill directory under a throwaway root and return its path. */
function skill(root, folder, frontmatter, body = "body\n") {
  const dir = path.join(root, folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n${body}`);
  return dir;
}

function withRoot(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "check-skills-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("a skill that follows the spec passes and is named in the output", (t) => {
  const root = withRoot(t);
  const dir = skill(root, "demo", "name: demo\ndescription: Use when a test needs a demo skill.");
  const result = check([dir]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /\[OK\] .*demo[/\\]SKILL\.md/);
  assert.match(result.stdout, /1 SKILL\.md checked, 0 failed/);
});

test("an uppercase name goes red and names the field, the rule and the file", (t) => {
  const root = withRoot(t);
  const dir = skill(root, "Upper", "name: Upper\ndescription: Use when a test needs an uppercase name.");
  const result = check([dir]);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /\[FAIL\] .*Upper[/\\]SKILL\.md/);
  assert.match(result.stdout, /SKILL\.md name "Upper" must be 1–64 lowercase/);
  assert.match(result.stdout, /1 SKILL\.md checked, 1 failed/);
});

test("an empty description goes red", (t) => {
  const root = withRoot(t);
  const dir = skill(root, "nodesc", 'name: nodesc\ndescription: ""');
  const result = check([dir]);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /description must be 1–1024 characters, got 0/);
});

test("a body past 500 lines goes red and reports the count", (t) => {
  const root = withRoot(t);
  const dir = skill(root, "longbody", "name: longbody\ndescription: Use when a test needs a long body.", "line\n".repeat(501));
  const result = check([dir]);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /body must stay under 500 lines, got 501/);
});

test("a description that never says when to use the skill gets a note, not a failure", (t) => {
  const root = withRoot(t);
  const dir = skill(root, "demosc", "name: demosc\ndescription: A skill about demos.");
  const result = check([dir]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /\[OK\] .*demosc[/\\]SKILL\.md/);
  assert.match(result.stdout, /\[note\] .*demosc[/\\]SKILL\.md: SKILL\.md description does not say when to use/);
  assert.match(result.stdout, /1 SKILL\.md checked, 0 failed/);
});

test("a description that says it in another language passes", (t) => {
  const root = withRoot(t);
  const dir = skill(root, "zhsc", "name: zhsc\ndescription: 把一周的提交整理成周报，周会前使用時最合适。");
  const result = check([dir]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /1 SKILL\.md checked, 0 failed/);
  assert.doesNotMatch(result.stdout, /\[note\]/, "a usage clause needs no note");
});

test("a name that differs from its directory goes red", (t) => {
  const root = withRoot(t);
  const dir = skill(root, "foldername", "name: skilename\ndescription: Use when a test needs a mismatch.");
  const result = check([dir]);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /name must equal the directory it lives in/);
});

test("a body that breaks lines with lone CR is still counted line by line", (t) => {
  const root = withRoot(t);
  const name = "crbody";
  const description = "Use when a test counts CR-separated lines.";
  const dir = skill(root, name, `name: ${name}\ndescription: ${description}`, "line\r".repeat(501));
  const result = check([dir]);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /body must stay under 500 lines, got 501/);
});

test("a SKILL.md given by path is checked like its directory", (t) => {
  const root = withRoot(t);
  const dir = skill(root, "byfile", "name: byfile\ndescription: Use when a test passes the file.");
  const result = check([path.join(dir, "SKILL.md")]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /\[OK\] .*byfile[/\\]SKILL\.md/);
});

test("a skill directory with no SKILL.md goes red", (t) => {
  const root = withRoot(t);
  mkdirSync(path.join(root, "empty"), { recursive: true });
  const result = check([path.join(root, "empty")]);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /\[FAIL\]/);
  assert.match(result.stdout, /SKILL\.md is missing/);
});

test("no arguments checks what Git can see: tracked, untracked, not ignored", (t) => {
  const root = withRoot(t);
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.name", "Check Skills Test"]);
  git(root, ["config", "user.email", "check-skills@example.invalid"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  skill(root, "alpha", "name: alpha\ndescription: Use when a test needs alpha.");
  git(root, ["add", "--", "alpha"]);
  git(root, ["commit", "--quiet", "-m", "alpha"]);
  // Written but not staged: a new skill has to be caught before it is committed.
  skill(root, "beta", "name: beta\ndescription: Use when a test needs beta.");
  writeFileSync(path.join(root, ".gitignore"), "ignored/\n");
  // Ignored on purpose: build output and scratch copies are not sources.
  skill(root, "ignored/gamma", 'name: gamma\ndescription: ""');
  const result = check([], { cwd: root, root });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /alpha[/\\]SKILL\.md/);
  assert.match(result.stdout, /beta[/\\]SKILL\.md/);
  assert.doesNotMatch(result.stdout, /gamma/);
  assert.match(result.stdout, /2 SKILL\.md checked, 0 failed/);
});

test("the skill this repository ships passes", () => {
  const result = check(["apps/plugin/skills/ans"], { root: ROOT });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /apps\/plugin\/skills\/ans\/SKILL\.md/);
  assert.match(result.stdout, /1 SKILL\.md checked, 0 failed/);
});

// A file the checker cannot read is "could not check" (exit 2), not "this skill
// is broken" (exit 1); the two are read differently by whoever sees the red run.
test("an unreadable SKILL.md is reported apart and exits 2", (t) => {
  if (process.platform === "win32") {
    t.skip("Windows permissions do not deny a read this way");
    return;
  }
  const root = withRoot(t);
  const dir = skill(root, "locked", "name: locked\ndescription: Use when the file cannot be read.");
  const file = path.join(dir, "SKILL.md");
  // No restore hook: deleting a 000-mode file only needs write permission on its
  // directory, and a hook registered here would run after the cleanup hook.
  chmodSync(file, 0o000);
  if (canStillRead(file)) {
    t.skip("this user can read a 000-mode file (root); the branch needs a denied read");
    return;
  }
  const result = check([dir]);
  assert.equal(result.code, 2, result.stdout + result.stderr);
  assert.match(result.stdout, /\[ERROR\] .*locked[/\\]SKILL\.md/);
  assert.match(result.stdout, /1 could not be read/);
});

// The push gate exports GIT_DIR in a linked worktree; a checker that honoured it
// would read another repository and report every tracked SKILL.md as missing.
test("an inherited GIT_DIR does not decide which repository is checked", (t) => {
  const root = withRoot(t);
  git(root, ["init", "--quiet"]);
  skill(root, "alpha", "name: alpha\ndescription: Use when a test needs alpha.");
  git(root, ["add", "--", "alpha"]);
  // The decoy is a full repo with the bad skill staged, and the environment
  // points git at it the way a push hook does: GIT_DIR plus GIT_WORK_TREE.
  const decoy = withRoot(t);
  git(decoy, ["init", "--quiet"]);
  skill(decoy, "bad", 'name: bad\ndescription: ""');
  git(decoy, ["add", "--", "bad"]);
  const result = check([], {
    cwd: root,
    root,
    env: { GIT_DIR: path.join(decoy, ".git"), GIT_WORK_TREE: decoy },
  });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /alpha[/\\]SKILL\.md/);
  assert.doesNotMatch(result.stdout, /bad/);
});

test("a checkout with no skill is refused instead of passing vacuously", (t) => {
  const root = withRoot(t);
  git(root, ["init", "--quiet"]);
  const result = check([], { cwd: root, root });
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /no SKILL\.md found/);
});

test("a file that is not named SKILL.md is a usage error", (t) => {
  const root = withRoot(t);
  const dir = skill(root, "other", "name: other\ndescription: Use when a test needs a file.");
  const notes = path.join(dir, "notes.md");
  writeFileSync(notes, "scratch\n");
  const result = check([notes]);
  assert.equal(result.code, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /not a SKILL\.md/);
});

// Deleting a skill before staging it is normal while editing; it is reported and
// skipped, not counted as a broken skill or as an unreadable one.
test("a git-listed skill deleted from the tree is skipped, not failed", (t) => {
  const root = withRoot(t);
  git(root, ["init", "--quiet"]);
  skill(root, "alpha", "name: alpha\ndescription: Use when a test needs alpha.");
  skill(root, "gone", "name: gone\ndescription: Use when a test deletes a skill.");
  git(root, ["add", "--", "alpha", "gone"]);
  rmSync(path.join(root, "gone", "SKILL.md"));
  const result = check([], { cwd: root, root });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /\[skip\] .*gone[/\\]SKILL\.md: listed by git but missing/);
  assert.match(result.stdout, /1 SKILL\.md checked, 1 skipped, 0 failed/);
});

// Skipping must not turn into a green run that proved nothing.
test("a checkout where every skill was skipped is refused", (t) => {
  const root = withRoot(t);
  git(root, ["init", "--quiet"]);
  skill(root, "gone", "name: gone\ndescription: Use when a test deletes a skill.");
  git(root, ["add", "--", "gone"]);
  rmSync(path.join(root, "gone", "SKILL.md"));
  const result = check([], { cwd: root, root });
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /0 SKILL\.md checked, 1 skipped, 0 failed/);
  assert.match(result.stdout, /nothing was checked/);
});

// Only "gone" means skipped: an unreadable directory is "could not check".
test("a skill directory that cannot be read is not skipped", (t) => {
  if (process.platform === "win32") {
    t.skip("Windows permissions do not deny a directory listing this way");
    return;
  }
  const root = withRoot(t);
  git(root, ["init", "--quiet"]);
  const dir = skill(root, "locked", "name: locked\ndescription: Use when a test locks a dir.");
  git(root, ["add", "--", "locked"]);
  chmodSync(dir, 0o000);
  // Restore inline in a finally, not via t.after: hooks run after the cleanup
  // hook that deletes the tree, so a hook here would throw ENOENT on POSIX.
  let result;
  try {
    if (canListDirectory(dir)) {
      t.skip("this user can list a 000-mode directory (root); the branch needs a denied read");
      return;
    }
    result = check([], { cwd: root, root });
  } finally {
    chmodSync(dir, 0o755);
  }
  assert.equal(result.code, 2, result.stdout + result.stderr);
  assert.match(result.stdout, /\[ERROR\] .*locked[/\\]SKILL\.md/);
  assert.doesNotMatch(result.stdout, /\[skip\]/);
});

// A symlinked SKILL.md is a rule failure ("must be a regular, non-symlink file"),
// not a missing file — existsSync alone would get that wrong.
test("a dangling symlinked SKILL.md goes red as a symlink", (t) => {
  if (process.platform === "win32") {
    t.skip("creating symlinks needs privileges on Windows");
    return;
  }
  const root = withRoot(t);
  git(root, ["init", "--quiet"]);
  const dir = skill(root, "linked", "name: linked\ndescription: Use when a test needs a link.");
  rmSync(path.join(dir, "SKILL.md"));
  symlinkSync(path.join(dir, "nowhere.md"), path.join(dir, "SKILL.md"));
  git(root, ["add", "--", "linked"]);
  const result = check([], { cwd: root, root });
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /must be a regular, non-symlink file/);
});

test("a path that does not exist is a usage error, not a failing skill", (t) => {
  const root = withRoot(t);
  const result = check([path.join(root, "nowhere")]);
  assert.equal(result.code, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /no such file or directory/);
});
