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
