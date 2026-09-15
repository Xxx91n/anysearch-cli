// ans chat: interactive retrieval-augmented chat session.
// ADR-0007 decision 7: uses PiAgentRuntime for agent loop.
// ADR-0017 D2: uses createLlmSession deep module from kernel.
// Reads LLM config from ANS_LLM_PROVIDER + ANS_LLM_MODEL env vars.
// ADR-0037 D4/A3: optional custom endpoint via ANS_LLM_BASE_URL + ANS_LLM_API (chat|messages|responses).
// baseUrl shape: chat/responses include the version path (..../v1); messages excludes it (anthropic SDK appends /v1/messages).

import { PiAgentRuntime, createLlmSession } from "@anysearch-cli/kernel";
import type { RetrieverPort, DomainConfigPort } from "@anysearch-cli/kernel";
import { createEngine } from "../composition";
import { domainSearchDirs } from "../db";
import { domainTomlPath, loadDomainByNameIn } from "@anysearch-cli/store";
import { join } from "node:path";

export async function runChat(args: string[]): Promise<number> {
  // Parse query from args.
  const query = args.join(" ");
  if (!query) {
    process.stderr.write("Usage: ans chat [query]\n");
    process.stderr.write("Example: ans chat \"What is RRF fusion?\"\n");
    return 2;
  }

  // Check LLM config.
  const providerName = process.env.ANS_LLM_PROVIDER;
  const modelName = process.env.ANS_LLM_MODEL;
  if (!providerName || !modelName) {
    process.stderr.write("LLM provider not configured.\n");
    process.stderr.write("Set with: export ANS_LLM_PROVIDER=anthropic\n");
    process.stderr.write("           export ANS_LLM_MODEL=claude-sonnet-4-6\n");
    process.stderr.write("Or use:   ans llm set anthropic claude-sonnet-4-6\n");
    return 3;
  }

  // Initialize LLM session via kernel deep module (ADR-0017 D2).
  let session;
  try {
    // ADR-0037 D4: custom endpoint config — ANS_LLM_API is required when ANS_LLM_BASE_URL is
    // set (explicit three-way; no protocol sniffing). ANS_LLM_API_KEY supplies the key.
    const baseUrl = process.env.ANS_LLM_BASE_URL;
    const apiRaw = process.env.ANS_LLM_API;
    const api = apiRaw === "chat" || apiRaw === "messages" || apiRaw === "responses" ? apiRaw : undefined;
    if (baseUrl && !api) {
      process.stderr.write("ANS_LLM_BASE_URL requires ANS_LLM_API=chat|messages|responses\n");
      return 3;
    }
    session = await createLlmSession({ provider: providerName, model: modelName, baseUrl, api, apiKey: baseUrl ? process.env.ANS_LLM_API_KEY : undefined });
  } catch (e: any) {
    process.stderr.write("Failed to initialize LLM: " + (e?.message || String(e)) + "\n");
    return 3;
  }

  // Initialize retriever + domain.
  const domainName = process.env.ANS_DOMAIN || "default";
  let retriever: RetrieverPort;
  let domain: DomainConfigPort;
  try {
    const engineResult = createEngine(domainName, { domainsDirs: domainSearchDirs() });
    retriever = engineResult.retriever;
    domain = engineResult.config || loadDomainByNameIn(domainName, domainSearchDirs()) as DomainConfigPort;
  } catch (e: any) {
    console.error("[warn] Domain load failed: " + (e?.message || String(e)) + ", using fallback.");
    // Fallback: no domain filtering, all providers.
    const fallback = createEngine();
    retriever = fallback.retriever;
    domain = {
      sources: { enabled: [] },
      prompts: [],
      skills: { active: ["search"] },
      hooks: { toolWhitelist: ["search"] },
      rag: { adapter: "none" },
    };
  }

  // Construct PiAgentRuntime and run.
  // ADR-0017 D1: models undefined fix — session.models is now properly initialized.
  const runtime = new PiAgentRuntime({
    retriever,
    domain,
    // ADR-0055 D5: lazy mtime re-read lets `ans hitl --allow-url` write-back take effect live.
    domainTomlPath: domainTomlPath(),
    // ADR-0054 D4: CLI is the TTY composition root; kernel decides isInteractive() itself.
    interactive: !process.env.ANS_NO_INTERACTIVE,
    model: session.model,
    streamFn: session.streamFn,
    models: session.models,
    getApiKey: async () => session.apiKey,
  });

  console.log("ans chat: " + query);
  console.log("---");

  try {
    for await (const event of runtime.run(query)) {
      switch (event.type) {
        case "text":
          process.stdout.write(event.content);
          break;
        case "tool_call":
          console.log("\n[tool: " + event.name + "] " + JSON.stringify(event.args));
          break;
        case "tool_result":
          console.log("[result: " + event.name + "]");
          break;
        case "search":
          console.log("\n[search: " + event.query + "]");
          break;
        case "search_result":
          console.log("[search done]");
          break;
        case "done":
          console.log("\n---");
          console.log(event.summary);
          break;
        case "error":
          console.error("\n[error] " + event.message);
          return 1;
      }
    }
  } catch (e: any) {
    console.error("[error] " + (e?.message || String(e)));
    return 1;
  }

  return 0;
}
