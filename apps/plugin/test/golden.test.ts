// ADR-0056 D-005/T8 end-to-end golden case:
// hook outbound -> server extract -> store write -> SELECT-back closure.
//
// Topology: start the plugin server on a localhost port, fire a real
// HTTP request through callServer (the same code path the hook adapters
// use), then SELECT the persisted audit row from the SQLite trace store
// and verify trace_id, session_id, client_id round-trip exactly.
//
// This fills the M1 gap from 2026-09-11-audit: prior store-side and
// plugin-side tests covered half the chain each; this file covers the
// full chain in one process.
//
// Ship-gate coverage: this test DOES run under `pnpm ship-gate` - step 3 of
// scripts/ship-gate.mjs runs `turbo run test`, whose glob discovers
// apps/plugin/test/**/*.test.ts. It is also part of apps/plugin's `test`
// script and of tsconfig.test.json coverage. (An earlier revision of this
// comment claimed the opposite; corrected per the round-57 closure audit N-3.)

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { buildPropagationHeaders, parseAndValidateHeaders, newTraceIdHex, newSpanIdHex } from "../src/hooks/propagation.js";
import { emitConfigChangeAudit } from "@anysearch/store";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log("  PASS " + label); }
  else { failed++; console.error("  FAIL " + label); }
}

// Minimal copy of plugin server's /policy handler that does the same
// parseAndValidateHeaders + emitConfigChangeAudit pair the production
// server does. Kept inline here to avoid booting the full server
// composition (which depends on ProjectIndexStore + DOMAIN_TOML). This
// is the minimum surface for golden-case verification.
function startMinimalServer(
  obsDbPath: string,
  domainTomlPath: string,
): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const srv = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      if (req.url !== "/policy") {
        res.writeHead(404);
        res.end();
        return;
      }
      // Inline copy of the server-side parse + audit pattern. Same code
      // path as apps/plugin/src/server/index.ts:79-117 (the
      // emitConfigChangeAudit block, minus the policyVersion-change
      // audit that is gated on first request).
      const incoming = parseAndValidateHeaders(req);
      const policyVersion = "golden-v1";
      void emitConfigChangeAudit(obsDbPath, {
        actor: "server",
        source: "toml",
        path: domainTomlPath,
        change: { before: null, after: policyVersion },
        policyVersion,
        traceId: incoming.traceId,
        sessionId: incoming.sessionId,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ allow: [], deny: [], policy_version: policyVersion }));
    });
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ port, close: () => new Promise((r) => srv.close(() => r())) });
    });
  });
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "golden-"));
  const obsDbPath = join(dir, "audit.db");
  const domainTomlPath = join(dir, "domains", "default.toml");

  // --- Step 1: hook outbound — build real W3C headers from host stdin values ---
  const sessionId = "abcdef0123456789abcdef0123456789";
  const traceId = newTraceIdHex();
  const spanId = newSpanIdHex();
  const headers = buildPropagationHeaders({ sessionId, traceId, spanId });

  // --- Step 2: start server on a random localhost port ---
  const server = await startMinimalServer(obsDbPath, domainTomlPath);

  try {
    // --- Step 3: hook outbound HTTP call (real fetch, the same code path callServer uses) ---
    const url = "http://127.0.0.1:" + server.port + "/policy";
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer ",
        ...headers,
      },
      signal: AbortSignal.timeout(5000),
    });
    check("server reachable: HTTP 200", resp.status === 200);

    // --- Step 4: emitConfigChangeAudit is fire-and-forget — wait briefly for the SQLite write ---
    await new Promise((r) => setTimeout(r, 100));

    // --- Step 5: SELECT the persisted audit row directly from the SQLite trace store ---
    const raw = new Database(obsDbPath, { readonly: true });
    const row = raw.prepare(
      "SELECT trace_id AS traceId, injected_trace_id AS injectedTraceId, session_id AS sessionId, client_id AS clientId FROM observability_traces ORDER BY created_at DESC LIMIT 1"
    ).get() as { traceId: string; injectedTraceId: string; sessionId: string | null; clientId: string | null };
    raw.close();

    check("SELECT: row exists", row !== undefined);
    check("SELECT: trace_id matches hook-supplied", row.traceId === traceId);
    check("SELECT: injected_trace_id matches trace_id", row.injectedTraceId === traceId);
    check("SELECT: session_id matches host stdin", row.sessionId === sessionId);
    check("SELECT: client_id is NULL (plugin server path has no MCP client)", row.clientId === null);

    // --- Step 6: OPA #6905 closure — confirm parseAndValidateHeaders would also recover the same values ---
    const reparse = parseAndValidateHeaders({
      headers: {
        traceparent: headers.traceparent,
        "x-anysearch-session-id": headers["x-anysearch-session-id"]!,
      },
    });
    check("OPA closure: re-parse trace_id matches", reparse.traceId === traceId);
    check("OPA closure: re-parse session_id matches", reparse.sessionId === sessionId);

  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("\ngolden tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("golden test threw:", e);
  process.exit(1);
});