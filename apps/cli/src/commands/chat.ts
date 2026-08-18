// ans chat: interactive retrieval-augmented chat session.
// ADR-0007 decision 7: uses PiAgentRuntime for agent loop.
// Reads LLM config from ANS_LLM_PROVIDER + ANS_LLM_MODEL env vars.

import { createModels } from "@earendil-works/pi-ai";
import { PiAgentRuntime } from "@anysearch/kernel";
import type { RetrieverPort, DomainConfigPort } from "@anysearch/kernel";
import { createEngine } from "../composition";
import { loadDomainByName } from "@anysearch/store";

import { PROVIDER_IMPORTS, MODELS } from "../providers";

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

  if (!PROVIDER_IMPORTS[providerName]) {
    process.stderr.write("Unknown provider: " + providerName + "\n");
    process.stderr.write("Available: " + Object.keys(PROVIDER_IMPORTS).join(", ") + "\n");
    return 3;
  }

  // Initialize models.
  let model: any;
  let streamFn: any;
  try {
    const models = createModels();
    const providerFactory = await PROVIDER_IMPORTS[providerName]();
    models.setProvider(providerFactory);
    model = models.getModel(providerName, modelName);
    if (!model) {
      process.stderr.write("Model not found: " + providerName + "/" + modelName + "\n");
      process.stderr.write("Available: " + (MODELS[providerName] || []).join(", ") + "\n");
      return 3;
    }
    streamFn = models.streamSimple.bind(models);
  } catch (e: any) {
    process.stderr.write("Failed to initialize LLM: " + (e?.message || String(e)) + "\n");
    return 3;
  }

  // Initialize retriever + domain.
  const domainName = process.env.ANS_DOMAIN || "default";
  let retriever: RetrieverPort;
  let domain: DomainConfigPort;
  try {
    const engineResult = createEngine(domainName);
    retriever = engineResult.retriever;
    domain = engineResult.config || loadDomainByName(domainName) as DomainConfigPort;
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
  const runtime = new PiAgentRuntime({
    retriever,
    domain,
    model,
    streamFn,
    getApiKey: async () => {
      const key = providerName === "openai" ? process.env.OPENAI_API_KEY
        : providerName === "anthropic" ? process.env.ANTHROPIC_API_KEY
        : providerName === "google" ? (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY)
        : undefined;
      return key;
    },
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