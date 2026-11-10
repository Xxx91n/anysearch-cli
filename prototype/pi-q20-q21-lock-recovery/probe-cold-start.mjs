#!/usr/bin/env node
// Cold-start probe D1: two REAL MCP processes open one brand-new database at
// the same instant. Each must finish MCP initialize AND tools/list; afterwards
// the schema must be complete. Repeated 5 rounds on the fixed code.
//
// A 3-round "before" block runs the same scenario with
// ANS_PROTOTYPE_BUSY_RETRY=0 so the original race (if it appears) is visible on
// the same binary; that block is diagnostic, not a pass/fail assertion.
//
// Run: node prototype/pi-q20-q21-lock-recovery/probe-cold-start.mjs
// (requires a prior build of apps/mcp)

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const MCP_DIST = join(ROOT, "apps", "mcp", "dist", "index.js");
const OUT = join(HERE, "out");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(MCP_DIST)) {
  console.error("missing built MCP dist; build first");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const findings = [];
function record(id, question, pass, evidence) {
  findings.push({ id, question, pass, evidence });
  console.log((pass ? "  ok   " : "  FAIL ") + id + " — " + question);
}

const REQUIRED_TABLES = [
  "sessions", "messages", "retrieval_results", "resume_anchors", "budget_ledger",
  "semantic_memories", "access_events", "entity_merge_log", "edge_patterns", "t0_preferences",
];

function startMcp(env) {
  const child = spawn(process.execPath, [MCP_DIST, "--transport", "stdio"], {
    env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (c) => { stderr += c.toString(); });
  const pending = new Map();
  let nextId = 1;
  let buf = "";
  const exited = new Promise((resolveExit) => child.on("exit", (code, signal) => {
    for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(new Error("MCP exited (code=" + code + ", signal=" + signal + ")")); pending.delete(id); }
    resolveExit({ code, signal });
  }));
  child.stdout.on("data", (c) => {
    buf += c.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.id !== undefined && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer); p.resolve(m); }
    }
  });
  function rpc(method, params, timeoutMs = 25000) {
    return new Promise((res, rej) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); rej(new Error("rpc timeout: " + method)); }, timeoutMs);
      pending.set(id, { resolve: res, reject: rej, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  return { child, rpc, exited, stderr: () => stderr };
}

async function startAndUse(env, name) {
  const started = Date.now();
  const mcp = startMcp(env);
  try {
    const init = await mcp.rpc("initialize", {
      protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "cold-" + name, version: "1" },
    });
    mcp.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
    const list = await mcp.rpc("tools/list", {});
    return {
      name,
      ok: true,
      elapsedMs: Date.now() - started,
      serverName: init?.result?.serverInfo?.name ?? null,
      toolCount: (list?.result?.tools ?? []).length,
      stderr: mcp.stderr().slice(0, 600),
    };
  } catch (e) {
    return {
      name, ok: false, elapsedMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
      stderr: mcp.stderr().slice(0, 600),
    };
  } finally {
    try { mcp.child.kill("SIGKILL"); } catch { /* dead */ }
    try { await mcp.exited; } catch { /* ignore */ }
  }
}

function inspect(dbPath) {
  const db = new Database(dbPath, { readonly: true, timeout: 5000 });
  try {
    const integrity = db.pragma("integrity_check", { simple: true });
    const journal = db.pragma("journal_mode", { simple: true });
    const names = db.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view','trigger') ORDER BY name").all();
    const tableNames = names.filter((n) => n.type === "table").map((n) => n.name);
    const triggers = names.filter((n) => n.type === "trigger").map((n) => n.name);
    const fts = tableNames.filter((n) => n.endsWith("_fts"));
    return {
      integrity, journal,
      missingTables: REQUIRED_TABLES.filter((t) => !tableNames.includes(t)),
      fts,
      triggerCount: triggers.length,
    };
  } finally {
    db.close();
  }
}

function makeEnv(dbPath, piDir, extra = {}) {
  return {
    ANS_DB_PATH: dbPath,
    ANS_PI_SESSION_DIR: piDir,
    ANS_LLM_PROVIDER: "openai",
    ANS_LLM_MODEL: "probe-model",
    ANS_LLM_BASE_URL: "http://127.0.0.1:1/v1",
    ANS_LLM_API: "chat",
    ANS_LLM_API_KEY: "cold-probe-key-not-real",
    ...extra,
  };
}

async function runRound(round, extraEnv) {
  const root = mkdtempSync(join(tmpdir(), "ans-cold-" + round + "-"));
  const dbPath = join(root, "anysearch.db");
  const piDir = join(root, "pi");
  mkdirSync(piDir, { recursive: true });
  // Deliberately do NOT pre-create or pre-initialize the DB.
  const env = makeEnv(dbPath, piDir, extraEnv);
  const [a, b] = await Promise.all([
    startAndUse(env, "a"),
    startAndUse(env, "b"),
  ]);
  const schema = inspect(dbPath);
  rmSync(root, { recursive: true, force: true, maxRetries: 10 });
  return { round, a, b, schema };
}

const evidence = {
  probe: "cold-start",
  startedAt: new Date().toISOString(),
  samples: "SAMPLES-Q20-Q21-LOCK-COLDSTART.md (confirmed)",
  requiredTables: REQUIRED_TABLES,
  before: [],
  after: [],
  checks: findings,
};

try {
  console.log("before block (ANS_PROTOTYPE_BUSY_RETRY=0, 3 rounds)");
  for (let i = 1; i <= 3; i++) {
    const r = await runRound("before-" + i, { ANS_PROTOTYPE_BUSY_RETRY: "0" });
    evidence.before.push(r);
    console.log("  before round " + i + ": a=" + r.a.ok + " b=" + r.b.ok +
      " integrity=" + r.schema.integrity +
      (r.a.ok && r.b.ok ? "" : " aErr=" + (r.a.error ?? "").slice(0, 80) + " bErr=" + (r.b.error ?? "").slice(0, 80)));
  }

  record("before-observation", "关闭重试时的同瞬启动结果（诊断，不作为通过断言）",
    true,
    evidence.before.map((r) => ({
      round: r.round, a: { ok: r.a.ok, error: r.a.error, stderr: r.a.stderr },
      b: { ok: r.b.ok, error: r.b.error, stderr: r.b.stderr },
      integrity: r.schema.integrity,
    })));

  console.log("after block (default retry, 5 rounds)");
  for (let i = 1; i <= 5; i++) {
    const r = await runRound("after-" + i, {});
    evidence.after.push(r);
    console.log("  after round " + i + ": a=" + r.a.ok + " b=" + r.b.ok +
      " tools=" + r.a.toolCount + "/" + r.b.toolCount +
      " integrity=" + r.schema.integrity + " journal=" + r.schema.journal);
  }

  const allOk = evidence.after.every((r) => r.a.ok && r.b.ok && r.a.toolCount > 0 && r.b.toolCount > 0);
  record("D1-both-start", "5 轮 × 2 进程都完成 initialize 和 tools/list",
    allOk,
    evidence.after.map((r) => ({ round: r.round, a: r.a, b: r.b })));

  const allSchema = evidence.after.every((r) =>
    r.schema.integrity === "ok" && r.schema.missingTables.length === 0 &&
    r.schema.journal === "wal" && r.schema.fts.length > 0 && r.schema.triggerCount > 0);
  record("D1-schema", "每轮结构完整：integrity ok、关键表和 FTS/触发器齐全、journal_mode=wal",
    allSchema,
    evidence.after.map((r) => ({ round: r.round, schema: r.schema })));

  const swallowed = evidence.after.filter((r) =>
    !r.a.ok || !r.b.ok || /database is locked|SQLITE_BUSY/i.test(r.a.stderr + r.b.stderr));
  record("D1-no-swallowed-error", "没有进程吞掉 database is locked 假装启动成功",
    swallowed.length === 0,
    swallowed.map((r) => ({ round: r.round, a: r.a, b: r.b })));

  const text = JSON.stringify(evidence);
  record("SEC", "证据文件不含密钥材料", !text.includes("cold-probe-key-not-real"), { checkedChars: text.length });

  writeFileSync(join(OUT, "cold-start.json"), JSON.stringify(evidence, null, 2) + "\n");
  const failed = findings.filter((f) => !f.pass);
  for (const f of failed) console.log("  FAIL DETAIL " + f.id + " " + JSON.stringify(f.evidence).slice(0, 1500));
  console.log("\n" + (failed.length === 0 ? "all checks passed" : failed.length + " check(s) failed") + " — out/cold-start.json");
  process.exitCode = failed.length === 0 ? 0 : 1;
} catch (e) {
  console.error("probe failed: " + (e instanceof Error ? e.stack ?? e.message : String(e)));
  evidence.error = String(e?.stack ?? e);
  writeFileSync(join(OUT, "cold-start.json"), JSON.stringify(evidence, null, 2) + "\n");
  process.exitCode = 2;
}
