// ans llm: configure LLM providers (via @earendil-works/pi-ai).
// decision 7: list/set/check LLM providers.
// #108: `set` persists to the layered TOML config (~/.anysearch-cli/config.toml);
// env still overrides the file; secrets stay in env vars referenced by env_key.

import { createModels } from "@earendil-works/pi-ai";
import { PROVIDER_FACTORIES, PROVIDER_NAMES, MODELS, API_KEYS } from "@anysearch-cli/kernel";
import { resolveLlmConfig, userConfigPath, projectConfigPath, writeUserLlmConfig } from "../config-llm";

export async function runLlm(args: string[]): Promise<number> {
  if (args.length === 0) {
    console.log("ans llm - LLM provider configuration");
    console.log("---");
    const cfg = resolveLlmConfig();
    const src = (k: "provider" | "model") => cfg.sources[k] ?? "unset";
    console.log("Current: " + (cfg.provider || "(not set)") + "/" + (cfg.model || "(not set)") +
      "  [provider:" + src("provider") + " model:" + src("model") + "]");
    console.log("Files: user " + userConfigPath() + " | project " + projectConfigPath());
    console.log("");
    console.log("Available providers:");
    for (const [name, models] of Object.entries(MODELS)) {
      const apiKey = API_KEYS[name] || "UNKNOWN";
      // env_key indirection counts as auth only for the configured provider —
      // the secret belongs to whichever provider the file selected.
      const set = !!process.env[apiKey] || (name === cfg.provider && !!cfg.apiKey);
      console.log("  " + name + " [" + (set ? "AUTH" : "NO KEY") + "] - " + models.join(", "));
    }
    console.log("");
    console.log("Commands:");
    console.log("  ans llm set [provider] [model]  Set default LLM provider + model");
    console.log("  ans llm check                   Check auth status for all providers");
    console.log("  ans llm models [provider]       List available models");
    return 0;
  }

  const subcommand = args[0];

  if (subcommand === "set") {
    if (args.length < 2) {
      process.stderr.write("ans llm set [provider] [model]\n");
      process.stderr.write("Providers: openai, anthropic, google\n");
      return 2;
    }
    const provider = args[1];
    if (!PROVIDER_FACTORIES[provider]) {
      process.stderr.write("Unknown provider: " + provider + "\n");
      process.stderr.write("Available: openai, anthropic, google\n");
      return 2;
    }
    const model = args[2] || (MODELS[provider] ? MODELS[provider][0] : undefined);
    if (!model) {
      process.stderr.write("No model specified and no default available for " + provider + "\n");
      return 2;
    }

    console.log("Setting LLM provider: " + provider + "/" + model);
    const path = writeUserLlmConfig({ provider, model });
    console.log("Written to " + path + " ([llm] section; env vars still override it).");
    console.log("Secrets stay in env vars — reference one in the file via env_key = \"" + (API_KEYS[provider] || "YOUR_API_KEY_ENV") + "\".");
    console.log("");
    try {
      await PROVIDER_FACTORIES[provider]();
      console.log("[OK] Provider " + provider + " factory loaded successfully.");
    } catch (e: any) {
      console.log("[WARN] Provider factory failed: " + (e?.message || String(e)));
      console.log("Make sure the SDK is installed and API key is set.");
    }
    return 0;
  }

  if (subcommand === "check") {
    console.log("ans llm check - Auth status");
    console.log("---");
    for (const [name, factoryFn] of Object.entries(PROVIDER_FACTORIES)) {
      const apiKey = API_KEYS[name] || "UNKNOWN";
      const keySet = !!process.env[apiKey];
      try {
        await factoryFn();
        console.log("  " + name + ": [" + (keySet ? "KEY SET" : "NO KEY") + "]");
      } catch (e: any) {
        console.log("  " + name + ": [ERROR] " + (e?.message || String(e)));
      }
    }
    console.log("");
    console.log("Set keys via: export OPENAI_API_KEY=sk-xxx");
    return 0;
  }

  if (subcommand === "models") {
    const provider = args[1];
    if (provider) {
      if (!MODELS[provider]) {
        process.stderr.write("Unknown provider: " + provider + "\n");
        return 2;
      }
      console.log("Models for " + provider + ":");
      for (const m of MODELS[provider]) {
        console.log("  " + m);
      }
    } else {
      console.log("Available models:");
      for (const [p, models] of Object.entries(MODELS)) {
        console.log("  " + p + ": " + models.join(", "));
      }
    }
    return 0;
  }

  process.stderr.write("Unknown subcommand: " + subcommand + "\n");
  process.stderr.write("Use: ans llm (list), ans llm set [provider] [model], ans llm check, ans llm models\n");
  return 2;
}