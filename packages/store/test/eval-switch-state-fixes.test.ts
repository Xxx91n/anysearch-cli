// r116 fixer test wrapper. Covers:
//   F1 chain-wins rebuild (replaces quarantine loop with ledger recovery)
//   F2 legacy stage-transition/rollback/freeze rows fail loud
//   F3 superseded on-chain by eval-ship-gate-integrity.test.mjs (ADR-0057 T6)
//   F4 stale lock recovery (malformed JSON reaped)
//   D6 mutation: changing registered fields changes the digest
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { bootstrapAccessChain } from "../src/access-chain";
import { SqliteSessionStore } from "../src/session-store";
import { advanceSwitch, loadSwitchRegistration, replaySwitchChain } from "../src/eval/switch-run";

const fixturePath = join(process.cwd(), "fixtures", "switch-registration.json");
const canonical = readFileSync(fixturePath, "utf8");

let passed = 0;
let failed = 0;
function ok(label: string, cond: unknown): void {
  if (cond) passed++;
  else { failed++; console.error("FAIL: " + label); }
}

function freshDb(dbPath: string): void {
  const store = new SqliteSessionStore(dbPath);
  store.close();
}

try {
  // F1: stale ledger state must be rebuilt from chain, not quarantined forever.
  {
    const dir = mkdtempSync(join(tmpdir(), "ans-r116-f1-"));
    const dbPath = join(dir, "anysearch.db");
    freshDb(dbPath);
    writeFileSync(join(dir, "skip-ledger.json"), JSON.stringify({
      schema: "anysearch/gain-ledger@3",
      consecutiveWarn: 0,
      history: [],
      resolutions: [],
      lastSkipKeys: [],
      state: { phase: "S2", since: "2020-01-01T00:00:00Z", transitionId: "9999", evidenceHash: "deadbeef" + "0".repeat(56) },
      actions: [],
      revision: 0,
    }), "utf8");
    process.env.ANS_SWITCH_REG_PATH = fixturePath;
    const r = advanceSwitch({ outDir: dir, dbPath, mode: "real" });
    ok("F1 chain-wins rebuilds phase from chain", r.state.phase === "S0");
    ok("F1 chain-wins clears stale transitionId", r.state.transitionId === null);
    rmSync(dir, { recursive: true, force: true });
  }

  // F2: legacy stage-transition row must fail loud at replay.
  {
    const dir = mkdtempSync(join(tmpdir(), "ans-r116-f2-"));
    const dbPath = join(dir, "anysearch.db");
    freshDb(dbPath);
    const db = new Database(dbPath);
    bootstrapAccessChain(db);
    db.prepare("UPDATE access_chain_anchor SET genesis_hash = ? WHERE id = 1").run('r116-fixture');
    db.prepare("INSERT INTO access_events (memory_id, prev_hash, schema_version, event_type) VALUES (NULL, 'r116-fixture', 1, 'stage-transition')").run();
    db.close();
    process.env.ANS_SWITCH_REG_PATH = fixturePath;
    let legacyFailed = false;
    try { replaySwitchChain(dbPath); } catch (e) { legacyFailed = String((e as Error).message ?? e).includes("legacy switch event_type"); }
    ok("F2 legacy stage-transition row fails loud", legacyFailed);
    rmSync(dir, { recursive: true, force: true });
  }

  // F4: malformed lock file is reaped, advanceSwitch succeeds.
  {
    const dir = mkdtempSync(join(tmpdir(), "ans-r116-f4-"));
    const dbPath = join(dir, "anysearch.db");
    freshDb(dbPath);
    writeFileSync(join(dir, ".skip-ledger.lock"), "{ not-json", "utf8");
    process.env.ANS_SWITCH_REG_PATH = fixturePath;
    const r = advanceSwitch({ outDir: dir, dbPath, mode: "real" });
    ok("F4 malformed lock is reaped", !existsSync(join(dir, ".skip-ledger.lock")));
    ok("F4 advanceSwitch succeeds despite malformed lock", typeof r.state.phase === "string");
    rmSync(dir, { recursive: true, force: true });
  }

  // R63 release-gate edge: replaySwitchChain on an existing file without chain tables
  // (observation-layer created the shared durable DB) must return null, not throw.
  {
    const dir = mkdtempSync(join(tmpdir(), "ans-r63-obs-"));
    const dbPath = join(dir, "anysearch.db");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE observability_traces(id INTEGER PRIMARY KEY)");
    db.close();
    let threw = false;
    let replayed: unknown = "unset";
    try { replayed = replaySwitchChain(dbPath); } catch { threw = true; }
    ok("R63 observation-only DB replays as no-chain (null), not throw", !threw && replayed === null);
    rmSync(dir, { recursive: true, force: true });
  }

  // R63 corruption half of the same edge: chain tables present but access_events gone
  // must still fail closed.
  {
    const dir = mkdtempSync(join(tmpdir(), "ans-r63-corrupt-"));
    const dbPath = join(dir, "anysearch.db");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE access_chain_anchor(id INTEGER PRIMARY KEY, genesis_hash TEXT); CREATE TABLE switch_events(id INTEGER PRIMARY KEY)");
    db.close();
    let corruptThrew = false;
    try { replaySwitchChain(dbPath); } catch (e) { corruptThrew = String((e as Error).message ?? e).includes("access_events missing"); }
    ok("R63 chain-tables-without-access_events stays fail-closed", corruptThrew);
    rmSync(dir, { recursive: true, force: true });
  }

  // D6 mutation: a mutated fixture must diverge the registration digest.
  {
    process.env.ANS_SWITCH_REG_PATH = fixturePath;
    const base = loadSwitchRegistration();
    const mutated = JSON.parse(canonical) as Record<string, unknown>;
    const c = mutated.c as Record<string, unknown>;
    c.c1MinActiveRows = 1;
    const reconcile = mutated.reconcile as Record<string, unknown>;
    reconcile.minDiscordantPairs = 9999;
    const tmp = join(tmpdir(), "switch-registration-mut.json");
    writeFileSync(tmp, JSON.stringify(mutated, null, 2) + "\n", "utf8");
    process.env.ANS_SWITCH_REG_PATH = tmp;
    let divergent = false;
    try {
      const m = loadSwitchRegistration();
      divergent = m.registrationHash !== base.registrationHash;
    } catch (e) {
      divergent = String((e as Error).message ?? e).includes("integrity-fail-registration");
    }
    ok("D6 mutation diverges the registration digest", divergent);
    rmSync(tmp, { force: true });
  }
} finally {
  delete process.env.ANS_SWITCH_REG_PATH;
}

console.log("eval-switch-state-fixes.test: " + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
