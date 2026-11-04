// #112 acceptance — MCP engine per-CONNECTION reuse over stateless HTTP.
//
//   - HTTP 高频调用复用同一 engine/store: many requests, ONE injected engine,
//     and NO engine construction per request (proved by ANS_DB_PATH staying
//     absent — a per-request createEngine would mkdir it and open sqlite).
//   - 无状态规范回归: two requests do not leak request-level state into each
//     other; each tools/call sees exactly its own arguments and writes only
//     its own session.
//   - stdio path unchanged: buildServer(eng) still registers the 5 tools and
//     reuses the very engine it was handed.
//   - clientInfo seam: extractClientInfoName is pure, so the identity mapping
//     (initialize -> client_id, everything else -> anon) is pinned without HTTP.
//
// Seam: real createHttpApp() + real buildServer() over the mock engine (offline,
// no LLM). No test framework (repo convention).

import { createHttpApp, extractClientInfoName } from "../src/http.js";
import { buildServer } from "../src/server.js";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import type { AddressInfo } from "node:net";
import type { CompositionResult, Query } from "@anysearch-cli/kernel";
import type { FusedEnvelope } from "@anysearch-cli/retriever";
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

const emptyEnvelope: FusedEnvelope = {
  results: [],
  answers: [],
  metadata: { providersQueried: [], providersFailed: [], providersCancelled: [], elapsedMs: 0 },
};

const fakeSpan: any = {
  traceId: "reuse-trace",
  spanId: "reuse-span",
  addEvent: () => {},
  setAttributes: () => {},
  startSpan: async (_o: any, cb: any) => cb(fakeSpan),
  finish: () => {},
};

interface EngineLog {
  queries: string[];
  sessions: string[];
  saved: Array<{ sessionId: string; count: number }>;
}

// Counting engine: every observable interaction is appended, so a test can see
// WHICH engine served a request and in what order.
function createCountingEngine(log: EngineLog, tag: string): CompositionResult {
  let seq = 0;
  const retriever = {
    search: async (q: Query): Promise<FusedEnvelope> => {
      log.queries.push(String(q.query));
      return emptyEnvelope;
    },
  };
  const store = {
    createSession: async (d: string) => {
      const id = tag + "-session-" + ++seq;
      log.sessions.push(id);
      return { id, domain: d, createdAt: new Date().toISOString() };
    },
    append: async () => {},
    searchFts5: async () => [],
    searchMemory: async () => [],
    saveResults: async (sessionId: string, results: unknown[]) => {
      log.saved.push({ sessionId, count: results.length });
    },
    saveAnchor: async () => {},
    getAnchors: async () => [],
  };
  const observation = {
    recordOperation: async (_o: any, cb: any) => cb(fakeSpan),
  };
  return { retriever, store, observation } as unknown as CompositionResult;
}

async function startApp(app: ReturnType<typeof createHttpApp>) {
  const httpServer = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => httpServer.once("listening", () => r()));
  const port = (httpServer.address() as AddressInfo).port;
  const post = async (body: unknown) => {
    const r = await fetch("http://127.0.0.1:" + port + "/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify(body),
    });
    return { status: r.status, json: (await r.json().catch(() => null)) as any };
  };
  const close = () =>
    new Promise<void>((r) => {
      httpServer.close(() => r());
      httpServer.closeAllConnections?.();
    });
  return { post, close };
}

async function main() {
  // Keep the offline path offline (ans_chat / project index stay unset).
  const saved: Record<string, string | undefined> = {};
  for (const k of ["ANS_LLM_PROVIDER", "ANS_LLM_MODEL", "ANS_PROJECT_DB", "ANS_MCP_KEY"]) {
    saved[k] = process.env[k];
    delete process.env[k];
  }

  try {
    // ---- Part 1: many HTTP calls, ONE engine, zero per-request construction ----
    {
      const coldHome = mkdtempSync(join(tmpdir(), "ans-mcp-reuse-"));
      const coldDb = join(coldHome, "per-request", "anysearch.db"); // parents absent
      const prevDb = process.env.ANS_DB_PATH;
      process.env.ANS_DB_PATH = coldDb;

      const log: EngineLog = { queries: [], sessions: [], saved: [] };
      const engine = createCountingEngine(log, "shared");
      const { post, close } = await startApp(createHttpApp(engine));

      try {
        const N = 5;
        for (let i = 1; i <= N; i++) {
          const res = await post({
            jsonrpc: "2.0",
            id: i,
            method: "tools/call",
            params: { name: "search_web", arguments: { query: "q" + i } },
          });
          assert(res.status === 200, "http call " + i + ": 200");
          assert(res.json?.result?.isError !== true, "http call " + i + ": not isError");
        }

        // The injected engine served every request (a per-request createEngine
        // would bypass the mock entirely, leaving these logs empty).
        assert(log.queries.length === N, "engine reused: retriever saw all " + N + " calls (got " + log.queries.length + ")");
        assert(log.sessions.length === N, "engine reused: one session per call on the SAME store (got " + log.sessions.length + ")");
        // One store instance issued all sessions — a per-request engine would
        // restart the sequence at 1 (and come from a different sqlite handle).
        assert(
          log.sessions.join(",") === Array.from({ length: N }, (_, i) => "shared-session-" + (i + 1)).join(","),
          "engine reused: session ids come from one monotonic store (got " + JSON.stringify(log.sessions) + ")"
        );

        // The decisive regression guard: with ANS_DB_PATH pointing at a missing
        // tree, a per-request createEngine would mkdir it + open sqlite. It must
        // never happen, because the startup engine is injected, not built.
        assert(!existsSync(dirname(coldDb)), "no DB parent created: engine was NOT constructed per request");
        assert(!existsSync(coldDb), "no DB file created: engine was NOT constructed per request");
      } finally {
        await close();
        if (prevDb === undefined) delete process.env.ANS_DB_PATH; else process.env.ANS_DB_PATH = prevDb;
        try { rmSync(coldHome, { recursive: true, force: true }); } catch { /* OS temp */ }
      }
    }

    // ---- Part 2: stateless — no request-level state survives across calls ----
    {
      const log: EngineLog = { queries: [], sessions: [], saved: [] };
      const engine = createCountingEngine(log, "stateless");
      const { post, close } = await startApp(createHttpApp(engine));

      try {
        const first = await post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_web", arguments: { query: "alpha" } } });
        const second = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search_web", arguments: { query: "beta" } } });

        assert(first.status === 200 && second.status === 200, "stateless: both calls 200");
        // Each request replayed only its own arguments into the shared engine:
        // no carry-over of the previous query, no re-run of it.
        assert(
          log.queries.join(",") === "alpha,beta",
          "stateless: each call sees only its own query (got " + JSON.stringify(log.queries) + ")"
        );
        // Distinct sessions, and each save belongs to the session created by
        // its own request — no shared mutable session across requests.
        assert(log.sessions.length === 2 && log.sessions[0] !== log.sessions[1], "stateless: distinct session per request");
        assert(
          log.saved.length === 2 && log.saved[0].sessionId === log.sessions[0] && log.saved[1].sessionId === log.sessions[1],
          "stateless: each request wrote only its own session (got " + JSON.stringify(log.saved) + ")"
        );
        // Response payloads stay independent (fresh server per request): each
        // body reports only its own query, never the previous one.
        const textOf = (r: any): string => String(r?.json?.result?.content?.[0]?.text ?? "");
        assert(textOf(first).includes("alpha") && !textOf(first).includes("beta"), "stateless: first response carries only its own query");
        assert(textOf(second).includes("beta") && !textOf(second).includes("alpha"), "stateless: second response carries only its own query");
      } finally {
        await close();
      }
    }

    // ---- Part 3: stdio path unchanged (buildServer(eng) reuses that engine) ----
    {
      const log: EngineLog = { queries: [], sessions: [], saved: [] };
      const engine = createCountingEngine(log, "stdio");
      const serverA = buildServer(engine);
      const serverB = buildServer(engine);
      assert(serverA !== serverB, "stdio: buildServer() still returns a fresh server per call (factory pattern)");

      const rpc = await inMemoryRpc(serverA);
      await rpc.rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "reuse", version: "0" } });
      rpc.notify("notifications/initialized");
      const list = await rpc.rpc("tools/list", {});
      assert((list.result?.tools?.length ?? 0) === 5, "stdio: 5 tools registered on the injected engine");
      const call = await rpc.rpc("tools/call", { name: "search_web", arguments: { query: "stdio-only" } });
      assert(call.result?.isError !== true, "stdio: tools/call succeeds on the injected engine");
      assert(log.queries.join(",") === "stdio-only", "stdio: injected engine served the call unchanged");
      await serverA.close();
      await serverB.close();
    }

    // ---- Part 4: clientInfo identity seam (pure function, no HTTP) ----
    {
      const initBody = { method: "initialize", params: { clientInfo: { name: "claude-ai", version: "1.0.0" } } };
      assert(extractClientInfoName(initBody) === "claude-ai",
        "identity: initialize body yields the declared client name");
      assert(extractClientInfoName({ method: "tools/call", params: { name: "search_web", arguments: {} } }) === undefined,
        "identity: non-initialize call yields undefined (observer keeps anon id)");
      assert(extractClientInfoName({}) === undefined, "identity: empty body yields undefined");
      assert(extractClientInfoName(undefined) === undefined, "identity: absent body yields undefined");
      assert(extractClientInfoName({ params: {} }) === undefined, "identity: body without clientInfo yields undefined");
      assert(extractClientInfoName({ params: { clientInfo: { name: 42 } } }) === undefined,
        "identity: non-string name is not forwarded into the identity store");
      assert(extractClientInfoName({ params: { clientInfo: { name: "" } } }) === undefined,
        "identity: empty name is treated as absent");
    }
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }

  console.log("--- mcp engine reuse tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
