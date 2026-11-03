// ans_chat tool: PiAgentRuntime agent loop as MCP tool.
// lazy session cache in closure, env-var keyed rebuild.
// input validated by AJV.

import type { McpServer } from "@modelcontextprotocol/server";
import { fromJsonSchema } from "@modelcontextprotocol/server";
import type { CompositionResult } from "@anysearch-cli/kernel";
import { createLlmSession, PiAgentRuntime, KernelJsonSchemas, KernelToolDescriptions, type LlmSession } from "@anysearch-cli/kernel";
import { domainTomlPath } from "@anysearch-cli/store";
import { createHash } from "node:crypto";
import { observeTool } from "./observation.js";

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
    const base = opts.provider + "/" + opts.model + "/" + (opts.baseUrl ?? "") + "/" + (opts.api ?? "");
    // Reserve for per-request model override: independent segment + independent Map slot.
    // Must not overwrite the env-keyed default slot — one override would pollute all later default calls (T5 #91).
    // Single extra segment with explicit prefix keeps default key stable and collision-free
    // (provider/model/baseUrl/api never contain the "/override:" marker).
    if (opts.modelOverride) {
      return base + "/override:" + opts.modelOverride;
    }
    return base;
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
    // F-A4 tiebreaker: keyHash detects ANS_LLM_API_KEY rotation on a long-lived MCP server.
    // It is NOT part of the cache key partitioning — same provider/model/baseUrl/api
    // must hit the same cache slot; hash change re-creates the slot value, not a new slot.
    const keyHash = process.env.ANS_LLM_API_KEY
      ? createHash("sha256").update(process.env.ANS_LLM_API_KEY).digest("hex").slice(0, 12)
      : "";
    // Wire-affecting config only; secret material never enters cache key (assertion below).
    const key = buildCacheKey({ provider: providerName, model: modelName, baseUrl, api, modelOverride });

    // Assertion: cache key must not contain secret material. Key is built only from
    // provider+model+baseUrl+api (+ optional override segment); keyHash/apiKey are separate.
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
      provider: providerName, model: modelName, baseUrl, api,
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
        const { message } = args as { message: string };
        if (!providerName || !modelName) {
          return { content: [{ type: "text" as const, text: "ans_chat: LLM not configured. Set ANS_LLM_PROVIDER and ANS_LLM_MODEL env vars." }] };
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
          // ponytail: models undefined fix — pass session.models instead of undefined.
          const runtime = new PiAgentRuntime({
            retriever: eng.retriever,
            domain,
            domainTomlPath: domainTomlPath(),
            model: session.model,
            streamFn: session.streamFn,
            models: session.models,
            getApiKey: async () => session.apiKey,
            // one-line observation wiring — the ans_chat span
            // receives the engine's retrieval.domain_filter.* audit events.
            span,
          });
          let output = "";
          for await (const event of runtime.run(message)) {
            if (event.type === "text") output += event.content;
            else if (event.type === "done") output += "\n" + event.summary;
            else if (event.type === "error") output += "\n[error: " + event.message + "]";
          }
          return { content: [{ type: "text" as const, text: output || "ans_chat: no response" }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: "ans_chat error: " + (e instanceof Error ? e.message : String(e)) }] };
        }
      }, {
        "anysearch.provider": providerName ?? "",
        "anysearch.model": modelName ?? "",
      });
    }
  );
}
