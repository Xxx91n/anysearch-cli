// #305: the HTTP MCP transport has no per-request workspace.
//
// A long-running HTTP server serves many callers, so its own working directory
// must not stand in for their projects (S3). This file is separate from
// recall-project-scope.test.ts because the transport marker is process-wide.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRecallProjects } from "../src/project-index.js";
import { markHttpTransport } from "../src/transport-mode.js";

function project(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ans-mcp-http-" + tag + "-"));
  mkdirSync(join(dir, ".ans"), { recursive: true });
  writeFileSync(join(dir, ".ans", "config.toml"), "", "utf8");
  return dir;
}

test("HTTP transport: implicit scope is unavailable, explicit projectPaths still works", () => {
  const previousCwd = process.cwd();
  const current = project("scope");
  process.chdir(current);
  markHttpTransport();
  try {
    const implicit = resolveRecallProjects();
    assert.deepEqual(implicit.projects, []);
    assert.match(implicit.notes.join("; "), /HTTP MCP server has no per-request workspace/);
    const explicit = resolveRecallProjects([current]);
    assert.deepEqual(explicit.projects, [realpathSync(current)], "projectPaths still works on HTTP");
  } finally {
    process.chdir(previousCwd);
    rmSync(current, { recursive: true, force: true });
  }
});
