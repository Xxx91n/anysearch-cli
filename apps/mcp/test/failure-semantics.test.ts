// #204 acceptance — MCP execution-result semantics.
//
//   - Handler exceptions in search_web / research_web / recall_memory return
//     isError:true with the existing actionable text and no structuredContent.
//   - ans_chat without LLM configuration and a thrown runtime error are errors.
//   - A zero-result search is a success ONLY when an arm answered; an all-arm
//     outage is isError:true and names providersFailed.
//   - A partial failure with results is isError:false and carries
//     providersFailed / providerErrorClasses / providerBuildErrors in BOTH
//     content and structuredContent.
//   - Assertions travel the registered handler seam and, once, the real
//     stateless HTTP transport.
//
// No test framework (repo convention: assert-based, run via `node --import tsx
// --test`). Offline only: no providers, no LLM network.

import { buildServer } from "../src/server.js";
import { registerSearchWeb } from "../src/tools/search-web.tool.js";
import { registerResearchWeb } from "../src/tools/research-web.tool.js";
import { registerRecallMemory } from "../src/tools/recall-memory.tool.js";
import { registerAnsChat } from "../src/tools/ans-chat.tool.js";
import { registerQueryKnowledge } from "../src/tools/query-knowledge.tool.js";
import type { CompositionResult, Query } from "@anysearch-cli/kernel";
import type { FusedEnvelope, AttributionReport } from "@anysearch-cli/retriever";
import type { SessionStore } from "@anysearch-cli/store";
import { httpStateless } from "./helpers/mcp-harness.js";

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
  traceId: "t",
  spanId: "s",
  addEvent: () => {},
  setAttributes: () => {},
  startSpan: async (_o: any, cb: any) => cb(fakeSpan),
  finish: () => {},
};

type Handler = (args: unknown) => Promise<any>;

function captureHandlers(eng: CompositionResult): Record<string, Handler> {
  const handlers: Record<string, Handler> = {};
  const fakeServer = {
    registerTool: (name: string, _config: unknown, handler: Handler) => {
      handlers[name] = handler;
    },
  };
  registerSearchWeb(fakeServer as any, eng);
  registerResearchWeb(fakeServer as any, eng);
  registerRecallMemory(fakeServer as any, eng);
  registerAnsChat(fakeServer as any, eng);
  registerQueryKnowledge(fakeServer as any, eng);
  return handlers;
}

const okStore = {
  createSession: async (d: string) => ({ id: "s", domain: d, createdAt: "" }),
  ensureSession: async () => {},
  append: async () => {},
  searchFts5: async () => [],
  searchMemory: async () => [],
  saveResults: async () => {},
  saveAnchor: async () => {},
  getAnchors: async () => [],
};

function makeEngine(
  search: (q: Query) => Promise<FusedEnvelope>,
  extra: Partial<CompositionResult> = {},
): CompositionResult {
  return {
    retriever: { search },
    store: okStore as unknown as SessionStore,
    observation: { recordOperation: async (_o: any, cb: any) => cb(fakeSpan) },
    providerBuildErrors: {},
    ...extra,
  } as unknown as CompositionResult;
}

function emptyEnvelope(providersQueried: string[]): FusedEnvelope {
  return {
    results: [],
    answers: [],
    metadata: { providersQueried, providersFailed: [], providersCancelled: [], elapsedMs: 1 },
  };
}

function allFailedEnvelope(providers: string[]): FusedEnvelope {
  return {
    results: [],
    answers: [],
    metadata: {
      providersQueried: providers,
      providersFailed: [...providers],
      providersCancelled: [],
      providerErrorClasses: { [providers[0]]: "transient", [providers[1] ?? providers[0]]: "permanent-auth" },
      elapsedMs: 1,
    },
  } as FusedEnvelope;
}

function partialEnvelope(): FusedEnvelope {
  return {
    results: [{ url: "https://example.com/a", title: "A", snippet: "s", source: "exa" } as any],
    answers: [],
    metadata: {
      providersQueried: ["exa", "tavily"],
      providersFailed: ["tavily"],
      providersCancelled: [],
      providerErrorClasses: { tavily: "transient" },
      elapsedMs: 1,
    },
  } as FusedEnvelope;
}

const ENV_KEYS = ["ANS_LLM_PROVIDER", "ANS_LLM_MODEL", "ANS_LLM_BASE_URL", "ANS_LLM_API", "ANS_LLM_API_KEY", "ANS_PROJECT_DB"];
function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

async function main() {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }

  try {
    // ---- 1. Handler exceptions are execution errors (no structuredContent) ----
    {
      const eng = makeEngine(async () => {
        throw new Error("forced retriever failure");
      });
      const h = captureHandlers(eng);

      const sw = await h.search_web({ query: "x" });
      assert(sw?.isError === true, "search_web retriever failure: isError true");
      assert(
        sw?.content?.[0]?.text === "search_web error: forced retriever failure",
        "search_web retriever failure: existing actionable text kept",
      );
      assert(sw?.structuredContent === undefined, "search_web failure: no structuredContent");

      const rw = await h.research_web({ question: "x", depth: "brief" });
      assert(rw?.isError === true, "research_web retriever failure: isError true");
      assert(
        rw?.content?.[0]?.text === "research_web error: forced retriever failure",
        "research_web retriever failure: existing actionable text kept",
      );
      assert(rw?.structuredContent === undefined, "research_web failure: no structuredContent");
    }

    // ---- 2. Store failure in recall_memory is an execution error ----
    {
      const eng = makeEngine(async () => emptyEnvelope([]), {
        store: {
          ...okStore,
          searchMemory: async () => {
            throw new Error("forced store failure");
          },
        } as unknown as SessionStore,
      });
      const rm = await captureHandlers(eng).recall_memory({ query: "x", limit: 3 });
      assert(rm?.isError === true, "recall_memory store failure: isError true");
      assert(
        rm?.content?.[0]?.text === "recall_memory error: forced store failure",
        "recall_memory store failure: existing actionable text kept",
      );
      assert(rm?.structuredContent === undefined, "recall_memory failure: no structuredContent");
    }

    // ---- 3. ans_chat: missing configuration and runtime errors ----
    {
      // Missing config: captured at registration time from the env.
      const missing = await captureHandlers(makeEngine(async () => emptyEnvelope([]))).ans_chat({ message: "hi" });
      assert(missing?.isError === true, "ans_chat missing LLM config: isError true");
      assert(
        String(missing?.content?.[0]?.text) === "ans_chat: LLM not configured. Set ANS_LLM_PROVIDER and ANS_LLM_MODEL env vars.",
        "ans_chat missing LLM config: actionable copy kept",
      );
      assert(missing?.structuredContent === undefined, "ans_chat missing LLM config: no structuredContent");

      // Runtime error before any network call: baseUrl set without ANS_LLM_API.
      process.env.ANS_LLM_PROVIDER = "openai";
      process.env.ANS_LLM_MODEL = "gpt-5-mini";
      process.env.ANS_LLM_BASE_URL = "http://127.0.0.1:1/v1";
      const thrown = await captureHandlers(makeEngine(async () => emptyEnvelope([]))).ans_chat({ message: "hi" });
      assert(thrown?.isError === true, "ans_chat runtime error: isError true");
      assert(
        String(thrown?.content?.[0]?.text).includes("ANS_LLM_API"),
        "ans_chat runtime error: actionable text names the missing setting",
      );
      assert(thrown?.structuredContent === undefined, "ans_chat runtime error: no structuredContent");
      clearEnv();
    }

    // ---- 4. search_web: all-arm outage is an error, not an empty result ----
    {
      const h = captureHandlers(makeEngine(async () => allFailedEnvelope(["exa", "tavily"])));
      const res = await h.search_web({ query: "x" });
      assert(res?.isError === true, "search_web all providers failed: isError true");
      const text = String(res?.content?.[0]?.text);
      assert(text.includes("providersFailed: exa, tavily"), "search_web all providers failed: names providersFailed");
      assert(!text.includes("{"), "search_web all providers failed: error text is not a JSON payload");
      assert(res?.structuredContent === undefined, "search_web all providers failed: no structuredContent");
    }

    // ---- 5. research_web: all-arm outage across rounds is an error ----
    {
      const h = captureHandlers(makeEngine(async () => allFailedEnvelope(["exa", "tavily"])));
      const res = await h.research_web({ question: "x", depth: "brief" });
      assert(res?.isError === true, "research_web all providers failed: isError true");
      const text = String(res?.content?.[0]?.text);
      assert(text.includes("providersFailed: exa, tavily"), "research_web all providers failed: names providersFailed");
      assert(res?.structuredContent === undefined, "research_web all providers failed: no structuredContent");
    }

    // ---- 6. Partial failure with results stays a success + metadata ----
    {
      const eng = makeEngine(async () => partialEnvelope(), {
        providerBuildErrors: { exa: "permanent: missing/invalid credential — set the provider's API key env" },
      });
      const h = captureHandlers(eng);
      const res = await h.search_web({ query: "x" });

      assert(res?.isError !== true, "search_web partial failure: isError is not true");
      const doc = JSON.parse(String(res?.content?.[0]?.text));
      assert(doc.totalResults === 1, "search_web partial failure: results preserved");
      assert(
        JSON.stringify(doc.providersFailed) === JSON.stringify(["tavily"]),
        "search_web partial failure: content carries providersFailed",
      );
      assert(doc.providerErrorClasses?.tavily === "transient", "search_web partial failure: content carries providerErrorClasses");
      assert(
        typeof doc.providerBuildErrors?.exa === "string",
        "search_web partial failure: content carries providerBuildErrors",
      );
      const sc = res?.structuredContent;
      assert(sc !== undefined, "search_web partial failure: structuredContent present");
      assert(
        JSON.stringify(sc.providersFailed) === JSON.stringify(["tavily"]),
        "search_web partial failure: structuredContent carries providersFailed",
      );
      assert(sc.providerErrorClasses?.tavily === "transient", "search_web partial failure: structuredContent carries providerErrorClasses");
      assert(typeof sc.providerBuildErrors?.exa === "string", "search_web partial failure: structuredContent carries providerBuildErrors");
    }

    // ---- 7. research_web: same partial-failure contract ----
    {
      const eng = makeEngine(async () => partialEnvelope(), {
        providerBuildErrors: { exa: "permanent: missing/invalid credential — set the provider's API key env" },
      });
      const res = await captureHandlers(eng).research_web({ question: "x", depth: "brief" });
      assert(res?.isError !== true, "research_web partial failure: isError is not true");
      const doc = JSON.parse(String(res?.content?.[0]?.text));
      assert(doc.totalResults === 1, "research_web partial failure: results preserved");
      assert(JSON.stringify(doc.providersFailed) === JSON.stringify(["tavily"]), "research_web partial failure: content carries providersFailed");
      assert(doc.providerErrorClasses?.tavily === "transient", "research_web partial failure: content carries providerErrorClasses");
      assert(typeof doc.providerBuildErrors?.exa === "string", "research_web partial failure: content carries providerBuildErrors");
      const sc = res?.structuredContent;
      assert(sc?.providersFailed?.[0] === "tavily", "research_web partial failure: structuredContent carries providersFailed");
      assert(sc?.providerErrorClasses?.tavily === "transient", "research_web partial failure: structuredContent carries providerErrorClasses");
      assert(typeof sc?.providerBuildErrors?.exa === "string", "research_web partial failure: structuredContent carries providerBuildErrors");
    }

    // ---- 8. Zero results with an answering arm stays a success ----
    {
      const res = await captureHandlers(makeEngine(async () => emptyEnvelope(["exa"]))).search_web({ query: "x" });
      assert(res?.isError !== true, "search_web zero results with one successful provider: isError is not true");
      assert(!String(res?.content?.[0]?.text).includes("all providers failed"), "search_web zero results: not an outage message");
    }

    // ---- 9. Abstain keeps its successful policy-result contract ----
    {
      const abstainEnvelope = {
        results: [],
        answers: [],
        metadata: {
          providersQueried: ["exa"],
          providersFailed: [],
          providersCancelled: [],
          elapsedMs: 1,
          abstain: { abstain: true, reason: "domain_filter_empty", domain: "docs", preFiltered: 3, postFiltered: 0, gate: "post" },
        },
      } as FusedEnvelope;
      const res = await captureHandlers(makeEngine(async () => abstainEnvelope)).search_web({ query: "x" });
      assert(res?.isError !== true, "abstain: isError is not true");
      assert(res?.structuredContent?.abstain?.abstain === true, "abstain: structured marker preserved");
    }

    // ---- 10. query_knowledge none/note stay successful ----
    {
      const eng = makeEngine(async () => emptyEnvelope([]), {
        config: { rag: { adapter: "note" } } as any,
      });
      const res = await captureHandlers(eng).query_knowledge({ query: "x" });
      assert(res?.isError !== true, "query_knowledge adapter=note: isError is not true");
      assert(typeof res?.content?.[0]?.text === "string", "query_knowledge adapter=note: successful empty text result");
    }

    // ---- 11. Real stateless HTTP transport propagates isError ----
    {
      const eng = makeEngine(async () => {
        throw new Error("forced retriever failure");
      });
      const http = await httpStateless(() => buildServer(eng));
      try {
        const res = await http.post({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "search_web", arguments: { query: "x" } },
        });
        assert(res.status === 200, "http failure call: transport stays 200");
        assert(res.json?.result?.isError === true, "http failure call: isError propagates over the transport");
        assert(
          String(res.json?.result?.content?.[0]?.text).startsWith("search_web error:"),
          "http failure call: actionable text travels with the result",
        );
        assert(res.json?.result?.structuredContent === undefined, "http failure call: no structuredContent");

        // Protocol faults stay JSON-RPC errors — isError is execution-only.
        const unknown = await http.post({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "not_a_tool", arguments: {} },
        });
        assert(unknown.status === 200, "http unknown tool: transport stays 200");
        assert(unknown.json?.error !== undefined, "http unknown tool: stays a JSON-RPC error");
        assert(unknown.json?.result === undefined, "http unknown tool: not converted into a tool result");
      } finally {
        await http.close();
      }
    }

    // ---- 12. Attribution travels in BOTH channels on the success path ----
    // Replaces the ship-gate source-text count in the tool files: this drives
    // the registered handlers and reads the actual payloads.
    {
      const attribution: AttributionReport = {
        schema: "anysearch/attribution-report@1",
        generatedAt: "2026-01-01T00:00:00.000Z",
        claims: [],
        gaps: [],
        supportedCount: 0,
        uncertainCount: 0,
        unsupportedCount: 0,
        judgeEnhanced: false,
      };
      const h = captureHandlers(
        makeEngine(async () => ({ ...partialEnvelope(), attribution }) as FusedEnvelope),
      );

      const sw = await h.search_web({ query: "x" });
      const swDoc = JSON.parse(String(sw?.content?.[0]?.text));
      assert(swDoc.attribution?.schema === attribution.schema, "search_web content JSON carries attribution");
      assert(
        sw?.structuredContent?.attribution?.schema === attribution.schema,
        "search_web structuredContent carries attribution",
      );

      const rw = await h.research_web({ question: "x", depth: "brief" });
      const rwDoc = JSON.parse(String(rw?.content?.[0]?.text));
      assert(Array.isArray(rwDoc.attribution?.claims), "research_web content JSON carries attribution");
      assert(Array.isArray(rw?.structuredContent?.attribution?.claims), "research_web structuredContent carries attribution");
    }
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }

  console.log("--- mcp failure-semantics tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
