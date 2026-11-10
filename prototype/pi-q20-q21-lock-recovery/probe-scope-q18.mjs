#!/usr/bin/env node
// Q18 scope probe: a missing scope and malformed memoryIds must be errors.
// Checks the built MCP tool surface and the CLI entry, each in a temp DB.
//
// Run: node prototype/pi-q20-q21-lock-recovery/probe-scope-q18.mjs
// (requires a prior build of apps/mcp)

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const MCP_DIST = join(ROOT, "apps", "mcp", "dist", "index.js");
const CLI_ENTRY = join(ROOT, "apps", "cli", "src", "index.ts");
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

function startMcp(env) {
  const child = spawn(process.execPath, [MCP_DIST, "--transport", "stdio"], {
    env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (c) => { stderr += c.toString(); });
  const pending = new Map();
  let nextId = 1;
  let buf = "";
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
  function rpc(method, params, timeoutMs = 30000) {
    return new Promise((res, rej) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); rej(new Error("rpc timeout: " + method)); }, timeoutMs);
      pending.set(id, { resolve: res, reject: rej, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  return { child, rpc, stderr: () => stderr };
}

function textOf(res) {
  return (res?.result?.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

async function mcpCheck() {
  const root = mkdtempSync(join(tmpdir(), "ans-q18-mcp-"));
  const dbPath = join(root, "anysearch.db");
  const mcp = startMcp({
    ANS_DB_PATH: dbPath,
    ANS_PI_SESSION_DIR: join(root, "pi"),
    ANS_LLM_PROVIDER: "openai",
    ANS_LLM_MODEL: "probe-model",
    ANS_LLM_BASE_URL: "http://127.0.0.1:1/v1",
    ANS_LLM_API: "chat",
    ANS_LLM_API_KEY: "scope-probe-key-not-real",
  });
  try {
    await mcp.rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "scope", version: "1" } });
    mcp.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
    const cases = [];
    for (const [label, args] of [
      ["no-scope", { operation: "consolidate" }],
      ["both-null", { operation: "consolidate", sessionId: null, memoryIds: null }],
      ["invalid-memory", { operation: "consolidate", memoryIds: [0, -1] }],
      ["valid-session-invalid-memory", { operation: "consolidate", sessionId: "ok-session", memoryIds: [0] }],
      ["invalid-session", { operation: "consolidate", sessionId: "bad id with spaces" }],
    ]) {
      const res = await mcp.rpc("tools/call", { name: "ans_chat", arguments: args });
      cases.push({ label, isError: res?.result?.isError === true, text: textOf(res) });
    }
    return { cases, stderr: mcp.stderr().slice(0, 400) };
  } finally {
    mcp.child.kill();
    await sleep(300);
    rmSync(root, { recursive: true, force: true, maxRetries: 10 });
  }
}

function cliCheck() {
  const root = mkdtempSync(join(tmpdir(), "ans-q18-cli-"));
  const env = {
    ...process.env,
    ANS_DB_PATH: join(root, "anysearch.db"),
    ANS_PI_SESSION_DIR: join(root, "pi"),
  };
  return new Promise((res) => {
    const child = spawn(process.execPath, ["--import", "tsx", CLI_ENTRY, "consolidate", "--dry-run"], {
      cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += c.toString(); });
    child.stderr.on("data", (c) => { stderr += c.toString(); });
    child.on("exit", (code) => {
      res({ exitCode: code, stdout: stdout.slice(0, 400), stderr: stderr.slice(0, 600) });
      rmSync(root, { recursive: true, force: true, maxRetries: 10 });
    });
  });
}

const evidence = { probe: "q18-scope", startedAt: new Date().toISOString(), samples: "SAMPLES-Q20-Q21-LOCK-COLDSTART.md (confirmed)", checks: findings };
try {
  const mcp = await mcpCheck();
  evidence.mcp = mcp;
  record("Q18-mcp-no-scope", "MCP：两个范围都没给时直接报错，不退化成全库整理",
    mcp.cases[0].isError && /explicit scope|scope is required/i.test(mcp.cases[0].text) &&
      mcp.cases[1].isError,
    mcp.cases.slice(0, 2));
  record("Q18-mcp-memory", "MCP：非法 memoryIds 报错",
    mcp.cases[2].isError && mcp.cases[3].isError, mcp.cases.slice(2, 4));
  record("Q18-mcp-session", "MCP：非法 sessionId 仍然报错",
    mcp.cases[4].isError && /sessionId/i.test(mcp.cases[4].text), mcp.cases[4]);

  const cli = await cliCheck();
  evidence.cli = cli;
  record("Q18-cli-no-scope", "CLI：没给 --session/--memory 时退出码 2，并说明拒绝全库整理",
    cli.exitCode === 2 && /explicit scope|full-archive/i.test(cli.stderr), cli);

  const text = JSON.stringify(evidence);
  record("SEC", "证据文件不含密钥材料", !text.includes("scope-probe-key-not-real"), { checkedChars: text.length });

  writeFileSync(join(OUT, "q18-scope.json"), JSON.stringify(evidence, null, 2) + "\n");
  const failed = findings.filter((f) => !f.pass);
  for (const f of failed) console.log("  FAIL DETAIL " + f.id + " " + JSON.stringify(f.evidence).slice(0, 1000));
  console.log("\n" + (failed.length === 0 ? "all checks passed" : failed.length + " check(s) failed") + " — out/q18-scope.json");
  process.exitCode = failed.length === 0 ? 0 : 1;
} catch (e) {
  console.error("probe failed: " + (e instanceof Error ? e.stack ?? e.message : String(e)));
  evidence.error = String(e?.stack ?? e);
  writeFileSync(join(OUT, "q18-scope.json"), JSON.stringify(evidence, null, 2) + "\n");
  process.exitCode = 2;
}
