// #304 — `ans search` bills this run's own task.
//
// What this pins:
//   - an unset ANS_DOMAIN still reads the DEFAULT domain's declared [budget]:
//     the historical full fanout for provider selection does not silently drop
//     the operator's cap (the same `ANS_DOMAIN || "default"` rule `ans chat`
//     and `ans consolidate` use);
//   - one executed search = one `cli.search` task with its own budget row;
//   - a refused cap stops before any provider request and exits non-zero.
//
// The search arm is a local JSON-RPC endpoint, so no key and no network are
// needed. The engine is the real one: reserve→settle is exercised, not faked.
//
// Run: pnpm --filter @anysearch-cli/cli test

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openTaskRegistry } from "@anysearch-cli/store";
import { runSearch } from "../src/commands/search.js";
import { runWithCliTask } from "../src/cli-task-context.js";

const dir = mkdtempSync(join(tmpdir(), "ans-304-search-"));
const domainsDir = join(dir, "domains");
const dbPath = join(dir, "cli.db");
mkdirSync(domainsDir, { recursive: true });
const ENV_KEYS = ["ANS_DB_PATH", "ANS_DOMAINS_DIR", "ANS_DOMAIN", "USERPROFILE", "HOME", "ANS_PROVIDERS", "ANYSEARCH_ENDPOINT", "ANYSEARCH_API_KEY"];
const previousEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) previousEnv[key] = process.env[key];
process.env.ANS_DB_PATH = dbPath;
process.env.ANS_DOMAINS_DIR = domainsDir;
process.env.USERPROFILE = dir;
process.env.HOME = dir;
process.env.ANS_PROVIDERS = "anysearch";
delete process.env.ANS_DOMAIN;

let requests = 0;
let server: Server | undefined;

function writeDefaultDomain(callCap: number): void {
  writeFileSync(join(domainsDir, "default.toml"), [
    'name = "default"',
    'sources = { enabled = ["anysearch"], urlAllowlist = ["print.example"] }',
    'prompts = [{ name = "system", content = "SEARCH-DEFAULT." }]',
    'skills = { active = ["search"] }',
    'hooks = { toolWhitelist = ["search"] }',
    'rag = { adapter = "none" }',
    "[budget]",
    "tokenCap = 20000",
    "callCap = " + callCap,
  ].join("\n") + "\n", "utf8");
}

async function run(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  let out = "";
  let err = "";
  (process.stdout as any).write = (chunk: any) => { out += String(chunk); return true; };
  (process.stderr as any).write = (chunk: any) => { err += String(chunk); return true; };
  try {
    const code = await runSearch(argv);
    return { code, out, err };
  } finally {
    (process.stdout as any).write = realOut;
    (process.stderr as any).write = realErr;
  }
}

function readRows<T>(sql: string, ...params: any[]): T[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

test.after(() => {
  for (const key of ENV_KEYS) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
  try { server?.close(); } catch { /* already closed */ }
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
});

test("search under a registered task bills that task; default domain caps it", async () => {
  writeDefaultDomain(20);
  server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    let call: any = {};
    try { call = JSON.parse(body); } catch { /* ignore */ }
    if (call.method === "initialize") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result: { protocolVersion: call.params?.protocolVersion } }));
      return;
    }
    if (call.method === "tools/call") {
      requests++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0", id: call.id,
        result: { structuredContent: { results: [{ url: "https://print.example/source", title: "print", snippet: "s" }] } },
      }));
      return;
    }
    res.writeHead(202).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  process.env.ANYSEARCH_ENDPOINT = "http://127.0.0.1:" + port + "/mcp";
  process.env.ANYSEARCH_API_KEY = "print-test-key";

  const registry = openTaskRegistry(dbPath);
  try {
    const task = registry.registerTask({ kind: "cli.search", role: "business", entry: "cli" });
    const r = await runWithCliTask(
      { taskId: task.taskId, kind: "cli.search", role: "business", attachSession: () => {} },
      () => run(["anysearch-cli GitHub repository", "--json"]),
    );
    assert.equal(r.code, 0, "stderr: " + r.err);
    // The test runner shares this stdout, so assert the JSON contract without
    // slicing the whole buffer: the pretty-printed document always carries the
    // results array and the URL the fake provider returned.
    assert.match(r.out, /"results":\s*\[/, "stdout carries the search JSON");
    assert.match(r.out, /print\.example/, "the provider result is in the output");
    assert.equal(requests, 1, "one provider request");

    const budgets = readRows<{ calls: number; reserved: number; configured: number }>(
      "SELECT billable_calls AS calls, reserved_calls AS reserved, configured FROM task_budgets WHERE task_id = ?",
      task.taskId,
    );
    assert.equal(budgets.length, 1, "the default domain's [budget] reached the task (not silently dropped)");
    assert.equal(Number(budgets[0]?.configured), 1);
    assert.ok(Number(budgets[0]?.calls) >= 1, "the provider call was billed");
    assert.equal(Number(budgets[0]?.reserved), 0, "the reservation was settled");
    const sessionRows = readRows<{ n: number }>("SELECT COUNT(*) AS n FROM budget_ledger");
    assert.equal(sessionRows[0]?.n, 0, "a bare search opens no session budget row");
    task.finish({ exitCode: 0 });
  } finally {
    registry.close();
  }
});

test("a refused cap stops before the provider request", async () => {
  writeDefaultDomain(0);
  const before = requests;
  const registry = openTaskRegistry(dbPath);
  try {
    const task = registry.registerTask({ kind: "cli.search", role: "business", entry: "cli" });
    const r = await runWithCliTask(
      { taskId: task.taskId, kind: "cli.search", role: "business", attachSession: () => {} },
      () => run(["anysearch-cli GitHub repository"]),
    );
    assert.equal(r.code, 1);
    assert.match(r.err, /stopped by this run's task budget/);
    assert.equal(requests, before, "no provider request was sent");
    const budgets = readRows<{ calls: number; reserved: number }>(
      "SELECT billable_calls AS calls, reserved_calls AS reserved FROM task_budgets WHERE task_id = ?",
      task.taskId,
    );
    assert.equal(budgets.length, 1, "the refused run still owns its budget row");
    assert.equal(Number(budgets[0]?.calls), 0);
    assert.equal(Number(budgets[0]?.reserved), 0, "the refusal left no phantom reservation");
  } finally {
    registry.close();
  }
});

test("a broken default domain TOML fails closed instead of dropping its budget", async () => {
  // A configured-but-broken domain is not an absence: treating it as "no
  // budget" would ignore a declared cap while still fanning out.
  writeFileSync(join(domainsDir, "default.toml"), 'name = "default"\nsources = { enabled = [ }\n', "utf8");
  const before = requests;
  const registry = openTaskRegistry(dbPath);
  try {
    const task = registry.registerTask({ kind: "cli.search", role: "business", entry: "cli" });
    await assert.rejects(
      withTask(task, () => run(["anysearch-cli GitHub repository"])),
      /Domain schema:/,
    );
    assert.equal(requests, before, "no provider request was sent");
  } finally {
    registry.close();
    writeDefaultDomain(20);
  }
});
