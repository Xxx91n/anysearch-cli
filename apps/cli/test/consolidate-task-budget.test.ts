// #304 — `ans consolidate` bills this run's own task.
//
// What this pins:
//   - materials from several chats, or a memory list with no owning session,
//     are charged to the run's task; no single conversation is picked to pay;
//   - a declared [budget] that cannot be established stops the run before any
//     model call instead of quietly running unmetered;
//   - an undeclared domain says it is unmetered and invents no row.
//
// No model call is made: with no LLM configured the run still scans and reports
// llmUnavailable, which is enough to prove WHICH budget row the run was wired
// to. The real calls' reserve/settle is the shared seam already covered by the
// chat wiring tests.
//
// Run: pnpm --filter @anysearch-cli/cli test

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openTaskRegistry } from "@anysearch-cli/store";
import { runConsolidate } from "../src/commands/consolidate.js";
import { runWithCliTask } from "../src/cli-task-context.js";

const dir = mkdtempSync(join(tmpdir(), "ans-304-cli-"));
const domainsDir = join(dir, "domains");
mkdirSync(domainsDir, { recursive: true });
writeFileSync(join(domainsDir, "taskbudget.toml"), [
  'name = "taskbudget"',
  'sources = { enabled = [] }',
  'prompts = [{ name = "system", content = "TASKBUDGET-SYSTEM." }]',
  'skills = { active = ["search"] }',
  'hooks = { toolWhitelist = ["search"] }',
  'rag = { adapter = "none" }',
  "[budget]",
  "tokenCap = 100000",
  "callCap = 20",
].join("\n") + "\n", "utf8");
writeFileSync(join(domainsDir, "nobudget.toml"), [
  'name = "nobudget"',
  'sources = { enabled = [] }',
  'prompts = [{ name = "system", content = "NOBUDGET-SYSTEM." }]',
  'skills = { active = ["search"] }',
  'hooks = { toolWhitelist = ["search"] }',
  'rag = { adapter = "none" }',
].join("\n") + "\n", "utf8");

const dbPath = join(dir, "cli.db");
const ENV_KEYS = [
  "ANS_DB_PATH", "ANS_DOMAINS_DIR", "ANS_DOMAIN", "USERPROFILE", "HOME",
  "ANS_LLM_PROVIDER", "ANS_LLM_MODEL", "ANS_LLM_BASE_URL", "ANS_LLM_API", "ANS_LLM_API_KEY",
];
const previousEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) previousEnv[key] = process.env[key];
process.env.ANS_DB_PATH = dbPath;
process.env.ANS_DOMAINS_DIR = domainsDir;
process.env.ANS_DOMAIN = "taskbudget";
process.env.USERPROFILE = dir;
process.env.HOME = dir;
for (const key of ["ANS_LLM_PROVIDER", "ANS_LLM_MODEL", "ANS_LLM_BASE_URL", "ANS_LLM_API", "ANS_LLM_API_KEY"]) {
  delete process.env[key];
}

async function run(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  let out = "";
  let err = "";
  (process.stdout as any).write = (chunk: any) => { out += String(chunk); return true; };
  (process.stderr as any).write = (chunk: any) => { err += String(chunk); return true; };
  try {
    const code = await runConsolidate(argv);
    return { code, out, err };
  } finally {
    (process.stdout as any).write = realOut;
    (process.stderr as any).write = realErr;
  }
}

function withTask<T>(task: { taskId: string }, fn: () => Promise<T>): Promise<T> {
  return runWithCliTask(
    { taskId: task.taskId, kind: "cli.consolidate", role: "business", attachSession: () => {} },
    fn,
  );
}

function readRows<T>(sql: string, ...params: any[]): T[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

test("several session owners: the run bills its task, not the first chat", async () => {
  const registry = openTaskRegistry(dbPath);
  try {
    const task = registry.registerTask({ kind: "cli.consolidate", role: "business", entry: "cli" });
    const r = await withTask(task, () => run(["--session", "alpha", "--session", "beta", "--dry-run"]));
    assert.equal(r.code, 0, "stderr: " + r.err);
    assert.doesNotMatch(r.out, /budget: unmetered/,
      "the run must not call itself unmetered just because several chats own the materials");
    const budgets = readRows<{ id: string; configured: number; calls: number; reserved: number }>(
      "SELECT task_id AS id, configured, billable_calls AS calls, reserved_calls AS reserved FROM task_budgets WHERE task_id = ?",
      task.taskId,
    );
    assert.equal(budgets.length, 1, "the task carries the declared caps");
    assert.equal(Number(budgets[0]?.configured), 1);
    assert.equal(Number(budgets[0]?.calls), 0, "no model call was made, so nothing is billed");
    assert.equal(Number(budgets[0]?.reserved), 0, "no reservation is left hanging");
    const sessions = readRows<{ n: number }>(
      "SELECT COUNT(*) AS n FROM budget_ledger WHERE session_id IN ('alpha', 'beta')",
    );
    assert.equal(sessions[0]?.n, 0, "neither conversation's account was opened for this run");
    task.finish({ exitCode: 0 });
  } finally {
    registry.close();
  }
});

test("a memory list has no owning session, yet the run is still metered", async () => {
  const registry = openTaskRegistry(dbPath);
  try {
    const task = registry.registerTask({ kind: "cli.consolidate", role: "business", entry: "cli" });
    const r = await withTask(task, () => run(["--memory", "1", "--dry-run"]));
    assert.equal(r.code, 0, "stderr: " + r.err);
    assert.doesNotMatch(r.out, /budget: unmetered/);
    const budgets = readRows<{ configured: number }>(
      "SELECT configured FROM task_budgets WHERE task_id = ?", task.taskId,
    );
    assert.equal(budgets.length, 1, "the memory-scoped run gets the same task budget");
    assert.equal(Number(budgets[0]?.configured), 1);
  } finally {
    registry.close();
  }
});

test("declared budget with no registered task: stop before any model call", async () => {
  const r = await run(["--session", "alpha", "--dry-run"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /task budget could not be established/);
  assert.doesNotMatch(r.out, /scanned \d+ cluster/,
    "the run must stop instead of proceeding unmetered");
});

test("declared budget whose row cannot be established: stop before any model call", async () => {
  const r = await withTask({ taskId: "cli-never-registered" }, () =>
    run(["--session", "alpha", "--dry-run"]));
  assert.equal(r.code, 1);
  assert.match(r.err, /task budget could not be established/);
  assert.match(r.err, /establishment failed/);
});

test("undeclared domain: the run says it is unmetered and invents no row", async () => {
  process.env.ANS_DOMAIN = "nobudget";
  const registry = openTaskRegistry(dbPath);
  try {
    const task = registry.registerTask({ kind: "cli.consolidate", role: "business", entry: "cli" });
    const r = await withTask(task, () => run(["--session", "alpha", "--dry-run"]));
    assert.equal(r.code, 0, "stderr: " + r.err);
    assert.match(r.out, /budget: unmetered — this run declared no \[budget\] caps/);
    const budgets = readRows<{ id: string }>("SELECT task_id AS id FROM task_budgets WHERE task_id = ?", task.taskId);
    assert.equal(budgets.length, 0, "no caps were declared, so no budget row is written");
  } finally {
    registry.close();
    process.env.ANS_DOMAIN = "taskbudget";
  }
});

test.after(() => {
  for (const key of ENV_KEYS) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
});
