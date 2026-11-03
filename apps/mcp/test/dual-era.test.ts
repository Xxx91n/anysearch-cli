// #100 acceptance — Dual Era compatibility + dual-transport 5-tool smoke.
//
//   Dual Era (behavior UNCHANGED by the 2.0.0 -> 2.4.0 bump, hand-wired path):
//     - legacy clients (2024-10-07 .. 2025-11-25) initialize and get their own
//       version echoed back; tools/list + tools/call work.
//     - a client claiming the modern 2026-07-28 revision is gracefully negotiated
//       DOWN to 2025-11-25 (SDK built-in legacy fallback) and still served —
//       zero visible change to host clients. We do NOT opt into createMcpHandler /
//       serveStdio (that would change behavior and is out of scope for #100).
//     - modern-envelope probes on the hand-wired path stay pinned: server/discover
//       is MethodNotFound (-32601), while tools/list carrying a 2026-07-28 _meta
//       envelope still returns the tool list (graceful legacy degradation).
//   Transports: stdio (StdioServerTransport) + stateless Streamable HTTP
//     (per-request server over a shared engine + NodeStreamableHTTPServerTransport), all 5 tools.
//
// Seam: real buildServer() with a mock engine (offline, no LLM), driven over the
// actual transport classes in-process. No test framework (repo convention).

import { buildServer } from "../src/server.js";
import type { KernelToolName } from "@anysearch-cli/kernel";
import { createMockEngine } from "./helpers/mock-engine.js";
import { stdioRpc, httpStateless, inMemoryRpc } from "./helpers/mcp-harness.js";

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

const TOOL_NAMES: KernelToolName[] = [
  "search_web",
  "research_web",
  "recall_memory",
  "query_knowledge",
  "ans_chat",
];
const LEGACY_VERSIONS = ["2024-10-07", "2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
const MODERN_VERSION = "2026-07-28";
const LATEST_LEGACY = "2025-11-25";

const CALL_ARGS: Record<KernelToolName, Record<string, unknown>> = {
  search_web: { query: "hello world" },
  research_web: { question: "what is rust", depth: "brief" },
  recall_memory: { query: "rust", limit: 3 },
  query_knowledge: { query: "rust" },
  ans_chat: { message: "hello" },
};

function assertCallOk(res: any, name: string, label: string) {
  assert(res !== undefined && res !== null, label + " " + name + ": got a result");
  assert(res?.isError !== true, label + " " + name + ": isError not true");
  const text = res?.content?.[0]?.text;
  assert(
    Array.isArray(res?.content) && typeof text === "string" && text.length > 0,
    label + " " + name + ": non-empty text content"
  );
  // The retrieval/chat handlers catch failures and return "<name> error: ..."
  // WITHOUT setting isError (src/tools/*.tool.ts). Reject that handler-error
  // prefix so a failed call cannot pass this smoke (CodeRabbit #117).
  assert(
    typeof text === "string" && !text.startsWith(name + " error:"),
    label + " " + name + ": not a handler-error result"
  );
}

function assertToolList(tools: any[], label: string) {
  assert(Array.isArray(tools) && tools.length === TOOL_NAMES.length, label + ": tools/list returns 5 tools");
  for (const name of TOOL_NAMES) {
    const t = (tools ?? []).find((x: any) => x.name === name);
    assert(t !== undefined, label + ": lists " + name);
    const req = name === "research_web" ? "question" : name === "ans_chat" ? "message" : "query";
    assert(
      typeof t?.inputSchema?.properties?.[req]?.description === "string" && t.inputSchema.properties[req].description.length > 0,
      label + ": " + name + " inputSchema keeps type descriptions"
    );
  }
}

async function main() {
  // Force the offline-safe paths: ans_chat returns "LLM not configured" (no
  // network), recall_memory skips the optional project index.
  const saved: Record<string, string | undefined> = {};
  for (const k of ["ANS_LLM_PROVIDER", "ANS_LLM_MODEL", "ANS_PROJECT_DB"]) {
    saved[k] = process.env[k];
    delete process.env[k];
  }

  try {
    // ---- Part 1: stdio Dual Era negotiation + listing, per protocol version ----
    for (const v of [...LEGACY_VERSIONS, MODERN_VERSION]) {
      const expected = v === MODERN_VERSION ? LATEST_LEGACY : v;
      const server = buildServer(createMockEngine());
      const { rpc, notify } = await stdioRpc(server);
      const init = await rpc("initialize", { protocolVersion: v, capabilities: {}, clientInfo: { name: "dual-era", version: "0" } });
      assert(init.result?.protocolVersion === expected, "stdio init@" + v + " negotiates " + expected + " (dual-era)");
      notify("notifications/initialized");
      const list = await rpc("tools/list", {});
      assertToolList(list.result?.tools, "stdio@" + v);
      await server.close();
    }

    // ---- Part 1b: modern-envelope probes on the hand-wired path (pinned) ----
    // The hand-wired McpServer + transport stays legacy-only. A 2026-07-28 _meta
    // envelope must NOT unlock modern methods, yet tools/list still degrades
    // gracefully to the legacy tool list. Pins the exact behavior measured in #94.
    {
      const modernMeta = {
        "io.modelcontextprotocol/protocolVersion": MODERN_VERSION,
        "io.modelcontextprotocol/clientInfo": { name: "modern-probe", version: "0" },
      };
      // B: server/discover with a modern envelope -> MethodNotFound (legacy-only).
      const serverB = buildServer(createMockEngine());
      const rpcB = await inMemoryRpc(serverB);
      const discover = await rpcB.rpc("server/discover", { _meta: modernMeta });
      assert(discover.error?.code === -32601, "modern server/discover -> -32601 (hand-wired path stays legacy-only)");
      await serverB.close();
      // C: tools/list with a modern envelope (no initialize) -> still returns tools.
      const serverC = buildServer(createMockEngine());
      const rpcC = await inMemoryRpc(serverC);
      const listC = await rpcC.rpc("tools/list", { _meta: modernMeta });
      assertToolList(listC.result?.tools, "modern-envelope tools/list");
      await serverC.close();
    }

    // ---- Part 2: stdio full 5-tool tools/call smoke (+ AJV input validation) ----
    {
      const server = buildServer(createMockEngine());
      const { rpc, notify } = await stdioRpc(server);
      await rpc("initialize", { protocolVersion: LATEST_LEGACY, capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
      notify("notifications/initialized");
      for (const name of TOOL_NAMES) {
        const res = await rpc("tools/call", { name, arguments: CALL_ARGS[name] });
        assertCallOk(res.result, name, "stdio");
        if (name === "ans_chat") {
          assert(String(res.result?.content?.[0]?.text ?? "").includes("not configured"), "stdio ans_chat: offline not-configured copy (no LLM call)");
        }
      }
      // AJV validation still enforced through fromJsonSchema (empty query rejected).
      const bad = await rpc("tools/call", { name: "search_web", arguments: { query: "" } });
      assert(bad.result?.isError === true, "stdio search_web: empty query rejected (isError true, AJV minLength)");
      const extra = await rpc("tools/call", { name: "search_web", arguments: { query: "x", nope: 1 } });
      assert(extra.result?.isError === true, "stdio search_web: additional property rejected (closed schema)");
      await server.close();
    }

    // ---- Part 3: stateless Streamable HTTP smoke (per-request factory) ----
    {
      const http = await httpStateless(() => buildServer(createMockEngine()));
      try {
        // initialize claiming the modern revision -> negotiated down, 200.
        const init = await http.post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: MODERN_VERSION, capabilities: {}, clientInfo: { name: "http-smoke", version: "0" } } });
        assert(init.status === 200, "http initialize: 200");
        assert(init.json?.result?.protocolVersion === LATEST_LEGACY, "http initialize@2026-07-28 negotiates " + LATEST_LEGACY);

        // tools/list on a FRESH server (stateless) with the version header.
        const list = await http.post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, { "mcp-protocol-version": LATEST_LEGACY });
        assert(list.status === 200, "http tools/list (version header): 200");
        assertToolList(list.json?.result?.tools, "http");

        // tools/list with NO initialize and NO version header — stateless serves it.
        const listNoInit = await http.post({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} });
        assert(listNoInit.status === 200, "http tools/list (no init, no header): 200 (stateless)");
        assertToolList(listNoInit.json?.result?.tools, "http-stateless");

        // Full 5-tool tools/call smoke over HTTP.
        let id = 10;
        for (const name of TOOL_NAMES) {
          const res = await http.post({ jsonrpc: "2.0", id: id++, method: "tools/call", params: { name, arguments: CALL_ARGS[name] } });
          assert(res.status === 200, "http tools/call " + name + ": 200");
          assertCallOk(res.json?.result, name, "http");
        }

        // Stateless consistency: a second independent tools/list still returns 5.
        const again = await http.post({ jsonrpc: "2.0", id: id++, method: "tools/list", params: {} });
        assert(again.status === 200 && (again.json?.result?.tools?.length ?? 0) === TOOL_NAMES.length, "http stateless: repeat tools/list consistent (fresh server per request)");
      } finally {
        await http.close();
      }
    }
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }

  console.log("--- mcp dual-era + transport smoke tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
