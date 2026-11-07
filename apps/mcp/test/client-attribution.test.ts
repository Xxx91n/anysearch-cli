// #213 client attribution — a modern per-request `_meta` clientInfo maps to a
// client_id in the observation trace; a legacy call without per-request
// clientInfo records mcp_unknown; the initialize-only extraction remains a fallback.
//
// Seam: real buildServer()/createHttpApp() + real SqliteObservationStore over
// the in-memory SDK transport and the production stateless HTTP app. The
// observation wrapper pins each runId so the persisted client_id column can be
// SELECTed back (the store-side round-trip is covered separately in
// packages/store/test/session-id-propagation.test.ts).

import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerContext } from "@modelcontextprotocol/server";
import type { CompositionResult } from "@anysearch-cli/kernel";
import { SqliteObservationStore } from "@anysearch-cli/store";
import { createHttpApp } from "../src/http.js";
import { buildServer } from "../src/server.js";
import { requestClientInfoName, runWithMcpIdentity } from "../src/mcp-context.js";
import { observeTool } from "../src/tools/observation.js";
import { createMockEngine } from "./helpers/mock-engine.js";
import { inMemoryRpc } from "./helpers/mcp-harness.js";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error("FAIL: " + msg);
  }
}

const CLIENT_INFO = "io.modelcontextprotocol/clientInfo";
const PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";
const CLIENT_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";
const TOOL_CALLS: Array<[string, Record<string, unknown>]> = [
  ["search_web", { query: "attribution" }],
  ["research_web", { question: "attribution", depth: "brief" }],
  ["recall_memory", { query: "attribution" }],
  ["query_knowledge", { query: "attribution" }],
  ["ans_chat", { message: "attribution" }],
];

// A complete 2026-07-28 per-request envelope: protocol version, clientInfo and
// client capabilities are the reserved keys a modern caller sends on every
// tools/call.
const modernMeta = {
  [PROTOCOL_VERSION]: "2026-07-28",
  [CLIENT_INFO]: { name: "claude-ai", version: "0" },
  [CLIENT_CAPABILITIES]: {},
};

function fakeCtx(clientInfo: unknown): ServerContext {
  return { mcpReq: { envelope: { [CLIENT_INFO]: clientInfo } } } as unknown as ServerContext;
}

function createCapturingEngine(store: SqliteObservationStore) {
  const base = createMockEngine();
  const runs: string[] = [];
  let seq = 0;
  const engine = {
    ...base,
    observation: {
      recordOperation: (options: any, cb: any) => {
        const runId = "client-attribution-run-" + ++seq;
        runs.push(runId);
        return store.recordOperation({ ...options, runId }, cb);
      },
    },
  } as unknown as CompositionResult;
  return { engine, runs, latest: (): string => runs[runs.length - 1]! };
}

async function startHttp(engine: CompositionResult) {
  const app = createHttpApp(engine);
  const srv = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    srv.once("listening", resolve);
    srv.once("error", reject);
  });
  const port = (srv.address() as AddressInfo).port;
  return {
    post: async (body: unknown) => {
      const res = await fetch("http://127.0.0.1:" + port + "/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify(body),
      });
      return { status: res.status, json: await res.json().catch(() => undefined) };
    },
    close: () =>
      new Promise<void>((resolve) => {
        srv.close(() => resolve());
        srv.closeAllConnections?.();
      }),
  };
}

async function main() {
  const saved: Record<string, string | undefined> = {};
  for (const k of ["ANS_LLM_PROVIDER", "ANS_LLM_MODEL", "ANS_MCP_KEY"]) {
    saved[k] = process.env[k];
    delete process.env[k];
  }

  const dir = mkdtempSync(join(tmpdir(), "mcp-client-attribution-"));
  const store = new SqliteObservationStore(join(dir, "observation.db"));
  try {
    const { engine, runs, latest } = createCapturingEngine(store);
    const initialized = { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "claude-ai", version: "0" } };

    // ---- 1) every tool reads the modern per-request envelope ----
    {
      const server = buildServer(engine);
      const rpc = await inMemoryRpc(server);
      await rpc.rpc("initialize", initialized);
      rpc.notify("notifications/initialized");
      for (const [name, args] of TOOL_CALLS) {
        const before = runs.length;
        const res = await rpc.rpc("tools/call", { name, arguments: args, _meta: modernMeta });
        assert(runs.length === before + 1, name + ": one observation trace per tool call");
        const attribution = store.readAttribution(latest());
        assert(attribution?.clientId === "claude_code", name + ": modern _meta clientInfo maps to claude_code");
        if (name === "ans_chat") {
          // Offline missing LLM config is an error result, but the trace is
          // still written before the handler returns it.
          assert(res.result?.isError === true, "ans_chat: offline not-configured result still records attribution");
        }
      }
      await server.close();
    }

    // ---- 2) a legacy call without per-request clientInfo stays anonymous ----
    {
      const server = buildServer(engine);
      const rpc = await inMemoryRpc(server);
      await rpc.rpc("initialize", initialized);
      rpc.notify("notifications/initialized");
      const res = await rpc.rpc("tools/call", { name: "search_web", arguments: { query: "legacy" } });
      assert(res.result?.isError !== true, "legacy search_web: normal success result");
      const attribution = store.readAttribution(latest());
      assert(attribution?.clientId === "mcp_unknown", "legacy tool call without per-request clientInfo records mcp_unknown");
      await server.close();
    }

    // ---- 3) production stateless HTTP: initialize does not travel ----
    {
      const http = await startHttp(engine);
      try {
        const init = await http.post({ jsonrpc: "2.0", id: 1, method: "initialize", params: initialized });
        assert(init.status === 200, "http legacy initialize: 200");
        // The shipped server stays legacy-only: a request carrying
        // MCP-Protocol-Version: 2026-07-28 is rejected before dispatch
        // (dual-era.test.ts), so the reachable modern path is the body
        // envelope without that header.
        const modern = await http.post({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "search_web", arguments: { query: "http-modern" }, _meta: modernMeta },
        });
        assert(modern.status === 200, "http modern-envelope tools/call: 200");
        const modernAttr = store.readAttribution(latest());
        assert(modernAttr?.clientId === "claude_code", "http modern request maps the per-request client_id");
        const legacy = await http.post({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "search_web", arguments: { query: "http-legacy" } },
        });
        assert(legacy.status === 200, "http legacy tools/call: 200");
        const legacyAttr = store.readAttribution(latest());
        assert(legacyAttr?.clientId === "mcp_unknown", "http legacy stateless call records mcp_unknown (initialize identity does not travel)");
      } finally {
        await http.close();
      }
    }

    // ---- 4) the initialize-time fallback remains available ----
    {
      await runWithMcpIdentity({ clientInfoName: "claude-ai" }, () =>
        observeTool(engine, "search_web", undefined, async () => ({ content: [] })));
      const attribution = store.readAttribution(latest());
      assert(attribution?.clientId === "claude_code", "initialize fallback maps to claude_code when no per-request envelope exists");
    }

    // ---- 5) the per-request envelope wins over the initialize fallback ----
    {
      await runWithMcpIdentity({ clientInfoName: "claude-ai" }, () =>
        observeTool(engine, "search_web", fakeCtx({ name: "cursor", version: "0" }), async () => ({ content: [] })));
      const attribution = store.readAttribution(latest());
      assert(attribution?.clientId === "cursor", "per-request clientInfo takes precedence over the initialize fallback");
    }

    // ---- 6) untrusted/malformed clientInfo degrades to mcp_unknown ----
    {
      assert(requestClientInfoName(undefined) === undefined, "no request context yields no name");
      assert(requestClientInfoName(fakeCtx({ name: 42 })) === undefined, "non-string name is not forwarded");
      assert(requestClientInfoName(fakeCtx({ name: "" })) === undefined, "empty name is treated as absent");
      assert(requestClientInfoName(fakeCtx(null)) === undefined, "null clientInfo is treated as absent");
      await observeTool(engine, "search_web", fakeCtx({ name: 42 }), async () => ({ content: [] }));
      const attribution = store.readAttribution(latest());
      assert(attribution?.clientId === "mcp_unknown", "malformed clientInfo still records mcp_unknown");
    }
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("--- mcp client attribution tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FAIL: client attribution test crashed: " + (e instanceof Error ? e.stack ?? e.message : String(e)));
  process.exit(1);
});
