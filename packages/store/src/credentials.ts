// User credential file (#301 / spec S2).
//
// What this is: ONE plaintext file under the user config root
// (`~/.ans/credentials.json`) holding provider API keys, so the user
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
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { ansCredentialsPathFor, resolveConfigHome } from "./ans-paths.js";

export { resolveConfigHome };


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
  /**
   * Additional env names that also mean "this provider's key". pi-ai resolves a
   * model provider's key from its OWN map, and for google that name is
   * GEMINI_API_KEY (see @earendil-works/pi-ai dist/env-api-keys). A key entered
   * under that name is still google's key, so the provider binding must
   * recognize it — otherwise changing the provider would send it elsewhere.
   */
  altEnvKeys?: readonly string[];
}

export const CREDENTIAL_PROVIDERS: readonly CredentialProviderInfo[] = [
  { id: "openai", kind: "model", envKey: "OPENAI_API_KEY" },
  { id: "anthropic", kind: "model", envKey: "ANTHROPIC_API_KEY" },
  { id: "google", kind: "model", envKey: "GOOGLE_API_KEY", altEnvKeys: ["GEMINI_API_KEY"] },
  { id: "tavily", kind: "search", envKey: "TAVILY_API_KEY" },
  { id: "exa", kind: "search", envKey: "EXA_API_KEY" },
  { id: "anysearch", kind: "search", envKey: "ANYSEARCH_API_KEY" },
];

/**
 * The search arms this resolver fills. It is declared, and the catalog is
 * checked against it at load time, so a provider added on one side only stops
 * the module with one named error instead of being resolved by nobody.
 */
export const SEARCH_PROVIDER_IDS = ["tavily", "exa", "anysearch"] as const;
export type SearchProviderId = (typeof SEARCH_PROVIDER_IDS)[number];
assertCatalogMatchesSearchIds();

/**
 * Search providers only: the env var each one's key is read from.
 *
 * The `kind === "search"` check is not redundant with the assert above: that one
 * compares the two lists, so a model provider that happens to share an id would
 * pass it. Here the kind is what makes the id a search arm at all.
 */
export const SEARCH_PROVIDER_ENV_KEYS: Record<SearchProviderId, string> = Object.fromEntries(
  SEARCH_PROVIDER_IDS.map((id) => {
    const found = credentialProvider(id);
    if (!found || found.kind !== "search") {
      throw new Error("SEARCH_PROVIDER_IDS names " + id + " but CREDENTIAL_PROVIDERS has no search provider of that id");
    }
    return [id, found.envKey];
  }),
) as Record<SearchProviderId, string>;

/**
 * A search provider in the catalog that no arm resolves is a silent hole: doctor
 * would list it, `resolveSearchCredentials` would never fill it, and nothing
 * would say why. Fail at import instead, with ONE wording for the whole class of
 * mismatch so a reader never has to work out which of two messages applies.
 */
function assertCatalogMatchesSearchIds(): void {
  const catalog = CREDENTIAL_PROVIDERS.filter((p) => p.kind === "search").map((p) => p.id).sort();
  const declared = [...SEARCH_PROVIDER_IDS].sort();
  if (catalog.join(",") !== declared.join(",")) {
    throw new Error(
      "CREDENTIAL_PROVIDERS search ids (" + catalog.join(", ") + ") and SEARCH_PROVIDER_IDS (" +
      declared.join(", ") + ") disagree; add the provider to both",
    );
  }
}

/**
 * Every env name that means "this provider's key", canonical first. Used to
 * resolve the provider a stored `env_key` name belongs to when the user file
 * does not state one.
 */
export function providerForEnvKey(envKey: string): string | undefined {
  const wanted = envKey.trim();
  return CREDENTIAL_PROVIDERS.find(
    (p) => p.envKey === wanted || p.altEnvKeys?.includes(wanted),
  )?.id;
}

/** The env var a model provider's key is read from; includes pi-ai's alternate names. */
export function modelEnvKeysFor(provider: string): string[] {
  const info = credentialProvider(provider);
  if (!info || info.kind !== "model") return [];
  return [info.envKey, ...(info.altEnvKeys ?? [])];
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

/**
 * What kind of fault made the credential file unusable.
 *
 * Design: a closed set — this is the only thing about the file that reaches a
 * machine-readable surface, so it never grows into free text (no file
 * contents, no key fragment).
 */
export type CredentialFileFaultKind = "unreadable" | "not-json" | "invalid-structure" | "invalid-record";

/**
 * The errnos a read failure may report.
 *
 * Design: a closed set — `e.code` is typed `string`, and only codes with a
 * remedy the user can act on belong here.
 */
export const CREDENTIAL_FILE_FAULT_ERRNOS = [
  "EACCES", "EPERM", "EROFS", "EISDIR", "ENOTDIR", "ENAMETOOLONG",
  "EMFILE", "ENFILE", "EBUSY", "ETIMEDOUT", "ENOSPC", "EIO",
] as const;

export type CredentialFileFaultErrno = (typeof CREDENTIAL_FILE_FAULT_ERRNOS)[number];

/** The classification alone: what kind of fault, plus the errno when there was one. */
export interface CredentialFileFault {
  kind: CredentialFileFaultKind;
  errno?: CredentialFileFaultErrno;
}

export interface CredentialFileContents {
  bindings: CredentialBinding[];
  /** Set when the file exists but could not be read or parsed. Never silently treated as empty on write. */
  error?: string;
  /**
   * The same fact as `error`, classified. A machine-readable surface carries
   * this instead of the sentence: `error` can quote the file (a bad entry names
   * the provider it found), and a reader acting on the fault does not need the
   * wording.
   */
  fault?: CredentialFileFault;
}

/**
 * Design: one return writes both — the sentence for stderr, the classification
 * for machine-readable surfaces; every failure exit goes through this helper.
 */
function unusableFile(
  path: string,
  detail: string,
  kind: CredentialFileFaultKind,
  errno?: string,
): CredentialFileContents {
  return {
    bindings: [],
    error: path + ": " + detail,
    fault: isCredentialFaultErrno(errno) ? { kind, errno } : { kind },
  };
}

/**
 * The one place the credential file's path is decided. A call that omits `home`
 * resolves the config root through `resolveConfigHome`, so a reader and a writer
 * that both omit it can never end up describing two different files.
 */
export function userCredentialsPath(home: string = resolveConfigHome()): string {
  return ansCredentialsPathFor(home);
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

/**
 * What may be SHOWN for a bound endpoint. A base URL can carry credentials
 * (`https://user:pass@host/v1`) or a secret in its query string, and `ans auth
 * list` prints the binding — so the userinfo and the query are stripped first.
 * The stored value is untouched; only the display form is.
 */
export function displayEndpoint(endpoint: string | null): string {
  if (!endpoint) return "(provider default endpoint)";
  // `new URL("user:pass@host/v1")` parses with scheme "user:" — so a missing
  // scheme must be caught BEFORE parsing, or the userinfo would ride along.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(endpoint)) return stripAuthorityAndQuery(endpoint);
  try {
    const url = new URL(endpoint);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return stripAuthorityAndQuery(endpoint);
  }
}

/** Drop userinfo (everything up to the last '@' in the authority) and the query. */
function stripAuthorityAndQuery(value: string): string {
  const withoutQuery = value.split(/[?#]/)[0] ?? "";
  const firstSlash = withoutQuery.indexOf("/");
  const authority = firstSlash < 0 ? withoutQuery : withoutQuery.slice(0, firstSlash);
  const at = authority.lastIndexOf("@");
  return at >= 0 ? withoutQuery.slice(at + 1) : withoutQuery;
}

/**
 * What may be SHOWN for a provider id read out of the file: the fault sentence is
 * printed verbatim by `ans auth`, `auth list`, `ans llm` and doctor, so a value
 * pasted into that field must not arrive with control characters or at any length.
 */
export function providerLabel(raw: string): string {
  // `\p{Cc}` is the control class and `\p{Cf}` the format class (zero-width
  // joiners, bidi overrides): both can rewrite or hide what a terminal shows. A
  // space in their place keeps two tokens from fusing into one word.
  const cleaned = raw.replace(/[\p{Cc}\p{Cf}]+/gu, " ").trim();
  return cleaned.length > 40 ? cleaned.slice(0, 40) + "…" : cleaned;
}

/**
 * Validate one stored record. Returns the binding, or a reason it cannot be
 * trusted. A record is never silently dropped: writing back a filtered list
 * would permanently erase whatever it held.
 */
function parseBinding(raw: unknown, index: number): { binding: CredentialBinding } | { problem: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { problem: "entry " + (index + 1) + " is not an object" };
  }
  const rec = raw as Record<string, unknown>;
  const provider = typeof rec["provider"] === "string" ? rec["provider"].trim().toLowerCase() : "";
  if (!provider) return { problem: "entry " + (index + 1) + " has no provider" };
  const apiKey = typeof rec["apiKey"] === "string" ? rec["apiKey"].trim() : "";
  if (!apiKey) return { problem: "entry " + (index + 1) + " (" + providerLabel(provider) + ") has no apiKey" };
  // An endpoint that is present but not a string cannot be silently reshaped
  // into "the provider default" - that would change which host the key is sent
  // to, which is exactly what the binding is supposed to prevent.
  const rawEndpoint = rec["endpoint"];
  if (rawEndpoint !== undefined && rawEndpoint !== null && typeof rawEndpoint !== "string") {
    return { problem: "entry " + (index + 1) + " (" + providerLabel(provider) + ") has a non-string endpoint" };
  }
  const endpoint = typeof rawEndpoint === "string" ? normalizeBindingEndpoint(rawEndpoint) : null;
  return { binding: { provider, endpoint, apiKey } };
}

/**
 * A UTF-8 BOM is legal in a text file and fatal to `JSON.parse`. Notepad and
 * PowerShell's redirection both add one, so a file that looks healthy in an
 * editor would otherwise read as "not valid JSON".
 */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * The pieces every surface builds its advice from: the two command names, and the
 * two halves of the sentence. Only a fault inside a readable file can be repaired,
 * so `KEEP_KEYS` belongs to that case alone.
 */
export const REPAIR_COMMAND = "ans auth repair";
export const STORE_KEY_COMMAND = "ans auth set <provider>";
export const FIX_OR_REPLACE = "fix or remove the file";
export const KEEP_KEYS = "or run " + REPAIR_COMMAND + " to keep the keys it can still read";
const REMOVE_ADVICE = "; " + FIX_OR_REPLACE + ", then retry";
const REPAIR_ADVICE = "; " + FIX_OR_REPLACE + ", " + KEEP_KEYS;

/**
 * What the user can do about a read failure, by the code that caused it. "Fix its
 * permissions" is wrong advice for a full disk or a directory in the file's
 * place, and "remove it" on a full disk would throw away keys that are fine.
 */
const READ_REMEDY: Record<CredentialFileFaultErrno, string> = {
  EACCES: "fix its permissions",
  EPERM: "fix its permissions",
  EROFS: "move the file to a writable disk",
  EISDIR: "move the directory at that path aside",
  ENOTDIR: "fix the path: a parent directory is a file",
  ENAMETOOLONG: "shorten the path",
  ENOSPC: "free some disk space",
  EMFILE: "close some open files and run ans again",
  ENFILE: "close some open files and run ans again",
  EBUSY: "retry once nothing else is using the file",
  ETIMEDOUT: "retry once the file is reachable",
  EIO: "check the disk and retry the read",
};

/** True for a code in the closed set: the only kind worth publishing. */
export function isCredentialFaultErrno(value: unknown): value is CredentialFileFaultErrno {
  return CREDENTIAL_FILE_FAULT_ERRNOS.some((code) => code === value);
}

/** The remedy for a code this build knows; a neutral sentence for anything else. */
export function readFaultRemedy(errno?: string): string {
  return isCredentialFaultErrno(errno) ? READ_REMEDY[errno] : "check the file and the folder it lives in";
}

/** The one wording for "the file cannot be read at all"; the read and the repair share it. */
function unreadableSentence(code: string): string {
  return "could not read it (" + code + "); " + readFaultRemedy(code);
}

/**
 * Parse the file's bytes. One parser for the read and the repair path: they have
 * to agree on what a readable file is, and a read fix (the BOM) would otherwise
 * have to be made twice.
 *
 * `problems` names every record that failed, in file order, and `bindings` holds
 * the ones that passed. The read path reports the first problem as a whole-file
 * fault (a partial view must never be written back); repair is the one caller
 * allowed to act on the split.
 */
function parseCredentialBytes(
  raw: string,
): { bindings: CredentialBinding[]; problems: string[] } | { detail: string; kind: CredentialFileFaultKind } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(raw));
  } catch (e) {
    // SECURITY: a JSON.parse message quotes the text around the error, which in
    // this file is usually a key. Report only the position - the reader
    // (`ans auth list`, doctor, the resolver's warning) goes to stderr, and spec
    // S2 forbids a secret in error details. Node's message carries "(line N
    // column M)" for a syntax error; keep that and drop the rest.
    const position = /line \d+ column \d+/.exec((e as Error).message)?.[0];
    return { detail: "not valid JSON" + (position ? " (" + position + ")" : ""), kind: "not-json" };
  }
  const list = (parsed as Record<string, unknown> | null)?.["bindings"];
  if (!Array.isArray(list)) return { detail: "missing the \"bindings\" list", kind: "invalid-structure" };
  const bindings: CredentialBinding[] = [];
  const problems: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const parsedEntry = parseBinding(list[i], i);
    if ("problem" in parsedEntry) problems.push(parsedEntry.problem);
    else bindings.push(parsedEntry.binding);
  }
  return { bindings, problems };
}

/** Read the credential file. A missing file is simply "no keys"; a broken one reports why. */
export function readUserCredentials(
  opts: { home?: string; filePath?: string } = {},
): CredentialFileContents {
  // `userCredentialsPath` already resolves the root when `home` is undefined, so
  // the path is decided in exactly one place.
  const path = opts.filePath ?? userCredentialsPath(opts.home);
  if (!existsSync(path)) return { bindings: [] };
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    // Same rule as the parse error: the file's contents never reach the output.
    return unusableFile(
      path,
      unreadableSentence((e as NodeJS.ErrnoException).code ?? "I/O error"),
      "unreadable",
      (e as NodeJS.ErrnoException).code,
    );
  }
  const bytes = parseCredentialBytes(raw);
  if (!("bindings" in bytes)) {
    return unusableFile(path, bytes.detail + REMOVE_ADVICE, bytes.kind);
  }
  // A record that cannot be trusted makes the WHOLE file untrusted: returning
  // the readable ones would let the next write replace the file with a filtered
  // list and permanently erase the bad record (and whatever it held). Report it
  // instead, so the user fixes or removes the file knowingly.
  if (bytes.problems.length > 0) {
    return unusableFile(path, bytes.problems[0]! + REPAIR_ADVICE, "invalid-record");
  }
  return { bindings: bytes.bindings };
}

/**
 * The sentence a warning line says about a credential file that could not be read
 * or parsed: `resolveSearchCredentials` puts it in `warnings`, and `ans auth
 * status` prints it after `[WARN] `. Diagnosis rows (doctor, `ans auth list`, `ans
 * llm`) print `file.error` in their own shape instead, because they also say how
 * to fix it. Undefined for a healthy (or absent) file.
 */
export function credentialFileWarning(file: CredentialFileContents): string | undefined {
  return file.error ? file.error + "; continuing without the user credential file" : undefined;
}

/** Search credentials resolved for the retriever's three arms. */
export interface ResolvedSearchCredentials {
  tavily?: { apiKey?: string; source: "env" | "user" };
  exa?: { apiKey?: string; source: "env" | "user" };
  anysearch?: { apiKey?: string; endpoint?: string; source: "env" | "user" };
  /**
   * Human-readable notes for stderr; never contains a secret value. Empty when
   * the caller supplied `credentialsFile`: that caller already holds the file's
   * `error` and reports it once (see `credentialFileWarning`).
   */
  warnings: string[];
  /**
   * Classified fault of the user credential file: present only when the file
   * exists but could not be read or parsed. Copied regardless of `warnings`,
   * because a caller that parsed the file itself suppresses the warning (that is
   * `ans chat`) and its engine still has to report the fault (#533).
   */
  credentialFileFault?: CredentialFileFault;
}

/**
 * Resolve the search-provider keys: explicit env first (per provider), then the
 * user credential file. Search keys are bound to their provider only - the
 * endpoint of these SDKs is fixed, and an explicit ANYSEARCH_ENDPOINT is the
 * documented way to point that arm at a mirror.
 *
 * Design: the command that reads the user credential file parses it once and
 * passes the result to every resolver and report; whoever parsed it reports its
 * fault. A resolver given `credentialsFile` neither reads the file again nor
 * reports it, so nothing has to decide whether a message repeats another.
 * `filePath` only applies when this resolver reads the file itself.
 */
export function resolveSearchCredentials(
  env: NodeJS.ProcessEnv = process.env,
  opts: { home?: string; filePath?: string; credentialsFile?: CredentialFileContents } = {},
): ResolvedSearchCredentials {
  // The config root follows the same HOME/USERPROFILE convention the rest of the
  // installation uses (one shared resolver, so the reader and the writer can
  // never disagree about which file is in force).
  const home = resolveConfigHome(opts.home, env);
  const file = opts.credentialsFile ?? readUserCredentials({ home, filePath: opts.filePath });
  const warnings: string[] = [];
  // Untagged: each consumer adds its own prefix (`[anysearch] ` on the kernel's
  // stderr, `[WARN] ` in `ans auth status`). Tagging here would couple them to
  // this string and double the prefix.
  const fault = credentialFileWarning(file);
  if (!opts.credentialsFile && fault) warnings.push(fault);
  const out: ResolvedSearchCredentials = { warnings };
  // The classification travels even when the warning does not: a caller that
  // parsed the file itself reports the sentence in its own shape, and the
  // engine still has to say on a machine-readable surface that the file is
  // unusable (#533).
  if (file.fault) out.credentialFileFault = file.fault;

  // One rule for all three arms: an explicit env value wins over the stored
  // entry, and a missing key means the arm simply is not supplied (its SDK
  // keeps whatever fallback it has).
  const pick = (provider: SearchProviderId): { apiKey?: string; source: "env" | "user" } | undefined => {
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
  //
  // Whenever the injected env names an endpoint it is emitted, with or without a
  // key: a caller that passes its own env must not get `undefined` here while
  // the provider constructor falls back to the real process.env, because then
  // the arm's key and its endpoint would come from two different envs.
  const ansEndpoint = env.ANYSEARCH_ENDPOINT?.trim() || undefined;
  const anysearch = pick("anysearch");
  if (anysearch) out.anysearch = { ...anysearch, endpoint: ansEndpoint };
  else if (ansEndpoint) out.anysearch = { endpoint: ansEndpoint, source: "env" };

  return out;
}

/** Outcome of looking one provider up in the credential file. */
export type CredentialLookup =
  | { status: "found"; apiKey: string }
  /** Every endpoint the provider has a stored key for; empty means "the provider default". */
  | { status: "endpoint-mismatch"; stored: string[] }
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
  // Report ALL stored endpoints, not just the first: the file sorts them
  // lexicographically, so naming one would tell the user their key is bound to
  // an arbitrary host and invite them to "fix" the wrong thing.
  if (forProvider.length > 0) {
    return { status: "endpoint-mismatch", stored: forProvider.map((b) => b.endpoint).filter((e): e is string => e !== null) };
  }
  return { status: "absent" };
}

// ---------------------------------------------------------------------------
// Cross-process mutation lock
// ---------------------------------------------------------------------------

/**
 * How long to keep trying for the mutation lock before giving up, and how long
 * before an existing lock is assumed abandoned. Writing a key is a
 * sub-millisecond read-modify-write, so a lock older than the stale window means
 * its owner died; waiting forever would hang a command, and stealing silently
 * would reintroduce the very race this lock prevents.
 */
const LOCK_WAIT_MS = 5_000;
const LOCK_STALE_MS = 10_000;

/**
 * Take an exclusive lock for a read-modify-write of the credential file.
 *
 * Without it, two `ans auth set` processes can each read the same old file, add
 * their own entry, and replace the whole file - the later writer silently
 * deleting the other's key while both report success. Rename
 * atomicity does not help: it makes each write complete, not the read+write pair
 * atomic.
 *
 * `openSync(..., "wx")` is the atomic step (O_CREAT|O_EXCL): exactly one creator
 * wins. A lock whose mtime is older than the stale window is treated as
 * abandoned and removed, which bounds recovery from a killed process.
 */
function withCredentialLock<T>(path: string, fn: () => T): T {
  const lockPath = path + ".lock";
  // Every failure in this function leaves by the same door as a failed write, so
  // the user sees one actionable sentence whatever step failed - including "the
  // folder is not writable", which is the most common real cause and used to
  // escape as a bare EACCES from the lock file (found by the installed-product
  // lane in CI: a read-only config directory must fail with this message, not
  // with an errno).
  // Never after a publish: this door is a refused lock or an unusable folder.
  const refused = (reason: string): CredentialWriteRefusal =>
    new CredentialWriteRefusal(refusalSentence(path, reason), false);
  try {
    mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  } catch (e) {
    throw refused("cannot create " + dirname(lockPath) + " (" + ((e as NodeJS.ErrnoException).code ?? "I/O error") + ")");
  }
  const deadline = Date.now() + LOCK_WAIT_MS;
  let fd: number | undefined;
  for (;;) {
    try {
      fd = openSync(lockPath, "wx", 0o600);
      break;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        // EACCES/EROFS here means the directory refuses the lock file - the same
        // root cause as a refused write, so it gets the same actionable door.
        throw refused("cannot take the write lock " + lockPath + " (" + (code ?? "I/O error") + ")");
      }
      let stale = false;
      try {
        stale = Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS;
      } catch {
        // It vanished between the failed create and the stat: retry at once.
        continue;
      }
      if (stale) {
        try { unlinkSync(lockPath); } catch { /* another waiter won the removal */ }
        continue;
      }
      if (Date.now() >= deadline) {
        throw refused(
          "another ans process is writing it (" + lockPath + " is still held after " +
          Math.round(LOCK_WAIT_MS / 1000) + "s)",
        );
      }
      sleepMs(20);
    }
  }
  try {
    writeSync(fd, String(process.pid));
    return fn();
  } finally {
    try { closeSync(fd); } catch { /* already closed */ }
    try { unlinkSync(lockPath); } catch { /* already gone */ }
  }
}

/** Blocking sleep without a dependency; Node allows Atomics.wait on the main thread. */
function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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

/** `classifyCredentialFault` matches on "refusing to write", so this sentence is built once. */
function refusalSentence(path: string, reason: string): string {
  return "refusing to write the credential file " + path + ": " + reason +
    ". Set the key in the environment instead (e.g. ANS_LLM_API_KEY), or fix the folder's permissions and retry.";
}

/**
 * A refused credential write. `published` is true when the rename had already
 * replaced the target and the later access check failed: the file then holds the
 * new bytes, or the fail-closed removal took it away. False means nothing on disk
 * changed. A caller cannot tell this from the filesystem afterwards, so the write
 * says it.
 */
export class CredentialWriteRefusal extends Error {
  // Assigning in the body, not a parameter property: the manual probes load this
  // module through Node's strip-only TypeScript loader, which refuses that syntax.
  readonly published: boolean;
  constructor(message: string, published: boolean) {
    super(message);
    this.name = "CredentialWriteRefusal";
    this.published = published;
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
    throw new CredentialWriteRefusal(refusalSentence(path, reason), published);
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
  // The lock covers the WHOLE read-modify-write, not just the file replacement:
  // two writers that both read the old file would otherwise each replace it with
  // their own view, deleting the other's key.
  return withCredentialLock(path, () => {
    const existing = readUserCredentials({ filePath: path });
    if (existing.error) {
      // The read already ended with the advice; say only what this write did not do.
      throw new CredentialWriteRefusal(
        existing.error + "; writing it now would rebuild the file and drop the record it cannot read",
        false,
      );
    }
    const kept = existing.bindings.filter((b) => !(b.provider === info.id && b.endpoint === endpoint));
    kept.push({ provider: info.id, endpoint, apiKey });
    writeProtectedFile(path, serialize(kept), activePlatform());
    return path;
  });
}

/** Remove one key. Returns false when there was nothing to remove. */
export function removeUserCredential(
  input: { provider: string; endpoint?: string | null },
  opts: { home?: string; filePath?: string } = {},
): boolean {
  const path = opts.filePath ?? userCredentialsPath(opts.home);
  const endpoint = normalizeBindingEndpoint(input.endpoint);
  // Same lock as the write: a removal racing a write could otherwise resurrect a
  // key that was just deleted, or delete one that was just added.
  return withCredentialLock(path, () => {
    const existing = readUserCredentials({ filePath: path });
    if (existing.error) {
      throw new CredentialWriteRefusal(
        existing.error + "; removing it now would rebuild the file and drop the record it cannot read",
        false,
      );
    }
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
  });
}

export type CredentialRepairResult =
  | { kind: "absent" }
  | { kind: "unrepairable"; error: string }
  | { kind: "healthy"; path: string; kept: number }
  | { kind: "repaired"; path: string; kept: number; dropped: string[] }
  /** The rewrite was refused. `published` says whether the target may hold the new bytes. */
  | { kind: "write-failed"; error: string; published: boolean };

/**
 * Keep the records that can be trusted and drop the ones that cannot.
 *
 * Design: read the raw bytes under the lock, never `readUserCredentials`'s
 * `bindings` — that list is empty on every fault, and writing it back is the
 * erasure the read path exists to prevent.
 */
export function repairUserCredentials(
  opts: { home?: string; filePath?: string } = {},
): CredentialRepairResult {
  const path = opts.filePath ?? userCredentialsPath(opts.home);
  if (!existsSync(path)) return { kind: "absent" };
  return withCredentialLock(path, () => {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (e) {
      return {
        kind: "unrepairable",
        error: path + ": " + unreadableSentence((e as NodeJS.ErrnoException).code ?? "I/O error"),
      };
    }
    const bytes = parseCredentialBytes(raw);
    if (!("bindings" in bytes)) {
      return {
        kind: "unrepairable",
        error: path + ": " + bytes.detail +
          "; nothing in it can be kept, so remove the file and store the keys again",
      };
    }
    if (bytes.problems.length === 0) return { kind: "healthy", path, kept: bytes.bindings.length };
    try {
      writeProtectedFile(path, serialize(bytes.bindings), activePlatform());
    } catch (e) {
      if (e instanceof CredentialWriteRefusal) {
        return { kind: "write-failed", error: e.message, published: e.published };
      }
      throw e;
    }
    return { kind: "repaired", path, kept: bytes.bindings.length, dropped: bytes.problems };
  });
}

