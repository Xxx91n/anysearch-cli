// Agent Skill installer contract (#109): local Git source → install → validate
// → list → uninstall; fail-closed manifest handling and installation ≠ activation.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync,
  statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { runSkill } from "../src/commands/skill.js";
import {
  __setStatusProbeForTest, LOCK_PENDING_ENTRY, MANIFEST_TEMP_ENTRY, machineId, managedSkillsRoot, pidIdentity,
  QUARANTINE_ENTRY, releaseOwnedLock, renameWithRetry, skillManifestPath, skillRenameIO, STAGING_ENTRY,
  type SkillManifest, type StatusProbeChild, type StatusProbeSpawn,
} from "../src/skill-store.js";

/** Run a Git command in a test repository and return trimmed stdout. */
function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/**
 * Simulate the streaming `git status` child (#138) without copying a huge skill.
 *
 * The fake is willing to emit `totalBytes` of porcelain output, so a probe that
 * still buffered the listing would blow past the old 16 MiB maxBuffer. `kill`
 * records signals and closes the fake like Git terminating on a signal; the
 * probe's early stop is what keeps `emittedBytes()` bounded.
 */
function fakeStatusProbe(spec: {
  totalBytes?: number;
  code?: number | null;
  signal?: NodeJS.Signals | null;
  stderr?: string;
  silent?: boolean;
}) {
  const total = spec.totalBytes ?? 0;
  const chunk = "M  templates/report.txt\n";
  const kills: NodeJS.Signals[] = [];
  const events = new EventEmitter();
  let emitted = 0;
  let closed = false;
  const finish = (code: number | null, signal: NodeJS.Signals | null) => {
    if (closed) return;
    closed = true;
    stdout.push(null);
    setImmediate(() => events.emit("close", code, signal));
  };
  const stdout = new Readable({
    read() {
      if (spec.silent) return;
      if (emitted >= total) {
        finish(spec.code ?? 0, spec.signal ?? null);
        return;
      }
      emitted = Math.min(total, emitted + chunk.length);
      this.push(chunk);
    },
  });
  // One push then EOF: an endlessly readable stderr can starve the setImmediate
  // that emits the child close event, hanging the suite.
  const stderr = new Readable({
    read() {
      if (spec.stderr) this.push(spec.stderr);
      this.push(null);
    },
  });
  const child: StatusProbeChild = Object.assign(events, {
    stdout,
    stderr,
    kill(signal: NodeJS.Signals = "SIGTERM") {
      kills.push(signal);
      finish(null, signal);
      return true;
    },
  });
  return {
    spawn: (() => child) as StatusProbeSpawn,
    kills,
    emittedBytes: () => emitted,
  };
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
    if (process.platform !== "win32") {
      assert.equal(statSync(join(managed, "demo")).mode & 0o777, 0o700, "the installed root is owner-only");
    }
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
  const emptyList = await f.run(["list"]);
  assert.equal(emptyList.code, 0);
  assert.match(emptyList.stdout, /No installed skills\./);
  const emptyValidate = await f.run(["validate"]);
  assert.equal(emptyValidate.code, 0);
  assert.match(emptyValidate.stdout, /No installed skills to validate\./);
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
  const listed = await f.run(["list"]);
  assert.equal(listed.code, 1, "list stays fail-closed on unrecorded content");
  assert.match(listed.stderr, /manifest is missing/);
});

test("a manifest lock serializes install and uninstall in the same scope", async (t) => {
  const f = fixture(t);
  assert.equal((await f.run(["install", f.source()])).code, 0);
  const managed = managedSkillsRoot(f.opts);
  const lock = join(managed, ".installed.lock");
  const manifestBefore = readFileSync(skillManifestPath(f.opts), "utf8");
  mkdirSync(lock);
  writeFileSync(join(lock, "owner.json"),
    JSON.stringify({ token: "test", pid: 424242, host: "test-host", startedAt: "2026-11-03T00:00:00.000Z" }));
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

test("uninstall drops a manifest entry whose directory is already gone", async (t) => {
  const f = fixture(t);
  assert.equal((await f.run(["install", f.source()])).code, 0);
  rmSync(join(managedSkillsRoot(f.opts), "demo"), { recursive: true, force: true });
  const removed = await f.run(["uninstall", "demo"]);
  assert.equal(removed.code, 0, removed.stderr);
  assert.deepEqual(f.manifest().skills, {});
  const listed = await f.run(["list"]);
  assert.equal(listed.code, 0, listed.stderr);
  assert.match(listed.stdout, /No installed skills\./);
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

test("gitignored content is copied and recorded as dirty", async (t) => {
  const f = fixture(t);
  const dir = f.source();
  writeFileSync(join(dir, ".gitignore"), "secret.env\n");
  git(f.repository, ["add", join(dir, ".gitignore")]);
  git(f.repository, ["commit", "--quiet", "-m", "ignore secret"]);
  writeFileSync(join(dir, "secret.env"), "TOKEN=example\n");
  const result = await f.run(["install", dir]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /\[dirty source\]/);
  assert.equal(f.manifest().skills.demo.dirty, true);
  assert.equal(readFileSync(join(managedSkillsRoot(f.opts), "demo", "secret.env"), "utf8"), "TOKEN=example\n");
});

test("a source repository that defines Git content filters is refused before status", async (t) => {
  const f = fixture(t);
  const dir = f.source();
  // Commit the attributes before configuring the driver: adding or committing an
  // attributes file itself re-normalizes tracked files and would run the filter.
  writeFileSync(join(f.repository, ".gitattributes"), "*.txt filter=evil\n");
  git(f.repository, ["add", ".gitattributes"]);
  git(f.repository, ["commit", "--quiet", "-m", "attributes"]);
  // Arm the driver: status re-hashes this stat-dirty tracked file and would run it.
  writeFileSync(join(dir, "templates", "report.txt"), "armed\n");
  // Configure last, so no later Git command can execute the driver during setup.
  git(f.repository, ["config", "filter.evil.clean", "sh -c 'touch PWNED; cat'"]);
  const marker = join(f.repository, "PWNED");
  assert.equal(existsSync(marker), false);
  const result = await f.run(["install", dir]);
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, /content filters/);
  assert.match(result.stderr, /filter\.evil\.clean/);
  assert.equal(existsSync(marker), false, "the filter must never execute");
  assert.equal(existsSync(skillManifestPath(f.opts)), false);
});

test("filters defined in worktree config are also refused", async (t) => {
  const f = fixture(t);
  const dir = f.source();
  git(f.repository, ["config", "extensions.worktreeConfig", "true"]);
  git(f.repository, ["config", "--worktree", "filter.evil.clean", "sh -c 'touch PWNED; cat'"]);
  const result = await f.run(["install", dir]);
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, /filter\.evil\.clean/);
  assert.equal(existsSync(join(f.repository, "PWNED")), false);
});

test("user-global filters do not block an install", async (t) => {
  const f = fixture(t);
  const dir = f.source();
  const globalConfig = join(f.base, "global.gitconfig");
  writeFileSync(globalConfig, "[filter \"global\"]\n\tclean = cat\n");
  const previous = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  try {
    const result = await f.run(["install", dir]);
    assert.equal(result.code, 0, result.stderr);
  } finally {
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous;
  }
});

test("a dirty probe stops reading a status listing far beyond the old 16 MiB buffer", async (t) => {
  const f = fixture(t);
  const dir = f.source();
  // Three times the old maxBuffer: collecting the listing would have failed the
  // install, while the bounded probe only needs the first entry.
  const fake = fakeStatusProbe({ totalBytes: 48 * 1024 * 1024 });
  __setStatusProbeForTest({ spawn: fake.spawn });
  t.after(() => __setStatusProbeForTest(null));
  const result = await f.run(["install", dir]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(f.manifest().skills.demo.dirty, true);
  assert.deepEqual(fake.kills, ["SIGTERM"], "the probe stops Git once dirtiness is known");
  assert.ok(fake.emittedBytes() < 1024 * 1024, `only a bounded prefix is read (${fake.emittedBytes()} bytes)`);
});

test("the dirty probe does not inspect submodules", async (t) => {
  const f = fixture(t);
  const dir = f.source();
  const fake = fakeStatusProbe({ totalBytes: 64 });
  let args: string[] = [];
  const spawnCapture: StatusProbeSpawn = (command, spawnArgs, options) => {
    args = spawnArgs;
    return fake.spawn(command, spawnArgs, options);
  };
  __setStatusProbeForTest({ spawn: spawnCapture });
  t.after(() => __setStatusProbeForTest(null));
  const result = await f.run(["install", dir]);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(args.includes("--ignore-submodules=all"), args.join(" "));
});

test("a failing status probe fails closed before publishing anything", async (t) => {
  const f = fixture(t);
  const dir = f.source();
  const fake = fakeStatusProbe({ code: 128, stderr: "fatal: cannot read repository\n" });
  __setStatusProbeForTest({ spawn: fake.spawn });
  t.after(() => __setStatusProbeForTest(null));
  const result = await f.run(["install", dir]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /cannot inspect Git source/);
  assert.equal(existsSync(skillManifestPath(f.opts)), false);
  assert.equal(existsSync(join(managedSkillsRoot(f.opts), "demo")), false);
});

test("a hung status probe times out and installs nothing", async (t) => {
  const f = fixture(t);
  const dir = f.source();
  const fake = fakeStatusProbe({ silent: true });
  __setStatusProbeForTest({ spawn: fake.spawn, timeoutMs: 100 });
  t.after(() => __setStatusProbeForTest(null));
  const result = await f.run(["install", dir]);
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, /did not finish within 100ms/);
  assert.deepEqual(fake.kills, ["SIGKILL"], "a hung Git child is killed, not orphaned");
  assert.equal(existsSync(skillManifestPath(f.opts)), false);
});

test("an inherited GIT_DIR cannot redirect provenance to another repository", async (t) => {
  const f = fixture(t);
  const dir = f.source();
  const decoy = join(f.base, "decoy-repo");
  mkdirSync(decoy, { recursive: true });
  git(decoy, ["init", "--quiet"]);
  git(decoy, ["config", "user.name", "Skill Test"]);
  git(decoy, ["config", "user.email", "skill-test@example.invalid"]);
  git(decoy, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(decoy, "decoy.txt"), "decoy\n");
  git(decoy, ["add", "--", "decoy.txt"]);
  git(decoy, ["commit", "--quiet", "-m", "decoy"]);
  // Read the expectation before exporting GIT_DIR: the test helper inherits it too.
  const expected = git(f.repository, ["rev-parse", "HEAD"]);
  const saved = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
  process.env.GIT_DIR = join(decoy, ".git");
  process.env.GIT_WORK_TREE = decoy;
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const result = await f.run(["install", dir]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(f.manifest().skills.demo.commit, expected, "provenance must describe the selected source");
});

test("changes outside the selected source directory do not mark it dirty", async (t) => {
  const f = fixture(t);
  const dir = f.source();
  writeFileSync(join(f.repository, "unrelated.txt"), "outside the skill\n");
  writeFileSync(join(f.repository, "skills", "sibling.txt"), "sibling of the skill\n");
  const result = await f.run(["install", dir]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(f.manifest().skills.demo.dirty, false, "the probe stays scoped to the selected directory");
});

test("staged changes mark the source dirty", async (t) => {
  const f = fixture(t);
  const dir = f.source();
  writeFileSync(join(dir, "staged.txt"), "staged but not committed\n");
  git(f.repository, ["add", "--", join(dir, "staged.txt")]);
  const result = await f.run(["install", dir]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(f.manifest().skills.demo.dirty, true);
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

test("a source path with control characters is rejected before publication", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows file names cannot carry control characters");
    return;
  }
  const f = fixture(t);
  const odd = join(f.base, "odd\nname");
  renameSync(f.source(), odd);
  const result = await f.run(["install", odd]);
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, /control characters/);
  assert.equal(existsSync(skillManifestPath(f.opts)), false);
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
    const listed = await f.run(["list"]);
    assert.equal(listed.code, 0, listed.stderr);
    assert.match(listed.stdout, /No installed skills\./);
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

/** A pid above every supported OS pid limit; probing it reports ESRCH. */
function deadPid(): number {
  return 2_147_483_647;
}

/** Plant a lock owned by the given record in the user scope. */
function plantLock(
  managed: string,
  token: string,
  pid: number,
  host = hostname(),
  identity: { bootId?: string; namespace?: string } | undefined = pidIdentity(),
  mid: string | undefined = machineId(),
): string {
  const lock = join(managed, ".installed.lock");
  rmSync(lock, { recursive: true, force: true });
  mkdirSync(lock);
  writeFileSync(join(lock, "owner.json"), JSON.stringify({
    token, pid, host, startedAt: "2026-11-03T00:00:00.000Z",
    ...(mid ? { machineId: mid } : {}),
    ...(identity?.bootId ? { bootId: identity.bootId } : {}),
    ...(identity?.namespace ? { namespace: identity.namespace } : {}),
  }));
  return lock;
}

test("a lock held by a provably dead process on this host is reclaimed", async (t) => {
  if (!machineId()) { t.skip("machineId unavailable"); return; }
  const f = fixture(t);
  assert.equal((await f.run(["install", f.source()])).code, 0);
  const managed = managedSkillsRoot(f.opts);
  const lock = plantLock(managed, "dead", deadPid());
  const result = await f.run(["install", f.source("beta")]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(existsSync(lock), false, "the reclaimed lock is released after the operation");
  assert.deepEqual(Object.keys(f.manifest().skills).sort(), ["beta", "demo"]);
});

test("uninstall also reclaims a provably dead lock", async (t) => {
  if (!machineId()) { t.skip("machineId unavailable"); return; }
  const f = fixture(t);
  assert.equal((await f.run(["install", f.source()])).code, 0);
  const managed = managedSkillsRoot(f.opts);
  const lock = plantLock(managed, "dead", deadPid());
  const result = await f.run(["uninstall", "demo"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(existsSync(lock), false);
  assert.deepEqual(f.manifest().skills, {});
});

test("read maintenance reclaims a dead lock without blocking list", async (t) => {
  if (!machineId()) { t.skip("machineId unavailable"); return; }
  const f = fixture(t);
  assert.equal((await f.run(["install", f.source()])).code, 0);
  const managed = managedSkillsRoot(f.opts);
  const lock = plantLock(managed, "dead", deadPid());
  const listed = await f.run(["list"]);
  assert.equal(listed.code, 0, listed.stderr);
  assert.match(listed.stdout, /demo/);
  assert.equal(existsSync(lock), false);
});

test("an active reclaim guard prevents a second reclaimer from moving the lock", async (t) => {
  if (!machineId()) { t.skip("machineId unavailable"); return; }
  const f = fixture(t);
  assert.equal((await f.run(["install", f.source()])).code, 0);
  const managed = managedSkillsRoot(f.opts);
  const lock = plantLock(managed, "dead", deadPid());
  const identity = pidIdentity();
  const guard = join(managed, ".installed.lock.reclaiming");
  mkdirSync(guard);
  const mid = machineId();
  writeFileSync(join(guard, "owner.json"), JSON.stringify({
    token: "guard", pid: process.pid, host: hostname(), startedAt: "2026-11-03T00:00:00.000Z",
    ...(mid ? { machineId: mid } : {}),
    ...(identity ? { bootId: identity.bootId, namespace: identity.namespace } : {}),
  }));
  const result = await f.run(["install", f.source("beta")]);
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, /stale-lock reclaim is in progress/);
  assert.ok(existsSync(lock), "the dead lock is not moved while another reclaimer holds the guard");
  assert.ok(existsSync(guard));
});

test("a dead reclaim guard is recovered before reclamation", async (t) => {
  if (!machineId()) { t.skip("machineId unavailable"); return; }
  const f = fixture(t);
  assert.equal((await f.run(["install", f.source()])).code, 0);
  const managed = managedSkillsRoot(f.opts);
  const lock = plantLock(managed, "dead", deadPid());
  const identity = pidIdentity();
  const guard = join(managed, ".installed.lock.reclaiming");
  mkdirSync(guard);
  const mid = machineId();
  writeFileSync(join(guard, "owner.json"), JSON.stringify({
    token: "dead-guard", pid: deadPid(), host: hostname(), startedAt: "2026-11-03T00:00:00.000Z",
    ...(mid ? { machineId: mid } : {}),
    ...(identity ? { bootId: identity.bootId, namespace: identity.namespace } : {}),
  }));
  const result = await f.run(["install", f.source("beta")]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(existsSync(lock), false);
  assert.equal(existsSync(guard), false);
  assert.deepEqual(Object.keys(f.manifest().skills).sort(), ["beta", "demo"]);
});

test("locks that are live or from another host are never reclaimed", async (t) => {
  const f = fixture(t);
  assert.equal((await f.run(["install", f.source()])).code, 0);
  const managed = managedSkillsRoot(f.opts);
  const dir = f.source("beta");
  for (const [token, pid, host, mid] of [
    ["live", process.pid, hostname(), machineId()],
    ["remote", deadPid(), "remote-host", "foreign-machine-id"],
  ] as const) {
    const lock = plantLock(managed, token, pid, host, pidIdentity(), mid);
    const result = await f.run(["install", dir]);
    assert.equal(result.code, 1, result.stderr);
    assert.match(result.stderr, /another skill operation/);
    if (host !== hostname()) assert.match(result.stderr, /remote-host/, "cross-host locks name the other host");
    assert.ok(existsSync(lock), "a lock that is not provably dead is left in place");
  }
  const malformedLock = plantLock(managed, "junk", 0);
  writeFileSync(join(malformedLock, "owner.json"), "{broken");
  const malformed = await f.run(["install", dir]);
  assert.equal(malformed.code, 1, malformed.stderr);
  assert.match(malformed.stderr, /owner record is incomplete/);
  assert.ok(existsSync(malformedLock), "an unreadable owner is never reclaimed");
  assert.equal(existsSync(join(managed, "beta")), false);
  assert.deepEqual(Object.keys(f.manifest().skills), ["demo"]);
});

test("a lock from another PID namespace is never reclaimed", async (t) => {
  const f = fixture(t);
  assert.equal((await f.run(["install", f.source()])).code, 0);
  const managed = managedSkillsRoot(f.opts);
  const current = pidIdentity();
  const foreign = { bootId: current?.bootId ?? "other-boot", namespace: "other-namespace" };
  const lock = plantLock(managed, "foreign-namespace", deadPid(), hostname(), foreign);
  const result = await f.run(["install", f.source("beta")]);
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, /PID namespace/);
  assert.ok(existsSync(lock), "a lock from another namespace is left in place");
  assert.equal(existsSync(join(managed, "beta")), false);
});

test("a lock with a foreign machine identity is never reclaimed", async (t) => {
  const f = fixture(t);
  assert.equal((await f.run(["install", f.source()])).code, 0);
  const managed = managedSkillsRoot(f.opts);
  // Same hostname, same boot identity, dead PID — but a foreign machineId.
  const lock = plantLock(managed, "foreign-machine", deadPid(), hostname(), pidIdentity(), "foreign-machine-id");
  const result = await f.run(["install", f.source("beta")]);
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, /another machine/);
  assert.ok(existsSync(lock), "a lock with a foreign machine identity is left in place");
  assert.equal(existsSync(join(managed, "beta")), false);
});

test("a lock without machine identity fails closed", async (t) => {
  const f = fixture(t);
  assert.equal((await f.run(["install", f.source()])).code, 0);
  const managed = managedSkillsRoot(f.opts);
  // Same hostname, dead PID, but no machineId in the owner record.
  // Write owner.json directly to avoid plantLock's machineId() default.
  const lock = join(managed, ".installed.lock");
  rmSync(lock, { recursive: true, force: true });
  mkdirSync(lock);
  const identity = pidIdentity();
  writeFileSync(join(lock, "owner.json"), JSON.stringify({
    token: "no-machine-id", pid: deadPid(), host: hostname(), startedAt: "2026-11-03T00:00:00.000Z",
    ...(identity?.bootId ? { bootId: identity.bootId } : {}),
    ...(identity?.namespace ? { namespace: identity.namespace } : {}),
  }));
  const result = await f.run(["install", f.source("beta")]);
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, /another skill operation/);
  assert.ok(existsSync(lock), "a lock without machine identity is left in place");
  assert.equal(existsSync(join(managed, "beta")), false);
});

test("a lock from a previous boot is reclaimed as dead", async (t) => {
  if (!machineId()) { t.skip("machineId unavailable"); return; }
  const f = fixture(t);
  assert.equal((await f.run(["install", f.source()])).code, 0);
  const managed = managedSkillsRoot(f.opts);
  const current = pidIdentity();
  const previous = current
    ? { bootId: "previous-boot", namespace: current.namespace }
    : { bootId: "previous-boot" };
  const lock = plantLock(managed, "previous-boot", deadPid(), hostname(), previous);
  const result = await f.run(["install", f.source("beta")]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(existsSync(lock), false);
  assert.deepEqual(Object.keys(f.manifest().skills).sort(), ["beta", "demo"]);
});

/** Wait until the OS reports the pid as gone (a killed child can linger briefly). */
async function waitUntilGone(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`pid ${pid} is still reported alive after SIGKILL`);
}

// #147: every other reclaim test plants the lock with `plantLock`, which writes
// the owner into an already-published directory — the shape an older build left
// behind. The shipped installer never produces that: `createLockDirectory` fills
// a `.installed.lock.pending-XXXXXX` staging directory and publishes it with one
// rename, so a crash inside the critical section leaves a *published* lock whose
// owner record is readable. This test reproduces that exact publication order in
// a child process, kills it there, and hands the wreckage to a real `install`.
test("a lock left by a SIGKILLed holder is reclaimed by the next install", async (t) => {
  const mid = machineId();
  if (!mid) { t.skip("machineId unavailable"); return; }
  const f = fixture(t);
  const dir = f.source("alpha");
  const managed = managedSkillsRoot(f.opts);
  mkdirSync(managed, { recursive: true });

  // The child reproduces the real publication order: pending directory → owner
  // record → one rename. It then blocks forever inside the critical section, so
  // the SIGKILL below is the only exit path and no cleanup code ever runs.
  const script = [
    'const fs = require("node:fs"), os = require("node:os"), path = require("node:path");',
    "const managed = process.env.ANS_TEST_MANAGED;",
    'const pending = fs.mkdtempSync(path.join(managed, ".installed.lock.pending-"));',
    // All-or-nothing, like pidIdentity(): a failed /proc read must drop both identity
    // fields and still publish, not abort before the lock exists and fail the test.
    "let identity;",
    'if (process.platform === "linux") {',
    "  try {",
    '    const bootId = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();',
    '    const namespace = fs.readlinkSync("/proc/self/ns/pid");',
    "    if (bootId && namespace) identity = { bootId, namespace };",
    "  } catch {}",
    "}",
    'fs.writeFileSync(path.join(pending, "owner.json"), JSON.stringify({',
    '  token: "killed", pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString(),',
    "  ...(identity ?? {}),",
    '  ...(process.env.ANS_TEST_MACHINE_ID ? { machineId: process.env.ANS_TEST_MACHINE_ID } : {}),',
    "}), { encoding: \"utf8\", flag: \"wx\", mode: 0o600 });",
    'fs.renameSync(pending, path.join(managed, ".installed.lock"));',
    'process.stdout.write("locked\\n");',
    "setInterval(() => {}, 1000);",
  ].join("\n");

  const child = spawn(process.execPath, ["-e", script], {
    env: { ...process.env, ANS_TEST_MANAGED: managed, ANS_TEST_MACHINE_ID: mid },
    stdio: ["ignore", "pipe", "inherit"],
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  const holder = child.pid;
  assert.ok(holder, "the lock holder must report a pid");

  await new Promise<void>((resolve, reject) => {
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += String(chunk);
      if (output.includes("locked")) resolve();
    });
    child.on("error", reject);
    child.on("exit", (code) => reject(new Error(`the holder exited before signalling: ${String(code)}`)));
  });
  // Armed before the signal: a child that dies between the two lines above would
  // otherwise never emit the `exit` we are waiting for.
  const killed = new Promise<void>((resolve) => child.on("exit", () => resolve()));
  child.kill("SIGKILL");
  await killed;
  await waitUntilGone(holder);

  // The killed run really left a published lock behind, owned by a pid that is gone.
  const lock = join(managed, ".installed.lock");
  assert.equal(JSON.parse(readFileSync(join(lock, "owner.json"), "utf8")).pid, holder);
  assert.ok(existsSync(lock));

  const installed = await f.run(["install", dir]);
  assert.equal(installed.code, 0, installed.stderr);
  assert.equal(f.manifest().skills.alpha.name, "alpha", "the reclaimer published its own entry");
  assert.deepEqual(
    readdirSync(managed).filter((entry) => entry !== "installed.json" && entry !== "alpha"),
    [],
    "no lock, pending directory, quarantine or staging residue survives the reclaim",
  );
});

test("a dead unpublished lock is cleaned during reconciliation", async (t) => {
  const f = fixture(t);
  const managed = managedSkillsRoot(f.opts);
  const identity = pidIdentity();
  const pending = join(managed, ".installed.lock.pending-dead01");
  mkdirSync(pending, { recursive: true });
  const mid = machineId();
  writeFileSync(join(pending, "owner.json"), JSON.stringify({
    token: "dead", pid: deadPid(), host: hostname(), startedAt: "2026-11-03T00:00:00.000Z",
    ...(mid ? { machineId: mid } : {}),
    ...(identity ? { bootId: identity.bootId, namespace: identity.namespace } : {}),
  }));
  const result = await f.run(["install", f.source()]);
  if (mid) {
    assert.equal(result.code, 0, result.stderr);
    assert.equal(existsSync(pending), false);
  } else {
    assert.equal(result.code, 0, result.stderr);
    assert.ok(existsSync(pending), "pending with no machineId is preserved when identity is unavailable");
  }
});

test("an unpublished lock directory does not block a scope or act as a lock", async (t) => {
  const f = fixture(t);
  const managed = managedSkillsRoot(f.opts);
  const pending = join(managed, ".installed.lock.pending-stale1");
  mkdirSync(pending, { recursive: true });
  writeFileSync(join(pending, "owner.json"), "{}");
  const installed = await f.run(["install", f.source()]);
  assert.equal(installed.code, 0, installed.stderr);
  assert.ok(existsSync(join(managed, "demo")));
  assert.ok(existsSync(pending), "pending residue is inert and preserved");
  const listed = await f.run(["list"]);
  assert.equal(listed.code, 0, listed.stderr);
  assert.match(listed.stdout, /demo/);
});

test("an old holder cannot release a lock that changed hands", (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "ans-lock-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const lock = plantLock(base, "new", process.pid);
  assert.equal(releaseOwnedLock(lock, "old"), false);
  assert.ok(existsSync(lock), "the replaced lock survives its old holder's release");
  assert.equal(releaseOwnedLock(lock, "new"), true);
  assert.equal(existsSync(lock), false);
});

test("rename retries transient sharing violations and rethrows permanent failures", () => {
  // The platform gate is an explicit declaration now: these injections simulate
  // Windows sharing violations, so every seam states `platform: "win32"`.
  const busy = Object.assign(new Error("busy"), { code: "EBUSY" });
  let attempts = 0;
  const delays: number[] = [];
  renameWithRetry("from", "to", {
    platform: "win32",
    rename: () => { attempts += 1; if (attempts < 3) throw busy; },
    sleep: (ms) => { delays.push(ms); },
    now: () => 0,
  });
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [10, 20], "backoff grows exponentially from 10ms");

  const denied = Object.assign(new Error("denied"), { code: "EPERM" });
  let clock = 0;
  let calls = 0;
  assert.throws(() => renameWithRetry("from", "to", {
    platform: "win32",
    rename: () => { calls += 1; throw denied; },
    sleep: (ms) => { clock += ms; },
    now: () => clock,
  }), (error) => error === denied);
  assert.ok(calls > 1);
  assert.ok(clock <= 60_000, "the retry budget is bounded");

  const missing = Object.assign(new Error("gone"), { code: "ENOENT" });
  let nonRetryable = 0;
  assert.throws(() => renameWithRetry("from", "to", {
    platform: "win32",
    rename: () => { nonRetryable += 1; throw missing; },
    sleep: () => assert.fail("ENOENT must not be retried"),
    now: () => 0,
  }), (error) => error === missing);
  assert.equal(nonRetryable, 1);
});

test("startup reconciliation removes installer residue only when no manifest exists", async (t) => {
  const f = fixture(t);
  const managed = managedSkillsRoot(f.opts);
  mkdirSync(join(managed, ".install-ab12cd", "payload"), { recursive: true });
  writeFileSync(join(managed, ".install-ab12cd", "payload", "SKILL.md"), "partial");
  writeFileSync(join(managed, ".installed-00000000-0000-4000-8000-000000000000.tmp"), "{}");
  const installed = await f.run(["install", f.source()]);
  assert.equal(installed.code, 0, installed.stderr);
  assert.deepEqual(readdirSync(managed).sort(), ["demo", "installed.json"]);

  mkdirSync(join(managed, ".install-ef34gh", "payload"), { recursive: true });
  writeFileSync(join(managed, ".installed-11111111-1111-4111-8111-111111111111.tmp"), "{}");
  const second = await f.run(["install", f.source("beta")]);
  assert.equal(second.code, 0, second.stderr);
  assert.ok(existsSync(join(managed, ".install-ef34gh")), "residue is never guessed away while a manifest exists");
  assert.ok(existsSync(join(managed, ".installed-11111111-1111-4111-8111-111111111111.tmp")));
});

test("installer lookalikes written by the operator are never treated as residue", async (t) => {
  const f = fixture(t);
  const managed = managedSkillsRoot(f.opts);
  mkdirSync(join(managed, ".install-archive"), { recursive: true });
  writeFileSync(join(managed, ".install-archive", "notes.md"), "operator notes");
  writeFileSync(join(managed, ".installed-notes.tmp"), "{}");
  // A prefix match would read this as inert bookkeeping; the exact shape says content.
  mkdirSync(join(managed, ".installed.lock.pending-notalock"));
  const expected = [".install-archive", ".installed-notes.tmp", ".installed.lock.pending-notalock"];

  const installed = await f.run(["install", f.source()]);
  assert.equal(installed.code, 1, installed.stdout + installed.stderr);
  assert.match(installed.stderr, /skill manifest is missing in a non-empty managed directory/);
  assert.deepEqual(readdirSync(managed).sort(), expected, "nothing was deleted or created");
  assert.equal(existsSync(skillManifestPath(f.opts)), false, "no manifest is bootstrapped beside operator content");

  const listed = await f.run(["list"]);
  assert.equal(listed.code, 1, listed.stdout + listed.stderr);
  assert.match(listed.stderr, /skill manifest is missing/);
  assert.deepEqual(readdirSync(managed).sort(), expected, "the read path stays read-only");

  const validated = await f.run(["validate"]);
  assert.equal(validated.code, 1, validated.stdout + validated.stderr);
  assert.deepEqual(readdirSync(managed).sort(), expected);
});

test("every installer-generated entry name matches its exact pattern", (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "ans-entries-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  // mkdtempSync appends six characters; CI proves on ubuntu and windows that the
  // charset stays inside [A-Za-z0-9], so the staging and pending shapes hold.
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const staging = basename(mkdtempSync(join(base, ".install-")));
    assert.ok(STAGING_ENTRY.test(staging), `staging name does not match: ${staging}`);
    const pending = basename(mkdtempSync(join(base, ".installed.lock.pending-")));
    assert.ok(LOCK_PENDING_ENTRY.test(pending), `pending name does not match: ${pending}`);
  }
  // writeManifest and the quarantine rename build their names from randomUUID().
  assert.ok(MANIFEST_TEMP_ENTRY.test(`.installed-${randomUUID()}.tmp`));
  assert.ok(QUARANTINE_ENTRY.test(`.installed.lock.reclaim-${randomUUID()}`));

  // The boundary is exact: near-misses are operator content, not installer residue.
  // randomUUID() only writes version-4 UUIDs, so another version or a non-RFC
  // variant nibble is not a name the installer can have produced.
  for (const name of [".install-archive", ".install-abc", ".install-abcdefg", ".install-ab12_d",
    ".installed-notes.tmp", `.installed-${randomUUID().toUpperCase()}.tmp`, ".installed-0000.tmp",
    ".installed-00000000-0000-3000-8000-000000000000.tmp",
    ".installed-00000000-0000-4000-7000-000000000000.tmp"]) {
    assert.equal(STAGING_ENTRY.test(name) || MANIFEST_TEMP_ENTRY.test(name), false, `treated as residue: ${name}`);
  }
  for (const name of [".installed.lock.pending-notalock", ".installed.lock.pending-abc",
    ".installed.lock.reclaim-notauuid", ".installed.lock.reclaiming",
    ".installed.lock.reclaim-00000000-0000-3000-8000-000000000000",
    ".installed.lock.reclaim-00000000-0000-4000-7000-000000000000"]) {
    assert.equal(LOCK_PENDING_ENTRY.test(name) || QUARANTINE_ENTRY.test(name), false, `treated as bookkeeping: ${name}`);
  }
});

test("a clean scope is unchanged by list and validate", async (t) => {
  const f = fixture(t);
  assert.equal((await f.run(["install", f.source()])).code, 0);
  const managed = managedSkillsRoot(f.opts);
  const before = readdirSync(managed).sort();
  assert.equal((await f.run(["list"])).code, 0);
  assert.equal((await f.run(["validate"])).code, 0);
  assert.deepEqual(readdirSync(managed).sort(), before, "reconciliation is a no-op on a clean scope");
  assert.equal(existsSync(join(managed, ".installed.lock")), false);
});

test("install survives transient rename failures and publishes a complete manifest", async (t) => {
  const f = fixture(t);
  const dir = f.source();
  let calls = 0;
  skillRenameIO.current = {
    rename: (from, to) => {
      calls += 1;
      if (calls <= 2) throw Object.assign(new Error("busy"), { code: "EBUSY" });
      renameSync(from, to);
    },
    sleep: () => {},
    now: () => 0,
  };
  try {
    const result = await f.run(["install", dir]);
    assert.equal(result.code, 0, result.stderr);
  } finally {
    skillRenameIO.current = undefined;
  }
  assert.ok(calls >= 3, "the rename was retried before committing");
  assert.equal(f.manifest().skills.demo.commit, git(f.repository, ["rev-parse", "HEAD"]));
  assert.deepEqual(readdirSync(managedSkillsRoot(f.opts)).sort(), ["demo", "installed.json"]);
});

test("a permanent rename failure keeps the original error and publishes no half manifest", async (t) => {
  const f = fixture(t);
  assert.equal((await f.run(["install", f.source()])).code, 0);
  const managed = managedSkillsRoot(f.opts);
  const manifestBefore = readFileSync(skillManifestPath(f.opts), "utf8");
  const dir = f.source("beta");
  const denied = Object.assign(new Error("denied by test"), { code: "EPERM" });
  let clock = 0;
  skillRenameIO.current = {
    rename: () => { throw denied; },
    sleep: (ms) => { clock += ms; },
    now: () => clock,
  };
  try {
    const result = await f.run(["install", dir]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /denied by test/);
  } finally {
    skillRenameIO.current = undefined;
  }
  assert.equal(readFileSync(skillManifestPath(f.opts), "utf8"), manifestBefore);
  assert.equal(existsSync(join(managed, "beta")), false);
  assert.deepEqual(readdirSync(managed).sort(), ["demo", "installed.json"]);
});

test("manifest publication retries transient failures", async (t) => {
  const f = fixture(t);
  const dir = f.source();
  let failures = 0;
  skillRenameIO.current = {
    rename: (from, to) => {
      if (to.endsWith("installed.json") && failures < 2) {
        failures += 1;
        throw Object.assign(new Error("busy"), { code: "EBUSY" });
      }
      renameSync(from, to);
    },
    sleep: () => {},
    now: () => 0,
  };
  try {
    assert.equal((await f.run(["install", dir])).code, 0);
  } finally {
    skillRenameIO.current = undefined;
  }
  assert.equal(failures, 2);
  assert.equal(f.manifest().skills.demo.commit, git(f.repository, ["rev-parse", "HEAD"]));
});

test("permanent manifest publication failure rolls back the published directory", async (t) => {
  const f = fixture(t);
  const dir = f.source();
  const denied = Object.assign(new Error("denied by test"), { code: "EPERM" });
  let clock = 0;
  skillRenameIO.current = {
    rename: (from, to) => {
      if (to.endsWith("installed.json")) throw denied;
      renameSync(from, to);
    },
    sleep: (ms) => { clock += ms; },
    now: () => clock,
  };
  try {
    const result = await f.run(["install", dir]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /denied by test/);
  } finally {
    skillRenameIO.current = undefined;
  }
  const managed = managedSkillsRoot(f.opts);
  assert.equal(existsSync(join(managed, "demo")), false, "the published directory is rolled back");
  assert.equal(existsSync(skillManifestPath(f.opts)), false, "no partial manifest is published");
  assert.deepEqual(readdirSync(managed), []);
});

test("uninstall retries a transient backup rename", async (t) => {
  const f = fixture(t);
  assert.equal((await f.run(["install", f.source()])).code, 0);
  let failures = 0;
  skillRenameIO.current = {
    // EPERM is only retryable under the win32 gate, so the test declares it.
    platform: "win32",
    rename: (from, to) => {
      if (to.includes(".uninstall-") && failures < 2) {
        failures += 1;
        throw Object.assign(new Error("denied"), { code: "EPERM" });
      }
      renameSync(from, to);
    },
    sleep: () => {},
    now: () => 0,
  };
  try {
    assert.equal((await f.run(["uninstall", "demo"])).code, 0);
  } finally {
    skillRenameIO.current = undefined;
  }
  assert.equal(failures, 2);
  assert.deepEqual(f.manifest().skills, {});
});

test("uninstall restores the directory when manifest publication fails", async (t) => {
  const f = fixture(t);
  assert.equal((await f.run(["install", f.source()])).code, 0);
  const managed = managedSkillsRoot(f.opts);
  const manifestBefore = readFileSync(skillManifestPath(f.opts), "utf8");
  const denied = Object.assign(new Error("denied by test"), { code: "EPERM" });
  let clock = 0;
  skillRenameIO.current = {
    rename: (from, to) => {
      if (to.endsWith("installed.json")) throw denied;
      renameSync(from, to);
    },
    sleep: (ms) => { clock += ms; },
    now: () => clock,
  };
  try {
    const result = await f.run(["uninstall", "demo"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /denied by test/);
  } finally {
    skillRenameIO.current = undefined;
  }
  assert.ok(existsSync(join(managed, "demo", "SKILL.md")), "the backup is restored");
  assert.equal(readFileSync(skillManifestPath(f.opts), "utf8"), manifestBefore);
  assert.deepEqual(readdirSync(managed).sort(), ["demo", "installed.json"]);
});

test("uninstall backups are never auto-deleted and list reports the restore hint", async (t) => {
  const f = fixture(t);
  assert.equal((await f.run(["install", f.source()])).code, 0);
  const managed = managedSkillsRoot(f.opts);
  renameSync(join(managed, "demo"), join(managed, ".uninstall-abc"));
  const listed = await f.run(["list"]);
  assert.equal(listed.code, 0, listed.stderr);
  assert.match(listed.stderr, /demo/);
  assert.match(listed.stderr, /\.uninstall-abc/);
  const validated = await f.run(["validate"]);
  assert.equal(validated.code, 1);
  assert.match(validated.stderr, /\.uninstall-abc/, "validate also reports the restore hint");
  assert.ok(existsSync(join(managed, ".uninstall-abc", "SKILL.md")));
  assert.ok(f.manifest().skills.demo);
  const second = await f.run(["install", f.source("beta")]);
  assert.equal(second.code, 0, second.stderr);
  assert.ok(existsSync(join(managed, ".uninstall-abc", "SKILL.md")), "backups survive other mutations");
});

test("concurrent installers reclaiming a dead lock keep the manifest consistent", async (t) => {
  if (!machineId()) { t.skip("machineId unavailable"); return; }
  const f = fixture(t);
  const names = ["alpha", "beta", "gamma", "delta"];
  const dirs = names.map((name) => f.source(name));
  const managed = managedSkillsRoot(f.opts);
  mkdirSync(managed, { recursive: true });
  plantLock(managed, "dead", deadPid());
  const script = join(f.base, "concurrent-install.mjs");
  const source = new URL("../src/commands/skill.ts", import.meta.url).href;
  writeFileSync(script, `
import { existsSync, writeFileSync } from "node:fs";
import { runSkill } from ${JSON.stringify(source)};
const [home, cwd, barrier, ready, dir] = process.argv.slice(2);
const wait = new Int32Array(new SharedArrayBuffer(4));
const deadline = Date.now() + 20000;
writeFileSync(ready, "");
while (!existsSync(barrier) && Date.now() < deadline) Atomics.wait(wait, 0, 0, 10);
process.exit(await runSkill(["install", dir], { home, cwd, stdout: () => {}, stderr: (text) => process.stderr.write(text) }));
`);
  const barrier = join(f.base, "start");
  const ready = dirs.map((_, index) => join(f.base, `ready-${index}`));
  const children = dirs.map((dir, index) => spawn(
    process.execPath,
    ["--import", "tsx", script, f.home, f.cwd, barrier, ready[index], dir],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: ["ignore", "ignore", "pipe"] },
  ));
  // Release the children together only after every one has loaded tsx, so the
  // reclaim races actually overlap instead of running one after another.
  const pause = new Int32Array(new SharedArrayBuffer(4));
  const readyDeadline = Date.now() + 10000;
  while (!ready.every((path) => existsSync(path)) && Date.now() < readyDeadline) {
    Atomics.wait(pause, 0, 0, 20);
  }
  writeFileSync(barrier, "");
  const outcomes = await Promise.all(children.map((child) => new Promise<{ code: number; stderr: string }>((resolve, reject) => {
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code: code ?? 1, stderr }));
  })));
  const detail = outcomes.map((outcome) => `${outcome.code}: ${outcome.stderr.trim()}`).join(" | ");
  assert.ok(outcomes.some((outcome) => outcome.code === 0), `at least one installer must win: ${detail}`);
  const manifest = f.manifest();
  for (const name of names) {
    assert.equal(Boolean(manifest.skills[name]), existsSync(join(managed, name)),
      `${name}: manifest and directory must agree (${detail})`);
  }
  const leftovers = readdirSync(managed).filter((entry) => entry !== "installed.json" && !names.includes(entry));
  assert.deepEqual(leftovers, [], "no lock, staging or temp residue survives the race");
});
