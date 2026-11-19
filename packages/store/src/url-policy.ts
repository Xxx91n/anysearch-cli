// URL authorization policy single source.
// TOML [sources].urlAllowlist/urlDenylist is the ONLY authoritative source. ANS_URL_ALLOWLIST
// is a dev-only append-only override gated by ANS_ALLOW_ENV_OVERRIDE (strict enum 1/true/0/false;
// anything else fail-closed refuses to start, D7 five-state truth table).
// mergeAllowlist + canonicalVersion are shared by kernel, server, and hook (D1/D7).
// allow = union across layers (D2); deny is a first-class independent channel evaluated last.

import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, mkdirSync, statSync, existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadDomain, loadRawDomain, tryLoadRawDomain } from "./domain-loader";
import { isDomainNotFoundError } from "./domain-schema";
import { HOSTNAME_RE, type DomainSchema } from "./domain-schema";
import { SqliteObservationStore, generateTraceIdHex } from "./observation";
import { readSessionId } from "./session-id";

export const ENV_URL_ALLOWLIST = "ANS_URL_ALLOWLIST";
export const ENV_ALLOW_OVERRIDE = "ANS_ALLOW_ENV_OVERRIDE";

// D7 strict-enum: only {1,true}/{0,false} (case-insensitive). Misset -> throw naming var+value.
export function parseEnvOverrideSwitch(raw: string | undefined | null): boolean {
  if (raw === undefined || raw === null) return false;
  const v = raw.trim().toLowerCase();
  if (v === "") return false;
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  throw new Error(
    "Refusing to start: " + ENV_ALLOW_OVERRIDE + " accepts only 1/true/0/false; got " +
    ENV_ALLOW_OVERRIDE + "=" + JSON.stringify(raw),
  );
}

// env entries validated to the same bar as TOML (D7 equal strictness).
export function parseEnvHosts(raw: string | undefined | null): string[] {
  const entries = (raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const bad = entries.filter((h) => !HOSTNAME_RE.test(h));
  if (bad.length > 0) {
    throw new Error("Refusing to start: " + ENV_URL_ALLOWLIST + " entries must be hostnames (no scheme/port/wildcard); invalid: " + JSON.stringify(bad));
  }
  return entries;
}

// canonical = sort(dedupe(trim(lowercase(hosts)))) (D6 hash-input contract).
export function canonicalizeHosts(hosts: readonly string[]): string[] {
  return [...new Set(hosts.map((h) => h.trim().toLowerCase()).filter(Boolean))].sort();
}

// D2 append-only union across layers.
export function mergeAllowlist(tomlHosts: readonly string[], envHosts: readonly string[]): string[] {
  return canonicalizeHosts([...tomlHosts, ...envHosts]);
}

// D6: policy_version = sha256(canonical merged JSON). env override participates in the hash.
export function canonicalVersion(allow: readonly string[], deny: readonly string[]): string {
  const canonical = JSON.stringify({ allow: canonicalizeHosts(allow), deny: canonicalizeHosts(deny) });
  return createHash("sha256").update(canonical).digest("hex");
}

export interface UrlPolicy {
  allow: string[];
  deny: string[];
  policyVersion: string;
  // Five-state truth-table observability (D7):
  envHostsIgnored: boolean;  // state 2: env set non-empty, switch open false -> ignored (WARN + audit once/session)
  envHostsApplied: number;   // state 3: merged hosts count
}

export function resolveUrlPolicy(input: {
  tomlHosts: readonly string[];
  denyHosts?: readonly string[];
  env?: NodeJS.ProcessEnv;
}): UrlPolicy {
  const env = input.env ?? process.env;
  const allowOverride = parseEnvOverrideSwitch(env[ENV_ALLOW_OVERRIDE]);
  const envHosts = parseEnvHosts(env[ENV_URL_ALLOWLIST]);
  const base = canonicalizeHosts(input.tomlHosts);
  const allow = allowOverride ? mergeAllowlist(base, envHosts) : base;
  const deny = canonicalizeHosts(input.denyHosts ?? []);
  return {
    allow,
    deny,
    policyVersion: canonicalVersion(allow, deny),
    envHostsIgnored: !allowOverride && envHosts.length > 0,
    envHostsApplied: allowOverride ? envHosts.length : 0,
  };
}

// Resolve from a loaded domain schema (D1/D2).
export function resolvePolicyFromSchema(
  schema: Pick<DomainSchema, "sources">,
  env?: NodeJS.ProcessEnv,
): UrlPolicy {
  return resolveUrlPolicy({
    tomlHosts: schema.sources.urlAllowlist ?? [],
    denyHosts: schema.sources.urlDenylist ?? [],
    env,
  });
}

// Resolve from a domain TOML file. Missing file = empty policy; TOML parse failure throws
// (D3 load-layer fail-closed).
export function loadPolicyFromToml(tomlPath: string, env?: NodeJS.ProcessEnv): UrlPolicy {
  const schema = loadDomain(tomlPath);
  return resolvePolicyFromSchema(schema, env);
}

// Domain TOML path convention shared by CLI/MCP/plugin-server startup paths.
// B1: optional extra domains dirs (e.g. the builtin dir shipped inside the
// CLI package) are probed after the CWD convention; first existing file wins.
export function domainTomlPath(
  cwd: string = process.cwd(),
  name: string = process.env.ANS_DOMAIN || "default",
  extraDomainsDirs: string[] = [],
): string {
  // Same chain-head order as defaultDomainsDirs: ANS_DOMAINS_DIR, then CWD
  // convention, then caller-supplied extras (e.g. builtin package domains).
  const envDir = process.env.ANS_DOMAINS_DIR?.trim();
  if (envDir) {
    const envPath = join(envDir, name + ".toml");
    if (existsSync(envPath)) return envPath;
  }
  const primary = join(cwd, "domains", name + ".toml");
  if (existsSync(primary)) return primary;
  for (const dir of extraDomainsDirs) {
    const candidate = join(dir, name + ".toml");
    if (existsSync(candidate)) return candidate;
  }
  return primary;
}

// D4/D5 structured atomic write: tmp + rename.
export function atomicWriteFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

// One file's identity for "has this declaration changed since?" questions.
// mtime alone misses a same-second rewrite; ctime also catches a chmod, which
// matters because the policy's readability is part of whether it applies.
function fileVersion(path: string): string {
  try {
    const s = statSync(path);
    return s.mtimeMs + ":" + s.ctimeMs;
  } catch {
    return "-1";
  }
}

export interface PolicySourceVersion {
  path: string;
  /** `fileVersion` of the TOML at materialization; "-1" when it did not exist. */
  version: string;
}

// The dirs a chain walk probes when the caller handed no list of its own:
// the ANS_DOMAINS_DIR override first, then the TOML's own dir, then the cwd
// convention. One definition, because the reloader and the cache envelope must
// watch exactly the same list — a `base` living only in ANS_DOMAINS_DIR was
// invisible to the envelope while the reloader re-read it, which is the stale
// cache this check exists to prevent.
function defaultChainDirs(tomlPath: string): string[] {
  const dirs: string[] = [];
  const envDir = process.env.ANS_DOMAINS_DIR?.trim();
  if (envDir) dirs.push(envDir);
  dirs.push(dirname(tomlPath));
  dirs.push(join(process.cwd(), "domains"));
  return dirs;
}

export interface DomainChainWalk {
  /** Every file the policy is actually read from, in base-first order. */
  chain: string[];
  /** Candidates that were looked for and may appear later (missing today). */
  probed: string[];
}

// The files a project's URL policy depends on: the TOML plus its whole `base`
// chain. The reloader and the cache envelope both need this list, and if they
// walk it differently the cache can be accepted while a file the reloader reads
// has changed — so there is one walk.
//
// A base that exists but does not parse still belongs to the chain: it is part
// of what the policy depends on, and skipping it would hide exactly the kind of
// breakage this list exists to notice.
export function walkDomainChain(tomlPath: string, domainsDirs?: string[]): DomainChainWalk {
  const dirs = domainsDirs && domainsDirs.length > 0 ? domainsDirs : defaultChainDirs(tomlPath);
  const chain: string[] = [tomlPath];
  const probed: string[] = [];
  let cur: ReturnType<typeof loadRawDomain> | undefined;
  try { cur = loadRawDomain(tomlPath); } catch { cur = undefined; }
  const seen = new Set<string>();
  while (cur?.base) {
    if (seen.has(cur.base)) break;
    seen.add(cur.base);
    let found: { path: string; raw: ReturnType<typeof loadRawDomain> } | undefined;
    for (const d of dirs) {
      const candidate = join(d, cur.base + ".toml");
      probed.push(candidate);
      let raw: ReturnType<typeof loadRawDomain> | undefined;
      try { raw = tryLoadRawDomain(candidate); } catch { raw = {} as ReturnType<typeof loadRawDomain>; }
      if (raw) { found = { path: candidate, raw }; break; }
    }
    if (!found) break;
    chain.push(found.path);
    cur = found.raw;
  }
  return { chain, probed };
}

// The chain's versions at one moment, for the materialized-policy envelope.
// Recording them is what lets a later reader answer "is this cached policy still
// the one the declaration says?" without parsing TOML in a dependency-free hook.
export function domainSourceVersions(tomlPath: string, domainsDirs?: string[]): PolicySourceVersion[] {
  return walkDomainChain(tomlPath, domainsDirs).chain.map((path) => ({ path, version: fileVersion(path) }));
}

// supplement: write a MaterializedPolicy envelope
// (policy body + materialized_at timestamp) to the disk cache so the hook
// readPolicy cache fallback can surface staleness. The timestamp is the only
// signal that lets the hook differentiate "fresh from server seconds ago" from
// "last write was before the server went down 3 days ago".
//
// #306: the envelope also records WHICH project and WHICH declaration files it
// was materialized from. A cache that cannot prove it still describes the
// current project's current TOML is not used at all — the hook asks instead.
export interface MaterializedPolicy {
  allow: string[];
  deny: string[];
  policy_version: string;
  materialized_at: string; // ISO-8601 UTC
  /** Real path of the project this policy belongs to. */
  project_root: string;
  /**
   * The Active Domain name it was read under. Project + file versions alone are
   * not enough: switching A to B, where both files exist and neither changes,
   * leaves A's TOML untouched and its cache "unmoved" — yet it no longer
   * describes what the project declares.
   */
  domain_name: string;
  /** The TOML and its base chain at materialization. */
  sources: PolicySourceVersion[];
}

export interface PolicyCacheProvenance {
  projectRoot: string;
  domainName: string;
  sources: PolicySourceVersion[];
}

export function writePolicyCache(cachePath: string, policy: UrlPolicy, provenance: PolicyCacheProvenance): void {
  const envelope: MaterializedPolicy = {
    allow: policy.allow,
    deny: policy.deny,
    policy_version: policy.policyVersion,
    materialized_at: new Date().toISOString(),
    project_root: provenance.projectRoot,
    domain_name: provenance.domainName,
    sources: provenance.sources,
  };
  atomicWriteFile(cachePath, JSON.stringify(envelope, null, 2) + "\n");
}

// readPolicyCacheEnvelope: hook-side discriminator. Returns null when the cache
// is unreadable / shape-broken; otherwise returns the envelope for downstream
// staleness signaling.
//
// #306: an envelope written before this field set existed cannot say which
// declaration it came from, so it is treated as shape-broken rather than as a
// policy someone may rely on.
export function readPolicyCacheEnvelope(cachePath: string): MaterializedPolicy | null {
  try {
    const raw = JSON.parse(readFileSync(cachePath, "utf8")) as Partial<MaterializedPolicy>;
    if (!Array.isArray(raw.allow) || !Array.isArray(raw.deny) || typeof raw.policy_version !== "string") return null;
    if (typeof raw.materialized_at !== "string") return null;
    if (typeof raw.project_root !== "string" || raw.project_root.length === 0) return null;
    if (typeof raw.domain_name !== "string" || raw.domain_name.length === 0) return null;
    if (!Array.isArray(raw.sources) || raw.sources.length === 0) return null;
    const sourcesOk = raw.sources.every((s) => s && typeof s.path === "string" && typeof s.version === "string");
    if (!sourcesOk) return null;
    return raw as MaterializedPolicy;
  } catch {
    return null;
  }
}

// Can this cached policy still be trusted to describe the current project?
// Three things have to hold, and none is a guess:
//   1. it was materialized for THIS project (a cache copied into another
//      project's .anysearch-cli must not answer for it);
//   2. it names the Active Domain the caller is running now;
//   3. every file it was materialized from still has the same version, so the
//      declaration it encodes has not moved since.
// Anything else — including a file that appeared where there was none — means
// the cache cannot be confirmed, and the caller must ask instead of consuming.
export function policyCacheApplies(
  envelope: MaterializedPolicy,
  ctx: { projectRoot: string; domainName: string },
): { ok: true } | { ok: false; reason: string } {
  const real = (p: string): string => {
    try { return realpathSync(p); } catch { return p; }
  };
  if (real(envelope.project_root) !== real(ctx.projectRoot)) {
    return { ok: false, reason: "cached policy was materialized for a different project" };
  }
  if (envelope.domain_name !== ctx.domainName) {
    return { ok: false, reason: "cached policy was materialized under domain \"" + envelope.domain_name + "\", not \"" + ctx.domainName + "\"" };
  }
  for (const source of envelope.sources) {
    if (fileVersion(source.path) !== source.version) {
      return { ok: false, reason: "domain TOML changed after this policy was cached (" + source.path + ")" };
    }
  }
  return { ok: true };
}

/**
 * Lazy mtime-checked domain reloader (#167/#CodeRabbit).
 *
 * #306: the probe reports three outcomes instead of `schema | null`. "Nothing
 * changed" and "the file could not be read" are different answers, and a caller
 * that cannot tell them apart keeps enforcing a policy the operator may have
 * just replaced — or, worse, treats a broken declaration as a live one. The
 * caller decides what to do with `failed`; this function never decides for it.
 *
 * Inheritance-aware: startup resolves inherited domains via file-based lookup
 * (loadDomainByNameIn), so the reloader must use the same lookup and watch
 * ancestor mtimes. Otherwise a child with base stays stale after a restart-free
 * edit, and a base-only edit is invisible (no warning).
 *
 * #188: `forceFirst` makes the first probe load and return the schema even when
 * the mtime is unchanged. A long-lived host that builds a fresh runtime per
 * request (ans_chat) snapshots mtimes at construction — after a TOML edit — so
 * an mtime-only difference would never fire. The first run then still sees the
 * current file instead of the host's startup config snapshot. Default false
 * preserves the "unchanged -> unchanged" contract for other callers.
 */
export type DomainReloadResult =
  | { kind: "unchanged" }
  | { kind: "reloaded"; schema: DomainSchema }
  | {
      kind: "failed";
      reason: string;
      /**
       * `missing` = the TOML is gone from the chain; `broken` = it is there but
       * unreadable. Callers need the difference: for an undeclared domain an
       * absent file is the legal fallback, while a broken one never is.
       */
      fault: "missing" | "broken";
    };

export function createDomainReloader(tomlPath: string, domainsDirs?: string[], opts?: { forceFirst?: boolean }): () => DomainReloadResult {
  const getSearchDirs = (): string[] => (domainsDirs ? domainsDirs : defaultChainDirs(tomlPath));
  // Single shared dir order — collectChain and lookupFor must agree so the
  // watched files are exactly the files that would be loaded (grandparent in a
  // different dir would otherwise be missed). Reuse tryLoadRawDomain for the
  // ENOENT-vs-fail-fast distinction.
  const tryResolveParent = (base: string, searchDirs: string[]): { path: string; raw: ReturnType<typeof loadRawDomain> } | undefined => {
    for (const d of searchDirs) {
      const cand = join(d, base + ".toml");
      const raw = tryLoadRawDomain(cand);
      if (raw) return { path: cand, raw };
    }
    return undefined;
  };

  // One walker (walkDomainChain) shared with the cache envelope, so the files
  // this reloader watches and the files a cached policy claims to depend on are
  // the same list — a disagreement there would let a stale cache look current.
  const collectChainAndProbed = (): DomainChainWalk => walkDomainChain(tomlPath, getSearchDirs());

  const lookupFor = (): ((name: string) => ReturnType<typeof loadRawDomain> | undefined) | undefined => {
    const searchDirs = getSearchDirs();
    return (parent: string) => tryResolveParent(parent, searchDirs)?.raw;
  };

  // version includes ctime so chmod (permission repair) is detected even
  // when mtime is unchanged (inode(7): ctime changes on permission change).
  // watched = chain files + every probed candidate (including missing, -1)
  // so a new higher-priority file that shadows a parent is detected via stat,
  // without re-parsing the chain on every call.
  let { chain: watchedChain, probed: watchedProbed } = (() => {
    try { return collectChainAndProbed(); } catch { return { chain: [tomlPath], probed: [] as string[] }; }
  })();
  let watched = [...new Set([...watchedChain, ...watchedProbed])];
  let mtimes = new Map<string, string>();
  for (const pp of watched) mtimes.set(pp, fileVersion(pp));
  let warnedSig = "";
  let forcedFirst = opts?.forceFirst === true;

  return () => {
    const forced = forcedFirst;
    forcedFirst = false;
    // snapshot before attempt so a parent created during the load is not
    // recorded as already loaded.
    const preWatched = [...watched];
    let changed = false;
    for (const pp of watched) {
      if (fileVersion(pp) !== mtimes.get(pp)) { changed = true; break; }
    }
    if (!forced && !changed) return { kind: "unchanged" };
    try {
      const schema = loadDomain(tomlPath, lookupFor());
      const next = collectChainAndProbed();
      watchedChain = next.chain;
      watchedProbed = next.probed;
      watched = [...new Set([...watchedChain, ...watchedProbed])];
      mtimes.clear();
      for (const pp of watched) mtimes.set(pp, fileVersion(pp));
      return { kind: "reloaded", schema };
    } catch (e) {
      // collect new chain/probed but do not snapshot newly discovered paths
      // with their post-failure versions as if they were already loaded;
      // otherwise a parent created during the attempt would be missed.
      let next: { chain: string[]; probed: string[] } | null = null;
      try { next = collectChainAndProbed(); } catch { /* keep previous */ }
      if (next) {
        const preSet = new Set(preWatched);
        const merged = [...new Set([...watched, ...next.chain, ...next.probed])];
        const newPaths = new Set(merged.filter((p) => !preSet.has(p)));
        watched = merged;
        mtimes.clear();
        for (const pp of watched) {
          if (newPaths.has(pp)) {
            // force next call to re-check this path (was not covered by pre snapshot)
            mtimes.set(pp, "-1");
          } else {
            mtimes.set(pp, fileVersion(pp));
          }
        }
      } else {
        mtimes.clear();
        for (const pp of watched) mtimes.set(pp, fileVersion(pp));
      }
      const sig = watched.map((pp) => fileVersion(pp)).join(",");
      if (warnedSig !== sig) {
        warnedSig = sig;
        process.stderr.write("[anysearch] domain TOML reload failed: " + (e instanceof Error ? e.message : String(e)) + "\n");
      }
      // ENOENT is the ordinary shape of "the file is not there" (the reloader
      // is handed the convention path even when nothing exists at it), while
      // loadDomainByNameIn raises "Domain not found" instead. Both mean absent.
      const errno = (e as NodeJS.ErrnoException)?.code;
      return {
        kind: "failed",
        reason: e instanceof Error ? e.message : String(e),
        fault: errno === "ENOENT" || isDomainNotFoundError(e) ? "missing" : "broken",
      };
    }
  };
}

// D8 ConfigChange audit event fields.
export interface ConfigChangeEvent {
  source: "toml" | "env" | "cli";
  path: string;
  change: { before: unknown; after: unknown };
  policyVersion: string;
  actor?: string;
  traceId?: string;
  sessionId?: string;
}

// + /: write into the local trace store. Fail-open
// (AGENTS.md: audit write failure degrades to stderr), same posture as the rest of
// the observation layer. traceId/sessionId are forwarded to recordOperation so
// the new attribution columns are populated (OPA #6905 closure: SELECT after
// write returns the same values the caller threaded in).
//
// #307: the return value says whether the row landed. Fail-open stays — an
// audit fault must not break the caller's own work — but a caller that records
// this write as a task (the hook service) must not write "success" over a
// stderr line nobody reads. Existing callers ignore the value, so their
// behaviour is unchanged.
export async function emitConfigChangeAudit(dbPath: string, event: ConfigChangeEvent): Promise<boolean> {
  // Caller-supplied trace_id wins (server extracts from HTTP header); absent ->
  // generate fresh W3C 32-hex for this audit call (CLI per-command lifetime).
  const traceId = event.traceId && event.traceId.length === 32 ? event.traceId : generateTraceIdHex();
  // Caller-supplied session_id wins (server extract); absent -> read from file
  // (CLI path). MCP path keeps it empty.
  const sessionId = event.sessionId && event.sessionId.length > 0 ? event.sessionId : readSessionId();
  const attributes = {
    "anysearch.config.event_id": randomUUID(),
    "anysearch.config.timestamp": new Date().toISOString(),
    "anysearch.config.actor": event.actor ?? (process.env.USER || process.env.USERNAME || "unknown"),
    "anysearch.config.source": event.source,
    "anysearch.config.path": event.path,
    "anysearch.config.before": JSON.stringify(event.change.before ?? null),
    "anysearch.config.after": JSON.stringify(event.change.after ?? null),
    "anysearch.policy_version": event.policyVersion,
  };
  try {
    const store = new SqliteObservationStore(dbPath);
    try {
      await store.recordOperation(
        {
          kind: "config",
          operation: "config:change",
          attributes,
          traceId,
          sessionId,
          // ConfigChange audit events do not carry a client_id (they originate from
          // the CLI/plugin-server process, not from an MCP client). Leave empty.
        },
        () => undefined,
      );
    } finally {
      store.close();
    }
    return true;
  } catch (e) {
    process.stderr.write("[anysearch] config audit write failed: " + (e instanceof Error ? e.message : String(e)) + "\n");
    return false;
  }
}
