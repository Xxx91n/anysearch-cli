// ADR-0017 D2: createLlmSession deep module.
// One function, one return type, one error path.
// Encapsulates createModels -> setProvider -> getModel -> streamSimple.bind.
// No env reads in kernel — caller passes provider/config explicitly.
// Consumers: CLI chat command, MCP server ans_chat tool, plugin server.

import { createModels } from "@earendil-works/pi-ai";

export interface LlmSessionOptions {
  provider: string;
  model: string;
  /** Optional API key override; if omitted, pi-ai provider reads its own env vars. */
  apiKey?: string;
}

export interface LlmSession {
  model: ReturnType<ReturnType<typeof createModels>["getModel"]>;
  streamFn: ReturnType<typeof createModels>["streamSimple"];
  models: ReturnType<typeof createModels>;
  providerName: string;
  modelName: string;
  apiKey?: string;
}

// ADR-0017 D2: provider registry — delegates to pi-ai provider factories.
// ponytail: hardcoded for openai/anthropic/google; add more providers here when needed.
const PROVIDER_FACTORIES: Record<string, () => Promise<any>> = {
  openai: () => import("@earendil-works/pi-ai/providers/openai").then(m => m.openaiProvider()),
  anthropic: () => import("@earendil-works/pi-ai/providers/anthropic").then(m => m.anthropicProvider()),
  google: () => import("@earendil-works/pi-ai/providers/google").then(m => m.googleProvider()),
};

/**
 * Create an LLM session: createModels -> setProvider -> getModel -> streamSimple.bind.
 * Throws on unknown provider, missing model, or provider import failure.
 */
export async function createLlmSession(opts: LlmSessionOptions): Promise<LlmSession> {
  const factoryLoader = PROVIDER_FACTORIES[opts.provider];
  if (!factoryLoader) {
    throw new Error(`Unknown LLM provider: "${opts.provider}". Available: ${Object.keys(PROVIDER_FACTORIES).join(", ")}`);
  }

  const models = createModels();
  const providerFactory = await factoryLoader();
  models.setProvider(providerFactory);

  const model = models.getModel(opts.provider, opts.model);
  if (!model) {
    throw new Error(`Model not found: ${opts.provider}/${opts.model}`);
  }

  const streamFn = models.streamSimple.bind(models);
  const apiKey = opts.apiKey
    ?? (opts.provider === "openai" ? process.env.OPENAI_API_KEY
    : opts.provider === "anthropic" ? process.env.ANTHROPIC_API_KEY
    : opts.provider === "google" ? (process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY)
    : undefined);

  return { model, streamFn, models, providerName: opts.provider, modelName: opts.model, apiKey };
}
