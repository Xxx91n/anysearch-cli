// ans llm: configure LLM providers (via @earendil-works/pi-ai).
// List / set / check LLM providers.
// #108: `set` persists to the layered TOML config (~/.ans/config.toml);
// env still overrides the file; secrets stay out of that file.
// #301: the key itself can now live in the user credential file (`ans auth set`),
// which a GUI host without a shell env also reads. Resolution order for the key
// is ANS_LLM_API_KEY > [llm].env_key > the provider's own env var > the credential file.
// `set` drops a stale env_key on provider switch (cross-provider secret guard #120).

import { PROVIDER_FACTORIES, MODELS, API_KEYS } from "@anysearch-cli/kernel";
import { modelEnvKeysFor } from "@anysearch-cli/store";
import {
  type CredentialFileContents,
  displayEndpoint,
  KEY_SOURCE_LABELS,
  readUserCredentials,
  REPAIR_HINT,
  resolveConfigHome,
  userCredentialsPath as credentialsPath,
  resolveLlmConfig,
  userConfigPath,
  projectConfigPath,
  writeUserLlmConfig,
} from "../config-llm";

/** The BROKEN line both listings below print; the same result also goes to the resolver. */
function printCredentialFault(file: CredentialFileContents): void {
  if (file.error) console.log("Credentials file: BROKEN — " + file.error);
}

/** Which stored entries exist for this provider, as plain words (never a key). */
function storedBindings(file: CredentialFileContents, provider: string): string[] {
  return file.bindings
    .filter((b) => b.provider === provider)
    .map((b) => displayEndpoint(b.endpoint));
}

/** True when any env name this provider's key can live under is set. */
function envKeySet(provider: string): string | undefined {
  return modelEnvKeysFor(provider).find((name) => !!process.env[name]?.trim());
}

export async function runLlm(args: string[]): Promise<number> {
  // ONE root for the whole command, resolved from the process env - the same
  // input `ans auth` resolves it from - and passed explicitly to the resolver and
  // to the credential read, so the listing can never describe another file.
  const env = process.env;
  const home = resolveConfigHome(undefined, env);
  if (args.length === 0) {
    console.log("ans llm - LLM provider configuration");
    console.log("---");
    // Design: 列表和解析器共用一次读取，下面那行 BROKEN 是这句话唯一的出口。
    const credentialFile = readUserCredentials({ home });
    const cfg = resolveLlmConfig({ home, credentialsFile: credentialFile });
    const src = (k: keyof typeof cfg.sources) => cfg.sources[k] ?? "unset";
    console.log("Current: " + (cfg.provider || "(not set)") + "/" + (cfg.model || "(not set)") +
      "  [provider:" + src("provider") + " model:" + src("model") + "]");
    // #300: name where EVERY effective value came from, not just provider/model.
    // Sources are layer labels (flag/env/project/user/credentials), never the secret itself.
    console.log("Sources: provider=" + src("provider") + " model=" + src("model") +
      " baseUrl=" + src("baseUrl") + " api=" + src("api") + " apiKey=" + src("apiKey"));
    console.log("Files: user " + userConfigPath(home) + " | project " + projectConfigPath());
    console.log("Credentials: " + credentialsPath(home) + " (plain text; an env value still wins)");
    console.log("");
    console.log("Available providers:");
    printCredentialFault(credentialFile);
    for (const [name, models] of Object.entries(MODELS)) {
      const stored = storedBindings(credentialFile, name);
      // Three facts, three outcomes: the provider's own env var is set, its key
      // is the one in effect (possibly from another source), or only a stored
      // binding exists and is not being used. Every env name the provider's key
      // can live under counts, so the listing agrees with the resolver (which
      // accepts GEMINI_API_KEY for google).
      const envName = envKeySet(name);
      const effective = name === cfg.provider && !!cfg.apiKey;
      let label: string;
      if (envName || effective) label = "AUTH";
      else if (stored.length > 0) label = "NO KEY (stored, not in effect)";
      else label = "NO KEY";
      console.log("  " + name + " [" + label + "] - " + models.join(", "));
      if (envName && !effective) {
        // Name the variable, not a guess: which name carries the key is the
        // usable fact.
        console.log("      env: " + envName);
      }
      if (stored.length > 0 && !effective) {
        // Name the binding, not a guessed cause: the entry may be for another
        // provider or another endpoint.
        console.log("      stored for: " + stored.join(", "));
      }
    }
    console.log("");
    console.log("Commands:");
    console.log("  ans llm set [provider] [model]  Set default LLM provider + model");
    console.log("  ans auth set <provider>         Store the key once (plain text, owner-only)");
    console.log("  ans llm check                   Check auth status for all providers");
    console.log("  ans llm models [provider]       List available models");
    // A broken credential file is a failure, not a healthy listing: `ans auth`
    // and `ans doctor` already say so with exit 1, and a script reading only the
    // code must not see this command disagree (#537).
    if (credentialFile.error) {
      console.log(REPAIR_HINT);
      return 1;
    }
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
      console.log("Make sure the SDK is installed.");
      console.log("If the provider needs a key: ans auth set " + provider + "   (or export " + (API_KEYS[provider] || "ITS_API_KEY") + ")");
    }
    return 0;
  }

  if (subcommand === "check") {
    console.log("ans llm check - Auth status");
    console.log("---");
    const credentialFile = readUserCredentials({ home });
    const cfg = resolveLlmConfig({ home, credentialsFile: credentialFile });
    printCredentialFault(credentialFile);
    for (const [name, factoryFn] of Object.entries(PROVIDER_FACTORIES)) {
      const envName = envKeySet(name);
      const fromStore = credentialFile.bindings.some((b) => b.provider === name);
      const effective = name === cfg.provider && !!cfg.apiKey;
      // The resolver's source label IS the answer, so map it instead of
      // collapsing it into "resolved" (which told the user nothing).
      const layer = cfg.sources.apiKey;
      const resolvedFrom = layer ? KEY_SOURCE_LABELS[layer] : "an unknown source";
      let where: string;
      if (envName) where = "KEY SET (" + envName + ")";
      else if (effective) where = "KEY SET (" + resolvedFrom + ")";
      else if (fromStore) where = "KEY SET (stored file, not in effect)";
      else where = "NO KEY";
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
    if (credentialFile.error) {
      console.log(REPAIR_HINT);
      return 1;
    }
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