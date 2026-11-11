#!/usr/bin/env node
// Make sure `apps/mcp/dist/index.cjs` exists before `apps/cli` tests run.
//
// Why (issue #256): `ans mcp` forwards to that file
// (`apps/cli/src/commands/mcp.ts`) and `e2e.test.ts` drives `ans mcp --help`.
// `apps/mcp` is not a dependency of `apps/cli`, so turbo has no edge between
// `@anysearch-cli/mcp#build` and `@anysearch-cli/cli#test`.
//
// Building only when the file is missing keeps the common `turbo run test`
// path from building mcp twice (turbo already ran `mcp#build`). It narrows,
// but does not remove, the window where this build overlaps turbo's own
// mcp#build: tsup cleans the output dir first, so the two must not run at the
// same moment. In practice turbo's mcp#build finishes well before cli#test
// starts; `pnpm -r test` has no second mcp builder at all.
//
// Node stdlib only, like the other scripts/ gates.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const CLI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(CLI_DIR, "..", "..");
const TARGET = path.join(REPO_ROOT, "apps", "mcp", "dist", "index.cjs");

if (fs.existsSync(TARGET)) {
  process.exit(0);
}

process.stdout.write("ensure-mcp-dist: apps/mcp/dist/index.cjs missing, building it (ans mcp forwards to it)\n");
const r = spawnSync("pnpm", ["-C", "apps/mcp", "run", "build"], {
  cwd: REPO_ROOT,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (r.status !== 0) {
  process.stderr.write("ensure-mcp-dist: apps/mcp build failed (exit " + (r.status ?? 1) + ")\n");
  process.exit(r.status ?? 1);
}
if (!fs.existsSync(TARGET)) {
  process.stderr.write("ensure-mcp-dist: build reported success but " + TARGET + " is still missing\n");
  process.exit(1);
}
