// ans llm: configure LLM providers (via @earendil-works/pi-ai).
// List / set / check LLM providers.
// #108: `set` persists to the layered TOML config (~/.anysearch-cli/config.toml);
// env still overrides the file; secrets stay out of that file.
// #301: the key itself can now live in the user credential file (`ans auth set`),
// which a GUI host without a shell env also reads. Resolution order for the key
// is ANS_LLM_API_KEY > [llm].env_key > the credential file.
// `set` drops a stale env_key on provider switch (cross-provider secret guard #120).

import { createModels } from "@earendil-works/pi-ai";
import { PROVIDER_FACTORIES, PROVIDER_NAMES, MODELS, API_KEYS } from "@anysearch-cli/kernel";
import {
  readUserCredentials,
  userCredentialsPath as credentialsPath,
  resolveLlmConfig,
  userConfigPath,
  projectConfigPath,
  writeUserLlmConfig,
} from "../config-llm";

/** Which stored entries exist for this provider, as plain words (never a key). */
function storedBindings(provider: string): string[] {
  const file = readUserCredentials();
  return file.bindings
    .filter((b) => b.provider === provider)
    .map((b) => b.endpoint ?? "(provider default endpoint)");
}

export async function runLlm(args: string[]): Promise<number> {
  if (args.length === 0) {
    console.log("ans llm - LLM provider configuration");
    console.log("---");
    const cfg = resolveLlmConfig();
    const src = (k: keyof typeof cfg.sources) => cfg.sources[k] ?? "unset";
    console.log("Current: " + (cfg.provider || "(not set)") + "/" + (cfg.model || "(not set)") +
      "  [provider:" + src("provider") + " model:" + src("model") + "]");
    // #300: name where EVERY effective value came from, not just provider/model.
    // Sources are layer labels (flag/env/project/user/credentials), never the secret itself.
    console.log("Sources: provider=" + src("provider") + " model=" + src("model") +
      " baseUrl=" + src("baseUrl") + " api=" + src("api") + " apiKey=" + src("apiKey"));
    console.log("Files: user " + userConfigPath() + " | project " + projectConfigPath());
    console.log("Credentials: " + credentialsPath() + " (plain text; an env value still wins)");
    console.log("");
    console.log("Available providers:");
    for (const [name, models] of Object.entries(MODELS)) {
      const apiKey = API_KEYS[name] || "UNKNOWN";
      // Both sources count as auth, but each only for the provider it belongs
      // to: an env_key belongs to the provider the file selected, and a stored
      // entry is bound to its own provider and endpoint.
      const stored = storedBindings(name);
      const set = !!process.env[apiKey] || (name === cfg.provider && !!cfg.apiKey);
      const label = set ? "AUTH" : stored.length > 0 ? "AUTH (stored)" : "NO KEY";
      console.log("  " + name + " [" + label + "] - " + models.join(", "));
      if (!set && stored.length > 0) {
        // Say why a stored key did not count: it is bound to another endpoint.
        console.log("      stored for: " + stored.join(", ") + " — the effective endpoint differs");
      }
    }
    console.log("");
    console.log("Commands:");
    console.log("  ans llm set [provider] [model]  Set default LLM provider + model");
    console.log("  ans auth set <provider>         Store the key once (plain text, owner-only)");
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
    try {
      const path = writeUserLlmConfig({ provider, model });
      console.log("Written to " + path + " ([llm] section; env vars still override it).");
    } catch (e: any) {
      process.stderr.write((e?.message || String(e)) + "\n");
      return 1;
    }
    console.log("Secrets stay out of the config file — store one once with: ans auth set " + provider + ".");
    console.log("An env value (" + (API_KEYS[provider] || "YOUR_API_KEY_ENV") + " / ANS_LLM_API_KEY) still wins over the stored key.");
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
    const cfg = resolveLlmConfig();
    for (const [name, factoryFn] of Object.entries(PROVIDER_FACTORIES)) {
      const apiKey = API_KEYS[name] || "UNKNOWN";
      const keySet = !!process.env[apiKey];
      const fromStore = storedBindings(name);
      // The effective key for the selected provider can come from env, an
      // env_key indirection, or the stored file; other providers count only
      // their own env var and their own stored entries.
      const effective = name === cfg.provider && !!cfg.apiKey;
      const where = keySet ? "KEY SET (" + apiKey + ")"
        : effective ? "KEY SET (" + (cfg.sources.apiKey === "credentials" ? "stored file" :
          cfg.sources.apiKey === "user" ? "env_key" : "resolved") + ")"
          : fromStore.length > 0 ? "KEY SET (stored file)" : "NO KEY";
      try {
        await factoryFn();
        console.log("  " + name + ": [" + where + "]");
      } catch (e: any) {
        console.log("  " + name + ": [ERROR] " + (e?.message || String(e)));
      }
    }
    console.log("");
    console.log("Store a key once: ans auth set <provider>   (plain text, owner-only, shared with GUI entries)");
    console.log("Or set an env var: export OPENAI_API_KEY=...");
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