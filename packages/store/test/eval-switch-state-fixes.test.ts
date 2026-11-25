// r116 fixer test wrapper. Covers:
// F1 chain-wins rebuild (replaces quarantine loop with ledger recovery)
// F2 legacy stage-transition/rollback/freeze rows fail loud
// F3 superseded on-chain by eval-ship-gate-integrity.test.mjs
// F4 unreadable lock content is dated by the lock file's mtime (fresh kept, aged reaped)
// F6-F9 (#577) identity decides before age: a live owner keeps its lock, a dead one is reaped,
//         an unclassifiable one falls to age, and releasing never deletes a successor's lock
// D6 mutation: changing registered fields changes the digest
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { bootstrapAccessChain } from "../src/access-chain";
import { SqliteSessionStore } from "../src/session-store";
import { advanceSwitch, loadSwitchRegistration, replaySwitchChain } from "../src/eval/switch-run";
import { SkipLedgerError, withSkipLedgerLock } from "../src/eval/skip-ledger";
import { LEDGER_LOCK_MAX_AGE_MS, LedgerLockTimeoutError, withLedgerLock } from "../src/eval/ledger-lock";
import { withProbe } from "./helpers/probe-stub";

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
  // stale ledger state must be rebuilt from chain, not quarantined forever.
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

  // legacy stage-transition row must fail loud at replay.
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

  // F4 (#577): unreadable lock content is dated by the lock file's own mtime, so a fresh one is
  // left alone and an aged one is reaped. Deleting it on sight let two writers delete each other's
  // lock in the moment between create and write.
  {
    const dir = mkdtempSync(join(tmpdir(), "ans-r116-f4-"));
    const dbPath = join(dir, "anysearch.db");
    freshDb(dbPath);
    const lock = join(dir, ".skip-ledger.lock");
    writeFileSync(lock, "{ not-json", "utf8");
    process.env.ANS_SWITCH_REG_PATH = fixturePath;
    let timedOut = false;
    try { advanceSwitch({ outDir: dir, dbPath, mode: "real" }); } catch (e) { timedOut = e instanceof LedgerLockTimeoutError; }
    ok("F4 a fresh unreadable lock is left alone", timedOut && existsSync(lock) && readFileSync(lock, "utf8") === "{ not-json");
    ok("F4 advanceSwitch leaves the ledger alone on a lock timeout", !readdirSync(dir).some((name) => name.includes(".quarantined-")));
    const aged = (Date.now() - LEDGER_LOCK_MAX_AGE_MS - 60 * 1000) / 1000;
    utimesSync(lock, aged, aged);
    const r = advanceSwitch({ outDir: dir, dbPath, mode: "real" });
    ok("F4 an aged unreadable lock is reaped", !existsSync(lock));
    ok("F4 advanceSwitch succeeds once the aged lock is reaped", typeof r.state.phase === "string");
    rmSync(dir, { recursive: true, force: true });
  }

  // release-gate edge: replaySwitchChain on an existing file without chain tables
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

  // corruption half of the same edge: chain tables present but access_events gone
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

  // F5 (#570): a live writer's lock survives a probe that cannot be classified.
  // Only ESRCH proves the owner is gone. The old catch-all treated EPERM (and
  // every other probe failure) as death and deleted a fresh lock out from under
  // a running writer.
  {
    const dir = mkdtempSync(join(tmpdir(), "ans-r116-f5-"));
    const lock = join(dir, ".skip-ledger.lock");
    writeFileSync(lock, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    const survived = withProbe(process.pid, "EPERM", () => {
      try {
        withSkipLedgerLock(dir, () => {});
      } catch {
        // Expected: with the lock kept, the 100 × 25 ms retry loop runs out.
      }
      return existsSync(lock);
    });
    ok("F5 live lock survives an unconfirmable probe", survived);
    rmSync(dir, { recursive: true, force: true });
  }

  // F6 (#577): a live owner keeps the lock however old its record is. Age alone is not evidence
  // of death: a write paused past LOCK_MAX_AGE_MS (sleep, a debugger, a wedged network path) used
  // to have its lock deleted out from under it, and two writers then ran at once.
  {
    const dir = mkdtempSync(join(tmpdir(), "ans-577-f6-"));
    const lock = join(dir, ".skip-ledger.lock");
    const record = JSON.stringify({ pid: process.pid, at: new Date(Date.now() - 10 * 60 * 1000).toISOString() });
    writeFileSync(lock, record, "utf8");
    let entered = false;
    let error: unknown = null;
    try {
      withSkipLedgerLock(dir, () => { entered = true; });
    } catch (e) {
      error = e;
    }
    ok("F6 a live owner keeps the lock however old its record", !entered && error instanceof LedgerLockTimeoutError && readFileSync(lock, "utf8") === record);
    ok("F6 lock contention is not reported as a broken ledger", !(error instanceof SkipLedgerError));
    const message = error instanceof Error ? error.message : "";
    ok("F6 the timeout names the holder, the path, and the way out",
      message.includes(String(process.pid)) && message.includes(".skip-ledger.lock") && message.includes("delete the lock file"));
    rmSync(dir, { recursive: true, force: true });
  }

  // F7 (#577): a proven-dead owner is still reaped at once, however fresh the record is. This is
  // the half of the old rule that was right and must not be lost.
  {
    const dir = mkdtempSync(join(tmpdir(), "ans-577-f7-"));
    const lock = join(dir, ".skip-ledger.lock");
    const gonePid = 999999;
    writeFileSync(lock, JSON.stringify({ pid: gonePid, at: new Date().toISOString() }), "utf8");
    let entered = false;
    withProbe(gonePid, "ESRCH", () => { withSkipLedgerLock(dir, () => { entered = true; }); });
    ok("F7 a proven-dead owner is reaped at once", entered && !existsSync(lock));
    rmSync(dir, { recursive: true, force: true });
  }

  // F8 (#577): an owner the probe cannot classify falls back to the age rule — kept while the
  // record is fresh, reaped once it is older than LEDGER_LOCK_MAX_AGE_MS.
  {
    const fresh = mkdtempSync(join(tmpdir(), "ans-577-f8-fresh-"));
    const aged = mkdtempSync(join(tmpdir(), "ans-577-f8-aged-"));
    const unprobeablePid = 424242;
    writeFileSync(join(fresh, ".skip-ledger.lock"), JSON.stringify({ pid: unprobeablePid, at: new Date().toISOString() }), "utf8");
    writeFileSync(join(aged, ".skip-ledger.lock"), JSON.stringify({ pid: unprobeablePid, at: new Date(Date.now() - 10 * 60 * 1000).toISOString() }), "utf8");
    let freshEntered = false;
    let agedEntered = false;
    withProbe(unprobeablePid, "ERR_INVALID_ARG_TYPE", () => {
      try { withSkipLedgerLock(fresh, () => { freshEntered = true; }); } catch { /* expected: kept */ }
      withSkipLedgerLock(aged, () => { agedEntered = true; });
    });
    ok("F8 an unclassifiable owner with a fresh record keeps the lock", !freshEntered && existsSync(join(fresh, ".skip-ledger.lock")));
    ok("F8 an unclassifiable owner older than the max age is reaped", agedEntered && !existsSync(join(aged, ".skip-ledger.lock")));
    rmSync(fresh, { recursive: true, force: true });
    rmSync(aged, { recursive: true, force: true });
  }

  // F9 (#577): releasing removes only the record this call wrote. A writer that lost the lock used
  // to delete its successor's lock on the way out, letting a third process in.
  {
    const dir = mkdtempSync(join(tmpdir(), "ans-577-f9-"));
    const lock = join(dir, ".skip-ledger.lock");
    const successor = JSON.stringify({ pid: 4242, at: new Date().toISOString() });
    withSkipLedgerLock(dir, () => {
      writeFileSync(lock, successor, "utf8");
      return null;
    });
    ok("F9 releasing leaves a lock this call no longer owns", existsSync(lock) && readFileSync(lock, "utf8") === successor);
    rmSync(dir, { recursive: true, force: true });
  }

  // F10 (#577): a filesystem without hard links falls back to create-then-write. The claim is
  // complete before the callback runs, and an existing lock is still respected.
  {
    const dir = mkdtempSync(join(tmpdir(), "ans-577-f10-"));
    const lock = join(dir, ".skip-ledger.lock");
    const noLinks = { link(): void { throw Object.assign(new Error("hard links unsupported here"), { code: "EPERM" }); } };
    let claimSeen = "";
    withLedgerLock(lock, () => { claimSeen = readFileSync(lock, "utf8"); return null; }, noLinks);
    const claim = JSON.parse(claimSeen) as { pid?: number };
    ok("F10 the fallback writes a complete claim before the callback runs", claim.pid === process.pid && !existsSync(lock));

    const held = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });
    writeFileSync(lock, held, "utf8");
    let entered = false;
    let timedOut = false;
    try { withLedgerLock(lock, () => { entered = true; return null; }, noLinks); } catch (e) { timedOut = e instanceof LedgerLockTimeoutError; }
    ok("F10 the fallback still respects a held lock", !entered && timedOut && readFileSync(lock, "utf8") === held);
    rmSync(dir, { recursive: true, force: true });
  }
} finally {
  delete process.env.ANS_SWITCH_REG_PATH;
}

console.log("eval-switch-state-fixes.test: " + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
