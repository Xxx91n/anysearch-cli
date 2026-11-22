// Composition entry point: createEngine factory.
// lifted from apps/cli/src/composition.ts to packages/kernel.
// Both apps/cli and apps/mcp import from @anysearch-cli/kernel.
// decision 3A: pure function, no state, domain-aware provider filtering.
// decision 1A: returns RetrieverPort, not concrete RetroaererdEngine.
// decision 4A: loads domain from domains/<name>.toml convention directory.

import { TavilyProvider, ExaProvider, AnySearchProvider } from "@anysearch-cli/retriever/providers";
import type { SearchProvider, SearchRequest } from "@anysearch-cli/retriever";
import { RetroaererdEngine } from "./engine";
import type { RetrieverPort, DomainConfigPort, SessionStorePort, BudgetLedgerPort } from "./ports";
import {
  ansAttributionRoot,
  ansDurableDbPath,
  defaultDomainsDirs,
  SqliteObservationStore,
  SqliteSessionStore,
  readActiveCalibrationBundle,
  createDomainReloader,
  domainTomlPath,
  resolvePolicyFromSchema,
  resolveSearchCredentials,
  type ResolvedSearchCredentials,
} from "@anysearch-cli/store";
import * as path from "node:path";
import type { AttributionCalibration } from "./calibrate";
import {
  describeDomainFallback,
  domainConstraintFailure,
  DomainConstraintError,
  resolveDomainConstraint,
  type DomainConstraintFailure,
} from "./domain-constraint";

// Map provider ids to constructors.
// ponytail: wrap in try/catch — providers without API keys are skipped, not crashed.
// T7 ruling: the skip is fail-open named degradation, never silent — a failed
// construction writes a named stderr line and lands in
// CompositionResult.providerBuildErrors. Missing-key/config faults and
// unexpected construction bugs degrade identically (the arm is absent either
// way); only the message wording differs (the former hints at the key env).
//
// #301: the credential passed in comes from the shared resolver (explicit env
// first, then the user credential file), so a GUI host with no shell env still
// authenticates. The constructors keep their own env fallback as a last resort;
// an argument always wins over it.
type CredentialSource = ResolvedSearchCredentials | undefined;

const PROVIDER_CONSTRUCTORS: Record<string, (creds: CredentialSource) => SearchProvider> = {
  tavily: (creds) => new TavilyProvider(creds?.tavily?.apiKey),
  exa: (creds) => new ExaProvider(creds?.exa?.apiKey),
  anysearch: (creds) => new AnySearchProvider(creds?.anysearch?.apiKey, creds?.anysearch?.endpoint),
};

// Best-effort diagnostic: a closed/broken stderr (e.g. the MCP parent closed
// the pipe) must not turn the fail-open engine build into a process crash —
// both synchronous write throws and asynchronous stream errors are absorbed.
// The providerBuildErrors record remains the durable trace in that case.
function writeProviderDiagnostic(message: string): void {
  const stderr = process.stderr;
  const swallow = () => {};
  stderr.once("error", swallow);
  try {
    // On async write failure Node invokes the callback with the error BEFORE
    // emitting 'error' — the listener must survive until the event fires, so
    // it is removed only on a clean write (a lingering once-listener after a
    // failed write is harmless: it self-removes on the swallowed event).
    stderr.write(message, (error) => {
      if (!error) stderr.off("error", swallow);
    });
  } catch {
    stderr.off("error", swallow);
  }
}

/**
 * Which of the two things a provider-construction throw means, for callers that
 * have to word it themselves. The message is never returned or reprinted: it can
 * carry the key (see buildProvider).
 */
export function classifyProviderBuildError(error: unknown): "credential" | "unexpected" {
  const raw = String(error instanceof Error ? error.message : error);
  return /api[ _-]?key|401|unauthorized|invalid header value/i.test(raw) ? "credential" : "unexpected";
}

// Builds one provider arm; a construction failure is recorded into
// providerBuildErrors (id -> message) and surfaced on stderr — stdout stays
// protocol-pure for MCP. Unknown ids keep the legacy silent skip (schema-level
// concern, not a construction failure).
function buildProvider(
  id: string,
  providerBuildErrors: Record<string, string>,
  creds: CredentialSource,
): SearchProvider | undefined {
  const construct = PROVIDER_CONSTRUCTORS[id];
  if (!construct) return undefined;
  try {
    return construct(creds);
  } catch (error) {
    // Constructor error text is never recorded verbatim: constructors receive
    // the API key, and runtime error messages can embed it (e.g. Node's
    // "Headers.append: <value> is an invalid header value"). Only a safe
    // category rides stderr and providerBuildErrors (CWE-532). An invalid
    // header value at construction time is a malformed auth header — worded as
    // a credential fault regardless of which provider threw.
    const message = classifyProviderBuildError(error) === "credential"
      ? "permanent: missing/invalid credential — set the provider's API key env"
      : "unexpected construction fault";
    providerBuildErrors[id] = message;
    writeProviderDiagnostic("[anysearch] provider " + id + " construction failed: " + message + "\n");
    return undefined;
  }
}

function buildProviders(
  ids: string[],
  providerBuildErrors: Record<string, string>,
  creds: CredentialSource,
): SearchProvider[] {
  return ids
    .map((id) => buildProvider(id, providerBuildErrors, creds))
    .filter((p): p is SearchProvider => p !== undefined);
}

/**
 * Turn a credential-resolution failure into a sentence safe to show. Only a
 * recognised category and a bare errno are quoted: this text comes from a module
 * that reads a key file, so an unrecognised message is exactly the case where a
 * key fragment could ride along. Each branch names the fix, so a permissions
 * fault never reads as "delete the file".
 */
function classifyCredentialFault(error: unknown): string {
  const raw = String(error instanceof Error ? error.message : error);
  const code = /\b(EACCES|EPERM|ENOENT|EISDIR|EROFS|ENOSPC|EMFILE|ENFILE|EBUSY|ETIMEDOUT|ENOTDIR|ENAMETOOLONG)\b/.exec(raw)?.[1];
  // A permission fault outranks the wording: the same "could not read it" text
  // is used for EACCES and for a syntax error, and advising "delete the file" on
  // a permissions problem would destroy the user's other keys for nothing.
  const permission = code === "EACCES" || code === "EPERM" || code === "EROFS";

  if (/not valid JSON|missing the "bindings" list|is not an object|has no provider|has no apiKey|non-string endpoint/i.test(raw)) {
    return permission
      ? "the user credential file could not be read (" + code + "); check its permissions"
      : "the user credential file is not readable as stored keys; fix or remove it, then retry";
  }
  if (/refusing to write/i.test(raw)) {
    // The refusal carries the real cause (permissions, an unusable ACL tool, a
    // failed protection check, a held lock). Keeping the category is what lets a
    // user tell "fix the folder" from "another ans is writing it".
    if (/still held after/i.test(raw)) {
      return "another ans process is writing the credential file; wait for it to finish and retry";
    }
    // An ACL/protection fault is checked before the errno rules: it is thrown
    // after the write itself succeeded, so an errno in the message says nothing
    // about why the protection failed. Anchored on the wording store really
    // throws - a bare /ACL/ would also match the file path every message carries.
    if (/\bDACL\b|POSIX mode|not a regular file|owned by another account/i.test(raw)) {
      return "the credential file could not be locked to your account (" + (code ?? "protection fault") + "); check the folder's permissions";
    }
    // Everything else is classified by errno, not by wording. `writeProtectedFile`
    // re-throws the raw reason, so a message may carry an errno with no
    // "cannot create" prefix at all; keying on the phrase would make these
    // branches dead for the cases they exist for.
    if (permission) {
      return "the credential file's folder refused access (" + code + "); check its permissions";
    }
    if (code === "ENOSPC") return "there is no space left for the credential file; free some space and retry";
    if (code === "ENOTDIR" || code === "ENAMETOOLONG") {
      return "the credential file's folder path is not usable (" + code + "); check the config root";
    }
    if (code === "EMFILE" || code === "ENFILE") {
      return "this process has too many files open to write the credential file (" + code + "); close some and retry";
    }
    if (code === "EBUSY") {
      return "the credential file is in use (" + code + "); retry in a moment";
    }
    return "the credential file could not be written; check the folder's permissions";
  }
  if (code === "ETIMEDOUT") {
    // Not "the file is unreadable": a timeout means the storage behind it did not
    // answer (a network mount, a busy disk), and the fix is to look there.
    return "the user credential file did not respond in time (ETIMEDOUT); check the disk or network mount behind it";
  }
  if (code) return "the user credential file could not be read (" + code + ")";
  return "the user credential file could not be read; run `ans auth list` to check it";
}

export interface CompositionResult {
  retriever: RetrieverPort;
  config?: DomainConfigPort;
  store: SessionStorePort;
  observation: SqliteObservationStore;
  // exposed so cross-round merged attribution can reuse the same
  // immutable active head instead of silently falling back to the legacy floor.
  calibration?: AttributionCalibration;
  // Fail-open named degradation (T7 ruling): provider id -> construction
  // failure message, empty when every enabled arm built. Consumers pair this
  // with the engine's runtime providersFailed to audit the full chain.
  providerBuildErrors: Record<string, string>;
  // T2 #177: the per-call budget ledger bound to `store`'s connection. Exposed so
  // the PiAgentRuntime wiring (#178) passes this same instance — one budget row
  // per session, never a second ledger over the same DB. Optional so hand-built
  // CompositionResult mocks (tests, embedders) stay source-compatible; every
  // createEngine result supplies it.
  // #188: the domain name this engine was created for, so runtime reloaders
  // resolve the same TOML instead of falling back to ANS_DOMAIN/default.
  domainName?: string;
  // #306: whether that name was declared by the operator. Travels with
  // `domainName` so a long-lived host cannot re-read the env later and pair one
  // call's `declared` with an engine built for another name.
  domainDeclared?: boolean;
  // #188: the same domain dirs the loader used, passed on to runtime reloaders
  // so a base TOML in a host-specific dir stays resolvable on a live re-read.
  domainsDirs?: string[];
  ledger?: BudgetLedgerPort;
  // #301: which key each search arm was built with (env vs user credential
  // file), so a degraded arm can say "no key" instead of only "construction
  // failed". Never carries a secret value. UNDEFINED when no seam was passed, so
  // `if (engine.credentialSources)` keeps meaning "resolution was asked for".
  credentialSources?: CredentialSources;
}

/**
 * What search-credential resolution concluded. `undefined` at the consumer means
 * "nobody asked" (see the field above), so this type only covers the two cases
 * where a resolution actually ran.
 */
export type CredentialSources =
  /**
   * Resolution completed. Each arm says where its key came from, or `"none"` when
   * the arm was configured without one - the anysearch arm can carry an endpoint
   * and no key, and that arm is degraded, not authenticated. Recording it keeps
   * "not configured" and "configured but keyless" distinguishable.
   */
  | { status: "resolved"; tavily?: CredentialSourceLabel; exa?: CredentialSourceLabel; anysearch?: CredentialSourceLabel }
  /** Resolution threw. The arms fell back to their own env; `error` explains why. */
  | { status: "failed"; error: string };

/** Where one search arm's key came from; `"none"` means the arm has no key. */
export type CredentialSourceLabel = "env" | "user" | "none";

/**
 * Keep a resolver warning's meaning but drop anything that could be a secret.
 *
 * Reworked to stop guessing: an earlier version decided by shape ("this looks
 * like words, so it cannot be a key"), which let a lower-case key body through
 * and ate directory names that contained a digit. The order is now explicit:
 *
 * 1. set every file path aside, because the message exists to say WHICH FILE
 *    could not be read;
 * 2. redact everything key-shaped in what is left, with no shape-based escape;
 * 3. put the paths back.
 *
 * Step 2 redacts two forms: a known key prefix with a body of 8+ key characters
 * (the body may cross `/` and `.`, so a base64 key split by either is removed
 * whole), and any run of 20+ key characters. Both thresholds are deliberately
 * low: over-redacting a warning costs a sentence, under-redacting costs a key.
 */
export function redactPathFault(warning: string): string {
  const paths: string[] = [];
  // Placeholders are letters and digits only: a path contains backslashes, and a
  // backslash inside a replacement string is an escape, not a character.
  const token = (i: number) => "ZZPATH" + i + "ZZ";
  const body = warning.replace(PATH_RE, (match, offset: number) => {
    // A key can look exactly like a relative path (`sk-proj-ab12/cd34`). When
    // the match continues a known key prefix, it is a key, not a path - leaving
    // it unprotected is what lets the prefix rule below remove it whole.
    if (KEY_PREFIX_AT_END.test(warning.slice(0, offset))) return match;
    const kept = paths.length;
    paths.push(match);
    return token(kept);
  });
  const redacted = body
    .replace(/(?:sk|pk|rk|tvly|exa|key|api|tok)[-_][A-Za-z0-9_\-+=/.!]{8,}/gi, "[redacted]")
    .replace(/[A-Za-z0-9_\-+=]{20,}/g, "[redacted]");
  return paths.reduce((text, path, i) => text.split(token(i)).join(path), redacted);
}

const KEY_PREFIX_AT_END = /(?:sk|pk|rk|tvly|exa|key|api|tok)[-_]$/i;

/**
 * Real paths only. The relative branch needs a dot in the name or a known file
 * extension, because a bare `a/b` is also the shape of a base64 key body - and
 * protecting a key from redaction is the one failure this function cannot make.
 * The match stops at whitespace or punctuation that ends a path in these
 * messages, so `.../credentials.json: EACCES` keeps the errno outside the span.
 */
const PATH_RE = new RegExp(
  [
    // absolute POSIX or drive-letter path, any segments
    "(?:[A-Za-z]:)?[\\\\/][A-Za-z0-9._~\\-\\\\/]*",
    // relative path that is clearly a file: it carries an extension
    "|\\b[A-Za-z0-9._\\-]+(?:[\\\\/][A-Za-z0-9._\\-]+)*[\\\\/][A-Za-z0-9._\\-]+\\.[A-Za-z0-9]{1,10}\\b",
    // dotted file name with no directory part
    "|\\b[A-Za-z0-9._\\-]+\\.(?:json|toml|lock|log|txt|ya?ml|db|sqlite|acl|tmp)\\b",
  ].join(""),
  "g",
);
// createEngine: build configured engine.
// If domain is provided, loads TOML + filters providers by sources.enabled.
// If domain is omitted, all providers are registered (full fanout, skipping those without API keys).
// persistent DB path for maintenance commands (consolidate / forget / backfill).
// ANS_DB_PATH overrides; default ~/.ans/anysearch.db (#323).
// Kernel does not read env elsewhere, but path resolution is composition-root I/O (pits: keep it here).
export function resolveDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return ansDurableDbPath(env);
}

// attribution calibration lives on disk as a revision-root head
// pointer; only the wiring resolves it. Nothing in this repo derives a bundle
// any more, so a shipped install stays on the legacy floor until one is
// installed by hand; default joins the ~/.ans dir convention.
export function resolveAttributionRevisionRoot(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.ANS_ATTRIBUTION_GOLD_REVISION_ROOT && env.ANS_ATTRIBUTION_GOLD_REVISION_ROOT.trim();
  if (explicit) return path.resolve(explicit);
  return ansAttributionRoot(env);
}

// Fail-open: missing/corrupt head or bundle yields undefined and the engine
// stays on the legacy 0.6 floor (degraded path).
export function resolveActiveAttributionCalibration(
  env: NodeJS.ProcessEnv = process.env,
): AttributionCalibration | undefined {
  try {
    const active = readActiveCalibrationBundle(resolveAttributionRevisionRoot(env));
    if (!active) return undefined;
    return Object.freeze({
      params: Object.freeze({ ...active.bundle.params }),
      thresholds: Object.freeze({ ...active.bundle.thresholds }),
    });
  } catch (error) {
    // Fail-open stays, but a thrown fault (I/O, parse) is unexpected - surface
    // it instead of silently decaying to the legacy floor with no trace.
    // stderr only: MCP servers must keep stdout protocol-pure.
    process.stderr.write("[anysearch] attribution calibration load failed: " + String(error && (error as Error).message || error) + "\n");
    return undefined;
  }
}

export function createEngine(
  domain?: string,
  opts?: {
    dbPath?: string;
    attributionCalibration?: AttributionCalibration;
    domainsDirs?: string[];
    /**
     * #301: where the search arms' keys come from. Pass the shared resolution
     * (env first, then the user credential file) so a host without a shell env
     * still authenticates; omit it and each SDK falls back to its own env var,
     * which is the pre-#301 behaviour and keeps tests/embedders unchanged.
     */
    searchCredentials?: (env?: NodeJS.ProcessEnv) => ResolvedSearchCredentials;
    /**
     * Env handed to `searchCredentials`. NOTHING else in createEngine reads it -
     * domain dirs, the reloader and the calibration root still resolve through
     * process.env. Passing it therefore controls exactly one thing: where the
     * search keys come from (which is what a test needs). Do not pass it
     * expecting a fully isolated engine.
     */
    env?: NodeJS.ProcessEnv;
    /**
     * #306: false says `domain` is the caller's convention default rather than
     * something the operator named. A missing default then keeps the old
     * no-filtering fallback; a declared name that is missing stops the build.
     * Omitted means declared — passing a name is a request for that domain.
     */
    domainDeclared?: boolean;
  },
): CompositionResult {
  // #188 (CodeRabbit): keep the exact dirs the loader used (including the
  // default env/cwd chain), so a later reload still finds inherited bases even
  // if ANS_DOMAINS_DIR changes after construction.
  const domainsDirs = opts?.domainsDirs ?? defaultDomainsDirs();
  const env = opts?.env ?? process.env;
  let providers: SearchProvider[] = [];
  const providerBuildErrors: Record<string, string> = {};

  // #301: resolve every search key ONCE for this engine, so all arms see the
  // same answer and a degradation can be explained per arm. A warning about the
  // credential file goes straight to stderr (MCP keeps stdout protocol-pure)
  // and never carries a key value.
  //
  // The resolution is fail-open like every other arm of this build: a throwing
  // resolver (an unreadable file, a permission fault) must degrade to "each SDK
  // reads its own env", not kill the MCP process at startup.
  let creds: CredentialSource = undefined;
  // undefined, not a status value: a consumer that asks "was resolution even
  // configured?" still gets a falsy answer, which is what it got before #301.
  let credentialSources: CredentialSources | undefined;
  if (opts?.searchCredentials) {
    try {
      creds = opts.searchCredentials(env);
      for (const warning of creds?.warnings ?? []) {
        // Same rule as a thrown fault: the sentence is useful, so it is kept,
        // but only after anything key-shaped has been removed.
        writeProviderDiagnostic("[anysearch] " + redactPathFault(warning) + "\n");
      }
      const resolved: CredentialSources = { status: "resolved" };
      // `"none"` is only meaningful for anysearch: it is the one arm the resolver
      // emits without a key (an endpoint alone). tavily and exa are simply absent
      // when keyless, so nothing is recorded for them.
      if (creds?.tavily) resolved.tavily = creds.tavily.source;
      if (creds?.exa) resolved.exa = creds.exa.source;
      if (creds?.anysearch) resolved.anysearch = creds.anysearch.apiKey ? creds.anysearch.source : "none";
      credentialSources = resolved;
    } catch (e) {
      creds = undefined;
      // Classified, never forwarded: this text reaches stderr and the engine
      // result, and it comes from a module that reads a key file (CWE-532, same
      // rule as buildProvider above).
      const reason = classifyCredentialFault(e);
      credentialSources = { status: "failed", error: reason };
      writeProviderDiagnostic(
        "[anysearch] search credentials could not be resolved: " + reason +
        " — falling back to each SDK's own env var\n",
      );
    }
  }
  let config: DomainConfigPort | undefined;
  let sourceWeights: Record<string, number> | undefined;
  // request-time domain URL policy resolver — wired only when
  // the domain schema loads. The lazy-mtime reloader refreshes the schema when
  // the TOML changes; resolvePolicyFromSchema runs on every search() call so
  // TOML edits and ANS_URL_ALLOWLIST/DENYLIST env overrides take effect without
  // restart. No cached policy snapshot lives inside the retriever.
  let urlPolicy: (() => { allow: readonly string[]; deny: readonly string[]; policyVersion: string }) | undefined;
  // repo-level vertical default — lazy resolver over the
  // same liveSchema the urlPolicy reloader maintains (TOML edits take effect
  // without restart); absent vertical returns undefined.
  let repoVertical: (() => SearchRequest["vertical"]) | undefined;

  // Passing a name is itself a request for that domain unless the caller says
  // the name is its convention default (see `domainDeclared`); read once so the
  // build and the request-time re-read cannot disagree. No name at all means
  // nobody declared one, whatever the caller passed.
  const domainDeclared = Boolean(domain) && opts?.domainDeclared !== false;
  if (domain) {
    // #306: one three-state answer instead of a try/catch that turns every
    // absence into a full fanout. `declared: false` is the caller saying "this
    // name is my convention default, not something the operator asked for" — a
    // missing default keeps the old fallback, a broken one never does.
    const constraint = resolveDomainConstraint({
      name: domain,
      declared: domainDeclared,
      dirs: domainsDirs,
    });
    if (constraint.state === "failed") {
      if (constraint.fatal) throw new DomainConstraintError(constraint);
      process.stderr.write("[anysearch] " + describeDomainFallback(constraint) + "\n");
    }
    if (constraint.state === "established") {
      const schema = constraint.schema;
      config = schema as DomainConfigPort;
      const enabled = schema.sources.enabled;
      sourceWeights = schema.sources.weights;
      providers = buildProviders(enabled, providerBuildErrors, creds);
      // resolve the TOML path through the same chain the loader used
      // (env -> CWD -> caller-supplied dirs), then hand the engine a reloader that
      // reports a failed re-read instead of hiding it behind "unchanged".
      const tomlPath = domainTomlPath(process.cwd(), domain, domainsDirs);
      const reload = createDomainReloader(tomlPath, domainsDirs);
      let liveSchema = schema;
      // #306: a failed re-read becomes the same three-state failure the build
      // used, with the reloader's own `fault` kept intact — a declared name that
      // vanished is a fault, while the convention default vanishing is the legal
      // fallback. `domainConstraintFailure` decides `fatal`, so this path cannot
      // grow a second rule that disagrees with `legalAbsence` in the runtime.
      let liveFault: DomainConstraintFailure | undefined;
      let warnedFallback = false;
      const live = () => {
        const probe = reload();
        if (probe.kind === "reloaded") {
          liveSchema = probe.schema;
          liveFault = undefined;
        } else if (probe.kind === "failed") {
          liveFault = domainConstraintFailure({
            name: domain,
            declared: domainDeclared,
            fault: probe.fault,
            reason: probe.reason,
          });
        }
        if (liveFault?.fatal) throw new DomainConstraintError(liveFault);
        if (liveFault && !warnedFallback) {
          warnedFallback = true;
          process.stderr.write(
            "[anysearch] 没指定领域，默认的领域 TOML 读不到了（" + liveFault.reason +
              "），这次沿用上次读到的配置继续。\n",
          );
        }
        return liveSchema;
      };
      urlPolicy = () => resolvePolicyFromSchema(live());
      // Internal field is sub_domain in TOML (wire-adjacent declaration);
      // mapped to subDomain at this boundary so the kernel stays vertical*.
      repoVertical = () => {
        const v = live().sources.vertical;
        return v ? { domain: v.domain, ...(v.sub_domain ? { subDomain: v.sub_domain } : {}) } : undefined;
      };
    } else {
      providers = buildProviders(Object.keys(PROVIDER_CONSTRUCTORS), providerBuildErrors, creds);
    }
  } else {
    providers = buildProviders(Object.keys(PROVIDER_CONSTRUCTORS), providerBuildErrors, creds);
  }

  // explicit override wins; otherwise resolve the active head on disk.
  const attributionCalibration = opts?.attributionCalibration ?? resolveActiveAttributionCalibration();
  // ponytail: share one SessionStore across CLI + MCP. In-memory DB by default;
  // opts.dbPath enables durable store for maintenance commands.
  const dbPath = opts?.dbPath ?? ":memory:";
  const store = new SqliteSessionStore(dbPath);
  // T2 #177: the per-call ledger shares the store's connection. Budget rows are
  // created/cleared by #187's session-registration point (initBudget /
  // clearBudgetCaps on the Active Domain's [budget]); this root never creates
  // one, so a session without [budget] keeps #187's "no row = unmetered pass".
  // The engine acts on the ledger only when a search carries a session id
  // (Query.sessionId, threaded by PiAgentRuntime); stateless `search` calls keep
  // both gates closed.
  const ledger: BudgetLedgerPort | undefined = (() => {
    try {
      return store.createBudgetLedger();
    } catch (e) {
      // T2 #177: a legacy DB whose #187 `configured` migration failed must not
      // take the whole startup path down (ans search / MCP boot). Degrade to
      // "budget disabled" with a named stderr line; the anchors path still works.
      process.stderr.write("[anysearch] budget ledger unavailable: " + String(e instanceof Error ? e.message : e) + "\n");
      return undefined;
    }
  })();
  const engineOpts: ConstructorParameters<typeof RetroaererdEngine>[1] = {
    ...(sourceWeights ? { sourceWeights } : {}),
    ...(attributionCalibration ? { attributionCalibration } : {}),
    // domain-name rides with the resolver for audit attributes.
    ...(urlPolicy ? { urlPolicy, domainName: domain } : {}),
    ...(repoVertical ? { repoVertical } : {}),
    // per-call budget reserve→settle (T2 #177) — port present when the store
    // could build its ledger; session id is per search, so the gate opens only
    // on the chat/ans_chat paths.
    ...(ledger ? { ledger } : {}),
    // Design: the store owns anchor disk I/O; the engine only sees the port —
    // kernel purity (T7 decision #93). Writes fire only when the engine also
    // has a sessionId (per-search Query.sessionId, or construction-time opts).
    anchors: {
      saveAnchor: (sessionId, anchorType, payload) => store.saveAnchor(sessionId, anchorType, payload),
    },
  };
  const retriever: RetrieverPort = new RetroaererdEngine(
    providers,
    Object.keys(engineOpts).length ? engineOpts : undefined,
  );
  const observation = new SqliteObservationStore(dbPath);
  return {
    retriever,
    config,
    store,
    observation,
    calibration: attributionCalibration,
    providerBuildErrors,
    domainName: domain,
    domainDeclared,
    domainsDirs,
    ledger,
    credentialSources,
  };
}
