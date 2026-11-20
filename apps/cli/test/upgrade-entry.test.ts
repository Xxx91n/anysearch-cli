// #309 — the real CLI entry, spawned as a process, refuses a BUSINESS command
// while upgrade admission is closed.
//
// Why spawn instead of calling trackCliCommand: the contract is the process's
// exit code and stderr. A unit test that calls the tracker proves the plumbing;
// this proves that index.ts actually stops the command *before its handler*
// (exit 4) and that `ans upgrade status` still runs inside the same pause.
//
// Spawns the SOURCE entry through tsx, like the existing e2e "same product
// launcher" case — no dist build required.
//
// Run: pnpm --filter @anysearch-cli/cli test

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openTaskRegistry } from "@anysearch-cli/store";

const here = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.resolve(here, "..", "src", "index.ts");

interface RunResult { code: number; out: string }

function run(args: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", ENTRY, ...args], {
      stdio: ["ignore", "pipe", "pipe"], env, cwd,
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { out += d.toString(); });
    // A real wall-clock watchdog, deliberately: the thing under test is a real
    // child process, so there is no injectable clock here. Same shape (and
    // bound) as the existing e2e spawn helper.
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("timeout: ans " + args.join(" ")));
    }, 20_000);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, out }); });
  });
}

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log("  PASS " + label); }
  else { failed++; console.error("  FAIL " + label + (detail ? ": " + detail : "")); }
}

async function main(): Promise<void> {
  const work = mkdtempSync(path.join(tmpdir(), "ans-309-entry-"));
  const dbPath = path.join(work, "anysearch.db");
  // Run from the CLI package so the source entry's imports resolve (the same
  // cwd e2e.test.ts uses for its "source entry" case). The sandbox above still
  // owns HOME / USERPROFILE / ANS_DB_PATH, so no real user state is touched.
  const project = path.resolve(here, "..");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: work,
    USERPROFILE: work,
    ANS_DB_PATH: dbPath,
    ANS_DOMAINS_DIR: path.join(work, "domains"),
    ANS_NO_INTERACTIVE: "1",
  };
  try {
    const registry = openTaskRegistry(dbPath);
    try {
      // 1. Admission open: a management command runs normally.
      {
        const r = await run(["upgrade", "status"], env, project);
        check("1: `ans upgrade status` runs while admission is open", r.code === 0, "code=" + r.code + " out=" + r.out);
        check("1: status reports admission is open", /准入：开着/.test(r.out), r.out);
      }

      // 2. Close admission from the CLI itself, then a BUSINESS command stops.
      {
        const close = await run(["upgrade", "wait", "--timeout", "0"], env, project);
        check("2: `upgrade wait` pauses new tasks", registry.gateState() !== null);
        // Wait with 0ms and no work open succeeds; re-close for the refusal case.
        if (registry.gateState() === null) registry.openGate({ note: "entry test" });
        check("2: admission is closed for the next case", registry.gateState() !== null, "wait code=" + close.code);
      }
      {
        const r = await run(["search", "REFUSED-QUERY"], env, project);
        check("2: a business command exits 4 while admission is closed", r.code === 4, "code=" + r.code + " out=" + r.out);
        check("2: the refusal names the pause as a pause", /升级中/.test(r.out) && /不会排队/.test(r.out), r.out);
        check("2: the refusal says it did not start", /本次没有开始/.test(r.out), r.out);
        // Nothing ran: no search task row exists.
        const searchRows = registry.openTasks().filter((t) => t.kind === "cli.search");
        check("2: the refused command wrote no task row", searchRows.length === 0,
          JSON.stringify(searchRows.map((t) => t.taskId)));
      }

      // 3. Management commands keep working inside the same pause.
      {
        const r = await run(["upgrade", "status"], env, project);
        check("3: `upgrade status` runs while admission is closed", r.code === 1 || r.code === 0,
          "code=" + r.code + " out=" + r.out);
        check("3: status says admission is closed", /准入：关着/.test(r.out), r.out);
      }

      // 4. `upgrade cancel` reopens, and the same command runs again.
      {
        const r = await run(["upgrade", "cancel"], env, project);
        check("4: `upgrade cancel` exits 0", r.code === 0, "code=" + r.code + " out=" + r.out);
        check("4: admission is open again", registry.gateState() === null);
      }
    } finally {
      registry.close();
    }

    // 5. `ans upgrade --help` lists the commands and says it replaces nothing.
    {
      const r = await run(["upgrade", "--help"], env, project);
      check("5: --help exits 0", r.code === 0);
      for (const cmd of ["status", "wait", "install", "finish", "cancel", "dismiss", "prune"]) {
        check("5: help lists " + cmd, r.out.includes(cmd), r.out);
      }
      check("5: help says it does not replace program files", /不替换程序文件/.test(r.out), r.out);
      // #311: the way in when the global command itself is unusable.
      check("5: help names the by-path migration entry", r.out.includes("dist/migrate-install.js"), r.out);
    }
  } finally {
    try { rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* best effort */ }
  }

  console.log("\nupgrade entry tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("upgrade entry test threw:", e);
  process.exit(1);
});

// Keep assert import used (a thrown assert is the loudest failure path in the
// spawn helpers above).
void assert;
