#!/usr/bin/env node
// #100 acceptance — dist-level MCP smoke for the BUILT artifact (apps/mcp/dist/index.cjs).
//
// Complements the source-level acceptance tests (apps/mcp/test/sdk-v2-schema.test.ts,
// dual-era.test.ts) by exercising the real packed binary on BOTH transports:
//   - stdio:            initialize + tools/list, all 5 tools + type descriptions,
//                       Dual Era negotiation (legacy echo + 2026-07-28 -> 2025-11-25).
//   - Streamable HTTP:  stateless per-request server, /health readiness, initialize +
//                       tools/list (with and without a prior initialize), all 5 tools.
//
// tools/list only (no tools/call) so the smoke needs no provider/LLM API keys.
// Node stdlib only; cross-platform (ubuntu + windows CI matrix). Exit 0 = green.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST = resolve(ROOT, "apps/mcp/dist/index.cjs");
const TOOL_NAMES = ["search_web", "research_web", "recall_memory", "query_knowledge", "ans_chat"];
const LATEST_LEGACY = "2025-11-25";
const MODERN = "2026-07-28";

let failures = 0;
function check(cond, msg) {
  if (cond) {
    process.stdout.write("  ok   " + msg + "\n");
  } else {
    failures++;
    process.stdout.write("  FAIL " + msg + "\n");
  }
}

function assertToolList(tools, label) {
  check(Array.isArray(tools) && tools.length === TOOL_NAMES.length, label + ": tools/list returns 5 tools");
  for (const name of TOOL_NAMES) {
    const t = (tools ?? []).find((x) => x.name === name);
    check(t !== undefined, label + ": lists " + name);
    const req = name === "research_web" ? "question" : name === "ans_chat" ? "message" : "query";
    const desc = t?.inputSchema?.properties?.[req]?.description;
    check(typeof desc === "string" && desc.length > 0, label + ": " + name + " keeps type description (#46)");
  }
}

// Spawn the built binary and drive newline-delimited JSON-RPC over its stdio.
function stdioClient(args) {
  const child = spawn(process.execPath, [DIST, ...args], { stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (c) => { stderr += c.toString(); });
  const pending = new Map();
  let nextId = 1;
  let buf = "";
  child.stdout.on("data", (c) => {
    buf += c.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      if (m.id !== undefined && pending.has(m.id)) {
        const { resolve, timer } = pending.get(m.id);
        pending.delete(m.id);
        clearTimeout(timer);
        resolve(m);
      }
    }
  });
  const rpc = (method, params) =>
    new Promise((res, rej) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); rej(new Error("stdio timeout: " + method + "\nstderr: " + stderr)); }, 15000);
      pending.set(id, { resolve: res, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  const notify = (method, params) =>
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) }) + "\n");
  const close = () => { child.kill(); };
  return { rpc, notify, close };
}

async function stdioSmoke() {
  process.stdout.write("stdio smoke (built dist):\n");
  // Modern claim -> negotiated down to latest legacy (Dual Era fallback, unchanged).
  {
    const c = stdioClient(["--transport", "stdio"]);
    try {
      const init = await c.rpc("initialize", { protocolVersion: MODERN, capabilities: {}, clientInfo: { name: "mcp-smoke", version: "0" } });
      check(init.result?.protocolVersion === LATEST_LEGACY, "stdio init@" + MODERN + " negotiates " + LATEST_LEGACY);
      c.notify("notifications/initialized");
      const list = await c.rpc("tools/list", {});
      assertToolList(list.result?.tools, "stdio@" + MODERN);
    } finally {
      c.close();
    }
  }
  // Legacy claim -> echoed back verbatim.
  {
    const c = stdioClient(["--transport", "stdio"]);
    try {
      const init = await c.rpc("initialize", { protocolVersion: LATEST_LEGACY, capabilities: {}, clientInfo: { name: "mcp-smoke", version: "0" } });
      check(init.result?.protocolVersion === LATEST_LEGACY, "stdio init@" + LATEST_LEGACY + " echoes " + LATEST_LEGACY);
      c.notify("notifications/initialized");
      const list = await c.rpc("tools/list", {});
      assertToolList(list.result?.tools, "stdio@" + LATEST_LEGACY);
    } finally {
      c.close();
    }
  }
}

function getFreePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => res(p));
    });
  });
}

async function waitHealth(port, child, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("HTTP server exited early (code " + child.exitCode + ")");
    try {
      const r = await fetch("http://127.0.0.1:" + port + "/health");
      if (r.status === 200) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("HTTP /health not ready within " + timeoutMs + "ms");
}

async function httpSmoke() {
  process.stdout.write("Streamable HTTP smoke (built dist, stateless):\n");
  const port = await getFreePort();
  const child = spawn(process.execPath, [DIST, "--transport", "http", "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (c) => { stderr += c.toString(); });
  child.stdout.on("data", () => {});
  const base = "http://127.0.0.1:" + port + "/mcp";
  const post = async (body, extraHeaders = {}) => {
    const r = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json, text/event-stream", ...extraHeaders },
      body: JSON.stringify(body),
    });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  try {
    await waitHealth(port, child);
    check(true, "http /health ready");
    const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: MODERN, capabilities: {}, clientInfo: { name: "mcp-smoke", version: "0" } } });
    check(init.status === 200, "http initialize: 200");
    check(init.json?.result?.protocolVersion === LATEST_LEGACY, "http init@" + MODERN + " negotiates " + LATEST_LEGACY);
    const list = await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, { "mcp-protocol-version": LATEST_LEGACY });
    check(list.status === 200, "http tools/list (version header): 200");
    assertToolList(list.json?.result?.tools, "http");
    // Stateless: a tools/list with no prior initialize and no version header still serves.
    const listNoInit = await post({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} });
    check(listNoInit.status === 200, "http tools/list (no init, no header): 200 (stateless)");
    assertToolList(listNoInit.json?.result?.tools, "http-stateless");
  } catch (e) {
    failures++;
    process.stdout.write("  FAIL http smoke: " + e.message + "\nstderr: " + stderr + "\n");
  } finally {
    child.kill();
  }
}

async function main() {
  await stdioSmoke();
  await httpSmoke();
  if (failures > 0) {
    process.stdout.write("mcp-smoke: BROKEN (" + failures + " failed)\n");
    process.exit(1);
  }
  process.stdout.write("mcp-smoke: OK (stdio + Streamable HTTP, 5 tools, descriptions, dual-era)\n");
}
main().catch((e) => { process.stderr.write("mcp-smoke error: " + (e && e.stack ? e.stack : String(e)) + "\n"); process.exit(1); });
