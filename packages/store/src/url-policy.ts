// URL authorization policy single source.
// TOML [sources].urlAllowlist/urlDenylist is the ONLY authoritative source. ANS_URL_ALLOWLIST
// is a dev-only append-only override gated by ANS_ALLOW_ENV_OVERRIDE (strict enum 1/true/0/false;
// anything else fail-closed refuses to start, D7 five-state truth table).
// mergeAllowlist + canonicalVersion are shared by kernel, server, and hook (D1/D7).
// allow = union across layers (D2); deny is a first-class independent channel evaluated last.

import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, mkdirSync, statSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadDomain, loadRawDomain, tryLoadRawDomain } from "./domain-loader";
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

// supplement: write a MaterializedPolicy envelope
// (policy body + materialized_at timestamp) to the disk cache so the hook
// readPolicy cache fallback can surface staleness. The timestamp is the only
// signal that lets the hook differentiate "fresh from server seconds ago" from
// "last write was before the server went down 3 days ago".
export interface MaterializedPolicy {
  allow: string[];
  deny: string[];
  policy_version: string;
  materialized_at: string; // ISO-8601 UTC
}

export function writePolicyCache(cachePath: string, policy: UrlPolicy): void {
  const envelope: MaterializedPolicy = {
    allow: policy.allow,
    deny: policy.deny,
    policy_version: policy.policyVersion,
    materialized_at: new Date().toISOString(),
  };
  atomicWriteFile(cachePath, JSON.stringify(envelope, null, 2) + "\n");
}

// readPolicyCacheEnvelope: hook-side discriminator. Returns null when the cache
// is unreadable / shape-broken; otherwise returns the envelope for downstream
// staleness signaling.
export function readPolicyCacheEnvelope(cachePath: string): MaterializedPolicy | null {
  try {
    const raw = JSON.parse(readFileSync(cachePath, "utf8")) as Partial<MaterializedPolicy>;
    if (!Array.isArray(raw.allow) || !Array.isArray(raw.deny) || typeof raw.policy_version !== "string") return null;
    if (typeof raw.materialized_at !== "string") return null;
    return raw as MaterializedPolicy;
  } catch {
    return null;
  }
}

/**
 * Lazy mtime-checked domain reloader (#167/#CodeRabbit).
 *
 * Probe returns null = unchanged (or unreadable), schema = reloaded.
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
 * preserves the existing "unchanged -> null" contract for other callers.
 */
export function createDomainReloader(tomlPath: string, domainsDirs?: string[], opts?: { forceFirst?: boolean }): () => DomainSchema | null {
  const getSearchDirs = (): string[] => {
    if (domainsDirs) return domainsDirs;
    const dirs: string[] = [];
    const envDir = process.env.ANS_DOMAINS_DIR?.trim();
    if (envDir) dirs.push(envDir);
    try { dirs.push(dirname(tomlPath)); } catch {}
    dirs.push(join(process.cwd(), "domains"));
    return dirs;
  };
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

  const collectChainAndProbed = (): { chain: string[]; probed: string[] } => {
    const searchDirs = getSearchDirs();
    const chain: string[] = [tomlPath];
    const probed: string[] = [];
    const seen = new Set<string>();
    let curRaw: ReturnType<typeof loadRawDomain> | undefined;
    try {
      curRaw = loadRawDomain(tomlPath);
    } catch {
      return { chain, probed };
    }
    while (curRaw?.base) {
      if (seen.has(curRaw.base)) break;
      seen.add(curRaw.base);
      let found: { path: string; raw: ReturnType<typeof loadRawDomain> } | undefined;
      for (const d of searchDirs) {
        const cand = join(d, curRaw.base + ".toml");
        probed.push(cand);
        let raw: ReturnType<typeof loadRawDomain> | undefined;
        try { raw = tryLoadRawDomain(cand); } catch { raw = {} as ReturnType<typeof loadRawDomain>; }
        if (raw) { found = { path: cand, raw }; break; }
      }
      if (!found) break;
      chain.push(found.path);
      curRaw = found.raw;
    }
    return { chain, probed };
  };

  const lookupFor = (): ((name: string) => ReturnType<typeof loadRawDomain> | undefined) | undefined => {
    const searchDirs = getSearchDirs();
    return (parent: string) => tryResolveParent(parent, searchDirs)?.raw;
  };

  // version includes ctime so chmod (permission repair) is detected even
  // when mtime is unchanged (inode(7): ctime changes on permission change).
  const fileVersion = (p: string): string => {
    try {
      const s = statSync(p);
      return `${s.mtimeMs}:${s.ctimeMs}`;
    } catch {
      return "-1";
    }
  };

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
    if (!forced && !changed) return null;
    try {
      const schema = loadDomain(tomlPath, lookupFor());
      const next = collectChainAndProbed();
      watchedChain = next.chain;
      watchedProbed = next.probed;
      watched = [...new Set([...watchedChain, ...watchedProbed])];
      mtimes.clear();
      for (const pp of watched) mtimes.set(pp, fileVersion(pp));
      return schema;
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
        process.stderr.write("[anysearch] domain TOML reload failed; keeping last known good policy: " + (e instanceof Error ? e.message : String(e)) + "\n");
      }
      return null;
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
export async function emitConfigChangeAudit(dbPath: string, event: ConfigChangeEvent): Promise<void> {
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
  } catch (e) {
    process.stderr.write("[anysearch] config audit write failed: " + (e instanceof Error ? e.message : String(e)) + "\n");
  }
}
