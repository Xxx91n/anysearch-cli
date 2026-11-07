// ans_chat tool: PiAgentRuntime agent loop as MCP tool.
// LLM session cache in closure, env-var keyed rebuild.
// #132: explicit server-minted session handle (threaded by the client) wires
// MemoryPipeline; no handle = single-shot.
// input validated by AJV.

import type { McpServer } from "@modelcontextprotocol/server";
import { fromJsonSchema } from "@modelcontextprotocol/server";
import type { CompositionResult } from "@anysearch-cli/kernel";
import { createLlmSession, PiAgentRuntime, parseContextWindow, KernelJsonSchemas, KernelToolDescriptions, type LlmSession } from "@anysearch-cli/kernel";
import { domainTomlPath } from "@anysearch-cli/store";
import { createHash } from "node:crypto";
import { buildAnsChatResult, resolveAnsChatSession } from "../ans-chat-session.js";
import { observeTool } from "./observation.js";
import { toolError, toolFailure } from "./failure.js";

export function registerAnsChat(server: McpServer, eng: CompositionResult): void {
  // Design: cache key = provider+model+baseUrl+api (all wire-affecting config); key material never enters key.
  // keyHash is a rotation-detection tiebreaker (F-A4: long-lived MCP process must rebuild on env key rotation),
  // not a cache partition. Single-process single-credential (env-only) — multi-credential coexistence excluded (T5 #91 #50).
  // Future per-request model override reserves an independent Map slot via an extra key segment, never overwriting the env default slot.
  type CacheEntry = { session: LlmSession; keyHash: string };
  const sessionCache = new Map<string, CacheEntry>();

  function buildCacheKey(opts: {
    provider: string;
    model: string;
    baseUrl?: string;
    api?: string;
    modelOverride?: string;
  }): string {
    // Structured tuple prevents ambiguous "/" collisions: distinct configs can no longer
    // produce the same string (e.g. model="a/b", baseUrl="c" vs model="a", baseUrl="b/c").
    // JSON array serialization is deterministic and collision-free for these fields.
    const tuple: string[] = [opts.provider, opts.model, opts.baseUrl ?? "", opts.api ?? ""];
    // Reserve for per-request model override: independent segment + independent Map slot.
    // Must not overwrite the env-keyed default slot — one override would pollute all later default calls (T5 #91).
    // An extra tuple element keeps the default key stable and guarantees no collision with
    // provider/model/baseUrl/api values (they are always the first four elements).
    if (opts.modelOverride) {
      tuple.push(opts.modelOverride);
    }
    return JSON.stringify(tuple);
  }

  async function getLlmSession(modelOverride?: string): Promise<LlmSession> {
    const providerName = process.env.ANS_LLM_PROVIDER ?? "";
    const modelName = process.env.ANS_LLM_MODEL ?? "";
    // thread the custom-endpoint env trio like apps/cli chat.ts:40-47 —
    // ANS_LLM_BASE_URL/ANS_LLM_API/ANS_LLM_API_KEY must reach createLlmSession on
    // the MCP path too, else the configured v1/chat upstream is unreachable.
    const baseUrl = process.env.ANS_LLM_BASE_URL;
    const apiRaw = process.env.ANS_LLM_API;
    const api = apiRaw === "chat" || apiRaw === "messages" || apiRaw === "responses" ? apiRaw : undefined;
    // #113: custom endpoints carry no catalog window; the MCP root reads the env
    // (kernel stays env-free). Malformed values fail the call, not silently 128000.
    const contextWindow = parseContextWindow(process.env.ANS_LLM_CONTEXT_WINDOW);
    // F-A4 tiebreaker: keyHash detects ANS_LLM_API_KEY rotation on a long-lived MCP server.
    // It is NOT part of the cache key partitioning — same provider/model/baseUrl/api
    // must hit the same cache slot; hash change re-creates the slot value, not a new slot.
    const keyHash = process.env.ANS_LLM_API_KEY
      ? createHash("sha256").update(process.env.ANS_LLM_API_KEY).digest("hex").slice(0, 12)
      : "";
    // Fingerprint the complete baseUrl before it enters the cache key: raw URLs can
    // contain userinfo (https://user:pass@host) or secrets in query strings, and the
    // ANS_LLM_API_KEY assertion alone would not catch them. Hashing preserves
    // distinct URLs → distinct slots and identical URLs → same slot, without storing
    // the raw URL (or any embedded credential) in the Map key. keyHash is not needed
    // as a tiebreaker for this case.
    const baseUrlFingerprint = baseUrl ? createHash("sha256").update(baseUrl).digest("hex") : "";
    // Wire-affecting config only; secret material never enters cache key (assertion below).
    const key = buildCacheKey({ provider: providerName, model: modelName, baseUrl: baseUrlFingerprint, api, modelOverride });

    // Assertion: cache key must not contain secret material. Key is built only from
    // provider+model+baseUrlFingerprint+api (+ optional override segment); keyHash/apiKey are separate.
    // This guards against accidental future leakage of keyHash or raw key into the key string.
    const rawKey = process.env.ANS_LLM_API_KEY;
    if (rawKey && rawKey.length >= 8 && key.includes(rawKey)) {
      throw new Error("cache key must not contain secret material");
    }

    const cached = sessionCache.get(key);
    if (cached && cached.keyHash === keyHash) return cached.session;
    if (baseUrl && !api) {
      throw new Error("ANS_LLM_BASE_URL requires ANS_LLM_API=chat|messages|responses");
    }
    // Lazy init / rotation rebuild: same slot is overwritten on tiebreaker mismatch — not split.
    const session = await createLlmSession({
      provider: providerName, model: modelName, baseUrl, api, contextWindow,
      apiKey: baseUrl ? process.env.ANS_LLM_API_KEY : undefined,
    });
    sessionCache.set(key, { session, keyHash });
    return session;
  }

  server.registerTool(
    "ans_chat",
    {
      description: KernelToolDescriptions.ans_chat,
      inputSchema: fromJsonSchema(KernelJsonSchemas.ans_chat),
    },
    async (args: unknown) => {
      const providerName = process.env.ANS_LLM_PROVIDER;
      const modelName = process.env.ANS_LLM_MODEL;
      return observeTool(eng, "ans_chat", async (span) => {
        const { message, sessionId: requestedSessionId } = args as { message: string; sessionId?: string };
        if (!providerName || !modelName) {
          // Missing configuration is an execution failure, not a successful
          // chat whose text happens to say "not configured".
          return toolFailure("ans_chat: LLM not configured. Set ANS_LLM_PROVIDER and ANS_LLM_MODEL env vars.");
        }
        try {
          const session = await getLlmSession();
          const domain = eng.config ?? {
            sources: { enabled: [] },
            prompts: [],
            skills: { active: ["search"] },
            hooks: { toolWhitelist: ["search"] },
            rag: { adapter: "none" },
          };
          // #132: explicit server-minted session handle (MCP 2026-07-28 /
          // SEP-2567). A caller that threads the handle from a previous
          // structuredContent.sessionId resumes the same L1/L2 anchors; omitting
          // it is the explicit single-shot mode (fresh session each call).
          // Either half missing leaves the runtime's `store && sessionId` gate
          // closed, which warnMissingMemoryWiring names on stderr.
          // #178: the resolver also returns the engine's ledger on success —
          // the same connection that holds the session's [budget] row — so the
          // agent loop's token/USD usage settles on the production path.
          const memory = await resolveAnsChatSession(eng, requestedSessionId);
          // ponytail: models undefined fix — pass session.models instead of undefined.
          const runtime = new PiAgentRuntime({
            retriever: eng.retriever,
            domain,
            ...memory,
            domainTomlPath: domainTomlPath(),
            model: session.model,
            // #113: the real window for the L0 watermark. The pipeline is built
            // whenever `memory` carries store + sessionId (a minted or threaded
            // handle); the watermark is skipped only when wiring failed open.
            // The env still sets the custom model's request-budget window via
            // the session.
            contextWindow: session.contextWindow,
            streamFn: session.streamFn,
            models: session.models,
            getApiKey: async () => session.apiKey,
            // one-line observation wiring — the ans_chat span
            // receives the engine's retrieval.domain_filter.* audit events.
            span,
          });
          let output = "";
          let runtimeError: string | undefined;
          for await (const event of runtime.run(message)) {
            if (event.type === "text") output += event.content;
            else if (event.type === "done") {
              output += "\n" + event.summary;
              // #189: the one-shot recovery summary stays visible to the caller.
              if (event.recovery) output += "\n" + event.recovery;
            } else if (event.type === "error") {
              runtimeError = event.message;
            }
          }
          // The runtime's error event means the loop did not complete; surface
          // it as an execution failure instead of a successful-looking text.
          if (runtimeError !== undefined) return toolError("ans_chat", runtimeError);
          return buildAnsChatResult(output, memory.sessionId);
        } catch (e) {
          return toolError("ans_chat", e instanceof Error ? e.message : String(e));
        }
      }, {
        "anysearch.provider": providerName ?? "",
        "anysearch.model": modelName ?? "",
      });
    }
  );
}
