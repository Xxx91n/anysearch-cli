// ans_chat tool: PiAgentRuntime agent loop as MCP tool.
// ADR-0017 D2/D3: lazy session cache in closure, env-var keyed rebuild.
// ADR-0019 D3: input validated by AJV.

import type { McpServer } from "@modelcontextprotocol/server";
import { fromJsonSchema } from "@modelcontextprotocol/server";
import type { CompositionResult } from "@anysearch/kernel";
import { createLlmSession, PiAgentRuntime, KernelJsonSchemas, type LlmSession } from "@anysearch/kernel";
import { domainTomlPath } from "@anysearch/store";
import { observeTool } from "./observation.js";

export function registerAnsChat(server: McpServer, eng: CompositionResult): void {
  // ADR-0017 D3: lazy init on first ans_chat call, cached per server instance.
  // Env var change triggers rebuild (detected by key mismatch).
  let llmSession: LlmSession | null = null;
  let llmSessionKey = "";

  async function getLlmSession(): Promise<LlmSession> {
    const providerName = process.env.ANS_LLM_PROVIDER ?? "";
    const modelName = process.env.ANS_LLM_MODEL ?? "";
    const key = providerName + "/" + modelName;
    if (llmSession && llmSessionKey === key) return llmSession;
    // Lazy init: create on first call or when env changed.
    llmSession = await createLlmSession({ provider: providerName, model: modelName });
    llmSessionKey = key;
    return llmSession;
  }

  server.registerTool(
    "ans_chat",
    {
      description: "Run the anysearch agent loop: retrieval-augmented chat with LLM. Uses PiAgentRuntime with domain-aware tool filtering.",
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
            // ADR-0063 (R62 T7): one-line observation wiring — the ans_chat span
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
