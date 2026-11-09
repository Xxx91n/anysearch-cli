// #209 acceptance — search tools and the engine honor caller cancellation.
//
//   - The registered handler seam passes the SDK context signal into the engine
//     for BOTH search_web and research_web (pre-aborted caller included).
//   - HTTP transport e2e: closing the response stream cancels an in-flight
//     search, the provider sees its signal abort, and no resume anchor or
//     session auto-index write happens afterwards.
//   - stdio e2e: `notifications/cancelled` on the SDK request signal reaches the
//     same seam through a real stdio transport.
//
// Test setup: real buildServer()/createHttpApp() over a real RetroaererdEngine with a
// mock provider (offline, no LLM, no network). No test framework (repo
// convention: assert-based, run via `node --import tsx --test`).

import { buildServer } from "../src/server.js";
import { createHttpApp } from "../src/http.js";
import { registerSearchWeb } from "../src/tools/search-web.tool.js";
import { registerResearchWeb } from "../src/tools/research-web.tool.js";
import { stdioRpc } from "./helpers/mcp-harness.js";
import { RetroaererdEngine } from "@anysearch-cli/kernel";
import type { CompositionResult } from "@anysearch-cli/kernel";
import type { SearchProvider, SearchRequest, ProviderEnvelope, FusedEnvelope } from "@anysearch-cli/retriever";
import type { SessionStore } from "@anysearch-cli/store";
import type { AddressInfo } from "node:net";

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

const fakeSpan = {
  traceId: "cancel-trace",
  spanId: "cancel-span",
  addEvent: () => {},
  setAttributes: () => {},
  startSpan: async (_o: any, cb: any) => cb(fakeSpan),
  finish: () => {},
};

const emptyEnvelope: FusedEnvelope = {
  results: [],
  answers: [],
  metadata: { providersQueried: [], providersFailed: [], providersCancelled: [], elapsedMs: 0 },
};

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timed out waiting for " + label);
}

type Handler = (args: unknown, ctx?: { mcpReq?: { signal?: AbortSignal } }) => Promise<any>;

function captureHandlers(eng: CompositionResult): Record<string, Handler> {
  const handlers: Record<string, Handler> = {};
  const fakeServer = {
    registerTool: (name: string, _config: unknown, handler: Handler) => {
      handlers[name] = handler;
    },
  };
  registerSearchWeb(fakeServer as any, eng);
  registerResearchWeb(fakeServer as any, eng);
  return handlers;
}

// Real engine + one slow mock provider. The provider blocks until its
// per-provider signal aborts, so tests observe the exact cancellation seam the
// engine builds.
function makeComposition() {
  const signals: AbortSignal[] = [];
  const anchors: unknown[] = [];
  const saves: unknown[] = [];
  let startedResolve: () => void = () => { };
  const started = new Promise<void>((r) => { startedResolve = r; });

  const provider: SearchProvider = {
    id: "slow",
    modes: ["fast", "index", "deep", "answer"],
    async search(_req: SearchRequest, signal: AbortSignal): Promise<ProviderEnvelope> {
      signals.push(signal);
      startedResolve();
      return new Promise<ProviderEnvelope>((resolve) => {
        const settle = () => resolve({ provider: "slow", results: [], answers: [], elapsedMs: 1 });
        if (signal.aborted) settle();
        else signal.addEventListener("abort", settle, { once: true });
      });
    },
  };

  const engine = new RetroaererdEngine([provider], {
    sessionId: "cancel-session",
    anchors: {
      saveAnchor: async (_sessionId, _type, payload) => {
        anchors.push(payload);
      },
    },
  });

  const store = {
    createSession: async (d: string) => ({ id: "cancel-store-session", domain: d, createdAt: "" }),
    ensureSession: async () => {},
    append: async () => {},
    searchFts5: async () => [],
    searchMemory: async () => [],
    saveResults: async (_sessionId: string, results: unknown[]) => {
      saves.push(results);
    },
    saveAnchor: async () => {},
    getAnchors: async () => [],
  } as unknown as SessionStore;

  const comp = {
    retriever: engine,
    store,
    observation: { recordOperation: async (_o: any, cb: any) => cb(fakeSpan) },
    providerBuildErrors: {},
  } as unknown as CompositionResult;

  return { comp, signals, anchors, saves, started };
}

async function main() {
  // ---- 1. Handler seam: both search tools forward the SDK context signal ----
  {
    const signals: Array<AbortSignal | undefined> = [];
    let saves = 0;
    const eng = {
      retriever: {
        search: async (q: any) => {
          signals.push(q.signal);
          return emptyEnvelope;
        },
      },
      store: {
        createSession: async (d: string) => ({ id: "s", domain: d, createdAt: "" }),
        saveResults: async () => {
          saves++;
        },
      },
      observation: { recordOperation: async (_o: any, cb: any) => cb(fakeSpan) },
      providerBuildErrors: {},
    } as unknown as CompositionResult;
    const h = captureHandlers(eng);

    const caller = new AbortController();
    caller.abort("cancelled before handler");
    await h.search_web({ query: "seam" }, { mcpReq: { signal: caller.signal } });
    await h.research_web({ question: "seam", depth: "brief" }, { mcpReq: { signal: caller.signal } });

    assert(signals.length === 2, "1: both search tools queried the engine");
    assert(signals[0]?.aborted === true, "1: search_web forwards an already-aborted SDK signal");
    assert(signals[1]?.aborted === true, "1: research_web forwards an already-aborted SDK signal");
    assert(saves === 0, "1: cancelled search_web performs no session auto-index");
  }

  // ---- 2. HTTP e2e: closing the response stream cancels an in-flight search ----
  {
    const { comp, signals, anchors, saves, started } = makeComposition();
    const app = createHttpApp(comp);
    const httpServer = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => httpServer.once("listening", () => r()));
    const port = (httpServer.address() as AddressInfo).port;

    const caller = new AbortController();
    const request = fetch("http://127.0.0.1:" + port + "/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "search_web", arguments: { query: "http-cancel" } },
      }),
      signal: caller.signal,
    }).catch(() => null);

    try {
      await started;
      assert(signals[0].aborted === false, "2: provider signal is live before the client cancels");
      caller.abort("client closed the response stream");
      await request;
      await waitFor(() => signals[0].aborted, "HTTP provider abort");
      // The handler continues briefly after the abort; give the post-cancel
      // branches time to (wrongly) write before asserting they did not.
      await new Promise((r) => setTimeout(r, 30));
      assert(signals[0].aborted === true, "2: closing the HTTP response stream aborts the provider signal");
      assert(anchors.length === 0, "2: cancelled HTTP search writes no sufficiency anchor");
      assert(saves.length === 0, "2: cancelled HTTP search performs no session auto-index");
    } finally {
      await new Promise<void>((r) => {
        httpServer.close(() => r());
        httpServer.closeAllConnections?.();
      });
    }
  }

  // ---- 3. stdio e2e: notifications/cancelled reaches the SDK request signal ----
  {
    const { comp, signals, anchors, saves, started } = makeComposition();
    const server = buildServer(comp);
    const { rpc, notify } = await stdioRpc(server);

    try {
      await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "cancel", version: "0" } });
      notify("notifications/initialized");
      // initialize is id 1; this tools/call is id 2 (the harness increments).
      const call = rpc("tools/call", { name: "search_web", arguments: { query: "stdio-cancel" } });
      call.catch(() => {});

      await started;
      assert(signals[0].aborted === false, "3: provider signal is live before the stdio cancellation");
      notify("notifications/cancelled", { requestId: 2, reason: "test cancellation" });
      await waitFor(() => signals[0].aborted, "stdio provider abort");
      await new Promise((r) => setTimeout(r, 30));
      assert(signals[0].aborted === true, "3: stdio cancellation aborts the provider signal");
      assert(anchors.length === 0, "3: cancelled stdio search writes no sufficiency anchor");
      assert(saves.length === 0, "3: cancelled stdio search performs no session auto-index");
    } finally {
      await server.close();
    }
  }

  console.log("--- mcp cancellation tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
