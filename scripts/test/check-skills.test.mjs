// scripts/check-skills.mjs (#387): what the exit codes mean (0 every skill
// passes / 1 a rule broke or nothing was found / 2 the check could not run),
// which files discovery finds, and one case per rule that has to go red.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../check-skills.mjs", import.meta.url));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Run the checker the way CI does: one plain node process, no build first.
 * `root` swaps in another checkout for the no-argument discovery mode.
 */
function check(args = [], { cwd = ROOT, root } = {}) {
  const env = { ...process.env };
  // A stray export on the developer's machine must not choose the tree, and the
  // child has to do its own tsx re-entry.
  delete env.ANS_CHECK_SKILLS_TSX;
  if (root) env.ANS_CHECK_SKILLS_ROOT = root;
  else delete env.ANS_CHECK_SKILLS_ROOT;
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: "utf8", timeout: 120_000 });
  if (result.error || result.signal) {
    throw new Error(`check-skills did not finish: ${result.error ? result.error.message : result.signal}`);
  }
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
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
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
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
  skill(root, "alpha", "name: alpha\ndescription: Use when a test needs alpha.");
  git(root, ["add", "--", "alpha/SKILL.md", "alpha"]);
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

test("no arguments in this checkout finds the shipped skill and passes it", () => {
  const result = check([], { root: ROOT });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /apps\/plugin\/skills\/ans\/SKILL\.md/);
  assert.match(result.stdout, /([1-9]\d*) SKILL\.md checked, 0 failed/);
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

test("a checkout with no skill is refused instead of passing vacuously", (t) => {
  const root = withRoot(t);
  git(root, ["init", "--quiet"]);
  const result = check([], { cwd: root, root });
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /no SKILL\.md found/);
});

test("a path that does not exist is a usage error, not a failing skill", (t) => {
  const root = withRoot(t);
  const result = check([path.join(root, "nowhere")]);
  assert.equal(result.code, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /no such file or directory/);
});
