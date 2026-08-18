// Shared LLM provider configuration for ans llm + ans chat.
// ADR-0007 decision 7: provider factory + model catalog.

export const PROVIDER_IMPORTS: Record<string, () => Promise<any>> = {
  openai: () => import("@earendil-works/pi-ai/providers/openai").then(m => m.openaiProvider()),
  anthropic: () => import("@earendil-works/pi-ai/providers/anthropic").then(m => m.anthropicProvider()),
  google: () => import("@earendil-works/pi-ai/providers/google").then(m => m.googleProvider()),
};

export const MODELS: Record<string, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "o3-mini", "o4-mini"],
  anthropic: ["claude-sonnet-4-6", "claude-opus-4-1", "claude-haiku-4-5"],
  google: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
};

export const API_KEYS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_API_KEY",
};