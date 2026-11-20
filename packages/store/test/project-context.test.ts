import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProjectContext } from "../src/project-context";

test("project identity: nested paths, worktree markers, aliases, unknown directories", () => {
  const dir = mkdtempSync(join(tmpdir(), "ans-project-"));
  try {
    const project = join(dir, "project");
    const nested = join(project, "src");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(project, ".git"), "gitdir: elsewhere");
    assert.deepEqual(resolveProjectContext(nested), { root: realpathSync(project), source: "git" });
    const alias = join(dir, "alias");
    symlinkSync(project, alias, process.platform === "win32" ? "junction" : "dir");
    assert.equal(resolveProjectContext(alias).root, realpathSync(project));
    const configured = join(dir, "configured");
    mkdirSync(join(configured, ".ans"), { recursive: true });
    writeFileSync(join(configured, ".ans", "config.toml"), "");
    assert.deepEqual(resolveProjectContext(configured), { root: realpathSync(configured), source: "config" });
    assert.equal(resolveProjectContext(join(dir, "missing")).root, null);
    assert.equal(resolveProjectContext(dir).root, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("project identity: the user root is not a project, even with ~/.ans/config.toml", () => {
  // `ans llm set` writes `~/.ans/config.toml`, and that path is now also the
  // project marker. Accepting it would make the home directory the project of
  // every directory above a Git root — all of them landing in one project_path.
  const previous = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME };
  const home = mkdtempSync(join(tmpdir(), "ans-home-root-"));
  try {
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    mkdirSync(join(home, ".ans"), { recursive: true });
    writeFileSync(join(home, ".ans", "config.toml"), "[llm]\nprovider = \"openai\"\n");

    assert.equal(resolveProjectContext(home).root, null, "the home directory itself");
    const child = join(home, "scratch");
    mkdirSync(child, { recursive: true });
    assert.equal(resolveProjectContext(child).root, null, "a directory below it");
  } finally {
    if (previous.USERPROFILE === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previous.USERPROFILE;
    if (previous.HOME === undefined) delete process.env.HOME;
    else process.env.HOME = previous.HOME;
    rmSync(home, { recursive: true, force: true });
  }
});
