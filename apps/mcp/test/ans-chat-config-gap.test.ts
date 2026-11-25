// #581 acceptance — an ans_chat call that cannot run has no side effects.
//
// The missing-model path resolves config, writes one finished task row, writes
// one observation, and stops. The proof here is a before/after snapshot of every
// table in a real temp SQLite file, not "the model factory was not called":
// sessions, the budget ledger, reservations, task budgets and usage must all
// stay exactly as they were.
//
// The same call also has to say WHICH file is half-written and WHICH field is
// missing; a generic "not configured" would hide that (#581).
//
// Run: pnpm --filter @anysearch-cli/mcp test

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteObservationStore, SqliteSessionStore, resolveLlmConfig } from "@anysearch-cli/store";
import type { CompositionResult } from "@anysearch-cli/kernel";
import type { McpServer } from "@modelcontextprotocol/server";
import { registerAnsChat } from "../src/tools/ans-chat.tool.js";
import { createMcpToolState } from "../src/tool-state.js";
import { resetMcpTaskWarnings } from "../src/mcp-task.js";

/** The fields of the tool result this test reads; the rest of the shape is not under test. */
interface ToolResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: Array<{ type: string; text: string }>;
}

const ENV_KEYS = [
  "HOME", "USERPROFILE", "ANS_DB_PATH", "ANS_PI_SESSION_DIR", "ANS_DOMAIN", "ANS_DOMAINS_DIR",
  "ANS_LLM_PROVIDER", "ANS_LLM_MODEL", "ANS_LLM_BASE_URL", "ANS_LLM_API", "ANS_LLM_API_KEY",
  "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY",
  "EXA_API_KEY", "TAVILY_API_KEY", "ANYSEARCH_API_KEY",
];

/** Every user table with its row count, so a diff names exactly what moved. */
function tableCounts(dbPath: string): Record<string, number> {
  const db = new Database(dbPath, { readonly: true });
  try {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all() as Array<{ name: string }>;
    const counts: Record<string, number> = {};
    for (const { name } of tables) {
      const row = db.prepare('SELECT COUNT(*) AS n FROM "' + name.replace(/"/g, '""') + '"').get() as
        { n: number } | undefined;
      counts[name] = row?.n ?? 0;
    }
    return counts;
  } finally {
    db.close();
  }
}

function changedTables(before: Record<string, number>, after: Record<string, number>): string[] {
  return Object.keys(after).filter((name) => before[name] !== after[name]).sort();
}

test("a half-written config stops with one task row and one observation, nothing else", async () => {
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  const root = mkdtempSync(join(tmpdir(), "ans-581-mcp-"));
  const home = join(root, "home");
  const cwd = join(root, "project");
  const dbPath = join(root, "anysearch.db");
  mkdirSync(join(home, ".ans"), { recursive: true });
  mkdirSync(join(cwd, ".ans"), { recursive: true });
  // Half config: the answer must name the user layer and the missing model.
  writeFileSync(join(home, ".ans", "config.toml"), '[llm]\nprovider = "anthropic"\n');
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.ANS_PI_SESSION_DIR = join(root, "pi-sessions");
  process.env.ANS_DB_PATH = dbPath;
  resetMcpTaskWarnings();

  const sessionStore = new SqliteSessionStore(dbPath);
  const observationStore = new SqliteObservationStore(dbPath);
  try {
    const engine = {
      retriever: { search: async () => ({ results: [], answers: [], metadata: {} }) },
      store: sessionStore,
      observation: observationStore,
    } as unknown as CompositionResult;
    const seen: unknown[] = [];
    const state = createMcpToolState({
      createAnsChatSession: async (opts) => {
        seen.push(opts);
        throw new Error("the model factory must not run without provider and model");
      },
      resolveLlmConfig: (opts = {}) => resolveLlmConfig({ ...opts, home, cwd }),
    });
    let handler: ((args: unknown) => Promise<unknown>) | undefined;
    const server = {
      registerTool: (name: string, _cfg: unknown, fn: (args: unknown) => Promise<unknown>) => {
        if (name === "ans_chat") handler = fn;
      },
    } as unknown as McpServer;
    registerAnsChat(server, engine, state);
    assert.ok(handler, "ans_chat was registered");

    const before = tableCounts(dbPath);
    // The registered handler's result type is the SDK's opaque object. This is
    // the test seam, not a product boundary: read the two fields this test owns.
    const result = await handler!({ message: "hello" }) as ToolResult;
    const after = tableCounts(dbPath);

    assert.equal(result.isError, true, "missing model is an execution error");
    assert.equal(result.structuredContent, undefined, "a bare error carries no structuredContent");
    const text = (result.content ?? []).map((block) => block.text).join("\n");
    assert.ok(text.startsWith("ans_chat: "), "the reason stays first: " + text);
    assert.ok(text.includes("The user config file sets provider but not model."),
      "the answer names the user layer and the missing model: " + text);
    assert.ok(!text.includes("anthropic"), "no provider value reaches the result");
    assert.ok(!text.includes(home) && !text.includes(cwd), "no absolute path reaches the result");
    assert.equal(seen.length, 0, "the model factory was never called");

    // The whole point of the ticket: a snapshot, not a factory assertion.
    assert.deepEqual(changedTables(before, after),
      ["observability_spans", "observability_traces", "task_records"],
      "only the task record and the observation grew");
    assert.equal(after.observability_traces, before.observability_traces + 1,
      "exactly one observation was written");
    assert.equal(after.observability_spans, before.observability_spans + 1,
      "the one observation wrote exactly one span");
    assert.equal(after.task_records, before.task_records + 1, "exactly one task record was written");
    for (const table of ["sessions", "budget_ledger", "budget_reservations", "task_budgets"]) {
      assert.equal(after[table], before[table], table + " gained no rows");
    }

    const task = new Database(dbPath, { readonly: true });
    try {
      const rows = task.prepare(
        "SELECT ended_at AS ended, exit_code AS code, session_id AS session FROM task_records",
      ).all() as Array<{ ended: string | null; code: number | null; session: string | null }>;
      assert.equal(rows.length, 1, "one task record");
      assert.ok(rows[0]?.ended, "the failed call's record is already ended");
      assert.equal(rows[0]?.code, 1, "the record says the call failed");
      assert.equal(rows[0]?.session, null, "no session was minted, so the record links none");
    } finally {
      task.close();
    }
  } finally {
    sessionStore.close();
    observationStore.close();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
