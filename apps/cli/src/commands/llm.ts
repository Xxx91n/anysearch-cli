// ans llm: configure LLM providers (via @earendil-works/pi-ai).
// ADR-0007 decision 7: list/set/check LLM providers.
// ponytail: MVP - register provider, check auth, set default model via env/config.

import { createModels } from "@earendil-works/pi-ai";
import { PROVIDER_FACTORIES, PROVIDER_NAMES, MODELS, API_KEYS } from "@anysearch/kernel";

export async function runLlm(args: string[]): Promise<number> {
  if (args.length === 0) {
    console.log("ans llm - LLM provider configuration");
    console.log("---");
    const currentProvider = process.env.ANS_LLM_PROVIDER || "(not set)";
    const currentModel = process.env.ANS_LLM_MODEL || "(not set)";
    console.log("Current: " + currentProvider + "/" + currentModel);
    console.log("");
    console.log("Available providers:");
    for (const [name, models] of Object.entries(MODELS)) {
      const apiKey = API_KEYS[name] || "UNKNOWN";
      const set = !!process.env[apiKey];
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
    console.log("");
    console.log("To persist, add to your environment:");
    console.log("  export ANS_LLM_PROVIDER=" + provider);
    console.log("  export ANS_LLM_MODEL=" + model);
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