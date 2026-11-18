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
  defaultDomainsDirs,
  loadDomainByNameIn,
  SqliteObservationStore,
  SqliteSessionStore,
  readActiveCalibrationBundle,
  createDomainReloader,
  domainTomlPath,
  resolvePolicyFromSchema,
  isDomainSchemaError,
  resolveSearchCredentials,
  type ResolvedSearchCredentials,
} from "@anysearch-cli/store";
import * as path from "node:path";
import type { AttributionCalibration } from "./calibrate";

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
    const raw = String(error instanceof Error ? error.message : error);
    const message = /api[ _-]?key|401|unauthorized|invalid header value/i.test(raw)
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
 * Turn a credential-resolution failure into a sentence safe to show. The
 * resolver reads a file that holds keys, so its message is not assumed clean:
 * only a recognised category and a bare errno code are quoted, and each of them
 * points at the fix. Anything unrecognised becomes a fixed sentence - an
 * unknown message is exactly the case where a key fragment could ride along.
 */
function classifyCredentialFault(error: unknown): string {
  const raw = String(error instanceof Error ? error.message : error);
  const code = /\b(EACCES|EPERM|ENOENT|EISDIR|EROFS|ENOSPC|EMFILE|EBUSY)\b/.exec(raw)?.[1];
  if (/not valid JSON|missing the "bindings" list|has no apiKey|has no provider/i.test(raw)) {
    return "the user credential file is not readable as stored keys (" + (code ?? "parse fault") + "); fix or remove it";
  }
  if (/refusing to write/i.test(raw)) {
    return "the credential file could not be written (" + (code ?? "write fault") + "); check the folder's permissions";
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
  // #188: the same domain dirs the loader used, passed on to runtime reloaders
  // so a base TOML in a host-specific dir stays resolvable on a live re-read.
  domainsDirs?: string[];
  ledger?: BudgetLedgerPort;
  // #301: which key each search arm was built with (env vs user credential
  // file), so a degraded arm can say "no key" instead of only "construction
  // failed". A tagged union rather than three optional fields: a consumer must
  // be able to tell "nobody asked", "asked, no key" and "asked, it broke" apart
  // at the type level, because reading the last one as the middle one hides a
  // real fault. Never carries a secret value.
  credentialSources?: CredentialSources;
}

/** The three outcomes of search-credential resolution. */
export type CredentialSources =
  /** No `searchCredentials` seam was passed; nothing was resolved. */
  | { status: "unasked" }
  /** Resolution completed; a key present here is the one that arm was built with. */
  | { status: "resolved"; tavily?: string; exa?: string; anysearch?: string }
  /** Resolution threw. The arms fell back to their own env; `error` explains why. */
  | { status: "failed"; error: string };

// createEngine: build configured engine.
// If domain is provided, loads TOML + filters providers by sources.enabled.
// If domain is omitted, all providers are registered (full fanout, skipping those without API keys).
// persistent DB path for maintenance commands (consolidate / forget / backfill).
// ANS_DB_PATH overrides; default ~/.anysearch/anysearch.db (global dir convention from t0-projection).
// Kernel does not read env elsewhere, but path resolution is composition-root I/O (pits: keep it here).
export function resolveDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.ANS_DB_PATH && env.ANS_DB_PATH.trim();
  if (explicit) return explicit;
  const home = env.USERPROFILE || env.HOME || ".";
  return path.join(home, ".anysearch", "anysearch.db");
}

// attribution calibration lives on disk as a revision-root head
// pointer; only the wiring resolves it. Env override mirrors
// scripts/attribution-calibrate.mjs; default joins the ~/.anysearch dir convention.
export function resolveAttributionRevisionRoot(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.ANS_ATTRIBUTION_GOLD_REVISION_ROOT && env.ANS_ATTRIBUTION_GOLD_REVISION_ROOT.trim();
  if (explicit) return path.resolve(explicit);
  const home = env.USERPROFILE || env.HOME || ".";
  return path.join(home, ".anysearch", "attribution-gold-revisions");
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
  let credentialSources: CredentialSources = { status: "unasked" };
  if (opts?.searchCredentials) {
    try {
      creds = opts.searchCredentials(env);
      for (const warning of creds?.warnings ?? []) {
        writeProviderDiagnostic("[anysearch] " + warning + "\n");
      }
      const resolved: CredentialSources = { status: "resolved" };
      if (creds?.tavily) resolved.tavily = creds.tavily.source;
      if (creds?.exa) resolved.exa = creds.exa.source;
      if (creds?.anysearch) resolved.anysearch = creds.anysearch.source;
      credentialSources = resolved;
    } catch (e) {
      creds = undefined;
      // The raw message is classified, never forwarded: this string can reach
      // stderr and (through the engine result) an MCP payload, and the resolver
      // reads a credential file, so its error text must not be trusted to be
      // free of a key fragment (CWE-532; same rule as buildProvider above).
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

  if (domain) {
    try {
      // B1: resolution chain — caller-supplied domains dirs (builtin package
      // dir etc.) then the ANS_DOMAINS_DIR/CWD defaults. Missing domain stays
      // fail-open full-fanout; schema errors keep today's semantics.
      const dirs = domainsDirs;
      const schema = loadDomainByNameIn(domain, dirs);
      config = schema as DomainConfigPort;
      const enabled = schema.sources.enabled;
      sourceWeights = schema.sources.weights;
      providers = buildProviders(enabled, providerBuildErrors, creds);
      // resolve the TOML path through the same chain the loader used
      // (env -> CWD -> caller-supplied dirs), then hand the engine a reloader that
      // keeps last-known-good on a bad reload (plugin server reuses this pattern).
      const tomlPath = domainTomlPath(process.cwd(), domain, dirs);
      const reload = createDomainReloader(tomlPath, dirs);
      let liveSchema = schema;
      const live = () => {
        const reloaded = reload();
        if (reloaded) liveSchema = reloaded;
        return liveSchema;
      };
      urlPolicy = () => resolvePolicyFromSchema(live());
      // Internal field is sub_domain in TOML (wire-adjacent declaration);
      // mapped to subDomain at this boundary so the kernel stays vertical*.
      repoVertical = () => {
        const v = live().sources.vertical;
        return v ? { domain: v.domain, ...(v.sub_domain ? { subDomain: v.sub_domain } : {}) } : undefined;
      };
    } catch (e) {
      // configuration errors fail fast — an invalid sources.weights must not be
      // swallowed by the fail-open full-fanout fallback (which exists for missing domains/keys).
      // rework: the predicate is the whole
      // "Domain schema:" family, not a single field — a malformed sources.vertical
      // (or urlAllowlist/compaction/…) is the same silent-drop class: the domain
      // is configured but broken, so swallowing it would discard the operator's
      // explicit policy (incl. the URL allowlist trust boundary). "Domain not
      // found" stays fail-open — absent domain ≠ broken domain.
      if (isDomainSchemaError(e)) throw e;
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
    domainsDirs,
    ledger,
    credentialSources,
  };
}
