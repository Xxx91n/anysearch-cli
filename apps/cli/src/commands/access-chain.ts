// ans access-chain — access_events tamper-evidence chain bootstrap (ADR-0040 D6).
// Thin wrapper over the same idempotent bootstrap core the SessionStore constructor runs lazily.
// dry-run is the default (backfill-relations precedent); --apply constructs the store, which runs
// the schema + ALTER chain + IMMEDIATE bootstrap.

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolveDbPath } from "@anysearch/kernel";
import { SqliteSessionStore, accessChainPreview } from "@anysearch/store";

export async function runAccessChain(args: string[]): Promise<number> {
  const sub = args[0];
  if (!sub || sub === "--help" || sub === "-h") {
    process.stdout.write(
      [
        "ans access-chain — access_events tamper-evidence chain (ADR-0040)",
        "",
        "Commands:",
        "  bootstrap              Dry-run: report legacy rows + the anchor digest that --apply would seal",
        "  bootstrap --apply      Seal legacy events into the single-row access_chain_anchor (idempotent)",
        "  bootstrap --dry-run    Same as bare 'bootstrap' (explicit)",
        "",
        "Options:",
        "  --db PATH              Override database path (default: ANS_DB_PATH or ~/.anysearch/anysearch.db)",
      ].join("\n") + "\n",
    );
    return 0;
  }
  if (sub !== "bootstrap") { process.stderr.write("ans access-chain: unknown subcommand " + sub + "\n"); return 2; }
  const apply = args.includes("--apply");
  if (apply && args.includes("--dry-run")) { process.stderr.write("ans access-chain bootstrap: --apply and --dry-run are mutually exclusive\n"); return 2; }
  const di = args.indexOf("--db");
  const dbPath = di >= 0 && args[di + 1] ? args[di + 1]! : resolveDbPath();

  if (apply) {
    mkdirSync(dirname(dbPath), { recursive: true });
    const store = new SqliteSessionStore(dbPath); // ctor runs schema + ALTERs + IMMEDIATE bootstrap
    store.close();
    const db = new Database(dbPath, { readonly: true });
    try {
      const p = accessChainPreview(db);
      process.stdout.write("[access-chain] anchor sealed: digest=" + (p.anchor?.digest ?? "<missing>") + " legacyRows=" + p.legacyRows + "\n");
      return p.anchor ? 0 : 1;
    } finally { db.close(); }
  }

  if (!existsSync(dbPath)) { process.stdout.write("[access-chain] no database at " + dbPath + " (nothing to bootstrap)\n"); return 1; }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const cols = new Set((db.prepare("PRAGMA table_info(access_events)").all() as { name: string }[]).map((c) => c.name));
    if (!cols.has("prev_hash")) {
      const n = (db.prepare("SELECT COUNT(*) AS n FROM access_events").get() as { n: number }).n;
      process.stdout.write("[access-chain] pre-upgrade schema: " + n + " legacy rows pending seal. Run: ans access-chain bootstrap --apply\n");
      return 0;
    }
    const p = accessChainPreview(db);
    if (p.anchor) {
      process.stdout.write("[access-chain] anchor already sealed (idempotent): digest=" + p.anchor.digest + " genesis=" + p.anchor.genesis_hash.slice(0, 16) + "... created_at=" + p.anchor.created_at + "\n");
    } else {
      process.stdout.write("[access-chain] dry-run: would seal " + p.legacyRows + " legacy rows, digest=" + p.digest + "\n");
    }
    return 0;
  } finally { db.close(); }
}
