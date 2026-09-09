// ADR-0040 D3/D4/D6: access_events tamper-evidence — writer-side canonical serializer + chain
// bootstrap. The verifier (scripts/verify-access-events.mjs) is an independent re-implementation
// of this spec (_Avoid_ 3: shared serialization code is forbidden — a bug must not hide in both).
//
// Pinned spec constants (duplicated verbatim in ADR-0040, implemented independently by the verifier):
//   CHAIN_FIELDS  = ["accessed_at","event_type","id","memory_id","prev_hash","schema_version","source_label"]
//                   (ASCII lexicographic order = RFC 8785 §3.2.3 key order for this closed ASCII
//                   scalar schema; JSON.stringify of an object literal built in this order is
//                   byte-equivalent to JCS.Canonicalize for this schema)
//   LEGACY_FIELDS = ["accessed_at","id","memory_id"]  (same rule; legacy rows hash only the 3 real columns)
//   event hash    = SHA-256 hex of JSON.stringify of the fixed-key-order object (NULL -> JSON null)
//   legacy digest = SHA-256 hex of the byte concat of (legacyRowJson + "\n") over legacy rows in id order
//   genesis_hash  = SHA-256 hex of the ASCII string "access-chain-genesis:" + digest
//   first chained row carries prev_hash = genesis_hash; each later row chains on the previous row's hash
//
// Type whitelist (D4): INTEGER columns must be integer numbers, TEXT columns strings, NULL only in
// prev_hash / schema_version / event_type. REAL / blob / NaN entering the chain input throws.
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

export const CHAIN_SCHEMA_VERSION = 2;
export const CHAIN_EVENT_TYPE = "access";
export const CHAIN_FIELDS = ["accessed_at", "event_type", "id", "memory_id", "prev_hash", "schema_version", "source_label"] as const;
// Pre-ADR-0053 rows were chained without source_label. The independent verifier
// hashes them with this six-field shape, so the writer must match at the v1/v2 boundary.
export const CHAIN_FIELDS_V1 = ["accessed_at", "event_type", "id", "memory_id", "prev_hash", "schema_version"] as const;
export const LEGACY_FIELDS = ["accessed_at", "id", "memory_id"] as const;
export const GENESIS_PREFIX = "access-chain-genesis:";

export interface ChainEventRow {
  id: number; memory_id: number; accessed_at: string;
  prev_hash: string | null; schema_version: number | null; event_type: string | null;
  source_label: string | null;
}
export interface LegacyEventRow { id: number; memory_id: number; accessed_at: string; }

const sha256hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

function assertScalar(k: string, v: unknown): void {
  if (v === null) { if (k === "prev_hash" || k === "schema_version" || k === "event_type" || k === "source_label") return; throw new Error("access-chain: " + k + " must not be NULL"); }
  if (typeof v === "string") return;
  // D4 whitelist: INTEGER only — REAL (non-integer number) or anything else is rejected.
  // source_label and trace_id are nullable TEXT in the v2 boundary.
  if (typeof v === "number" && Number.isInteger(v) && (k === "id" || k === "memory_id" || k === "schema_version")) return;
  throw new Error("access-chain: non-whitelisted value for " + k + " (" + Object.prototype.toString.call(v) + ")");
}

/** Canonical JSON bytes for a chained event row (fixed key order, whitelist-enforced). */
export function canonicalEventJson(row: ChainEventRow): string {
  const out: Record<string, unknown> = {};
  const fields: readonly (keyof ChainEventRow)[] = row.schema_version === 1 ? CHAIN_FIELDS_V1 : CHAIN_FIELDS;
  for (const k of fields) {
    const v = row[k as keyof ChainEventRow];
    // ADR-0044 D5: switch edges carry a NULL memory_id; the access chain keeps the same
    // six-field canonical form while the switch_events side table holds the edge provenance.
    if (v === null && k === "memory_id" && typeof out.event_type === "string" && out.event_type !== CHAIN_EVENT_TYPE) {
      out[k] = v;
      continue;
    }
    assertScalar(k, v);
    out[k] = v;
  }
  return JSON.stringify(out);
}

/** Canonical JSON bytes for a legacy (pre-chain) event row. */
export function canonicalLegacyJson(row: LegacyEventRow): string {
  const out: Record<string, unknown> = {};
  for (const k of LEGACY_FIELDS) { const v = row[k as keyof LegacyEventRow]; assertScalar(k, v); out[k] = v; }
  return JSON.stringify(out);
}

export function eventHash(row: ChainEventRow): string { return sha256hex(canonicalEventJson(row)); }

/** Aggregate digest over all legacy rows in id order (D3: one-off snapshot, Sigilbase "honest approach"). */
export function legacyDigest(rows: LegacyEventRow[]): string {
  const h = createHash("sha256");
  for (const r of rows) h.update(canonicalLegacyJson(r) + "\n", "utf8");
  return h.digest("hex");
}

export function genesisHash(digest: string): string { return sha256hex(GENESIS_PREFIX + digest); }

export interface ChainAnchor { digest: string; genesis_hash: string; created_at: string }

/** Read-only preview of what bootstrap would write (for `ans access-chain bootstrap --dry-run`). */
export function accessChainPreview(db: Database.Database): { anchor: ChainAnchor | null; legacyRows: number; digest: string; genesis_hash: string } {
  const anchor = (db.prepare("SELECT digest, genesis_hash, created_at FROM access_chain_anchor WHERE id = 1").get() as ChainAnchor | undefined) ?? null;
  const legacy = db.prepare("SELECT id, memory_id, accessed_at FROM access_events WHERE prev_hash IS NULL ORDER BY id").all() as LegacyEventRow[];
  const digest = legacyDigest(legacy);
  return { anchor, legacyRows: legacy.length, digest, genesis_hash: genesisHash(digest) };
}

/**
 * D6: lazy bootstrap — seal legacy rows into the single-row anchor exactly once.
 * BEGIN IMMEDIATE via transaction().immediate() (WAL read→write upgrade is not covered by
 * busy_timeout; one defensive retry on SQLITE_BUSY*). Single-row CHECK + upsert give DB-level
 * idempotency under CLI+MCP dual-process open. Throws on persistent busy/IO — caller degrades
 * to stderr WARN + telemetry bit (ADR-0009 D6 fail-open).
 */
export function bootstrapAccessChain(db: Database.Database): { status: "created" | "exists"; legacyRows: number; digest: string } {
  const run = db.transaction((): { status: "created" | "exists"; legacyRows: number; digest: string } => {
    const prev = accessChainPreview(db);
    if (prev.anchor) return { status: "exists", legacyRows: prev.legacyRows, digest: prev.anchor.digest };
    db.prepare("INSERT OR IGNORE INTO access_chain_anchor (id, digest, genesis_hash) VALUES (1, ?, ?)").run(prev.digest, prev.genesis_hash);
    return { status: "created", legacyRows: prev.legacyRows, digest: prev.digest };
  });
  for (let attempt = 0; ; attempt++) {
    try { return run.immediate(); } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (attempt === 0 && /SQLITE_BUSY/.test(msg)) continue; // one defensive retry (D6)
      throw e;
    }
  }
}
