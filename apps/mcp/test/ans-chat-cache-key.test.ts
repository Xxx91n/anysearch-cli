// #179 acceptance - ans_chat LLM session cache-key pinning (#50 follow-up).
//
// The behavior under test was fixed by #111; this file adds regression tests
// only, so the production module stays untouched.
//
// Test setup: the tool module boundary (registerAnsChat). The cache closure lives in
// the real implementation, so these assertions pin the shipped behavior rather
// than a test-local copy of buildCacheKey.
//
// How a rebuild is observed without mocking the call chain:
//   - Catalog models (openai/gpt-5-mini) write one override line per
//     createLlmSession call when ANS_LLM_CONTEXT_WINDOW is set (#113, #258):
//     "[anysearch] ANS_LLM_CONTEXT_WINDOW overrides catalog model ...".
//     Counting that line is a direct count of session construction - tiny
//     probe, no network.
//   - For custom endpoints (baseUrl set) a local HTTP listener stands in for
//     the upstream: a rebuild repoints the request at the new endpoint, while a
//     cache hit keeps using the old one. The response is never asserted on -
//     the model call is allowed to fail; only "was the slot rebuilt" matters.
//
// No test framework (repo convention).

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { McpServer } from "@modelcontextprotocol/server";
import type { CompositionResult } from "@anysearch-cli/kernel";
import { registerAnsChat } from "../src/tools/ans-chat.tool.js";

let passed = 0;
let failed = 0;

/** Record one assertion result in the pass/fail tally. */
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error("FAIL: " + msg);
  }
}

// getLlmSession() refuses a cache key that embeds key material. Used as the
// "cache key shape" guard probe below.
const SECRET_MARKER = "cache key must not contain secret material";

const ENV_KEYS = [
  "ANS_LLM_PROVIDER",
  "ANS_LLM_MODEL",
  "ANS_LLM_BASE_URL",
  "ANS_LLM_API",
  "ANS_LLM_API_KEY",
  "ANS_LLM_CONTEXT_WINDOW",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
];

type ChatResult = { content: Array<{ type: string; text: string }> };
type ChatHandler = (args: unknown) => Promise<ChatResult>;

/**
 * Capture the handler that registerAnsChat registers, against a fake MCP server.
 *
 * Each harness owns a fresh cache closure, matching one long-lived MCP process:
 * the session cache is created inside the tool registration.
 */
function chatHarness(): ChatHandler {
  let handler: ChatHandler | undefined;
  const server = {
    registerTool: (name: string, _definition: unknown, h: ChatHandler) => {
      if (name === "ans_chat") handler = h;
    },
  } as unknown as McpServer;
  const engine = {
    // No store: resolves to single-shot memory wiring (no pipeline, no DB).
    retriever: { search: async () => ({ results: [], answers: [], metadata: {} }) },
    observation: { recordOperation: async (_op: unknown, cb: (span: unknown) => unknown) => cb(undefined) },
  } as unknown as CompositionResult;
  registerAnsChat(server, engine);
  if (!handler) throw new Error("ans_chat handler was not registered");
  return handler;
}

/** Concatenate the model-visible text blocks of one tool result. */
function outputOf(result: ChatResult): string {
  return result.content.map((block) => block.text).join("\n");
}

/** Invoke ans_chat once and return its text output. */
async function callOne(handler: ChatHandler): Promise<string> {
  return outputOf(await handler({ message: "cache-key probe" }));
}

/**
 * Count every catalog session construction via its override line, without
 * swallowing ordinary stderr output.
 */
let rebuilt = 0;
const originalStderrWrite = process.stderr.write;
function installRebuildProbe(): void {
  (process.stderr as unknown as { write: typeof process.stderr.write }).write = function (
    chunk: unknown,
    ...rest: unknown[]
  ) {
    if (String(chunk).includes("ANS_LLM_CONTEXT_WINDOW overrides catalog model")) rebuilt++;
    return (originalStderrWrite as (...args: unknown[]) => boolean).call(process.stderr, chunk, ...rest);
  } as typeof process.stderr.write;
}
/** Restore the original stderr writer after the probe has served its purpose. */
function restoreRebuildProbe(): void {
  process.stderr.write = originalStderrWrite;
}

/**
 * Start a local stand-in upstream and count how many model calls reach it.
 *
 * A request arriving here proves the session was (re)built against this
 * endpoint. The 400 response is deliberate: the model call is expected to
 * fail, and only "which endpoint was used" is asserted.
 */
async function startEndpointProbe() {
  let hits = 0;
  const httpServer = createServer((req, res) => {
    hits++;
    req.resume();
    // Connection: close keeps undici from holding a keep-alive socket open
    // after the suite finishes (that socket otherwise delays process exit).
    res.writeHead(400, { "content-type": "application/json", connection: "close" });
    res.end(JSON.stringify({ error: { message: "probe endpoint" } }));
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", () => resolve()));
  const port = (httpServer.address() as AddressInfo).port;
  return {
    url: "http://127.0.0.1:" + port + "/v1",
    hits: () => hits,
    close: () =>
      new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeAllConnections?.();
      }),
  };
}

/**
 * Run the cache-key regression scenarios and print the pass/fail tally.
 *
 * Environment variables and the stderr probe are restored in `finally`, so a
 * failing assertion cannot leak state into the rest of the test process.
 */
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
  // Register-time values: the handler closure captures provider/model once.
  const registerDefaults = () => {
    process.env.ANS_LLM_PROVIDER = "openai";
    process.env.ANS_LLM_MODEL = "gpt-5-mini";
  };

  installRebuildProbe();
  try {
    // ---- 1. rotation: keyHash is a tiebreaker, not a partition ----
    {
      registerDefaults();
      // The #113 catalog warning is the rebuild probe (one per constructor call).
      process.env.ANS_LLM_CONTEXT_WINDOW = "4096";
      const handler = chatHarness();
      const keyA = "sk-pin-test-key-AAAA-0001";
      const keyB = "sk-pin-test-key-BBBB-0002";
      process.env.ANS_LLM_API_KEY = keyA;

      let before = rebuilt;
      await callOne(handler);
      assert(rebuilt - before === 1, "rotation: cold call constructs exactly one session");

      before = rebuilt;
      await callOne(handler);
      assert(rebuilt - before === 0, "rotation: identical config + identical key hits the same slot (no rebuild)");

      before = rebuilt;
      process.env.ANS_LLM_API_KEY = keyB;
      await callOne(handler);
      assert(rebuilt - before === 1, "rotation: a new key rebuilds instead of reusing the old session (rotation detected)");

      before = rebuilt;
      await callOne(handler);
      assert(rebuilt - before === 0, "rotation: after the rebuild the new key owns the slot (second call is a hit)");

      before = rebuilt;
      process.env.ANS_LLM_API_KEY = keyA;
      await callOne(handler);
      assert(
        rebuilt - before === 1,
        "rotation: switching back also rebuilds - the old credential slot is not retained (same slot, no split cache)",
      );
    }

    // ---- 2. baseUrl slot identity + no raw secret material in the key ----
    {
      registerDefaults();
      const handler = chatHarness();
      // Two stand-in upstreams: the cold call binds the "stale" endpoint, the
      // switch targets "fresh". A cache hit keeps calling stale (fresh sees no
      // traffic); a rebuild repoints the session at fresh. Both answer 400 at
      // once, so neither path waits on a dead socket or a retry backoff.
      const stale = await startEndpointProbe();
      const fresh = await startEndpointProbe();
      try {
        const sharedKey = "sk-pin-test-key-SHARED-0003";
        process.env.ANS_LLM_BASE_URL = stale.url;
        process.env.ANS_LLM_API = "chat";
        process.env.ANS_LLM_API_KEY = sharedKey;
        await callOne(handler); // cold: the stale endpoint slot is created

        // 2a. switching the baseUrl must select a different slot.
        const freshBefore = fresh.hits();
        process.env.ANS_LLM_BASE_URL = fresh.url;
        await callOne(handler);
        assert(
          fresh.hits() > freshBefore,
          "baseUrl: a different endpoint selects a different slot (baseUrl participates in the key)",
        );

        // 2b. the raw URL is fingerprinted before entering the key: using the
        // URL itself as the credential must not trip the secret guard that
        // would fire if the raw URL were embedded in the key.
        const endpointKey = fresh.url;
        process.env.ANS_LLM_API_KEY = endpointKey; // new keyHash -> rebuild executes the guard
        const fingerprintProbe = await callOne(handler);
        assert(
          !fingerprintProbe.includes(SECRET_MARKER),
          "baseUrl: the raw URL is fingerprinted - it never lands in the cache key",
        );

        // 2c. the guard itself is still armed: an API key that occurs verbatim
        // inside the key tuple (here the model name) must be refused.
        process.env.ANS_LLM_API_KEY = process.env.ANS_LLM_MODEL!;
        const guardProbe = await callOne(handler);
        assert(
          guardProbe.includes(SECRET_MARKER),
          "secret guard: raw key material appearing in a cache key is rejected",
        );
      } finally {
        await Promise.all([stale.close(), fresh.close()]);
      }
    }
  } finally {
    restoreRebuildProbe();
    restoreEnv();
  }

  console.log("--- ans_chat cache-key tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  restoreRebuildProbe();
  console.error(e);
  process.exit(1);
});