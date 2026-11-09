// #210 acceptance — ans_chat's LLM session cache is process-level across the
// stateless HTTP transport, while direct tool registrations stay isolated.
//
// Test setup: real createHttpApp() + real buildServer() + the real stateless
// Streamable HTTP transport, with an INJECTED session-factory counter (the
// confirmed test interface for #210 — not stderr-warning counting).
//
// Covered:
//   1. two stateless HTTP ans_chat calls with identical wire config construct
//      the LLM session once (including concurrent cold requests)
//   2. a contextWindow change rebuilds the session (window is in the key)
//   3. an API-key rotation rebuilds through the same slot (no split cache)
//   4. an identical repeat after the rebuild is a cache hit
//   5. stateless isolation: distinct minted session handles, and the model
//      context of the second call does not carry the first call's message
//   6. stdio keeps its process-level behavior (two calls, one construction)
//   7. the shared state holds the LLM client cache only, and a fresh default
//      state is created per direct registration
//
// No network: the injected factory returns a faux pi-ai session.
// No test framework (repo convention).

import type { AddressInfo } from "node:net";
import type { CompositionResult } from "@anysearch-cli/kernel";
import type { FusedEnvelope } from "@anysearch-cli/retriever";
import { createFauxCore, fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { createHttpApp } from "../src/http.js";
import { buildServer } from "../src/server.js";
import { createMcpToolState, type AnsChatSessionFactory } from "../src/tool-state.js";
import { stdioRpc } from "./helpers/mcp-harness.js";

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

const ENV_KEYS = [
  "ANS_LLM_PROVIDER",
  "ANS_LLM_MODEL",
  "ANS_LLM_BASE_URL",
  "ANS_LLM_API",
  "ANS_LLM_API_KEY",
  "ANS_LLM_CONTEXT_WINDOW",
  "ANS_MCP_KEY",
  "ANS_PROJECT_DB",
];

// Wire config the two cache-hit calls share.
const PROVIDER = "probe-provider";
const MODEL = "probe-model";
const WINDOW_A = "4096";
const WINDOW_B = "8192";
const KEY_A = "sk-probe-key-AAAA-0001";
const KEY_B = "sk-probe-key-BBBB-0002";

/**
 * Build a faux pi-ai session that answers "pong" once per prompt and records
 * the messages the model saw. `construction` labels which factory call built it.
 */
function buildFauxSession(
  opts: Parameters<AnsChatSessionFactory>[0],
  construction: number,
  seen: Array<{ construction: number; messages: any[] }>,
) {
  const faux = createFauxCore({ provider: opts.provider, models: [{ id: opts.model }] });
  // Each prompt consumes one response; the suite never runs more than a few.
  faux.setResponses(Array.from({ length: 8 }, () => (ctx: any) => {
    seen.push({ construction, messages: JSON.parse(JSON.stringify(ctx?.messages ?? [])) });
    return fauxAssistantMessage(fauxText("pong"));
  }));
  return {
    model: faux.getModel(),
    streamFn: faux.streamSimple,
    models: faux,
    providerName: opts.provider,
    modelName: opts.model,
    apiKey: opts.apiKey,
    contextWindow: opts.contextWindow,
  } as any;
}

/** Immediately-available counting factory. */
function makeCountingFactory(seen: Array<{ construction: number; messages: any[] }>) {
  let constructed = 0;
  const factory: AnsChatSessionFactory = async (opts) => {
    const construction = ++constructed;
    return buildFauxSession(opts, construction, seen);
  };
  return { factory, constructed: () => constructed };
}

/**
 * Factory whose first construction stays pending until `release()`.
 * A second concurrent request that reaches the cache while the build is pending
 * must join it instead of starting a second construction.
 */
function makeDeferredFactory(seen: Array<{ construction: number; messages: any[] }>) {
  let constructed = 0;
  let open: () => void = () => {};
  const gate = new Promise<void>((resolve) => { open = resolve; });
  const factory: AnsChatSessionFactory = async (opts) => {
    const construction = ++constructed;
    await gate;
    return buildFauxSession(opts, construction, seen);
  };
  return { factory, constructed: () => constructed, release: () => open() };
}

const emptyEnvelope: FusedEnvelope = {
  results: [],
  answers: [],
  metadata: { providersQueried: [], providersFailed: [], providersCancelled: [], elapsedMs: 0 },
};

const fakeSpan: any = {
  traceId: "cache-trace",
  spanId: "cache-span",
  addEvent: () => {},
  setAttributes: () => {},
  startSpan: async (_o: any, cb: any) => cb(fakeSpan),
  finish: () => {},
};

/** Engine with a store that mints a distinct handle per call (isolation probe). */
function createEngine(): CompositionResult {
  let seq = 0;
  const store = {
    createSession: async (domain: string) => ({
      id: "cache-sess-" + ++seq,
      domain,
      createdAt: new Date().toISOString(),
    }),
    ensureSession: async () => {},
    append: async () => {},
    searchFts5: async () => [],
    searchMemory: async () => [],
    saveResults: async () => {},
    saveAnchor: async () => {},
    getAnchors: async () => [],
  };
  const retriever = { search: async (): Promise<FusedEnvelope> => emptyEnvelope };
  const observation = { recordOperation: async (_o: unknown, cb: (span: unknown) => unknown) => cb(fakeSpan) };
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

/** One tools/call ans_chat over the app; returns the raw JSON-RPC response. */
async function callChat(post: (body: unknown) => Promise<{ status: number; json: any }>, id: number, message: string) {
  return post({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "ans_chat", arguments: { message } },
  });
}

function textOf(res: any): string {
  return String(res?.json?.result?.content?.[0]?.text ?? "");
}

function sessionIdOf(res: any): string | undefined {
  return res?.json?.result?.structuredContent?.sessionId;
}

async function main() {
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  const restoreEnv = () => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };

  try {
    // Wire config for every call unless a case changes it.
    process.env.ANS_LLM_PROVIDER = PROVIDER;
    process.env.ANS_LLM_MODEL = MODEL;
    process.env.ANS_LLM_BASE_URL = "http://127.0.0.1:9/v1";
    process.env.ANS_LLM_API = "chat";
    process.env.ANS_LLM_API_KEY = KEY_A;
    process.env.ANS_LLM_CONTEXT_WINDOW = WINDOW_A;

    const seen: Array<{ construction: number; messages: any[] }> = [];
    const counted = makeCountingFactory(seen);
    const state = createMcpToolState({ createAnsChatSession: counted.factory });
    const engine = createEngine();
    const app = createHttpApp(engine, state);
    const { post, close } = await startApp(app);

    try {
      // ---- 1. identical config: one construction across two HTTP requests ----
      const first = await callChat(post, 1, "first message");
      assert(first.status === 200, "http call 1: 200");
      assert(first.json?.result?.isError !== true, "http call 1: not isError");
      assert(textOf(first).includes("pong"), "http call 1: model answer reaches the caller");
      assert(counted.constructed() === 1, "http call 1: cold call constructs exactly one session");

      const second = await callChat(post, 2, "second message");
      assert(second.status === 200, "http call 2: 200");
      assert(second.json?.result?.isError !== true, "http call 2: not isError");
      assert(
        counted.constructed() === 1,
        "http call 2: identical wire config reuses the process-level session (got " + counted.constructed() + " constructions)",
      );

      // ---- 5. isolation: fresh handle per call, no conversation carry-over ----
      const firstHandle = sessionIdOf(first);
      const secondHandle = sessionIdOf(second);
      assert(!!firstHandle && !!secondHandle, "isolation: both calls mint a session handle");
      assert(
        firstHandle !== secondHandle,
        "isolation: each stateless call mints its own handle (no hidden cross-request session)",
      );
      const firstPrompt = seen.find((s) => JSON.stringify(s.messages).includes("first message"))?.messages ?? [];
      const secondPrompt = seen.find((s) => JSON.stringify(s.messages).includes("second message"))?.messages ?? [];
      assert(
        JSON.stringify(firstPrompt).includes("first message"),
        "isolation: the first run's model context carries its own message",
      );
      assert(
        JSON.stringify(secondPrompt).includes("second message") &&
          !JSON.stringify(secondPrompt).includes("first message"),
        "isolation: the second run starts fresh — no conversation state from the first request",
      );

      // ---- 2. contextWindow change: rebuild ----
      process.env.ANS_LLM_CONTEXT_WINDOW = WINDOW_B;
      const windowChanged = await callChat(post, 3, "window changed");
      assert(windowChanged.status === 200, "window change: 200");
      assert(
        counted.constructed() === 2,
        "contextWindow: a changed window selects a new slot and rebuilds (got " + counted.constructed() + ")",
      );

      // ---- 3. key rotation at the same config: rebuild, same slot ----
      process.env.ANS_LLM_CONTEXT_WINDOW = WINDOW_A;
      process.env.ANS_LLM_API_KEY = KEY_B;
      const rotated = await callChat(post, 4, "key rotated");
      assert(rotated.status === 200, "key rotation: 200");
      assert(
        counted.constructed() === 3,
        "rotation: a new API key rebuilds the session (got " + counted.constructed() + " constructions)",
      );

      // ---- 4. identical repeat: cache hit ----
      const repeat = await callChat(post, 5, "repeat");
      assert(repeat.status === 200, "repeat: 200");
      assert(
        counted.constructed() === 3,
        "repeat: identical config + identical key does not rebuild (got " + counted.constructed() + ")",
      );

      // Switching the credential back rebuilds the SAME slot again — the cache
      // does not keep the old credential's session alongside the new one.
      process.env.ANS_LLM_API_KEY = KEY_A;
      const switchedBack = await callChat(post, 6, "key switched back");
      assert(switchedBack.status === 200, "switch back: 200");
      assert(
        counted.constructed() === 4,
        "rotation: switching back rebuilds the same slot instead of retaining a split cache (got " +
          counted.constructed() + ")",
      );
      const switchedBackRepeat = await callChat(post, 7, "switch back repeat");
      assert(switchedBackRepeat.status === 200, "switch back repeat: 200");
      assert(
        counted.constructed() === 4,
        "rotation: the switched-back credential owns the slot (second call is a hit)",
      );
    } finally {
      await close();
    }

    // ---- 1b. concurrent cold requests share one in-flight construction ----
    {
      const seenConcurrent: Array<{ construction: number; messages: any[] }> = [];
      const deferred = makeDeferredFactory(seenConcurrent);
      const concurrentState = createMcpToolState({ createAnsChatSession: deferred.factory });
      const appConcurrent = createHttpApp(createEngine(), concurrentState);
      const { post: postConcurrent, close: closeConcurrent } = await startApp(appConcurrent);
      try {
        // Hold the first build open so the second request reaches the cache while
        // the construction is still pending.
        const first = callChat(postConcurrent, 20, "concurrent first");
        for (let i = 0; i < 200 && deferred.constructed() === 0; i++) {
          await new Promise((r) => setTimeout(r, 5));
        }
        assert(deferred.constructed() === 1, "concurrent: the first request entered the factory");

        const second = callChat(postConcurrent, 21, "concurrent second");
        await new Promise((r) => setTimeout(r, 100));
        assert(
          deferred.constructed() === 1,
          "concurrent: a second identical request joins the in-flight build (got " + deferred.constructed() + ")",
        );
        deferred.release();
        const [r1, r2] = await Promise.all([first, second]);
        assert(r1.status === 200 && r2.status === 200, "concurrent: both requests complete");
        assert(
          r1.json?.result?.isError !== true && r2.json?.result?.isError !== true,
          "concurrent: both requests succeed",
        );
        assert(
          deferred.constructed() === 1,
          "concurrent: both requests share one session construction (got " + deferred.constructed() + ")",
        );
      } finally {
        // Release a gate left closed by a failed assertion so no pending build
        // outlives the suite.
        deferred.release();
        await closeConcurrent();
      }
    }

    // ---- 6. stdio keeps its process-level behavior ----
    {
      const seenStdio: Array<{ construction: number; messages: any[] }> = [];
      const countedStdio = makeCountingFactory(seenStdio);
      const stateStdio = createMcpToolState({ createAnsChatSession: countedStdio.factory });
      const server = buildServer(createEngine(), stateStdio);
      const { rpc, notify } = await stdioRpc(server);
      await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "cache-probe", version: "0" } });
      notify("notifications/initialized");
      for (let i = 0; i < 2; i++) {
        const res = await rpc("tools/call", { name: "ans_chat", arguments: { message: "stdio message " + i } });
        assert(res.result?.isError !== true, "stdio call " + i + ": not isError");
      }
      assert(
        countedStdio.constructed() === 1,
        "stdio: one long-lived server keeps the process-level cache (got " + countedStdio.constructed() + ")",
      );
      await server.close();
    }

    // ---- 7. state shape + fresh default per direct registration ----
    {
      const a = createMcpToolState();
      const b = createMcpToolState();
      assert(
        a.ansChatSessionCache !== b.ansChatSessionCache,
        "default state: each instance gets a fresh cache (direct registrations stay isolated)",
      );
      assert(
        Object.keys(a).sort().join(",") === "ansChatSessionCache,createAnsChatSession",
        "shared state: holds the LLM client cache and its factory only — no conversation/handle/anchor/budget state",
      );
    }
  } finally {
    restoreEnv();
  }

  console.log("--- ans_chat shared-cache tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
