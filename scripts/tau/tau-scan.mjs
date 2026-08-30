#!/usr/bin/env node
// ADR-0039 D3: zero-dependency thin launcher for the tau sensitivity scan (eval-judge.mjs
// pattern). Spawns tsx for the TS core; the scan never runs through the eval runner and
// never touches the OF look ledger (ANS_EVAL_NO_LOOK set defensively).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const child = spawn(
  process.execPath,
  ["--import", "tsx", path.join("src", "eval", "tau-scan-cli.ts"), ...process.argv.slice(2)],
  { cwd: path.join(ROOT, "packages", "store"), stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, ANS_EVAL_NO_LOOK: "1" } }
);
child.on("close", (code) => process.exit(code ?? 2));
