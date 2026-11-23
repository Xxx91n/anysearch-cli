// Generated-config drift — scripts/gen-claude-configs.mjs writes the Claude and
// Codex templates plus the plugin skeleton from one spec. This check
// regenerates them into a temp dir and compares every emitted file with the
// version committed in HEAD.
//
// Why HEAD and not the working tree: `pnpm test` from the repo root runs
// `gen:configs` before the tests (the build task), so a hand-edited file is
// overwritten and a worktree comparison always agrees. HEAD is the copy a
// build cannot wash. A file the generator emits but HEAD lacks fails here:
// commit the regenerated file.
//
// Without git or HEAD (a source tarball) the check skips and says why — it
// must not pass silently, because there is nothing to compare against.

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("  PASS " + name); }
  catch (e) { failed++; console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message : String(e))); }
}

const PLUGIN_ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

function headAvailable(): boolean {
  const r = spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" });
  return !r.error && r.status === 0;
}

function gitShow(relPath: string): { ok: boolean; bytes?: Buffer } {
  const r = spawnSync("git", ["show", "HEAD:apps/plugin/" + relPath], { cwd: REPO_ROOT });
  return r.error || r.status !== 0 ? { ok: false } : { ok: true, bytes: r.stdout };
}

test("generated configs match HEAD byte for byte", () => {
  if (!headAvailable()) {
    console.log("    SKIP: no git or HEAD here (source tarball?) — nothing to compare the generator output against");
    return;
  }
  const tmp = mkdtempSync(join(tmpdir(), "ans-gen-head-"));
  try {
    const run = spawnSync(process.execPath, [join(PLUGIN_ROOT, "scripts", "gen-claude-configs.mjs")], {
      encoding: "utf8",
      env: { ...process.env, ANS_GEN_OUT: tmp },
    });
    assert.equal(run.status, 0, "generator must run clean: " + run.stderr.slice(0, 200));
    // The file list comes from what the generator actually wrote, so a new
    // artifact is covered without editing this test.
    const files = readdirSync(tmp, { recursive: true })
      .map(String)
      .filter((rel) => statSync(join(tmp, rel)).isFile())
      .map((rel) => rel.split("\\").join("/"))
      .sort();
    assert.ok(files.length > 0, "generator produced no files");
    for (const file of files) {
      const committed = gitShow(file);
      assert.ok(committed.ok, file + " is generated but not committed — add it to the commit");
      assert.ok(
        committed.bytes.equals(readFileSync(join(tmp, file))),
        file + " drifted from HEAD — regenerate it (pnpm -C apps/plugin gen:configs) and commit the change",
      );
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

process.on("exit", () => {
  console.log("  config-drift: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exitCode = 1;
});
