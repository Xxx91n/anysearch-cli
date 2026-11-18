// User credential file (#301 / spec S2).
//
// What this is: ONE plaintext file under the user config root
// (`~/.anysearch-cli/credentials.json`) holding provider API keys, so the user
// enters a key once and every entry on this machine and account - CLI, MCP,
// plugin server, the GUI host - reads it. It is NOT encrypted, NOT a system
// keychain, and it is never copied into project configs or host configs.
//
// Why a file instead of more env vars: a GUI host does not inherit a shell
// environment, so a key that only lives in `OPENAI_API_KEY` is invisible there
// (spec scenario N3). An explicit env value still wins, so deployment scripts
// and external secret systems keep working.
//
// Binding: every entry names the provider it belongs to, and for model
// providers also the endpoint it was entered for (null = the provider's own
// default). Resolution matches BOTH; a key entered for provider A or endpoint X
// is never sent to provider B or endpoint Y. That is the credential-misrouting
// guard spec S2 asks for.
//
// Access protection (spec S2, ticket acceptance 4): before a secret is written
// the file is locked to the current account and the lock is VERIFIED on the
// platform's own terms - POSIX mode bits on POSIX, a parsed Windows DACL via
// icacls on Windows. A POSIX mode is never used as a stand-in for a Windows
// ACL. If protection cannot be established or verified, the write fails and no
// unprotected copy of the secret is left on disk.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const CREDENTIALS_FILENAME = "credentials.json";

/** Written into every file so its plaintext nature is obvious to a human who opens it. */
export const CREDENTIALS_NOTE =
  "Plain text provider API keys. This file is NOT encrypted and is NOT a system keychain. " +
  "It is readable only by your OS account (checked when ans writes it). " +
  "Written by `ans auth set`; remove one key with `ans auth remove <provider>` or delete this file.";

/** Where each provider's key normally comes from, and how it is used. */
export interface CredentialProviderInfo {
  id: string;
  kind: "model" | "search";
  /** Env var that holds this provider's key when an explicit env value is in force. */
  envKey: string;
}

export const CREDENTIAL_PROVIDERS: readonly CredentialProviderInfo[] = [
  { id: "openai", kind: "model", envKey: "OPENAI_API_KEY" },
  { id: "anthropic", kind: "model", envKey: "ANTHROPIC_API_KEY" },
  { id: "google", kind: "model", envKey: "GOOGLE_API_KEY" },
  { id: "tavily", kind: "search", envKey: "TAVILY_API_KEY" },
  { id: "exa", kind: "search", envKey: "EXA_API_KEY" },
  { id: "anysearch", kind: "search", envKey: "ANYSEARCH_API_KEY" },
];

/** Model providers only: the ids `ans llm` knows about, with their canonical env names. */
export function modelProviderEnvKeys(): Record<string, string> {
  return envKeysByKind("model");
}

/** Search providers only: the ids the retriever builds arms for. */
export const SEARCH_PROVIDER_ENV_KEYS: Record<string, string> = envKeysByKind("search");

function envKeysByKind(kind: CredentialProviderInfo["kind"]): Record<string, string> {
  return Object.fromEntries(
    CREDENTIAL_PROVIDERS.filter((p) => p.kind === kind).map((p) => [p.id, p.envKey]),
  );
}

export function credentialProvider(id: string): CredentialProviderInfo | undefined {
  return CREDENTIAL_PROVIDERS.find((p) => p.id === id);
}

/**
 * One stored key. `endpoint` is only meaningful for model providers: null means
 * "the provider's own default endpoint", a string means that exact base URL.
 */
export interface CredentialBinding {
  provider: string;
  endpoint: string | null;
  apiKey: string;
}

export interface CredentialFileContents {
  bindings: CredentialBinding[];
  /** Set when the file exists but could not be read or parsed. Never silently treated as empty on write. */
  error?: string;
}

export function userCredentialsPath(home: string = homedir()): string {
  return join(home, ".anysearch-cli", CREDENTIALS_FILENAME);
}

/**
 * The user config root every credential/config reader must agree on: an
 * explicit override, else USERPROFILE (Windows), else HOME, else the real home.
 *
 * One function because two readers that disagree would read different files -
 * the resolver would look for the key the writer had just stored somewhere
 * else. An exported-but-empty value falls through, matching this repo's
 * convention for "set but blank means unset".
 */
export function resolveConfigHome(explicit?: string, env: NodeJS.ProcessEnv = process.env): string {
  return explicit || env.USERPROFILE || env.HOME || homedir();
}

/**
 * Normalize an endpoint for binding comparison: trim and drop trailing slashes,
 * so `https://gw/v1/` and `https://gw/v1` are the same binding. An empty value
 * means "no custom endpoint" (= the provider's default).
 */
export function normalizeBindingEndpoint(endpoint: string | null | undefined): string | null {
  if (endpoint === undefined || endpoint === null) return null;
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  return trimmed === "" ? null : trimmed;
}

function asBinding(raw: unknown): CredentialBinding | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  const provider = typeof rec["provider"] === "string" ? rec["provider"].trim().toLowerCase() : "";
  const apiKey = typeof rec["apiKey"] === "string" ? rec["apiKey"].trim() : "";
  if (!provider || !apiKey) return null;
  const endpoint = typeof rec["endpoint"] === "string" ? normalizeBindingEndpoint(rec["endpoint"]) : null;
  return { provider, endpoint, apiKey };
}

/** Read the credential file. A missing file is simply "no keys"; a broken one reports why. */
export function readUserCredentials(
  opts: { home?: string; filePath?: string } = {},
): CredentialFileContents {
  const path = opts.filePath ?? userCredentialsPath(opts.home);
  if (!existsSync(path)) return { bindings: [] };
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    return { bindings: [], error: path + ": could not read (" + (e as Error).message + ")" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { bindings: [], error: path + ": not valid JSON (" + (e as Error).message + ")" };
  }
  const list = (parsed as Record<string, unknown> | null)?.["bindings"];
  if (!Array.isArray(list)) {
    return { bindings: [], error: path + ": missing the \"bindings\" list" };
  }
  const bindings = list.map(asBinding).filter((b): b is CredentialBinding => b !== null);
  return { bindings };
}

/** Search credentials resolved for the retriever's three arms. */
export interface ResolvedSearchCredentials {
  tavily?: { apiKey?: string; source: "env" | "user" };
  exa?: { apiKey?: string; source: "env" | "user" };
  anysearch?: { apiKey?: string; endpoint?: string; source: "env" | "user" };
  /** Human-readable notes for stderr; never contains a secret value. */
  warnings: string[];
}

/**
 * Resolve the search-provider keys: explicit env first (per provider), then the
 * user credential file. Search keys are bound to their provider only - the
 * endpoint of these SDKs is fixed, and an explicit ANYSEARCH_ENDPOINT is the
 * documented way to point that arm at a mirror.
 */
export function resolveSearchCredentials(
  env: NodeJS.ProcessEnv = process.env,
  opts: { home?: string; filePath?: string } = {},
): ResolvedSearchCredentials {
  // The config root follows the same HOME/USERPROFILE convention the rest of the
  // installation uses (one shared resolver, so the reader and the writer can
  // never disagree about which file is in force).
  const home = resolveConfigHome(opts.home, env);
  const file = readUserCredentials({ ...opts, home });
  const warnings: string[] = [];
  if (file.error) warnings.push("[credentials] " + file.error + "; continuing without the user credential file");
  const out: ResolvedSearchCredentials = { warnings };

  // One rule for all three arms: an explicit env value wins over the stored
  // entry, and a missing key means the arm simply is not supplied (its SDK
  // keeps whatever fallback it has).
  const pick = (provider: "tavily" | "exa" | "anysearch"): { apiKey?: string; source: "env" | "user" } | undefined => {
    const envKey = SEARCH_PROVIDER_ENV_KEYS[provider];
    const fromEnv = envKey ? env[envKey]?.trim() : undefined;
    if (fromEnv) return { apiKey: fromEnv, source: "env" };
    const stored = file.bindings.find((b) => b.provider === provider)?.apiKey;
    return stored ? { apiKey: stored, source: "user" } : undefined;
  };

  const tavily = pick("tavily");
  if (tavily) out.tavily = tavily;
  const exa = pick("exa");
  if (exa) out.exa = exa;

  // The anysearch arm also takes an endpoint. It is an env-only input (the
  // adapter's default endpoint is baked in), and it is meaningful even with no
  // key at all - that is how the offline acceptance lane points the arm at a
  // dead port.
  const ansEndpoint = env.ANYSEARCH_ENDPOINT?.trim() || undefined;
  const anysearch = pick("anysearch");
  if (anysearch) out.anysearch = { ...anysearch, endpoint: ansEndpoint };
  else if (ansEndpoint) out.anysearch = { endpoint: ansEndpoint, source: "env" };

  return out;
}

/** Outcome of looking one provider up in the credential file. */
export type CredentialLookup =
  | { status: "found"; apiKey: string }
  | { status: "endpoint-mismatch"; stored: string | null }
  | { status: "absent" };

/**
 * Look up a model-provider key bound to (provider, endpoint). A key stored for
 * another endpoint of the same provider reports `endpoint-mismatch` instead of
 * being sent to a host it was not entered for.
 */
export function lookupModelCredential(
  provider: string | undefined,
  endpoint: string | null,
  file: CredentialFileContents,
): CredentialLookup {
  if (!provider) return { status: "absent" };
  const wanted = normalizeBindingEndpoint(endpoint);
  const forProvider = file.bindings.filter((b) => b.provider === provider.trim().toLowerCase());
  const exact = forProvider.find((b) => b.endpoint === wanted);
  if (exact) return { status: "found", apiKey: exact.apiKey };
  if (forProvider.length > 0) return { status: "endpoint-mismatch", stored: forProvider[0]!.endpoint };
  return { status: "absent" };
}

// ---------------------------------------------------------------------------
// Access protection
// ---------------------------------------------------------------------------

/**
 * Test seam for two failure modes that cannot be produced deterministically on
 * every host, and whose branches must still be covered:
 *
 * - `run`: a Windows host where the ACL tools are unusable (icacls missing, the
 *   filesystem has no ACL support, the account lacks the right). The write has
 *   to fail closed rather than publish a readable file.
 * - `verify`: another process widening the file between publish and the final
 *   check - a real race (someone chmods the file) with no deterministic trigger.
 *
 * Production leaves both unset and every write goes through the real tools.
 */
export const credentialProtectionSeam: {
  run?: (file: string, args: string[]) => string;
  verify?: (path: string, platform: NodeJS.Platform) => void;
} = {};

/** Run a System32 tool by absolute path - a PATH entry must never impersonate icacls. */
function system32Tool(name: string): string {
  const root = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  return join(root, "System32", name);
}

function runTool(file: string, args: string[]): string {
  if (credentialProtectionSeam.run) return credentialProtectionSeam.run(file, args);
  return execFileSync(file, args, { encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024 });
}

function activePlatform(): NodeJS.Platform {
  return process.platform;
}

let cachedSid: string | undefined;

/** The current account's SID, read from whoami; cached for the process. */
export function currentUserSid(): string {
  if (cachedSid) return cachedSid;
  const raw = runTool(system32Tool("whoami.exe"), ["/user", "/fo", "csv", "/nh"]).trim();
  // "\"domain\\user\",\"S-1-5-21-...\"" - the CSV second field is the SID.
  const fields = raw.split('","').map((s) => s.replace(/^"|"$/g, ""));
  const sid = fields[1] ?? "";
  if (!/^S-\d+(-\d+)+$/.test(sid)) {
    throw new Error("cannot determine the current Windows account SID (whoami said: " + raw.slice(0, 80) + ")");
  }
  cachedSid = sid;
  return sid;
}

/** Trustees an owner-only DACL may name: this account, Administrators, SYSTEM. */
function allowedWindowsTrustees(sid: string): Set<string> {
  return new Set([sid.toUpperCase(), "LA", "BA", "SY"]);
}

/** Lock the file to the current account. Windows: replace the DACL; POSIX: 0600. */
function applyProtection(path: string, platform: NodeJS.Platform): void {
  if (platform === "win32") {
    const sid = currentUserSid();
    runTool(system32Tool("icacls.exe"), [path, "/inheritance:r", "/grant:r", "*" + sid + ":(F)"]);
    return;
  }
  chmodSync(path, 0o600);
}

/** Read the file's DACL as SDDL text via `icacls /save` (writes UTF-16LE). */
function readWindowsSddl(path: string): string {
  const tmp = join(
    // /save writes next to the file it is given; a unique name in the temp dir
    // keeps the read side effect away from the credential directory.
    process.env.TEMP || process.env.TMP || ".",
    "ans-acl-" + process.pid + "-" + randomBytes(6).toString("hex") + ".acl",
  );
  try {
    runTool(system32Tool("icacls.exe"), [path, "/save", tmp]);
    if (!existsSync(tmp)) throw new Error("icacls /save produced no output");
    const text = readFileSync(tmp).toString("utf16le");
    const line = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith("D:"))
      .pop();
    if (!line) throw new Error("icacls /save reported no DACL");
    return line;
  } finally {
    try { unlinkSync(tmp); } catch { /* temp cleanup only */ }
  }
}

function parseAces(sddl: string): { flags: string; aces: { type: string; flags: string; trustee: string }[] } {
  const body = sddl.slice(2); // drop "D:"
  const firstParen = body.indexOf("(");
  const flags = firstParen < 0 ? body : body.slice(0, firstParen);
  const aces: { type: string; flags: string; trustee: string }[] = [];
  for (const match of body.matchAll(/\(([^)]*)\)/g)) {
    // SDDL ACE field order: type;flags;rights;object_guid;inherit_object_guid;trustee
    const parts = match[1]!.split(";");
    aces.push({
      type: (parts[0] ?? "").toUpperCase(),
      flags: (parts[1] ?? "").toUpperCase(),
      trustee: (parts[5] ?? "").toUpperCase(),
    });
  }
  return { flags: flags.toUpperCase(), aces };
}

/**
 * Verify the file is readable only by this account, using the platform's own
 * notion of access control. Throws with a plain reason when it is not.
 */
export function verifyFileProtection(path: string, platform: NodeJS.Platform = activePlatform()): void {
  if (credentialProtectionSeam.verify) {
    credentialProtectionSeam.verify(path, platform);
    return;
  }
  if (platform === "win32") {
    const sid = currentUserSid();
    const sddl = readWindowsSddl(path);
    const { flags, aces } = parseAces(sddl);
    if (!flags.includes("P")) {
      throw new Error("its Windows DACL still inherits permissions from the parent folder (" + sddl + ")");
    }
    const allowed = allowedWindowsTrustees(sid);
    if (aces.length === 0) throw new Error("its Windows DACL allows nobody (" + sddl + ")");
    for (const ace of aces) {
      if (ace.flags.includes("I")) {
        throw new Error("its Windows DACL contains an inherited entry for " + ace.trustee + " (" + sddl + ")");
      }
      if (ace.type !== "A") {
        throw new Error("its Windows DACL contains a non-allow entry (" + ace.type + ") for " + ace.trustee + " (" + sddl + ")");
      }
      if (!allowed.has(ace.trustee)) {
        throw new Error("its Windows DACL still allows " + ace.trustee + " (" + sddl + ")");
      }
    }
    // Keep the owner able to use the file at all.
    if (!aces.some((a) => a.trustee === sid.toUpperCase() || a.trustee === "LA")) {
      throw new Error("its Windows DACL does not grant this account access (" + sddl + ")");
    }
    return;
  }
  const st = lstatSync(path);
  if (!st.isFile()) throw new Error("it is not a regular file");
  const mode = st.mode & 0o777;
  if (mode !== 0o600) {
    throw new Error("its POSIX mode is " + mode.toString(8) + ", expected 600");
  }
  if (typeof process.getuid === "function" && process.getuid() !== undefined) {
    // Only meaningful on POSIX; a file owned by another uid is already a fault.
    if (st.uid !== process.getuid()) throw new Error("it is owned by another account (uid " + st.uid + ")");
  }
}

/**
 * Write the file so that no unprotected copy of the secret ever lands on disk:
 * the empty temp file is protected and verified FIRST, the key is written into
 * that already-protected file, and the result is renamed into place.
 */
function writeProtectedFile(path: string, content: string, platform: NodeJS.Platform): void {
  const dir = dirname(path);
  const tmp = join(dir, ".credentials." + process.pid + "." + randomBytes(6).toString("hex") + ".tmp");
  let published = false;
  try {
    const dirExisted = existsSync(dir);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!dirExisted && platform !== "win32") {
      try { chmodSync(dir, 0o700); } catch { /* the file check below is the real gate */ }
    }
    writeFileSync(tmp, "", { encoding: "utf8", flag: "wx", mode: 0o600 });
    applyProtection(tmp, platform);
    verifyFileProtection(tmp, platform);
    writeFileSync(tmp, content, { encoding: "utf8" });
    renameSync(tmp, path);
    published = true;
    verifyFileProtection(path, platform);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* already renamed or never created */ }
    if (published) {
      // The rename already replaced the target and the final check failed, so
      // the only safe state is "no file": failing closed beats leaving a secret
      // another account can read. Recovering needs a new `ans auth set`.
      try { unlinkSync(path); } catch { /* best effort */ }
    }
    // Every failure in this write - an unusable directory, a refused ACL tool, a
    // failed verification - leaves by this one door, worded the same way. A raw
    // EEXIST/EACCES would leave the user guessing whether a key was stored.
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(
      "refusing to write the credential file " + path + ": " + reason +
      ". Set the key in the environment instead (e.g. ANS_LLM_API_KEY), or fix the folder's permissions and retry.",
    );
  }
}

function serialize(bindings: CredentialBinding[]): string {
  const payload = {
    note: CREDENTIALS_NOTE,
    bindings: bindings
      .slice()
      .sort((a, b) => a.provider.localeCompare(b.provider) || String(a.endpoint).localeCompare(String(b.endpoint)))
      .map((b) => (b.endpoint === null
        ? { provider: b.provider, apiKey: b.apiKey }
        : { provider: b.provider, endpoint: b.endpoint, apiKey: b.apiKey })),
  };
  return JSON.stringify(payload, null, 2) + "\n";
}

export interface WriteCredentialInput {
  provider: string;
  /** Model providers only; omit/null for the provider's default endpoint. */
  endpoint?: string | null;
  apiKey: string;
}

/**
 * Store one key. Existing entries are preserved; the same (provider, endpoint)
 * pair is replaced. A malformed file is never rewritten - it would drop the
 * other keys - so the caller gets an error telling them to fix or remove it.
 */
export function writeUserCredential(
  input: WriteCredentialInput,
  opts: { home?: string; filePath?: string } = {},
): string {
  const info = credentialProvider(input.provider);
  if (!info) {
    throw new Error(
      "unknown provider " + JSON.stringify(input.provider) + "; known: " +
      CREDENTIAL_PROVIDERS.map((p) => p.id).join(", "),
    );
  }
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("the API key is empty");
  if (/[\u0000-\u001f\u007f]/.test(apiKey)) {
    throw new Error("the API key contains control characters; paste the key itself, not terminal escape codes");
  }
  if (apiKey.length > 8192) throw new Error("the API key is too long to be a key (" + apiKey.length + " characters)");
  const endpoint = normalizeBindingEndpoint(input.endpoint);
  if (endpoint !== null && info.kind !== "model") {
    throw new Error(
      "provider " + info.id + " is a search provider; its endpoint is fixed by the adapter " +
      "(use ANYSEARCH_ENDPOINT for the anysearch arm), so --endpoint only applies to model providers",
    );
  }

  const path = opts.filePath ?? userCredentialsPath(opts.home);
  const existing = readUserCredentials({ filePath: path });
  if (existing.error) {
    throw new Error(existing.error + "; fix or remove that file, then retry - rewriting it would drop the other keys");
  }
  const kept = existing.bindings.filter((b) => !(b.provider === info.id && b.endpoint === endpoint));
  kept.push({ provider: info.id, endpoint, apiKey });
  writeProtectedFile(path, serialize(kept), activePlatform());
  return path;
}

/** Remove one key. Returns false when there was nothing to remove. */
export function removeUserCredential(
  input: { provider: string; endpoint?: string | null },
  opts: { home?: string; filePath?: string } = {},
): boolean {
  const path = opts.filePath ?? userCredentialsPath(opts.home);
  const existing = readUserCredentials({ filePath: path });
  if (existing.error) throw new Error(existing.error + "; fix or remove that file, then retry");
  const endpoint = normalizeBindingEndpoint(input.endpoint);
  const kept = existing.bindings.filter(
    (b) => !(b.provider === input.provider && b.endpoint === endpoint),
  );
  if (kept.length === existing.bindings.length) return false;
  if (kept.length === 0) {
    try { unlinkSync(path); } catch { /* already gone */ }
    return true;
  }
  writeProtectedFile(path, serialize(kept), activePlatform());
  return true;
}

