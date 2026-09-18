#!/usr/bin/env node
// ADR-0052 D7: packaged CLI/MCP observation smoke.
// This script exercises the built bins, then reads the durable trace schema
// through the same better-sqlite3 prebuild used by the packages.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromStore = createRequire(path.join(ROOT, "packages", "store", "package.json"));
const Database = requireFromStore("better-sqlite3");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anysearch-observation-smoke-"));
const dbPath = path.join(dir, "trace.db");
const cliPath = path.join(ROOT, "apps", "cli", "dist", "index.js");
const mcpPath = path.join(ROOT, "apps", "mcp", "dist", "index.cjs");
const scrubbed = { ...process.env, ANS_DB_PATH: dbPath, ANS_DOMAIN: "", TAVILY_API_KEY: "", EXA_API_KEY: "", ANYSEARCH_API_KEY: "" };

function fail(message) {
  process.stderr.write("verify-observation: " + message + "\n");
  process.exit(1);
}

function readLineStream(child, expectedId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("MCP response timeout"));
    }, timeoutMs);
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        try {
          const message = JSON.parse(line);
          if (message.id === expectedId) {
            clearTimeout(timer);
            child.stdout.off("data", onData);
            resolve(message);
            return;
          }
        } catch {
          // Ignore non-JSON protocol noise.
        }
      }
    };
    child.stdout.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("MCP exited before response with code " + code));
    });
  });
}

async function main() {
  const cli = spawnSync(
    process.execPath,
    [cliPath, "search", "--json", "observation-smoke"],
    { cwd: ROOT, env: scrubbed, encoding: "utf8" },
  );
  if (cli.error) fail("CLI failed to start: " + cli.error.message);

  const child = spawn(
    process.execPath,
    [mcpPath, "--transport", "stdio"],
    { cwd: ROOT, env: scrubbed, stdio: ["pipe", "pipe", "pipe"] },
  );
  try {
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "verify-observation", version: "0" } },
    }) + "\n");
    await readLineStream(child, 1, 10_000);
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "search_web", arguments: { query: "observation-smoke", mode: "fast" } },
    }) + "\n");
    await readLineStream(child, 2, 10_000);
  } finally {
    // L-2 (R69 T5): graceful shutdown before the trace read — a hard kill can
    // drop the async observation write that lands just after the JSON-RPC
    // response (Windows kill = TerminateProcess, no cleanup handlers run).
    // stdin EOF lets the server exit on its own and flush; kill only as a
    // bounded fallback.
    child.stdin.end();
    const exited = await Promise.race([
      new Promise((resolve) => child.once("exit", () => resolve(true))),
      new Promise((resolve) => setTimeout(() => resolve(false), 3_000)),
    ]);
    if (!exited) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
  }

  const db = new Database(dbPath, { readonly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('observability_traces','observability_spans','observability_evaluations','observability_scores')").all().map((row) => row.name);
    for (const table of ["observability_traces", "observability_spans", "observability_evaluations", "observability_scores"]) {
      if (!tables.includes(table)) fail("missing table " + table);
    }
    // L-2 (R69 T5): retry window — trace persistence may still be landing
    // when this point is reached even after a graceful exit (WAL flush).
    let traces = [];
    let operations = new Set();
    for (let attempt = 0; attempt < 20; attempt++) {
      traces = db.prepare("SELECT run_id, operation, status FROM observability_traces ORDER BY rowid").all();
      operations = new Set(traces.map((row) => row.operation));
      if (operations.has("ans.search") && operations.has("search_web")) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
    if (!operations.has("ans.search")) fail("CLI trace missing");
    if (!operations.has("search_web")) fail("MCP trace missing");
    const payloadRow = db.prepare("SELECT payload_json FROM observability_traces WHERE operation = 'ans.search'").get();
    const payload = JSON.parse(payloadRow.payload_json);
    if (payload.schema !== "anysearch://schemas/observation/1.0.0") fail("internal schema mismatch");
    if (payload.semconvPin !== "b5d8440f6f126738fd50f927752cd669772c517b") fail("semantic pin mismatch");
    if (!Array.isArray(payload.spans) || payload.spans.length === 0) fail("trace has no spans");
    process.stdout.write(JSON.stringify({
      verdict: "PASSED",
      traceCount: traces.length,
      operations: [...operations].sort(),
      schema: payload.schema,
      semconvPin: payload.semconvPin,
    }, null, 2) + "\n");
  } finally {
    db.close();
  }
}

main()
  .catch((error) => fail(error && error.stack ? error.stack : String(error)))
  .finally(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });
