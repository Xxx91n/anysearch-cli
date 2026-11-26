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

import { randomBytes } from "node:crypto";
import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync,
  unlinkSync, writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { parse as tomlParse, stringify as tomlStringify, TomlError } from "smol-toml";
import { configWriteSeam } from "./config-llm-seam.js";
import { sweepStaleWorkFiles } from "./stale-work-files.js";
import { ansCredentialsPathFor, ansProjectConfigPath, ansUserConfigPathFor } from "./ans-paths.js";
import {
  credentialProvider,
  isPrintableEndpoint,
  lookupModelCredential,
  displayEndpoint,
  llmKeyLabel,
  modelEnvKeysFor,
  normalizeBindingEndpoint,
  providerForEnvKey,
  readUserCredentials,
  resolveConfigHome,
  storeKeyCommand,
} from "./credentials";
import type { CredentialFileContents, CredentialFileFault } from "./credentials";

/** `credentials` = the user credential file (#301); every other layer is a config source. */
export type LlmLayer = "cli" | "env" | "project" | "user" | "credentials";

/** The layers that can supply a base URL. The project file may only set provider
 * and model, so it is not one of them. */
export type BaseUrlLayer = "cli" | "env" | "user";

/** The winning base URL and the layer it came from: both, or neither. */
export type BaseUrlPick =
  | { value: string; layer: BaseUrlLayer }
  | { value?: undefined; layer?: undefined };

/** Where a stored key should be rebound; callers build the copyable command. */
export type BindingRetarget =
  | { kind: "default"; provider: string }
  | { kind: "endpoint"; provider: string; endpoint: string }
  | { kind: "unprintable"; provider: string; source: BaseUrlLayer };

/** Chooses where a stored key should be rebound: provider default, current
 * printable endpoint, or a placeholder plus the layer holding the full address. */
export function bindingRetarget(
  provider: string,
  effective: string | null,
  baseUrl: BaseUrlPick,
): BindingRetarget {
  if (effective === null || baseUrl.value === undefined) {
    return { kind: "default", provider };
  }
  if (isPrintableEndpoint(effective)) {
    return { kind: "endpoint", provider, endpoint: effective };
  }
  return {
    kind: "unprintable",
    provider,
    source: baseUrl.layer,
  };
}

/** Builds the copyable re-store command for a binding target. */
export function bindingCommand(target: BindingRetarget, placeholder = "<address>"): string {
  switch (target.kind) {
    case "default":
      return storeKeyCommand(target.provider);
    case "endpoint":
      return storeKeyCommand(target.provider, target.endpoint);
    case "unprintable":
      return storeKeyCommand(target.provider) + " --endpoint " + placeholder;
    default: {
      const exhaustive: never = target;
      return exhaustive;
    }
  }
}

/** Where each resolved field came from. `baseUrl` is narrower than the rest:
 * no project file can set one. */
export interface LlmSources {
  provider?: LlmLayer;
  model?: LlmLayer;
  baseUrl?: BaseUrlLayer;
  api?: LlmLayer;
  apiKey?: LlmLayer;
}

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

/** Keys every usable file needs. */
export const REQUIRED_LLM_KEYS = ["provider", "model"] as const;
// Project-level files may set provider/model only. Endpoint, wire protocol and
// secret source stay user-level.
export const PROJECT_LLM_KEYS = ["provider", "model"] as const;
export const USER_LLM_KEY_NAMES = [...PROJECT_LLM_KEYS, "base_url", "api", "env_key"] as const;
const PROJECT_LLM_WHITELIST = new Set<string>(PROJECT_LLM_KEYS);
const USER_LLM_KEYS = new Set<string>(USER_LLM_KEY_NAMES);
/** The wire protocols store accepts; kernel's `LlmEndpointKind` is the compile-time mirror. */
export const LLM_API_VALUES = ["chat", "messages", "responses"] as const;
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

/** Where a broken file failed: a TOML line/column or an errno code, never contents or values. */
export interface LlmFileFault {
  /** TOML parse position, when the parser reported one. */
  line?: number;
  column?: number;
  /** Read-failure errno code, when the throw carried one. */
  code?: string;
}

/**
 * What one config.toml turned out to be. Six closed values; the listing
 * prints them, and a surface can read the same fact instead of inferring it
 * from warnings.
 */
export type LlmConfigFileStatus = "missing" | "empty" | "no-llm" | "half" | "ok" | "broken";

/**
 * Why a file's [llm] section did not supply a key, or why the file did not parse
 * at all. File-level kinds carry no `key`; every key-level kind names one.
 */
export type LlmFileDiagnosticKind =
  | "unreadable"
  | "invalid-toml"
  | "llm-not-table"
  | "not-allowed-key"
  | "secret-looking-key"
  | "unknown-key"
  | "invalid-type";

export interface LlmFileDiagnostic {
  kind: LlmFileDiagnosticKind;
  /** The [llm] key this diagnostic is about; file-level kinds leave it out. */
  key?: string;
}

/** Why a value did not take effect: layer + name, never the value. */
export type LlmValueDiagnosticKind =
  | "api-invalid"
  | "env-key-provider-mismatch"
  | "env-key-unset"
  | "key-endpoint-mismatch"
  | "base-url-without-api";

export type LlmValueDiagnostic =
  | { kind: "api-invalid"; layer: LlmLayer }
  | { kind: "base-url-without-api"; layer: LlmLayer }
  | { kind: "env-key-provider-mismatch"; layer: "user"; envKeyLabel: string }
  | { kind: "env-key-unset"; layer: "user"; envKeyLabel: string }
  | { kind: "key-endpoint-mismatch"; layer: "user"; envKeyLabel: string }
  | { kind: "key-endpoint-mismatch"; layer: "credentials"; provider: string };

export interface LlmConfigFileState {
  layer: "user" | "project";
  status: LlmConfigFileStatus;
  /** [llm] keys this file supplied. Names only, never values. */
  present: string[];
  diagnostics: LlmFileDiagnostic[];
  /** Display label for sentences: project-relative or `~/…`, never absolute. */
  displayPath: string;
  /** Set only when status is `broken`; carries the safe failure location. */
  fault?: LlmFileFault;
}

export interface ResolvedLlmConfig {
  provider?: string;
  model?: string;
  baseUrl?: string;
  api?: (typeof LLM_API_VALUES)[number];
  /** Secret material resolved via ANS_LLM_API_KEY, env_key indirection, the provider's own env vars
   * or the user credential file. */
  apiKey?: string;
  /** The env var name the file asked the key to come from, if any. */
  envKey?: string;
  /** Which layer supplied each resolved field (for `ans llm` display + tests). */
  sources: LlmSources;
  /**
   * Per-file facts: one record for the user file and one for the project
   * file, always both, whether or not the file exists. A surface reads status
   * and diagnostics here; `warn` stays the human sentence.
   */
  configFiles: Record<"user" | "project", LlmConfigFileState>;
  /**
   * Value-level diagnostics: why a value or key is not in effect.
   * Separate from configFiles because a binding can live in credentials or env,
   * and because these never change a file's state.
   */
  valueDiagnostics: LlmValueDiagnostic[];
  /** Display-safe endpoints a rejected stored model key is bound to. */
  storedModelKeyEndpoints?: string[];
  /** True when credentials are enabled, no other API key was resolved, and credentials.json holds a model-provider binding. */
  hasStoredModelCredential?: boolean;
  /**
   * The classification of a credential file that exists but cannot be used;
   * set whether or not another layer supplied the key. The caller builds the
   * sentence through the kernel's `credentialFileNotice` table.
   */
  credentialFileFault?: CredentialFileFault;
}

const USER_BROKEN = "LLM config file is broken; provider/model could not be loaded. Fix the config file and try again.";
const STORED_KEY_BROKEN =
  "A model API key is still stored in credentials.json, but it is not in use until the config is fixed.";
const STORED_KEY_UNCONFIGURED =
  "A model API key is still stored in credentials.json, but it is not in use until provider and model are configured.";

// Both labels are relative on purpose: these sentences also reach MCP tool
// results, which must stay free of absolute paths. `path` is always built from
// the same home/cwd (`userConfigPath` / `projectConfigPath`), so a surface never
// has to guess the file and `relative()` never escapes its base.

/** The project file's path inside the project, using forward slashes. */
function projectDisplayPath(cwd: string, path: string): string {
  return relative(cwd, path).split(sep).join("/");
}

/** The user file's path from the config root, using `~` and forward slashes. */
function userDisplayPath(home: string, path: string): string {
  return "~/" + relative(home, path).split(sep).join("/");
}

function projectBrokenSentence(label: string): string {
  return "The project config file (" + label + ") is broken; provider/model could not be loaded from it. " +
    "Fix it and try again.";
}

/**
 * The one exit for "a config file is broken". Both files are judged separately
 * (#581): the user file keeps its existing sentence, the project file names
 * itself, and both sentences appear when both are broken. Sentences never
 * carry a value, a provider name, a warning's text, or an absolute path.
 */
function formatLlmConfigFault(cfg: ResolvedLlmConfig): string | undefined {
  if (cfg.provider && cfg.model) return undefined;
  const broken = (["user", "project"] as const)
    .filter((layer) => cfg.configFiles[layer].status === "broken")
    .map((layer) => (layer === "user" ? USER_BROKEN : projectBrokenSentence(cfg.configFiles.project.displayPath)));
  return broken.length > 0 ? broken.join(" ") : undefined;
}

/**
 * What one half-written file did set, and what is still missing. An [llm]
 * section whose fields were all dropped (empty or wrong types) says that
 * instead of naming a field it never had. A non-table [llm] never reaches here
 * — it is `no-llm`, not `half`.
 */
function halfConfigSentence(state: LlmConfigFileState): string | undefined {
  if (state.status !== "half") return undefined;
  const presentRequired = REQUIRED_LLM_KEYS.filter((key) => state.present.includes(key));
  const missingRequired = REQUIRED_LLM_KEYS.filter((key) => !state.present.includes(key));
  let detail: string;
  if (presentRequired.length === 0) {
    detail = "has an [llm] section, but none of " + REQUIRED_LLM_KEYS.join(", ") + " is set";
  } else {
    detail = "sets " + presentRequired.join(", ") + " but not " + missingRequired.join(", ");
  }
  const label = state.layer === "user"
    ? "The user config file"
    : "The project config file (" + state.displayPath + ")";
  return label + " " + detail + ".";
}

/**
 * Why this run has no usable provider/model, in the fixed order (#581): broken
 * files, then half-written files (including a partial env/CLI layer), then a
 * stored model key that no config can use. The caller adds its own "nothing
 * configured" guidance after this, so a broken user file keeps its old sentence
 * and never points at the example provider name.
 */
export function formatLlmConfigGap(cfg: ResolvedLlmConfig): string | undefined {
  if (cfg.provider && cfg.model) return undefined;
  const sentences: string[] = [];
  const fault = formatLlmConfigFault(cfg);
  if (fault) sentences.push(fault);
  for (const layer of ["user", "project"] as const) {
    const half = halfConfigSentence(cfg.configFiles[layer]);
    if (half) sentences.push(half);
  }
  // A partial env/CLI layer has no file record. Without this sentence a run
  // with only ANS_LLM_PROVIDER (or only --llm.provider) would fail with no
  // reason at all: the file half sentences do not cover it, and the generic
  // hint is reserved for "nothing configured".
  let missing: "provider" | "model" | undefined;
  if (!cfg.provider) missing = "provider";
  else if (!cfg.model) missing = "model";
  const set = missing === "provider" ? "model" : "provider";
  const setLayer = missing === "provider" ? cfg.sources.model : cfg.sources.provider;
  if ((setLayer === "env" || setLayer === "cli")) {
    const label = setLayer === "env" ? "The environment" : "The command line";
    sentences.push(label + " sets " + set + " but not " + missing + ".");
  }
  if (cfg.hasStoredModelCredential) {
    sentences.push(fault ? STORED_KEY_BROKEN : STORED_KEY_UNCONFIGURED);
  }
  return sentences.length > 0 ? sentences.join(" ") : undefined;
}

/**
 * True when neither field resolved and the user file is not broken: the host
 * adds its own "nothing configured" guidance. An empty `[llm]` is `half` but
 * resolves neither field, so it gets both the half sentence and this hint.
 */
export function needsLlmSetupHint(cfg: ResolvedLlmConfig): boolean {
  return !cfg.provider && !cfg.model && cfg.configFiles.user.status !== "broken";
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

interface LoadedLlmFile extends Omit<LlmConfigFileState, "displayPath"> {
  config: LlmFileConfig;
}

/**
 * Design: only the diagnostic head of a TOML parse error is shown, plus the
 * line and column `TomlError` records — never the snippet, which can be
 * `api_key = "sk-…"`. Every surface that prints or forwards this text (CLI
 * warnings, MCP stderr, a write refusal) takes the same rule.
 */
function tomlParseDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const head = message.split("\n")[0].trim() || "invalid TOML";
  if (error instanceof TomlError) return head + " at line " + error.line + ", column " + error.column;
  return head;
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
    const detail = tomlParseDetail(e);
    warn("[config] " + filePath + ": TOML parse failed (" + detail + "); ignoring file");
    const fault: LlmFileFault = {};
    if (e instanceof TomlError) {
      fault.line = e.line;
      fault.column = e.column;
    }
    return {
      layer: level, config: {}, fault, status: "broken", present: [],
      diagnostics: [{ kind: "invalid-toml" }],
    };
  }
  const section = root["llm"];
  if (section === undefined || section === null) {
    return { layer: level, config: {}, status: "no-llm", present: [], diagnostics: [] };
  }
  // Design: a non-table `[llm]` means "no [llm]" — arrays and datetimes are
  // objects too, and must not become an invented half-written section.
  if (typeof section !== "object" || Array.isArray(section) || section instanceof Date) {
    warn("[config] " + filePath + ": [llm] must be a table; ignoring section");
    return {
      layer: level, config: {}, status: "no-llm", present: [],
      diagnostics: [{ kind: "llm-not-table" }],
    };
  }
  const allowed = level === "project" ? PROJECT_LLM_WHITELIST : USER_LLM_KEYS;
  const out: LlmFileConfig = {};
  const present: string[] = [];
  const diagnostics: LlmFileDiagnostic[] = [];
  for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
    // The key name comes from the file; a quoted TOML key can carry ESC
    // sequences. Clean it before it reaches a terminal or a stored fact.
    const shownKey = llmKeyLabel(key);
    if (!allowed.has(key)) {
      let kind: LlmFileDiagnosticKind;
      let why: string;
      if (SECRET_KEY_RE.test(key)) {
        kind = "secret-looking-key";
        why = "secrets never go in config files; use env_key = \"ENV_VAR_NAME\"";
      } else if (level === "project") {
        kind = "not-allowed-key";
        why = "project config may only set: " + [...PROJECT_LLM_WHITELIST].join(", ");
      } else {
        kind = "unknown-key";
        why = "unknown [llm] key";
      }
      warn("[config] " + filePath + ": ignoring [llm]." + shownKey + " — " + why);
      diagnostics.push({ kind, key: shownKey });
      continue;
    }
    if (typeof value !== "string" || value === "") {
      warn("[config] " + filePath + ": ignoring [llm]." + shownKey + " — value must be a non-empty string");
      diagnostics.push({ kind: "invalid-type", key: shownKey });
      continue;
    }
    (out as Record<string, string>)[key] = value;
    present.push(shownKey);
  }
  // An [llm] table with no usable fields is still a half-written config: the
  // section is there, the provider/model pair is not.
  const status: LlmConfigFileStatus = REQUIRED_LLM_KEYS.every((key) => Boolean(out[key])) ? "ok" : "half";
  return { layer: level, config: out, status, present, diagnostics };
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
  if (!existsSync(path)) {
    return { layer: level, config: {}, status: "missing", present: [], diagnostics: [] };
  }
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
    const rawCode = typeof e === "object" && e !== null && "code" in e ? e.code : undefined;
    const fault: LlmFileFault = typeof rawCode === "string" ? { code: rawCode } : {};
    return {
      layer: level, config: {}, fault, status: "broken", present: [],
      diagnostics: [{ kind: "unreadable" }],
    };
  }
  // Design: decide `empty` before parsing — trim-empty is its own state, not
  // "no [llm]", and parsing cannot tell them apart.
  if (raw.trim() === "") {
    return { layer: level, config: {}, status: "empty", present: [], diagnostics: [] };
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

  const userConfigFile = userConfigPath(home);
  const projectConfigFile = projectConfigPath(cwd);
  const userFile = loadFile(userConfigFile, "user", warn);
  const projectFile = loadFile(projectConfigFile, "project", warn);
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

  const resolved: ResolvedLlmConfig = {
    sources: {},
    valueDiagnostics: [],
    configFiles: {
      user: {
        layer: userFile.layer, status: userFile.status,
        present: userFile.present, diagnostics: userFile.diagnostics,
        displayPath: userDisplayPath(home, userConfigFile),
        ...(userFile.fault ? { fault: userFile.fault } : {}),
      },
      project: {
        layer: projectFile.layer, status: projectFile.status,
        present: projectFile.present, diagnostics: projectFile.diagnostics,
        displayPath: projectDisplayPath(cwd, projectConfigFile),
        ...(projectFile.fault ? { fault: projectFile.fault } : {}),
      },
    },
  };
  const pick = (field: "provider" | "model" | "api", outKey: "provider" | "model" | "api") => {
    for (const [layer, cfg] of [
      ["cli", cliLayer],
      ["env", envLayer],
      ["project", project],
      ["user", user],
    ] as const) {
      const v = cfg[field];
      // An invalid api value is dropped for that layer only, so a valid lower
      // layer can still win instead of the whole key being discarded.
      if (v && field === "api" && !(LLM_API_VALUES as readonly string[]).includes(v)) {
        warn("[config] ignoring api=" + llmKeyLabel(v) + " from " + layer + " — must be " + LLM_API_VALUES.join("|"));
        resolved.valueDiagnostics.push({ kind: "api-invalid", layer });
        continue;
      }
      // A falsy check: an exported-but-empty var (ANS_LLM_PROVIDER=) or a
      // `--llm.provider=` flag must not shadow lower layers.
      if (v) {
        if (outKey === "provider") resolved.provider = v;
        else if (outKey === "model") resolved.model = v;
        else resolved.api = v as ResolvedLlmConfig["api"];
        resolved.sources[outKey] = layer;
        return;
      }
    }
  };
  pick("provider", "provider");
  pick("model", "model");
  pick("api", "api");

  // base_url is picked on its own so the layer travels with the value.
  // A project file may only set provider and model, so it is not a base-URL
  // layer at all; keeping it out here is what lets the advice below name where
  // an unprintable URL lives instead of guessing.
  let baseUrlPick: BaseUrlPick = {};
  for (const [layer, cfg] of [["cli", cliLayer], ["env", envLayer], ["user", user]] as const) {
    if (cfg.base_url) {
      baseUrlPick = { value: cfg.base_url, layer };
      break;
    }
  }
  if (baseUrlPick.value !== undefined) {
    resolved.baseUrl = baseUrlPick.value;
    resolved.sources.baseUrl = baseUrlPick.layer;
  }

  // baseUrl is a no-op without a wire protocol. An invalid api value already
  // warns on its own, so do not add a second, false "base_url without api"
  // explanation for the same run.
  const invalidApi = resolved.valueDiagnostics.some((d) => d.kind === "api-invalid");
  if (resolved.baseUrl && !resolved.api && !invalidApi) {
    warn("[config] base_url set without api — custom endpoint will be ignored by commands that require the pair");
    if (baseUrlPick.layer !== undefined) {
      resolved.valueDiagnostics.push({ kind: "base-url-without-api", layer: baseUrlPick.layer });
    }
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
    // The name comes from the file, so it can carry control characters. Show
    // the same cleaned label the file keys use; keep the raw name for lookup.
    const envKeyLabel = user.env_key ? llmKeyLabel(user.env_key) : undefined;

    if (user.env_key && providerBoundElsewhere) {
      refuseEveryName(user.env_key);
      resolved.valueDiagnostics.push({
        kind: "env-key-provider-mismatch", layer: "user", envKeyLabel: llmKeyLabel(user.env_key),
      });
      warn(
        "[config] [llm].env_key ignored: it is bound to provider=" + boundProvider +
        (user.provider === undefined ? " (by the variable's own name)" : "") +
        " but " + resolved.sources.provider + " selected provider=" + resolved.provider +
        " — refusing to send that secret to a different provider",
      );
    } else if (user.env_key && endpointBoundElsewhere) {
      refuseEveryName(user.env_key);
      resolved.valueDiagnostics.push({
        kind: "key-endpoint-mismatch", layer: "user", envKeyLabel: llmKeyLabel(user.env_key),
      });
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
        resolved.valueDiagnostics.push({
          kind: "env-key-unset", layer: "user", envKeyLabel: llmKeyLabel(user.env_key),
        });
        warn("[config] [llm].env_key names " + envKeyLabel + " but that env var is not set");
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
  }

  // Design: read the file on every resolve, even when a key came from above —
  // the fault then rides the result instead of staying on stderr.
  if (opts.credentials !== false) {
    const credsPath = ansCredentialsPathFor(home);
    const file = opts.credentialsFile ?? readUserCredentials({ filePath: credsPath });
    if (file.fault) resolved.credentialFileFault = file.fault;
    if (!resolved.apiKey) {
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
      } else if (lookup.status === "endpoint-mismatch" && resolved.provider) {
        // The guard narrows the type; a mismatch already implies a provider.
        // Name every stored endpoint. Reporting one (whichever the file sorted
        // first) would send the user to fix the wrong binding.
        resolved.valueDiagnostics.push({ kind: "key-endpoint-mismatch", layer: "credentials", provider: resolved.provider });
        const storedDisplay = lookup.stored.map((e) => displayEndpoint(e));
        resolved.storedModelKeyEndpoints = storedDisplay;
        const storedList = storedDisplay.length > 0
          ? storedDisplay.join(", ")
          : "(the provider default)";
        const effective = normalizeBindingEndpoint(resolved.baseUrl);
        warn(
          "[config] " + credsPath + ": the stored " + resolved.provider + " key is bound to " +
          storedList + " but the effective endpoint is " + displayEndpoint(effective) +
          " — refusing to send that secret to a different endpoint; " +
          bindingAdvice(resolved.provider, effective, baseUrlPick) +
          " (see `ans auth list` for what is stored)",
        );
      }
    }
  }

  return resolved;
}

/** Where a base URL can be read back in full, for the sentence that tells a user
 * to go and copy it. */
export const BASE_URL_SOURCE: Record<BaseUrlLayer, string> = {
  cli: "--llm.base-url",
  env: "ANS_LLM_BASE_URL",
  user: "the user config file",
};

/** Turns bindingRetarget's decision into the resolver's English advice. */
function bindingAdvice(provider: string, effective: string | null, baseUrl: BaseUrlPick): string {
  const target = bindingRetarget(provider, effective, baseUrl);
  const command = bindingCommand(target);
  switch (target.kind) {
    case "default":
      return "run `" + command + "` to bind it to the provider default";
    case "endpoint":
      return "run `" + command + "` for this endpoint";
    case "unprintable":
      return "re-store it for that endpoint: the full address is in " + BASE_URL_SOURCE[target.source] +
        ". It cannot be printed here (redacted, too long, or contains control characters). Run `" +
        command + "`, replacing the angle-bracket part";
    default: {
      const exhaustive: never = target;
      return exhaustive;
    }
  }
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
 * Temp file, forced to disk before the rename; otherwise a power cut can publish
 * an empty file.
 * SECURITY: on POSIX the temp file is 0600 and the rename publishes that mode,
 * so an existing 0644 config is tightened too (CWE-312). Windows has no POSIX
 * mode here; the folder ACL decides who can read the file.
 */
function writeConfigTemp(path: string, content: string): void {
  const fd = openSync(path, "wx", 0o600);
  try {
    // writeFileSync loops until every byte lands; a bare writeSync can return
    // short on a full disk without throwing.
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** The errno code when the thrown value carries one, else its text. */
function errnoOrText(e: unknown): string {
  // A thrown value may be anything, and ErrnoException only claims code is a
  // string, so the runtime check below is the real guard, not the cast.
  const code = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
  if (typeof code === "string") return code;
  return e instanceof Error ? e.message : String(e);
}

/**
 * Follow a symlinked config file to the file it points at: renaming onto the
 * link would replace it with a regular file and cut off a dotfiles setup. A
 * link that cannot be resolved (dangling, looping, unreadable) stops the write
 * instead of quietly becoming a regular file.
 */
function linkTarget(path: string): string {
  // Only "no file yet" means "write as usual". Every other lstat failure
  // (ELOOP, EACCES, ENOTDIR) must surface as itself, not become a rename error.
  const entry = lstatSync(path, { throwIfNoEntry: false });
  if (entry === undefined || !entry.isSymbolicLink()) return path;
  try {
    return realpathSync(path);
  } catch (e) {
    throw new Error(
      "could not write " + path + ": it is a symlink and its target cannot be resolved (" +
      errnoOrText(e) +
      "). This write did not touch the existing config; fix or remove the link, then retry.",
      { cause: e },
    );
  }
}

/**
 * Write a temp file beside the target, then rename onto it, so a fault mid-write
 * leaves the previous file untouched instead of half-rewritten. Same rule as
 * config.env and credentials.json.
 *
 * Design: temp name carries pid + random bytes and lives in the target's own
 * directory — two concurrent `ans llm set` runs cannot publish each other's
 * half-finished file, one run's cleanup cannot delete the other's temp, and a
 * rename inside one directory never fails with EXDEV.
 */
function writeUserConfigFile(path: string, content: string): void {
  path = linkTarget(path);
  const dir = dirname(path);
  // The temp name starts with a dot; the sweep and the write share these two pieces.
  const tempPrefix = "." + basename(path) + ".";
  const tempSuffix = ".tmp";
  sweepStaleWorkFiles(path, { suffix: tempSuffix, prefix: tempPrefix });
  const temp = join(dir, tempPrefix + process.pid + "." + randomBytes(6).toString("hex") + tempSuffix);
  const write = configWriteSeam.write ?? writeConfigTemp;
  // Design: plain rename, no fs-atomic backoff — that policy waits up to a
  // minute on a Windows sharing error, and a hanging config command is worse
  // than one that fails and keeps the old file (same call as config.env).
  const rename = configWriteSeam.rename ?? renameSync;
  try {
    mkdirSync(dir, { recursive: true });
    write(temp, content);
    rename(temp, path);
  } catch (e) {
    try { unlinkSync(temp); } catch { /* never created, or already renamed */ }
    // Carry the errno alone: a raw rename message names the temp path, which
    // reads like an unrelated failure.
    const reason = errnoOrText(e);
    throw new Error(
      "could not write " + path + ": " + reason +
      ". This write did not touch the existing config; check that the file and its folder are writable, then retry.",
      { cause: e },
    );
  }
}

/**
 * Persist provider/model to the user-level config.toml (fixes the original #38
 * gap: `ans llm set` previously only printed export hints). Other [llm] keys
 * (base_url, api) and non-llm sections are preserved. env_key is dropped when
 * the provider changes: it names the previous provider's secret, and the
 * resolver's project-layer guard cannot detect that binding being rewritten in
 * place (CodeRabbit #120). Never writes secrets. A write that fails does not
 * touch the existing file: the new content is published by a rename, never by
 * rewriting the target in place.
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
      throw new Error(path + ": TOML parse failed (" + tomlParseDetail(e) + "); fix or remove the file, then retry");
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
  writeUserConfigFile(path, tomlStringify(root));
  return path;
}
