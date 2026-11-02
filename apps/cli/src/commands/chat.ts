// ans chat: interactive retrieval-augmented chat session.
// decision 7: uses PiAgentRuntime for agent loop.
// uses createLlmSession deep module from kernel.
// LLM config resolves through the layered loader (cli > env > project > user >
// default; #38/#92): --llm.provider/--llm.model/--llm.base-url/--llm.api flags,
// ANS_LLM_* env, .anysearch/config.toml (whitelisted keys), ~/.anysearch-cli/config.toml.
// baseUrl shape: chat/responses include the version path (..../v1); messages excludes it (anthropic SDK appends /v1/messages).

import { PiAgentRuntime, createLlmSession } from "@anysearch-cli/kernel";
import type { RetrieverPort, DomainConfigPort } from "@anysearch-cli/kernel";
import { createEngine } from "../composition";
import { domainSearchDirs } from "../db";
import { parseLlmFlags, resolveLlmConfig } from "../config-llm";
import { domainTomlPath, loadDomainByNameIn } from "@anysearch-cli/store";
import { join } from "node:path";

export async function runChat(argv: string[]): Promise<number> {
  const { flags, argv: args } = parseLlmFlags(argv);
  // Parse query from args.
  const query = args.join(" ");
  if (!query) {
    process.stderr.write("Usage: ans chat [--llm.provider P] [--llm.model M] [query]\n");
    process.stderr.write("Example: ans chat \"What is RRF fusion?\"\n");
    return 2;
  }

  // Resolve LLM config: CLI flag > env > project > user > default.
  const cfg = resolveLlmConfig({ flags });
  if (!cfg.provider || !cfg.model) {
    process.stderr.write("LLM provider not configured.\n");
    process.stderr.write("Set with: ans llm set anthropic claude-sonnet-4-6  (writes ~/.anysearch-cli/config.toml)\n");
    process.stderr.write("Or:       export ANS_LLM_PROVIDER=anthropic ANS_LLM_MODEL=claude-sonnet-4-6\n");
    return 3;
  }

  // Initialize LLM session via kernel deep module.
  let session;
  try {
    // custom endpoint config — api is required when baseUrl is set (explicit
    // three-way; no protocol sniffing). cfg.apiKey supplies the secret via
    // env_key indirection or ANS_LLM_API_KEY.
    const baseUrl = cfg.baseUrl;
    if (baseUrl && !cfg.api) {
      process.stderr.write("base_url requires api=chat|messages|responses\n");
      return 3;
    }
    session = await createLlmSession({ provider: cfg.provider, model: cfg.model, baseUrl, api: cfg.api, apiKey: cfg.apiKey });
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
  // models undefined fix — session.models is now properly initialized.
  const runtime = new PiAgentRuntime({
    retriever,
    domain,
    // lazy mtime re-read lets `ans hitl --allow-url` write-back take effect live.
    domainTomlPath: domainTomlPath(),
    // CLI is the TTY composition root; kernel decides isInteractive itself.
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
