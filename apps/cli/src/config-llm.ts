// Layered TOML LLM config (issue #38, decision #92).
// Layers per key, high → low: CLI flag > env > project > user > default.
//   user    ~/.anysearch-cli/config.toml   [llm] section
//   project .anysearch/config.toml         [llm] section, safety whitelist only
// Secrets never land in files: files store an `env_key` indirection naming the
// env var that holds the key; plaintext secret keys in either file are ignored
// with a warning. Project files are further restricted to a non-security
// whitelist so a malicious repo cannot redirect the endpoint or the secret
// source (Codex project-key precedent).
// The loader lives at the composition-root layer: it reads env + files here and
// passes values in; the kernel keeps zero env reads (LlmSession contract).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as tomlParse, stringify as tomlStringify } from "smol-toml";

export type LlmLayer = "cli" | "env" | "project" | "user";

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

export interface ResolvedLlmConfig {
  provider?: string;
  model?: string;
  baseUrl?: string;
  api?: "chat" | "messages" | "responses";
  /** Secret material resolved via env_key indirection or ANS_LLM_API_KEY; never from a file value. */
  apiKey?: string;
  /** The env var name the file asked the key to come from, if any. */
  envKey?: string;
  /** Which layer supplied each resolved field (for `ans llm` display + tests). */
  sources: Partial<Record<"provider" | "model" | "baseUrl" | "api" | "apiKey", LlmLayer>>;
}

export interface ResolveLlmOpts {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  home?: string;
  flags?: LlmFlags;
  warn?: (msg: string) => void;
}

export function userConfigPath(home: string = homedir()): string {
  return join(home, ".anysearch-cli", "config.toml");
}

export function projectConfigPath(cwd: string = process.cwd()): string {
  return join(cwd, ".anysearch", "config.toml");
}

// Parse the [llm] section of a config.toml, applying the level's key policy.
// Disallowed or mistyped keys are dropped with a warning, never silently honored.
export function parseLlmToml(
  toml: string,
  level: "user" | "project",
  filePath: string,
  warn: (msg: string) => void,
): LlmFileConfig {
  let root: Record<string, unknown>;
  try {
    root = tomlParse(toml) as Record<string, unknown>;
  } catch (e) {
    warn("[config] " + filePath + ": TOML parse failed (" + (e as Error).message + "); ignoring file");
    return {};
  }
  const section = root["llm"];
  if (section === undefined || section === null) return {};
  if (typeof section !== "object") {
    warn("[config] " + filePath + ": [llm] must be a table; ignoring section");
    return {};
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
  return out;
}

function loadFile(
  path: string,
  level: "user" | "project",
  warn: (msg: string) => void,
): LlmFileConfig {
  if (!existsSync(path)) return {};
  return parseLlmToml(readFileSync(path, "utf8"), level, path, warn);
}

/**
 * Resolve effective LLM config: CLI flag > env > project > user per key.
 * apiKey comes from ANS_LLM_API_KEY env, else from the env var named by the
 * winning layer's env_key (file stores the var NAME, never the secret).
 */
export function resolveLlmConfig(opts: ResolveLlmOpts = {}): ResolvedLlmConfig {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();
  const home = opts.home ?? homedir();
  const warn = opts.warn ?? ((m: string) => process.stderr.write(m + "\n"));

  const user = loadFile(userConfigPath(home), "user", warn);
  const project = loadFile(projectConfigPath(cwd), "project", warn);
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

  // Secret resolution: env var wins; otherwise follow the user file's env_key
  // indirection. env_key is user-level only (project whitelist drops it), so
  // there is exactly one file layer to consult.
  if (env.ANS_LLM_API_KEY) {
    resolved.apiKey = env.ANS_LLM_API_KEY;
    resolved.sources.apiKey = "env";
  } else if (user.env_key) {
    // Provider-binding guard (CodeRabbit #120): a user-declared provider that
    // differs from the effective provider means env_key belongs to another
    // provider — a project file must not be able to redirect that secret.
    // An absent user.provider establishes no binding: env_key is accepted
    // verbatim regardless of which layer picked the provider.
    const mismatch =
      resolved.sources.provider === "project" &&
      user.provider !== undefined &&
      user.provider !== resolved.provider;
    if (mismatch) {
      warn(
        "[config] [llm].env_key ignored: user file binds provider=" + user.provider +
        " but project selected provider=" + resolved.provider +
        " — refusing to send that secret to a different provider",
      );
    } else {
      resolved.envKey = user.env_key;
      const secret = env[user.env_key];
      if (secret) {
        resolved.apiKey = secret;
        resolved.sources.apiKey = "user";
      } else {
        warn("[config] [llm].env_key names " + user.env_key + " but that env var is not set");
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
  home: string = homedir(),
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
  mkdirSync(join(home, ".anysearch-cli"), { recursive: true });
  // SECURITY: owner-only permissions, same convention as config.env (CWE-312).
  writeFileSync(path, tomlStringify(root), { encoding: "utf8", mode: 0o600 });
  return path;
}
