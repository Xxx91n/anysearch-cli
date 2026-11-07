// #213 client attribution — a modern per-request `_meta` clientInfo maps to a
// client_id in the observation trace; a legacy call without per-request
// clientInfo records mcp_unknown; the initialize-only stash remains a fallback.
//
// Seam: real buildServer() + real SqliteObservationStore over the in-memory SDK
// transport. The observation wrapper pins each runId so the persisted client_id
// column can be SELECTed back (the store-side round-trip is covered separately
// in packages/store/test/session-id-propagation.test.ts).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerContext } from "@modelcontextprotocol/server";
import type { CompositionResult } from "@anysearch-cli/kernel";
import { SqliteObservationStore } from "@anysearch-cli/store";
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
const TOOL_CALLS: Array<[string, Record<string, unknown>]> = [
  ["search_web", { query: "attribution" }],
  ["research_web", { question: "attribution", depth: "brief" }],
  ["recall_memory", { query: "attribution" }],
  ["query_knowledge", { query: "attribution" }],
  ["ans_chat", { message: "attribution" }],
];

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
        const runId = "client-identity-run-" + ++seq;
        runs.push(runId);
        return store.recordOperation({ ...options, runId }, cb);
      },
    },
  } as unknown as CompositionResult;
  return { engine, runs, latest: (): string => runs[runs.length - 1]! };
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "mcp-client-identity-"));
  const store = new SqliteObservationStore(join(dir, "observation.db"));
  try {
    const { engine, runs, latest } = createCapturingEngine(store);
    const initialized = { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "claude-ai", version: "0" } };
    const modernMeta = { [CLIENT_INFO]: { name: "claude-ai", version: "0" } };

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

    // ---- 3) the initialize-time stash remains a fallback ----
    {
      await runWithMcpIdentity({ clientInfoName: "claude-ai" }, () =>
        observeTool(engine, "search_web", undefined, async () => ({ content: [] })));
      const attribution = store.readAttribution(latest());
      assert(attribution?.clientId === "claude_code", "initialize stash maps to claude_code when no per-request envelope exists");
    }

    // ---- 4) the per-request envelope wins over the initialize stash ----
    {
      await runWithMcpIdentity({ clientInfoName: "claude-ai" }, () =>
        observeTool(engine, "search_web", fakeCtx({ name: "cursor", version: "0" }), async () => ({ content: [] })));
      const attribution = store.readAttribution(latest());
      assert(attribution?.clientId === "cursor", "per-request clientInfo takes precedence over the initialize stash");
    }

    // ---- 5) untrusted/malformed clientInfo degrades to mcp_unknown ----
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
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("--- mcp client identity tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FAIL: client identity test crashed: " + (e instanceof Error ? e.stack ?? e.message : String(e)));
  process.exit(1);
});
