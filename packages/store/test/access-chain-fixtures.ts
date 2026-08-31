// ADR-0041 D3: single source of truth for the pre-upgrade access-chain schema derivation.
// Consumed by access-chain-verify / access-chain-telemetry / access-chain-bootstrap-spawn.
import { readFileSync } from "node:fs";

/** Strip the access_chain_anchor DDL (the pre-upgrade schema has no anchor table). */
export function stripChainAnchorDdl(schema: string): string {
  return schema.replace(/CREATE TABLE IF NOT EXISTS access_chain_anchor[^;]*;/s, "");
}

const LEGACY_ACCESS_EVENTS_DDL = "CREATE TABLE access_events (id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id INTEGER NOT NULL REFERENCES retrieval_results(id) ON DELETE CASCADE, accessed_at TEXT NOT NULL DEFAULT (datetime('now')));";

/** Pre-upgrade schema: anchor DDL stripped, access_events reduced to the legacy 3-column form. */
export function preUpgradeSchema(schemaPath: string): string {
  // r106 audit (F-02): old [^)]* could not span embedded parens (REFERENCES ... (id),
  // DEFAULT (datetime('now'))) and silently no-opped; match to the DDL-closing `);` and
  // fail loudly instead of silently returning an un-stripped schema.
  const out = stripChainAnchorDdl(readFileSync(schemaPath, "utf8")).replace(
    /CREATE TABLE IF NOT EXISTS access_events \([\s\S]*?\)\s*;/,
    LEGACY_ACCESS_EVENTS_DDL
  );
  if (!out.includes(LEGACY_ACCESS_EVENTS_DDL)) {
    throw new Error("preUpgradeSchema: access_events DDL pattern not found — refusing silent no-op");
  }
  return out;
}
