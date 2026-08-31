// ADR-0041 D1: gate-built verification object. Materializes .ship-gate/chain-gate.db through
// the real SqliteSessionStore write path with deterministic content seeds, then prints the db
// path on stdout (single line) so ship-gate can hand it to verify-access-events.mjs via --db.
import { rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteSessionStore } from "../packages/store/src/session-store.js";

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dir = path.join(root, ".ship-gate");
  mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, "chain-gate.db");
  for (const suffix of ["", "-wal", "-shm", "-journal"]) rmSync(dbPath + suffix, { force: true });
  const store = new SqliteSessionStore(dbPath);
  const session = await store.createSession("code");
  await store.saveResults(session.id, [
    { url: "https://example.com/chain-gate-fixture", title: "chain gate fixture", snippet: "gate-built verification object seed", source: "ship-gate" },
  ]);
  // Three chained events: deleting a middle OR head row is detectable (successor prev_hash
  // no longer matches); only tail-row or whole-segment truncation is invisible (declared
  // limitation, non-adversarial model — ADR-0040 / r106 audit F-03/F-10).
  for (let i = 0; i < 3; i++) await store.searchMemory("fixture", 10);
  store.close();
  process.stdout.write(dbPath + "\n");
}
main().catch((e: unknown) => {
  process.stderr.write("chain-gate-fixture: " + String(e instanceof Error ? e.message : e) + "\n");
  process.exit(1);
});
