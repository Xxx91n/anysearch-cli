// ADR-0040 D7 item 5 helper: thin bootstrap + chained-write process (spawned, never worker_threads —
// POSIX fcntl locks are per-process, so real contention requires real processes).
import Database from "better-sqlite3";
import { bootstrapAccessChain, eventHash, CHAIN_SCHEMA_VERSION, CHAIN_EVENT_TYPE, type ChainEventRow } from "../../src/access-chain.js";

const dbPath = process.argv[2];
const memoryId = Number(process.argv[3]);
const writes = Number(process.argv[4] ?? 5);

const db = new Database(dbPath, { timeout: 5000 });
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");
try { db.exec("ALTER TABLE access_events ADD COLUMN prev_hash TEXT"); } catch {}
try { db.exec("ALTER TABLE access_events ADD COLUMN schema_version INTEGER"); } catch {}
try { db.exec("ALTER TABLE access_events ADD COLUMN event_type TEXT"); } catch {}
try { db.exec("ALTER TABLE access_events ADD COLUMN source_label TEXT"); } catch {}
db.exec("CREATE TABLE IF NOT EXISTS access_chain_anchor (id INTEGER PRIMARY KEY CHECK (id = 1), digest TEXT NOT NULL, genesis_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))");

const boot = bootstrapAccessChain(db);

const chainWrite = db.transaction(() => {
  const last = db.prepare("SELECT id, memory_id, accessed_at, prev_hash, schema_version, event_type, source_label FROM access_events WHERE prev_hash IS NOT NULL ORDER BY id DESC LIMIT 1").get() as ChainEventRow | undefined;
  const anchor = db.prepare("SELECT genesis_hash FROM access_chain_anchor WHERE id = 1").get() as { genesis_hash: string } | undefined;
  const prevHash = last ? eventHash(last) : anchor!.genesis_hash;
  db.prepare("INSERT INTO access_events (memory_id, prev_hash, schema_version, event_type, source_label) VALUES (?, ?, ?, ?, ?)").run(memoryId, prevHash, CHAIN_SCHEMA_VERSION, CHAIN_EVENT_TYPE, "system");
});
for (let i = 0; i < writes; i++) chainWrite.immediate();

console.log(JSON.stringify({ bootstrap: boot.status, writes }));
db.close();
