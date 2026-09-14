// ADR-0055: URL authorization policy single source.
// TOML [sources].urlAllowlist/urlDenylist is the ONLY authoritative source. ANS_URL_ALLOWLIST
// is a dev-only append-only override gated by ANS_ALLOW_ENV_OVERRIDE (strict enum 1/true/0/false;
// anything else fail-closed refuses to start, D7 five-state truth table).
// mergeAllowlist + canonicalVersion are shared by kernel, server, and hook (D1/D7).
// allow = union across layers (D2); deny is a first-class independent channel evaluated last.

import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, mkdirSync, statSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadDomain } from "./domain-loader";
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

// ADR-0055 audit M2: env entries validated to the same bar as TOML (D7 equal strictness).
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

// Domain TOML path convention shared by CLI/MCP/plugin-server composition roots.
// ADR-0061 B1: optional extra domains dirs (e.g. the builtin dir shipped inside the
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

// ADR-0056 D-007 / ADR-0055 D6 supplement: write a MaterializedPolicy envelope
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

// D5: lazy mtime-checked re-read. Probe returns null = unchanged (or unreadable), schema = reloaded.
export function createDomainReloader(tomlPath: string): () => DomainSchema | null {
  let lastMtime = -1;
  let warnedMtime = -1;
  try { lastMtime = statSync(tomlPath).mtimeMs; } catch { /* path may appear later */ }
  return () => {
    let mtime: number;
    try { mtime = statSync(tomlPath).mtimeMs; } catch { return null; }
    if (mtime === lastMtime) return null;
    try {
      const schema = loadDomain(tomlPath);
      lastMtime = mtime;
      return schema;
    } catch (e) {
      // D3/OPA bad-bundle semantics: keep last known good, but signal it (audit M3:
      // old policy persisting silently leaves new deny entries dead with zero trace).
      if (warnedMtime !== mtime) {
        warnedMtime = mtime;
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

// ADR-0056 D-005 + D-002/D-003: write into the ADR-0052 local trace store. Fail-open
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
