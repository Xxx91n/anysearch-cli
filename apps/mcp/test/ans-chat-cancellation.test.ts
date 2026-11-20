// #211 acceptance — ans_chat honors MCP request cancellation.
//
//   - stdio seam: the SDK handler context signal (`ctx.mcpReq.signal`) aborts
//     an active ans_chat run whose stub stream never resolves.
//   - HTTP seam: closing the stateless response stream aborts the same run
//     through the request-scoped signal stashed in AsyncLocalStorage (#209).
//   - A cancelled chat writes no completed summary/anchor and no FTS message
//     sync, and releases its budget reservation through the abort path rather
//     than settling as a completed run.
//   - A pre-aborted call performs no LLM construction or session mint.
//
// Test setup: the registered ans_chat handler with an injected session factory
// (never-resolving stream) plus the real createHttpApp() transport. No test
// framework (repo convention: assert-based, run via `node --import tsx --test`).

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { CompositionResult } from "@anysearch-cli/kernel";
import type { FusedEnvelope } from "@anysearch-cli/retriever";
import { createHttpApp } from "../src/http.js";
import { createMcpToolState, type AnsChatSessionFactory } from "../src/tool-state.js";
import { registerAnsChat } from "../src/tools/ans-chat.tool.js";

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

// #322 regression guard: PI session records under a dir (empty if absent).
function piRecords(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
  } catch {
    return [];
  }
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("timed out waiting for " + label);
}

const fakeSpan: any = {
  traceId: "ans-chat-cancel-trace",
  spanId: "ans-chat-cancel-span",
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

interface Recording {
  streamCalls: number;
  streamSignals: AbortSignal[];
  creates: number;
  appends: number;
  anchors: number;
  tokenSettles: Array<{ reserved: number; actual: number }>;
  callSettles: Array<{ reserved: number; actual: number }>;
  usdSettles: number;
}

function makeRecording(): Recording {
  return {
    streamCalls: 0, streamSignals: [], creates: 0, appends: 0, anchors: 0,
    tokenSettles: [], callSettles: [], usdSettles: 0,
  };
}

/** A faux LLM session whose stream function never settles — the #211 hang. */
function makeStalledState(rec: Recording, streamStarted: () => void) {
  const factory: AnsChatSessionFactory = async (opts) => ({
    model: { id: opts.model, provider: opts.provider } as any,
    streamFn: ((_model: any, _context: any, options?: { signal?: AbortSignal }) => {
      rec.streamCalls++;
      if (options?.signal) rec.streamSignals.push(options.signal);
      streamStarted();
      return new Promise(() => { /* never settles on purpose */ });
    }) as any,
    models: {} as any,
    providerName: opts.provider,
    modelName: opts.model,
    apiKey: opts.apiKey,
    contextWindow: opts.contextWindow,
  } as any);
  return createMcpToolState({ createAnsChatSession: factory });
}

function makeEngine(rec: Recording): CompositionResult {
  const store = {
    createSession: async (domain: string) => {
      rec.creates++;
      return { id: "cancel-chat-session", domain, createdAt: "" };
    },
    ensureSession: async () => {},
    append: async () => { rec.appends++; },
    saveAnchor: async () => { rec.anchors++; },
    saveResults: async () => {},
    searchFts5: async () => [],
    searchMemory: async () => [],
    getAnchors: async () => [],
  };
  const ledger = {
    reserveCalls: () => true,
    settleCalls: (_s: string, reserved: number, actual: number) => {
      rec.callSettles.push({ reserved, actual });
    },
    reserveTokens: () => true,
    settleTokens: (_s: string, reserved: number, actual: number) => {
      rec.tokenSettles.push({ reserved, actual });
    },
    reserveUsd: () => true,
    settleUsd: () => { rec.usdSettles++; },
  };
  return {
    retriever: { search: async (): Promise<FusedEnvelope> => emptyEnvelope },
    store,
    ledger,
    observation: { recordOperation: async (_o: any, cb: any) => cb(fakeSpan) },
  } as unknown as CompositionResult;
}

type Handler = (args: unknown, ctx?: { mcpReq?: { signal?: AbortSignal } }) => Promise<any>;

function captureAnsChat(eng: CompositionResult, state: ReturnType<typeof createMcpToolState>): Handler {
  let handler: Handler | undefined;
  const fakeServer = {
    registerTool: (name: string, _config: unknown, fn: Handler) => {
      if (name === "ans_chat") handler = fn;
    },
  };
  registerAnsChat(fakeServer as any, eng, state);
  if (!handler) throw new Error("ans_chat handler was not registered");
  return handler;
}

// #322: every env that can steer a chat's writes into the operator's real home.
const ENV_KEYS = [
  "ANS_LLM_PROVIDER",
  "ANS_LLM_MODEL",
  "ANS_DB_PATH",
  "ANS_PI_SESSION_DIR",
  "HOME",
  "USERPROFILE",
];

async function main() {
  // Snapshot the operator's real PI dir BEFORE touching HOME/USERPROFILE —
  // homedir() derives from those, so reading it after redirecting would make
  // the guard below watch the temp dir instead of the real one.
  const realPiDir = join(homedir(), ".ans", "pi-sessions");
  const realBefore = piRecords(realPiDir);

  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }

  // A chat that mints a session handle writes a PI record. Until #322 this
  // suite had no isolation and appended that record to ~/.ans/pi-sessions.
  const tempRoot = mkdtempSync(join(tmpdir(), "ans-322-cancellation-"));

  process.env.HOME = tempRoot;
  process.env.USERPROFILE = tempRoot;
  process.env.ANS_DB_PATH = join(tempRoot, "anysearch.db");
  process.env.ANS_PI_SESSION_DIR = join(tempRoot, "pi-sessions");
  process.env.ANS_LLM_PROVIDER = "cancel-provider";
  process.env.ANS_LLM_MODEL = "cancel-model";

  try {
    // ---- 1. stdio seam: the SDK context signal aborts a stalled ans_chat ----
    {
      const rec = makeRecording();
      let started: () => void = () => {};
      const streamStarted = new Promise<void>((r) => { started = r; });
      const state = makeStalledState(rec, () => started());
      const eng = makeEngine(rec);
      const handler = captureAnsChat(eng, state);
      const caller = new AbortController();

      const call = handler({ message: "hang" }, { mcpReq: { signal: caller.signal } });
      await streamStarted;
      assert(rec.streamCalls === 1, "1: the stalled stream started once");
      const abortedAt = Date.now();
      caller.abort("stdio cancellation");
      const result = await Promise.race([
        call,
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("handler did not end")), 2000)),
      ]);

      assert(Date.now() - abortedAt < 1000, "1: cancellation does not wait for the stalled stream");
      assert(rec.streamSignals[0]?.aborted === true,
        "1: the stalled stream's active signal is aborted after cancellation");
      assert(String(result?.content?.[0]?.text ?? "").includes("no response"),
        "1: a cancelled chat returns no Agent-completed summary");
      // #266: a cut-off run spent real money but has no final provider figure,
      // so it has to SAY that. An omitted usage block reads as "free".
      const cancelledUsage = (result?.structuredContent as any)?.usage;
      assert(cancelledUsage?.run?.costSource === "unknown",
        "1: a cancelled chat reports its cost as unknown, not omitted (got "
        + JSON.stringify(cancelledUsage?.run?.costSource) + ")");
      assert(Array.isArray(cancelledUsage?.run?.missing) && cancelledUsage.run.missing.length > 0,
        "1: a cancelled chat names the accounting the provider never sent (got "
        + JSON.stringify(cancelledUsage?.run?.missing) + ")");
      assert((result?.structuredContent as any)?.interrupted === true,
        "1: a cancelled chat marks itself interrupted rather than finished");
      await new Promise((r) => setTimeout(r, 30));
      assert(rec.appends === 0, "1: a cancelled chat performs no FTS message sync");
      assert(rec.anchors === 0, "1: a cancelled chat writes no memory anchor");
      assert(rec.usdSettles === 0, "1: a cancelled chat settles no USD as a completed run");
      assert(rec.callSettles.length === 1 && rec.callSettles[0].actual === 1,
        "1: the started LLM call is released once through the abort contract");
      assert(rec.tokenSettles.length === 1 &&
        rec.tokenSettles[0].reserved > 0 &&
        rec.tokenSettles[0].actual === rec.tokenSettles[0].reserved,
        "1: cancellation releases the token reservation through the abort path");
    }

    // ---- 2. pre-aborted call: no LLM construction, no session mint ----
    {
      const rec = makeRecording();
      const state = makeStalledState(rec, () => {});
      const eng = makeEngine(rec);
      const handler = captureAnsChat(eng, state);
      const caller = new AbortController();
      caller.abort("cancelled before the handler");

      const result = await handler({ message: "already gone" }, { mcpReq: { signal: caller.signal } });
      assert(rec.streamCalls === 0, "2: a pre-aborted call starts no LLM stream");
      assert(rec.creates === 0, "2: a pre-aborted call mints no session row");
      assert(/cancelled/i.test(String(result?.content?.[0]?.text ?? "")),
        "2: a pre-aborted call says it was cancelled, not that it answered");
    }

    // ---- 3. HTTP seam: closing the response stream aborts the stalled chat ----
    {
      const rec = makeRecording();
      let started: () => void = () => {};
      const streamStarted = new Promise<void>((r) => { started = r; });
      const state = makeStalledState(rec, () => started());
      const eng = makeEngine(rec);
      const app = createHttpApp(eng, state);
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
          params: { name: "ans_chat", arguments: { message: "http-hang" } },
        }),
        signal: caller.signal,
      }).catch(() => null);

      try {
        await streamStarted;
        caller.abort("client closed the response stream");
        await request;
        // The reservation release is the observable proof that the handler
        // ended; the aborted response itself can no longer carry the result.
        await waitFor(() => rec.tokenSettles.length === 1, "the HTTP chat to end");
        await new Promise((r) => setTimeout(r, 30));
        assert(rec.streamCalls === 1, "3: the HTTP stream started once");
        assert(rec.streamSignals[0]?.aborted === true,
          "3: the HTTP cancellation aborts the stalled stream's active signal");
        assert(rec.appends === 0, "3: a cancelled HTTP chat performs no FTS message sync");
        assert(rec.anchors === 0, "3: a cancelled HTTP chat writes no memory anchor");
        assert(rec.usdSettles === 0, "3: a cancelled HTTP chat settles no USD as a completed run");
        assert(rec.callSettles.length === 1 && rec.callSettles[0].actual === 1,
          "3: the started HTTP chat call is released once through the abort contract");
        assert(rec.tokenSettles[0].actual === rec.tokenSettles[0].reserved,
          "3: the HTTP cancellation releases the reservation through the abort path");
      } finally {
        await new Promise<void>((r) => {
          httpServer.close(() => r());
          httpServer.closeAllConnections?.();
        });
      }
    }

    // ---- #322: no PI record reached the operator's real home ----
    const realAfter = piRecords(realPiDir);
    assert(
      realBefore.join("|") === realAfter.join("|"),
      "#322: the operator's real ~/.ans/pi-sessions gained no record (before=" +
        realBefore.length + ", after=" + realAfter.length + ")",
    );
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    try { rmSync(tempRoot, { recursive: true, force: true }); } catch { /* OS temp */ }
  }

  console.log("--- ans_chat cancellation tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
