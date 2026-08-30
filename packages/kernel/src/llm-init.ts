// ADR-0017 D2: createLlmSession deep module.
// One function, one return type, one error path.
// Encapsulates createModels -> setProvider -> getModel -> streamSimple.bind.
// No env reads in kernel — caller passes provider/config explicitly.
// Consumers: CLI chat command, MCP server ans_chat tool, plugin server.

import { createModels, createProvider, lazyApi, envApiKeyAuth } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai";

export interface LlmSessionOptions {
  provider: string;
  model: string;
  /** Optional API key override; if omitted, pi-ai provider reads its own env vars. */
  apiKey?: string;
  /**
   * ADR-0037 D4/A3: custom endpoint base URL (LiteLLM / OpenRouter / self-hosted).
   * When set, `api` is REQUIRED (explicit three-way selection, no protocol sniffing) and a
   * per-session provider is constructed from pi-ai primitives instead of the global registry.
   *
   * baseUrl shape depends on the wire protocol, because pi-ai delegates to the official SDKs:
   * - api=chat / api=responses -> openai SDK, appends "chat/completions" / "responses":
   *   baseUrl MUST include the version path (e.g. http://host/v1) to hit /v1/chat/completions.
   * - api=messages -> anthropic SDK, appends "/v1/messages" itself:
   *   baseUrl MUST be the host root WITHOUT /v1 (http://host), else /v1/v1/messages.
   */
  baseUrl?: string;
  /** Endpoint wire protocol: chat = <baseUrl>/chat/completions, messages = <baseUrl>/v1/messages, responses = <baseUrl>/responses. */
  api?: LlmEndpointKind;
}

export type LlmEndpointKind = "chat" | "messages" | "responses";

// pi-ai api module per endpoint kind (first-party implementations; lazyApi defers the import).
const ENDPOINT_MODULES: Record<LlmEndpointKind, () => Promise<unknown>> = {
  chat: () => import("@earendil-works/pi-ai/api/openai-completions"),
  messages: () => import("@earendil-works/pi-ai/api/anthropic-messages"),
  responses: () => import("@earendil-works/pi-ai/api/openai-responses"),
};

const ENDPOINT_API_IDS: Record<LlmEndpointKind, string> = {
  chat: "openai-completions",
  messages: "anthropic-messages",
  responses: "openai-responses",
};

export interface LlmSession {
  model: Model<string>;
  streamFn: ReturnType<typeof createModels>["streamSimple"];
  models: ReturnType<typeof createModels>;
  providerName: string;
  modelName: string;
  apiKey?: string;
}

// ADR-0017 D2: provider registry — delegates to pi-ai provider factories.
// ponytail: hardcoded for openai/anthropic/google; add more providers here when needed.
export const PROVIDER_FACTORIES: Record<string, () => Promise<any>> = {
  openai: () => import("@earendil-works/pi-ai/providers/openai").then(m => m.openaiProvider()),
  anthropic: () => import("@earendil-works/pi-ai/providers/anthropic").then(m => m.anthropicProvider()),
  google: () => import("@earendil-works/pi-ai/providers/google").then(m => m.googleProvider()),
};

// Derived from PROVIDER_FACTORIES keys — single source of truth, no drift.
export const PROVIDER_NAMES = Object.keys(PROVIDER_FACTORIES);

// Model catalog (pi-ai precedent: library owns the catalog, CLI renders it — generate-models).
// ponytail: hand-pinned subset of the pi-ai generated catalog; upgrade when pi ships a public catalog export.
export const MODELS: Record<string, string[]> = {
  openai: ["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5-codex"],
  anthropic: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"],
  google: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
};

// API_KEYS stays as CLI display hint (auth lives in pi-ai ProviderAuth, env name is consumer config).
export const API_KEYS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_API_KEY",
};

/**
 * Create an LLM session: createModels -> setProvider -> getModel -> streamSimple.bind.
 * Throws on unknown provider, missing model, or provider import failure.
 */
export async function createLlmSession(opts: LlmSessionOptions): Promise<LlmSession> {
  if (opts.baseUrl) {
    // ADR-0037 D4: explicit api required; never sniff the protocol from URL or response.
    if (!opts.api) {
      throw new Error("baseUrl requires explicit api kind: chat | messages | responses");
    }
    const model: Model<string> = {
      id: opts.model,
      name: opts.model,
      api: ENDPOINT_API_IDS[opts.api],
      provider: opts.provider,
      baseUrl: opts.baseUrl,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    };
    const provider = createProvider({
      id: opts.provider,
      name: opts.provider,
      baseUrl: opts.baseUrl,
      auth: { apiKey: envApiKeyAuth(opts.provider + " API key", ["ANS_LLM_API_KEY"]) },
      models: [model],
      api: lazyApi(ENDPOINT_MODULES[opts.api] as never),
    });
    const epModels = createModels();
    epModels.setProvider(provider);
    // r94 audit A2 (atomcode S1): no env reads in kernel — the caller (CLI chat/consolidate) passes ANS_LLM_API_KEY explicitly.
    const apiKey = opts.apiKey;
    const resolvedModel = (epModels.getModel(opts.provider, opts.model) ?? model) as Model<string>;
    return { model: resolvedModel, streamFn: epModels.streamSimple.bind(epModels), models: epModels, providerName: opts.provider, modelName: opts.model, apiKey } as LlmSession;
  }

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

  return { model: model as Model<string>, streamFn, models, providerName: opts.provider, modelName: opts.model, apiKey };
}
