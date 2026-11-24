// Layered TOML LLM config (issue #38, decision #92; shared home since #300).
// This is the ONE resolver for model settings. CLI and MCP both call it, so an
// independent MCP and an MCP launched by the CLI read the same user/project
// files through the same rules. Layers per key, high → low:
//   flag > env > project > user > default
//   user    ~/.ans/config.toml             [llm] section
//   project .ans/config.toml               [llm] section, safety whitelist only
// Model config files never hold a secret VALUE: they store an `env_key`
// indirection naming the env var that holds the key; plaintext secret keys in
// either file are ignored with a warning. Project files are further restricted
// to a non-security whitelist so a malicious repo cannot redirect the endpoint
// or the secret source (Codex project-key precedent).
// The key itself comes from, in order: ANS_LLM_API_KEY, the env var named by
// `env_key`, the selected provider's own env vars, then the user credential file
// (#301). The credential file is the GUI-friendly path (a GUI host inherits no
// shell env) and its entries are bound to a provider - and, for model providers,
// an endpoint - so a key entered for one provider is never sent to another one.
// The resolver reads env + files and passes values in; the kernel stays env-free
// (LlmSession contract). Every resolved field carries its source in `sources`,
// so callers can say where a value came from instead of guessing.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parse as tomlParse, stringify as tomlStringify } from "smol-toml";
import { ansCredentialsPathFor, ansProjectConfigPath, ansUserConfigPathFor } from "./ans-paths.js";
import {
  credentialProvider,
  lookupModelCredential,
  displayEndpoint,
  modelEnvKeysFor,
  normalizeBindingEndpoint,
  providerForEnvKey,
  readUserCredentials,
  resolveConfigHome,
} from "./credentials";
import type { CredentialFileContents } from "./credentials";

/** `credentials` = the user credential file (#301); every other layer is a config source. */
export type LlmLayer = "cli" | "env" | "project" | "user" | "credentials";

/**
 * How to name each layer in plain words, for any command that shows where a
 * value came from. It lives next to `LlmLayer` because the labels ARE that
 * type's vocabulary: `Record<LlmLayer, string>` means a new layer cannot ship
 * without a label, and every caller looks up the label for the layer it got.
 */
export const KEY_SOURCE_LABELS: Record<LlmLayer, string> = {
  cli: "command line",
  env: "env",
  project: "project file",
  user: "env via [llm].env_key",
  credentials: "stored file",
};

// Keys a project-level file may set under [llm]. Everything security-adjacent
// (endpoint, wire protocol, secret source) is user-level only.
const PROJECT_LLM_WHITELIST = new Set(["provider", "model"]);
const USER_LLM_KEYS = new Set(["provider", "model", "base_url", "api", "env_key"]);
const SECRET_KEY_RE = /api[_-]?key|token|secret|password/i;

export interface LlmFileConfig {
  provider?: string;
  model?: string;
  base_url?: string;
  api?: string;
  env_key?: string;
}

export interface LlmFlags {
  provider?: string;
  model?: string;
  baseUrl?: string;
  api?: string;
}

export type LlmConfigFaultKind = "unreadable" | "invalid-toml";

export interface ResolvedLlmConfig {
  provider?: string;
  model?: string;
  baseUrl?: string;
  api?: "chat" | "messages" | "responses";
  /** Secret material resolved via ANS_LLM_API_KEY, env_key indirection, the provider's own env vars
   * or the user credential file. */
  apiKey?: string;
  /** The env var name the file asked the key to come from, if any. */
  envKey?: string;
  /** Which layer supplied each resolved field (for `ans llm` display + tests). */
  sources: Partial<Record<"provider" | "model" | "baseUrl" | "api" | "apiKey", LlmLayer>>;
  /** A config file existed but could not be read or parsed. Never carries file contents. */
  configFault?: LlmConfigFaultKind;
  /** A healthy user credential file contains at least one model-provider binding. */
  hasStoredModelCredential?: boolean;
}

export function formatLlmConfigFault(cfg: ResolvedLlmConfig): string | undefined {
  if (!cfg.configFault || (cfg.provider && cfg.model)) return undefined;
  return "LLM config file is broken; provider/model could not be loaded. Fix the config file and try again." +
    (cfg.hasStoredModelCredential
      ? " A model API key is still stored in credentials.json, but it is not in use until the config is fixed."
      : "");
}

export interface ResolveLlmOpts {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /**
   * The config root. Omit it and the root is `resolveConfigHome(undefined, env)`:
   * the same call the writers make, so a caller only gets a different file by
   * passing a different `home` on purpose.
   *
   * An injected `env` is not isolation: if it names HOME/USERPROFILE the root
   * follows it; if it names neither, `resolveConfigHome` lands on `homedir()`.
   * A caller that needs a fixed root passes `home`. (The path helpers below take
   * only a root, so they cannot follow a caller's `env` at all.)
   */
  home?: string;
  flags?: LlmFlags;
  warn?: (msg: string) => void;
  /**
   * Turn OFF the user credential file (#301) for a caller that must only see
   * env/config values (the acceptance lane's "no user store at all" case).
   */
  credentials?: boolean;
  /**
   * An already-parsed credential file (#357). Pass the one result of
   * `readUserCredentials` and this resolver uses it instead of reading the file
   * again; it also stops warning about the file's own fault. The key lookup and
   * its endpoint-mismatch warning still run on this same result, and
   * `credentials: false` keeps its meaning: no credential file at all.
   *
   * Design: a supplied result silences this resolver's read and its file warning;
   * the caller that parsed the file reports that fault once.
   *
   * It must come from `readUserCredentials` for `ansCredentialsPathFor(home)` with
   * THIS `home`: the endpoint-mismatch warning names that path, so a result from
   * another root would point the user at the wrong file.
   */
  credentialsFile?: CredentialFileContents;
}

// Defaulting through `resolveConfigHome` (not `homedir()`) is what makes the
// "one root" rule hold at the type level too: a caller that omits `home` writes
// to the same file the resolver reads, on any host.
export function userConfigPath(home: string = resolveConfigHome()): string {
  return ansUserConfigPathFor(home);
}

export function projectConfigPath(cwd: string = process.cwd()): string {
  return ansProjectConfigPath(cwd);
}

interface LoadedLlmFile {
  config: LlmFileConfig;
  fault?: LlmConfigFaultKind;
}

function parseLlmTomlResult(
  toml: string,
  level: "user" | "project",
  filePath: string,
  warn: (msg: string) => void,
): LoadedLlmFile {
  let root: Record<string, unknown>;
  try {
    root = tomlParse(toml) as Record<string, unknown>;
  } catch (e) {
    warn("[config] " + filePath + ": TOML parse failed (" + (e as Error).message + "); ignoring file");
    return { config: {}, fault: "invalid-toml" };
  }
  const section = root["llm"];
  if (section === undefined || section === null) return { config: {} };
  if (typeof section !== "object") {
    warn("[config] " + filePath + ": [llm] must be a table; ignoring section");
    return { config: {} };
  }
  const allowed = level === "project" ? PROJECT_LLM_WHITELIST : USER_LLM_KEYS;
  const out: LlmFileConfig = {};
  for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
    if (!allowed.has(key)) {
      const why = SECRET_KEY_RE.test(key)
        ? "secrets never go in config files; use env_key = \"ENV_VAR_NAME\""
        : level === "project"
          ? "project config may only set: " + [...PROJECT_LLM_WHITELIST].join(", ")
          : "unknown [llm] key";
      warn("[config] " + filePath + ": ignoring [llm]." + key + " — " + why);
      continue;
    }
    if (typeof value !== "string" || value === "") {
      warn("[config] " + filePath + ": ignoring [llm]." + key + " — value must be a non-empty string");
      continue;
    }
    (out as Record<string, string>)[key] = value;
  }
  return { config: out };
}

// Parse the [llm] section of a config.toml, applying the level's key policy.
// Disallowed or mistyped keys are dropped with a warning, never silently honored.
export function parseLlmToml(
  toml: string,
  level: "user" | "project",
  filePath: string,
  warn: (msg: string) => void,
): LlmFileConfig {
  return parseLlmTomlResult(toml, level, filePath, warn).config;
}

function loadFile(
  path: string,
  level: "user" | "project",
  warn: (msg: string) => void,
): LoadedLlmFile {
  if (!existsSync(path)) return { config: {} };
  // Design: an unreadable file (a directory at config.toml, a permission error)
  // is a config fault, not an absent config — report it and carry on with the
  // lower layers instead of throwing out of the composition root before the
  // caller can observe or return a clean error (#300, greptile P2). Never
  // mistake the file's *existence* for "model connected".
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    warn("[config] " + path + ": could not read config file (" + (e as Error).message + "); ignoring file");
    return { config: {}, fault: "unreadable" };
  }
  return parseLlmTomlResult(raw, level, path, warn);
}

/**
 * Resolve effective LLM config: CLI flag > env > project > user per key.
 * apiKey comes from ANS_LLM_API_KEY env, else from the env var named by the user
 * file's env_key (project files may only set provider/model, and a file stores the
 * var NAME, never the secret), else the provider's own env vars, else the user
 * credential file.
 */
export function resolveLlmConfig(opts: ResolveLlmOpts = {}): ResolvedLlmConfig {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();
  // The config root comes from the SAME function every other reader and writer
  // uses, applied to the same env. One rule, so the file this resolver reads and
  // the file `ans auth set` writes are the same file by construction - including
  // when the injected env names no home and both fall through to the platform's.
  const home = resolveConfigHome(opts.home, env);
  const warn = opts.warn ?? ((m: string) => process.stderr.write(m + "\n"));

  const userFile = loadFile(userConfigPath(home), "user", warn);
  const projectFile = loadFile(projectConfigPath(cwd), "project", warn);
  const user = userFile.config;
  const project = projectFile.config;
  const flags = opts.flags ?? {};

  const envLayer: LlmFileConfig = {
    provider: env.ANS_LLM_PROVIDER,
    model: env.ANS_LLM_MODEL,
    base_url: env.ANS_LLM_BASE_URL,
    api: env.ANS_LLM_API,
  };
  const cliLayer: LlmFileConfig = {
    provider: flags.provider,
    model: flags.model,
    base_url: flags.baseUrl,
    api: flags.api,
  };

  const resolved: ResolvedLlmConfig = { sources: {} };
  if (userFile.fault) resolved.configFault = userFile.fault;
  const pick = (
    field: "provider" | "model" | "base_url" | "api",
    outKey: "provider" | "model" | "baseUrl" | "api",
  ) => {
    for (const [layer, cfg] of [
      ["cli", cliLayer],
      ["env", envLayer],
      ["project", project],
      ["user", user],
    ] as const) {
      const v = cfg[field];
      // an invalid api value is ignored per-layer so a valid lower layer wins
      // instead of the whole key being discarded (CodeRabbit #120).
      if (v && field === "api" && !["chat", "messages", "responses"].includes(v)) {
        warn("[config] ignoring api=" + v + " from " + layer + " — must be chat|messages|responses");
        continue;
      }
      // falsy check: an exported-but-empty var (ANS_LLM_PROVIDER=) or a
      // `--llm.provider=` flag must not shadow lower layers (CodeRabbit #120).
      if (v) {
        if (outKey === "provider") resolved.provider = v;
        else if (outKey === "model") resolved.model = v;
        else if (outKey === "baseUrl") resolved.baseUrl = v;
        else resolved.api = v as ResolvedLlmConfig["api"];
        resolved.sources[outKey] = layer;
        return;
      }
    }
  };
  pick("provider", "provider");
  pick("model", "model");
  pick("base_url", "baseUrl");
  pick("api", "api");

  // baseUrl is a no-op without a wire protocol: warn here so every caller
  // sees the failure mode instead of each re-checking baseUrl && !api.
  if (resolved.baseUrl && !resolved.api) {
    warn("[config] base_url set without api — custom endpoint will be ignored by commands that require the pair");
  }

  // Secret resolution, in order:
  //   1. ANS_LLM_API_KEY            explicit override for this config
  //   2. [llm].env_key              the user file names the env var to read
  //   3. the provider's own env     OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY
  //   4. the user credential file   #301, bound to provider + endpoint
  //
  // Step 3 exists because the credential file must never *shadow* an exported
  // key. Without it, a stored key would be passed as the session's explicit
  // apiKey and pi-ai would skip its own env fallback, so `OPENAI_API_KEY` would
  // silently stop working for anyone who had also stored a key (spec S2:
  // 明确环境凭据优先).
  //
  // Binding rule (spec S2, "using file credentials must check the matching
  // provider/endpoint"). A secret that a FILE supplies is used only when the
  // effective provider AND endpoint still match what that file declared for it:
  //   - env_key: the binding is the provider the key was entered for. Two cases:
  //     * the user file names a provider — that is the binding, and any other
  //       layer (project file, env, CLI flag) selecting a different one blocks
  //       the key. #120 did this for the project layer only; #301 extended it to
  //       env/CLI, because the same key would otherwise reach the new provider
  //       just as easily.
  //     * the user file names NO provider but the env_key is a provider's
  //       canonical variable name (ANTHROPIC_API_KEY, OPENAI_API_KEY, ...) — the
  //       NAME is the binding. Changing the provider from the env or a flag then
  //       blocks it too. Leaving this open would keep a documented misroute: the
  //       user file says "use ANTHROPIC_API_KEY" and an env change would send
  //       that anthropic secret to google. (This is the boundary #301 was asked
  //       to decide; the old behaviour is kept only for names that belong to no
  //       known provider, e.g. MY_CUSTOM_KEY.)
  //   - credentials.json: the entry stores its own provider + endpoint, and the
  //     lookup matches both exactly.
  //   - the provider's own env var is bound by its name alone: OPENAI_API_KEY
  //     already means "the openai provider", which is the binding pi-ai applies
  //     when we pass nothing.
  // Blocked means apiKey and envKey both stay undefined - not just a warning.
  if (env.ANS_LLM_API_KEY) {
    resolved.apiKey = env.ANS_LLM_API_KEY;
    resolved.sources.apiKey = "env";
  } else {
    const userEndpoint = normalizeBindingEndpoint(user.base_url);
    // An effective provider/endpoint that differs from what the user file bound
    // the key to means the key belongs somewhere else. An absent effective
    // provider has no target at all, so there is nothing to misroute.
    const providerOwnedByEnvKey = user.env_key ? providerForEnvKey(user.env_key) : undefined;
    const boundProvider = user.provider ?? providerOwnedByEnvKey;
    const providerBoundElsewhere =
      boundProvider !== undefined && resolved.provider !== undefined && boundProvider !== resolved.provider;
    const endpointBoundElsewhere =
      userEndpoint !== null && userEndpoint !== normalizeBindingEndpoint(resolved.baseUrl);

    // A refused source must not come back through a later fallback: the env_key
    // was blocked BECAUSE the effective provider (or endpoint) differs from what
    // the file bound it to, and the provider's own env var is usually the very
    // same variable. Without this guard the refusal would be decorative - the
    // key would be refused here and re-read by the branch below.
    //
    // Every name the same provider's key can live under is refused, not just the
    // one the file named: google's key is readable from both GOOGLE_API_KEY and
    // GEMINI_API_KEY, so blocking one alias would let the same secret through
    // the other.
    const refusedSecretSources = new Set<string>();
    const refuseEveryName = (envKey: string): void => {
      refusedSecretSources.add(envKey);
      const owner = providerForEnvKey(envKey);
      if (owner) for (const name of modelEnvKeysFor(owner)) refusedSecretSources.add(name);
    };

    if (user.env_key && providerBoundElsewhere) {
      refuseEveryName(user.env_key);
      warn(
        "[config] [llm].env_key ignored: it is bound to provider=" + boundProvider +
        (user.provider === undefined ? " (by the variable's own name)" : "") +
        " but " + resolved.sources.provider + " selected provider=" + resolved.provider +
        " — refusing to send that secret to a different provider",
      );
    } else if (user.env_key && endpointBoundElsewhere) {
      refuseEveryName(user.env_key);
      warn(
        "[config] [llm].env_key ignored: user file binds base_url=" + displayEndpoint(userEndpoint) +
        " but " + resolved.sources.baseUrl + " selected a different endpoint" +
        " — refusing to send that secret to a different endpoint",
      );
    } else if (user.env_key && !refusedSecretSources.has(user.env_key)) {
      const secret = env[user.env_key];
      if (secret) {
        resolved.envKey = user.env_key;
        resolved.apiKey = secret;
        resolved.sources.apiKey = "user";
      } else {
        // Not a dead end any more: the provider's own env var and the
        // credential file are the next sources.
        warn("[config] [llm].env_key names " + user.env_key + " but that env var is not set");
      }
    }

    if (!resolved.apiKey && resolved.provider) {
      // The env names belong to the provider, so a key found under any of them is
      // provider-appropriate by construction — that is exactly the binding pi-ai
      // would apply itself. `modelEnvKeysFor` includes pi-ai's own alternate
      // names (google reads GEMINI_API_KEY), so this stays in step with what the
      // client would have done on its own.
      const providerSecret = modelEnvKeysFor(resolved.provider)
        .filter((name) => !refusedSecretSources.has(name))
        .map((name) => env[name]?.trim())
        .find((value) => !!value);
      if (providerSecret) {
        resolved.apiKey = providerSecret;
        resolved.sources.apiKey = "env";
      }
    }

    if (!resolved.apiKey && opts.credentials !== false) {
      const credsPath = ansCredentialsPathFor(home);
      const file = opts.credentialsFile ?? readUserCredentials({ filePath: credsPath });
      if (!file.error && !file.fault && file.bindings.some(
        (binding) => credentialProvider(binding.provider)?.kind === "model",
      )) {
        resolved.hasStoredModelCredential = true;
      }
      if (!opts.credentialsFile && file.error) {
        // A broken credential file must be visible, never treated as "no keys"
        // when it is the last remaining source. A caller that supplied the file
        // already said this, in its own words, once.
        warn("[config] " + file.error);
      }
      const lookup = lookupModelCredential(resolved.provider, resolved.baseUrl ?? null, file);
      if (lookup.status === "found") {
        resolved.apiKey = lookup.apiKey;
        resolved.sources.apiKey = "credentials";
      } else if (lookup.status === "endpoint-mismatch") {
        // Name every stored endpoint. Reporting one (whichever the file sorted
        // first) would send the user to fix the wrong binding.
        const storedList = lookup.stored.length > 0
          ? lookup.stored.map((e) => displayEndpoint(e)).join(", ")
          : "(the provider default)";
        warn(
          "[config] " + credsPath + ": the stored " + resolved.provider + " key is bound to " +
          storedList + " but the effective endpoint is " +
          displayEndpoint(normalizeBindingEndpoint(resolved.baseUrl)) +
          " — refusing to send that secret to a different endpoint; run `ans auth set " +
          resolved.provider + "` for this endpoint (see `ans auth list` for what is stored)",
        );
      }
    }
  }

  return resolved;
}

// Parse --llm.* flags out of a command argv. Supports "--llm.provider X" and
// "--llm.provider=X" for provider|model|base-url|api. Returns remaining argv.
export function parseLlmFlags(argv: string[]): { flags: LlmFlags; argv: string[] } {
  const flags: LlmFlags = {};
  const rest: string[] = [];
  const map: Record<string, keyof LlmFlags> = {
    "--llm.provider": "provider",
    "--llm.model": "model",
    "--llm.base-url": "baseUrl",
    "--llm.api": "api",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf("=");
    const name = eq >= 0 ? a.slice(0, eq) : a;
    const field = map[name];
    if (field) {
      const v = eq >= 0 ? a.slice(eq + 1) : argv[++i];
      if (v === undefined) {
        process.stderr.write(name + " requires a value\n");
        continue;
      }
      flags[field] = v;
    } else {
      rest.push(a);
    }
  }
  return { flags, argv: rest };
}

/**
 * Persist provider/model to the user-level config.toml (fixes the original #38
 * gap: `ans llm set` previously only printed export hints). Other [llm] keys
 * (base_url, api) and non-llm sections are preserved. env_key is dropped when
 * the provider changes: it names the previous provider's secret, and the
 * resolver's project-layer guard cannot detect that binding being rewritten in
 * place (CodeRabbit #120). Never writes secrets.
 */
export function writeUserLlmConfig(
  patch: { provider?: string; model?: string },
  home: string = resolveConfigHome(),
  warn: (msg: string) => void = (m) => process.stderr.write("[config] " + m + "\n"),
): string {
  const path = userConfigPath(home);
  let root: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      root = tomlParse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch (e) {
      // never silently rewrite a malformed file — that would drop env_key and
      // every unrelated section (CodeRabbit #120).
      throw new Error(path + ": TOML parse failed (" + (e as Error).message + "); fix or remove the file, then retry");
    }
  }
  const llm = (typeof root["llm"] === "object" && root["llm"] !== null
    ? { ...(root["llm"] as Record<string, unknown>) }
    : {}) as Record<string, unknown>;
  if (patch.provider !== undefined) {
    // Match parseLlmToml's validation: only a non-empty string is a recorded
    // provider. An empty/non-string value counts as absent, so it must not
    // delete a valid env_key (CodeRabbit #124).
    const rawProvider = llm["provider"];
    const previous =
      typeof rawProvider === "string" && rawProvider !== "" ? rawProvider : undefined;
    // SECURITY: env_key is bound to the provider present when it was written.
    // Keeping it across a provider switch would send that secret to the new
    // provider's endpoint. Same-provider / model-only updates, and files with
    // no (valid) prior provider (no binding to violate), keep env_key as the
    // resolver does (CodeRabbit #120).
    if (previous !== undefined && previous !== patch.provider && llm["env_key"] !== undefined) {
      warn(
        "removed [llm].env_key=" + String(llm["env_key"]) +
        ": provider changed from " + String(previous) + " to " + patch.provider +
        "; set an env_key for the new provider",
      );
      delete llm["env_key"];
    }
    llm["provider"] = patch.provider;
  }
  if (patch.model !== undefined) llm["model"] = patch.model;
  root["llm"] = llm;
  mkdirSync(dirname(path), { recursive: true });
  // SECURITY: owner-only permissions, same convention as config.env (CWE-312).
  writeFileSync(path, tomlStringify(root), { encoding: "utf8", mode: 0o600 });
  return path;
}
