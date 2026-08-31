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
  return stripChainAnchorDdl(readFileSync(schemaPath, "utf8")).replace(
    /CREATE TABLE IF NOT EXISTS access_events \(([^)]*)\);/s,
    LEGACY_ACCESS_EVENTS_DDL
  );
}
