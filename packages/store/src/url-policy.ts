// ADR-0055: URL authorization policy single source.
// TOML [sources].urlAllowlist/urlDenylist is the ONLY authoritative source. ANS_URL_ALLOWLIST
// is a dev-only append-only override gated by ANS_ALLOW_ENV_OVERRIDE (strict enum 1/true/0/false;
// anything else fail-closed refuses to start, D7 five-state truth table).
// mergeAllowlist + canonicalVersion are shared by kernel, server, and hook (D1/D7).
// allow = union across layers (D2); deny is a first-class independent channel evaluated last.

import { createHash, randomUUID } from "node:crypto";
import { writeFileSync, renameSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { loadDomain } from "./domain-loader";
import type { DomainSchema } from "./domain-schema";
import { SqliteObservationStore } from "./observation";

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

export function parseEnvHosts(raw: string | undefined | null): string[] {
  return (raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
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
    denyHosts: (schema.sources as { urlDenylist?: string[] }).urlDenylist ?? [],
    env,
  });
}

// Resolve from a domain TOML file. Missing file = empty policy; TOML parse failure throws
// (D3 load-layer fail-closed).
export function loadPolicyFromToml(tomlPath: string, env?: NodeJS.ProcessEnv): UrlPolicy {
  const schema = loadDomain(tomlPath);
  return resolvePolicyFromSchema(schema, env);
}

// D4/D5 structured atomic write: tmp + rename.
export function atomicWriteFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

// D5: lazy mtime-checked re-read. Probe returns null = unchanged (or unreadable), schema = reloaded.
export function createDomainReloader(tomlPath: string): () => DomainSchema | null {
  let lastMtime = -1;
  try { lastMtime = statSync(tomlPath).mtimeMs; } catch { /* path may appear later */ }
  return () => {
    let mtime: number;
    try { mtime = statSync(tomlPath).mtimeMs; } catch { return null; }
    if (mtime === lastMtime) return null;
    try {
      const schema = loadDomain(tomlPath);
      lastMtime = mtime;
      return schema;
    } catch { return null; } // keep last known good (OPA bad-bundle semantics, D3)
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

// D8: write into the ADR-0052 local trace store. Fail-open (AGENTS.md: audit write failure
// degrades to stderr), same posture as the rest of the observation layer.
export async function emitConfigChangeAudit(dbPath: string, event: ConfigChangeEvent): Promise<void> {
  const attributes = {
    "anysearch.config.event_id": randomUUID(),
    "anysearch.config.timestamp": new Date().toISOString(),
    "anysearch.config.actor": event.actor ?? (process.env.USER || process.env.USERNAME || "unknown"),
    "anysearch.config.source": event.source,
    "anysearch.config.path": event.path,
    "anysearch.config.before": JSON.stringify(event.change.before ?? null),
    "anysearch.config.after": JSON.stringify(event.change.after ?? null),
    "anysearch.policy_version": event.policyVersion,
    "anysearch.trace_id": event.traceId ?? "",
    "anysearch.session_id": event.sessionId ?? "",
  };
  try {
    const store = new SqliteObservationStore(dbPath);
    try {
      await store.recordOperation(
        { kind: "config", operation: "config:change", attributes },
        () => undefined,
      );
    } finally {
      store.close();
    }
  } catch (e) {
    process.stderr.write("[anysearch] config audit write failed: " + (e instanceof Error ? e.message : String(e)) + "\n");
  }
}
