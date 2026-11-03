// Agent Skill installer contract (#109): local Git source → install → validate
// → list → uninstall; fail-closed manifest handling and installation ≠ activation.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync,
  symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSkill } from "../src/commands/skill.js";
import { managedSkillsRoot, skillManifestPath, type SkillManifest } from "../src/skill-store.js";

/** Run a Git command in a test repository and return trimmed stdout. */
function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Create isolated home/project/source Git fixtures with canonical temp paths. */
function fixture(t: TestContext) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "ans-skill-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, "home");
  const cwd = join(base, "project");
  const repository = join(base, "source-repo");
  for (const dir of [home, cwd, repository]) mkdirSync(dir, { recursive: true });
  git(repository, ["init", "--quiet"]);
  git(repository, ["config", "user.name", "Skill Test"]);
  git(repository, ["config", "user.email", "skill-test@example.invalid"]);
  git(repository, ["config", "commit.gpgsign", "false"]);
  const opts = { home, cwd };
  /** Run the skill CLI against the fixture and capture stdout/stderr. */
  async function run(args: string[]) {
    let stdout = "", stderr = "";
    const code = await runSkill(args, { ...opts, stdout: (s) => { stdout += s; }, stderr: (s) => { stderr += s; } });
    return { code, stdout, stderr };
  }
  /** Create and commit a skill directory in the fixture Git repository. */
  function source(name = "demo", folder = name, body = "Use the bundled template.\n"): string {
    const dir = join(repository, "skills", folder);
    mkdirSync(join(dir, "templates"), { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: A test skill\n---\n\n${body}`);
    writeFileSync(join(dir, "templates", "report.txt"), " bundled template\n");
    git(repository, ["add", "--", dir]);
    git(repository, ["commit", "--quiet", "-m", `add ${folder}`]);
    return dir;
  }
  /** Read the fixture manifest for the selected scope. */
  function manifest(project = false): SkillManifest {
    return JSON.parse(readFileSync(skillManifestPath({ ...opts, project }), "utf8"));
  }
  return { base, home, cwd, repository, opts, run, source, manifest };
}

for (const project of [false, true]) {
  test(`install → validate → list → uninstall in ${project ? "project" : "user"} scope, without activation`, async (t) => {
    const f = fixture(t);
    const dir = f.source();
    git(f.repository, ["tag", "v1.0.0"]);
    const flag = project ? ["--project"] : [];
    const managed = managedSkillsRoot({ ...f.opts, project });
    const manual = join(managed, "..", "manual", "SKILL.md");
    mkdirSync(join(managed, "..", "manual"), { recursive: true });
    writeFileSync(manual, "user-authored, not managed\n");
    const protectedFiles = [
      join(f.cwd, "domains", "research.toml"),
      join(f.home, ".anysearch-cli", "domains", "user.toml"),
      join(f.cwd, ".anysearch", "config.toml"),
      join(f.home, ".anysearch-cli", "config.toml"),
      join(f.home, ".anysearch", "config.env"),
    ];
    for (const path of protectedFiles) {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, '[skills]\nactive = ["existing"]\n');
    }
    const snapshot = () => protectedFiles.map((path) => readFileSync(path, "utf8"));
    const before = snapshot();

    const installed = await f.run(["install", dir, ...flag]);
    assert.equal(installed.code, 0, installed.stderr);
    assert.match(installed.stdout, /Installed only; activation remains in Active Domain TOML/);
    assert.equal(readFileSync(join(managed, "demo", "templates", "report.txt"), "utf8"), " bundled template\n");
    assert.equal(existsSync(join(managed, "demo", ".git")), false);
    assert.equal(existsSync(join(managed, ".installed.lock")), false, "the manifest lock is released after install");
    const entry = f.manifest(project).skills.demo;
    assert.equal(entry.source, dir);
    assert.equal(entry.commit, git(f.repository, ["rev-parse", "HEAD"]));
    assert.equal(entry.tag, "v1.0.0");
    assert.equal(entry.dirty, false);
    assert.deepEqual(snapshot(), before, "install must not rewrite domain/config files");

    const validated = await f.run(["validate", ...flag]);
    assert.equal(validated.code, 0, validated.stderr);
    assert.match(validated.stdout, /\[OK\] demo/);
    const listed = await f.run(["list", ...flag]);
    assert.equal(listed.code, 0, listed.stderr);
    assert.match(listed.stdout, /demo\t[0-9a-f]{12} \(v1\.0\.0\)/);
    assert.ok(listed.stdout.includes(dir));
    assert.ok(!listed.stdout.includes("manual"), "list is manifest-backed, not a filesystem scan");
    const removed = await f.run(["uninstall", "demo", ...flag]);
    assert.equal(removed.code, 0, removed.stderr);
    assert.equal(existsSync(join(managed, "demo")), false);
    assert.equal(readFileSync(manual, "utf8"), "user-authored, not managed\n");
    assert.deepEqual(f.manifest(project).skills, {});
    assert.deepEqual(snapshot(), before, "uninstall must not rewrite domain/config files");
  });
}

test("missing, malformed and schema-invalid manifests never authorize deletion", async (t) => {
  const f = fixture(t);
  const dir = f.source();
  assert.equal((await f.run(["install", dir])).code, 0);
  const path = skillManifestPath(f.opts);
  const original = readFileSync(path, "utf8");
  const target = join(managedSkillsRoot(f.opts), "demo", "SKILL.md");
  const content = readFileSync(target, "utf8");
  const valid = JSON.parse(original) as SkillManifest;
  const invalidManifests: (string | undefined)[] = [
    undefined, "{broken", "null", "[]", JSON.stringify({ version: 2, skills: {} }),
    JSON.stringify({ version: 1, skills: [] }),
    JSON.stringify({ version: 1, skills: { demo: { ...valid.skills.demo, name: "other" } } }),
    JSON.stringify({ version: 1, skills: { demo: { ...valid.skills.demo, source: "../escape" } } }),
    JSON.stringify({ version: 1, skills: { demo: { ...valid.skills.demo, commit: "not-a-commit" } } }),
    JSON.stringify({ version: 1, skills: { demo: { ...valid.skills.demo, dirty: "false" } } }),
    JSON.stringify({ version: 1, skills: { "../escape": valid.skills.demo } }),
  ];
  for (const raw of invalidManifests) {
    if (raw === undefined) rmSync(path); else writeFileSync(path, raw);
    const result = await f.run(["uninstall", "demo"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /manifest/i);
    assert.equal(readFileSync(target, "utf8"), content, "uninstall must not guess a deletion target");
    for (const command of ["list", "validate", "install"]) {
      const args = command === "install" ? [command, dir] : [command];
      assert.equal((await f.run(args)).code, 1, `${command} must fail closed on a broken manifest`);
    }
  }
  writeFileSync(path, original);
  const unknown = await f.run(["uninstall", "manual"]);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /not recorded/);
  assert.equal(readFileSync(target, "utf8"), content);
});

test("an empty scope lists nothing; missing manifest with orphan files still refuses uninstall", async (t) => {
  const f = fixture(t);
  assert.equal((await f.run(["list"])).code, 0);
  assert.equal((await f.run(["validate"])).code, 0);
  const absent = await f.run(["uninstall", "demo"]);
  assert.equal(absent.code, 1);
  assert.match(absent.stderr, /manifest is missing/);
  const orphan = join(managedSkillsRoot(f.opts), "demo", "SKILL.md");
  mkdirSync(join(orphan, ".."), { recursive: true });
  writeFileSync(orphan, "orphan");
  const result = await f.run(["uninstall", "demo"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /missing/);
  assert.equal(readFileSync(orphan, "utf8"), "orphan");
});

test("a manifest lock serializes install and uninstall in the same scope", async (t) => {
  const f = fixture(t);
  assert.equal((await f.run(["install", f.source()])).code, 0);
  const managed = managedSkillsRoot(f.opts);
  const lock = join(managed, ".installed.lock");
  const manifestBefore = readFileSync(skillManifestPath(f.opts), "utf8");
  mkdirSync(lock);
  writeFileSync(join(lock, "owner.json"),
    JSON.stringify({ pid: 424242, host: "test-host", startedAt: "2026-11-03T00:00:00.000Z" }));
  try {
    const install = await f.run(["install", f.source("beta")]);
    assert.equal(install.code, 1, install.stderr);
    assert.match(install.stderr, /another skill operation/);
    assert.match(install.stderr, /424242/, "the error names the recorded holder");
    assert.equal(existsSync(join(managed, "beta")), false);
    const uninstall = await f.run(["uninstall", "demo"]);
    assert.equal(uninstall.code, 1, uninstall.stderr);
    assert.match(uninstall.stderr, /another skill operation/);
    assert.ok(existsSync(join(managed, "demo", "SKILL.md")), "a locked uninstall removes nothing");
    assert.equal(readFileSync(skillManifestPath(f.opts), "utf8"), manifestBefore);
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
  const removed = await f.run(["uninstall", "demo"]);
  assert.equal(removed.code, 0, removed.stderr);
  assert.equal(existsSync(lock), false, "the manifest lock is released after uninstall");
  assert.deepEqual(readdirSync(managed), ["installed.json"]);
});

test("Git provenance records the full commit and marks uncommitted source changes", async (t) => {
  const f = fixture(t);
  const dir = f.source();
  writeFileSync(join(dir, "templates", "report.txt"), "local edit\n");
  writeFileSync(join(dir, "untracked.txt"), "new file\n");
  const result = await f.run(["install", dir]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /\[dirty source\]/);
  const entry = f.manifest().skills.demo;
  assert.equal(entry.commit, git(f.repository, ["rev-parse", "HEAD"]));
  assert.equal(entry.dirty, true);
  assert.equal(entry.tag, undefined);
});

test("repository root is a valid source and Git metadata is not copied", async (t) => {
  const f = fixture(t);
  f.source();
  writeFileSync(join(f.repository, "SKILL.md"), "---\nname: root-skill\ndescription: Root\n---\n");
  git(f.repository, ["add", "SKILL.md"]);
  git(f.repository, ["commit", "--quiet", "-m", "root skill"]);
  const result = await f.run(["install", f.repository]);
  assert.equal(result.code, 0, result.stderr);
  const target = join(managedSkillsRoot(f.opts), "root-skill");
  assert.ok(existsSync(join(target, "skills", "demo", "SKILL.md")));
  assert.equal(existsSync(join(target, ".git")), false);
});

test("invalid sources and frontmatter fail before publication", async (t) => {
  const f = fixture(t);
  const dir = f.source();
  const file = join(dir, "SKILL.md");
  const cases: [string, RegExp][] = [
    ["# no frontmatter\n", /frontmatter/],
    ["---\nname: [broken\n---\n", /YAML frontmatter/],
    ["---\njust a scalar\n---\n", /YAML mapping/],
    ["---\nname: demo\nname: other\n---\n", /YAML frontmatter/],
    ["---\nname: ../escape\ndescription: x\n---\n", /skill name/],
    ["---\nname: CON\ndescription: x\n---\n", /skill name/],
    ["---\nname: a--b\ndescription: x\n---\n", /skill name/],
  ];
  for (const [text, error] of cases) {
    writeFileSync(file, text);
    const result = await f.run(["install", dir]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, error);
    assert.equal(existsSync(skillManifestPath(f.opts)), false);
  }
  const plain = join(f.base, "not-git");
  mkdirSync(plain);
  writeFileSync(join(plain, "SKILL.md"), "---\nname: plain\n---\n");
  assert.match((await f.run(["install", plain])).stderr, /Git source/);
  assert.match((await f.run(["install", f.base])).stderr, /SKILL\.md/);
  const remote = await f.run(["install", "https://example.invalid/skills.git"]);
  assert.equal(remote.code, 2);
  assert.match(remote.stderr, /local Git checkout/);
});

test("CRLF, BOM and a name-only YAML mapping are parseable", async (t) => {
  const f = fixture(t);
  const dir = f.source();
  writeFileSync(join(dir, "SKILL.md"), "\uFEFF---\r\nname: demo\r\n---\r\nbody\r\n");
  const result = await f.run(["install", dir]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal((await f.run(["validate", "demo"])).code, 0);
});

test("source symlinks are rejected and staging is rolled back", async (t) => {
  const f = fixture(t);
  const dir = f.source();
  const outside = join(f.base, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "private.txt"), "do not copy");
  // Junctions work on Windows without requiring file-symlink privileges.
  const link = join(dir, "linked");
  symlinkSync(outside, link, "junction");
  try {
    const result = await f.run(["install", dir]);
    assert.equal(result.code, 1, result.stderr);
    assert.match(result.stderr, /symlink/);
    assert.equal(existsSync(join(managedSkillsRoot(f.opts), "demo")), false);
    assert.equal(existsSync(skillManifestPath(f.opts)), false);
    assert.deepEqual(readdirSync(managedSkillsRoot(f.opts)), []);
    assert.equal(readFileSync(join(outside, "private.txt"), "utf8"), "do not copy");
  } finally {
    rmSync(link, { force: true });
  }
});

test("reinstallation never overwrites an existing skill or a user-authored namesake", async (t) => {
  const f = fixture(t);
  const dir = f.source();
  const manual = join(f.home, ".anysearch-cli", "skills", "demo", "SKILL.md");
  mkdirSync(join(manual, ".."), { recursive: true });
  writeFileSync(manual, "handwritten");
  assert.equal((await f.run(["install", dir])).code, 0);
  const installed = join(managedSkillsRoot(f.opts), "demo", "SKILL.md");
  writeFileSync(installed, "local installed edit");
  const manifestBefore = readFileSync(skillManifestPath(f.opts), "utf8");
  const again = await f.run(["install", dir]);
  assert.equal(again.code, 1);
  assert.match(again.stderr, /already exists/);
  assert.equal(readFileSync(installed, "utf8"), "local installed edit");
  assert.equal(readFileSync(manual, "utf8"), "handwritten");
  assert.equal(readFileSync(skillManifestPath(f.opts), "utf8"), manifestBefore);
});

test("validate reports each broken skill without blocking healthy ones; uninstall stays manifest-backed", async (t) => {
  const f = fixture(t);
  assert.equal((await f.run(["install", f.source("alpha")])).code, 0);
  assert.equal((await f.run(["install", f.source("beta")])).code, 0);
  const broken = join(managedSkillsRoot(f.opts), "beta", "SKILL.md");
  writeFileSync(broken, "---\nname: [broken\n---\n");
  const all = await f.run(["validate"]);
  assert.equal(all.code, 1);
  assert.match(all.stdout, /\[OK\] alpha/);
  assert.match(all.stdout, /\[FAIL\] beta/);
  assert.equal((await f.run(["validate", "alpha"])).code, 0);
  assert.equal((await f.run(["validate", "beta"])).code, 1);
  assert.equal((await f.run(["uninstall", "beta"])).code, 0);
  assert.equal(existsSync(broken), false);
});

test("a replaced installed directory cannot redirect uninstall outside synced/", async (t) => {
  const f = fixture(t);
  assert.equal((await f.run(["install", f.source()])).code, 0);
  const managed = managedSkillsRoot(f.opts);
  const target = join(managed, "demo");
  rmSync(target, { recursive: true });
  const outside = join(f.base, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "keep.txt"), "keep");
  symlinkSync(outside, target, "junction");
  try {
    const result = await f.run(["uninstall", "demo"]);
    assert.equal(result.code, 1, result.stderr);
    assert.match(result.stderr, /symlink/);
    assert.equal(readFileSync(join(outside, "keep.txt"), "utf8"), "keep");
    assert.ok(f.manifest().skills.demo);
  } finally {
    rmSync(target, { force: true });
  }
});

test("project scope cannot alias the user store through a .anysearch symlink", async (t) => {
  const f = fixture(t);
  const dir = f.source();
  assert.equal((await f.run(["install", dir])).code, 0);
  const userSkill = join(managedSkillsRoot(f.opts), "demo", "SKILL.md");
  const userManifest = skillManifestPath(f.opts);
  // Junctions work on Windows without requiring file-symlink privileges.
  const link = join(f.cwd, ".anysearch");
  symlinkSync(join(f.home, ".anysearch-cli"), link, "junction");
  try {
    for (const args of [
      ["list", "--project"],
      ["validate", "--project"],
      ["uninstall", "demo", "--project"],
      ["install", dir, "--project"],
    ]) {
      const result = await f.run(args);
      assert.equal(result.code, 1, `${args.join(" ")}: ${result.stderr || result.stdout}`);
      assert.match(result.stderr, /scope root|symlink/);
    }
    assert.ok(existsSync(userSkill), "project-scoped operations must not delete the user installation");
    assert.ok(f.manifest().skills.demo, "user manifest must remain intact");
    assert.ok(existsSync(userManifest));
  } finally {
    rmSync(link, { force: true });
  }
});

test("usage errors are nonzero and do not create an installation", async (t) => {
  const f = fixture(t);
  for (const args of [["bogus"], ["install"], ["uninstall"], ["list", "extra"], ["validate", "a", "b"], ["list", "--wat"], ["list", "--project", "--user"]]) {
    assert.equal((await f.run(args)).code, 2, args.join(" "));
  }
  assert.equal(existsSync(skillManifestPath(f.opts)), false);
  assert.equal((await f.run(["--help"])).code, 0);
});
