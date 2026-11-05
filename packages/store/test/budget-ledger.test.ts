// Budget Ledger test (G004). Mole reserve-then-settle pattern.
// Self-check via assert-based demo (ponytail: no test framework).
// Uses SqliteSessionStore to create session, then BudgetLedger on same db.

import Database from "better-sqlite3";
import { SqliteSessionStore } from "../src/session-store";
import { BudgetLedger } from "../src/budget-ledger";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

async function main() {
  const tmpDir = mkdtempSync(join(tmpdir(), "ans-budget-"));
  const dbPath = join(tmpDir, "test.db");

  try {
    const store = new SqliteSessionStore(dbPath);
    const ledger = new BudgetLedger((store as any).db);

    // 1. initBudget + getBalance
    const s = await store.createSession("research");
    const s2 = await store.createSession("billing");
    {
      ledger.initBudget(s.id, { tokenCap: 100000, usdCap: 5.0, timeLimitMs: 60000 });
      const bal = ledger.getBalance(s.id);
      assert(bal !== null, "getBalance returns balance after initBudget");
      assert(bal!.tokenCap === 100000, "tokenCap = 100000");
      assert(bal!.usdCap === 5.0, "usdCap = 5.0");
      assert(bal!.remainingTokens === 100000, "remainingTokens = 100000 (nothing spent)");
      assert(bal!.remainingUsd === 5.0, "remainingUsd = 5.0");

      // 2. reserveTokens - success case
      const ok1 = ledger.reserveTokens(s.id, 10000);
      assert(ok1, "reserveTokens 10000 succeeds (within cap)");
      const bal2 = ledger.getBalance(s.id);
      assert(bal2!.reservedTokens === 10000, "reservedTokens = 10000 after reserve");
      assert(bal2!.remainingTokens === 90000, "remainingTokens = 90000 after reserve");

      // 3. reserveTokens - fail case (exceeds cap)
      const ok2 = ledger.reserveTokens(s.id, 95000);
      assert(!ok2, "reserveTokens 95000 fails (would exceed 100000 cap, 10000 already reserved)");
      const bal3 = ledger.getBalance(s.id);
      assert(bal3!.reservedTokens === 10000, "reservedTokens still 10000 after failed reserve");

      // 4. settleTokens - move reserved to spent
      ledger.settleTokens(s.id, 10000, 8000); // reserved 10000, actual 8000
      const bal4 = ledger.getBalance(s.id);
      assert(bal4!.reservedTokens === 0, "reservedTokens = 0 after settle");
      assert(bal4!.spentTokens === 8000, "spentTokens = 8000 (actual amount)");
      assert(bal4!.remainingTokens === 92000, "remainingTokens = 92000 after settle");

      // 5. reserveUsd + settleUsd
      const ok3 = ledger.reserveUsd(s.id, 2.0);
      assert(ok3, "reserveUsd 2.0 succeeds");
      ledger.settleUsd(s.id, 2.0, 1.5); // actual was 1.50
      const bal5 = ledger.getBalance(s.id);
      assert(bal5!.spentUsd === 1.5, "spentUsd = 1.5 after settle");
      assert(bal5!.remainingUsd === 3.5, "remainingUsd = 3.5 after settle");

      // 6. reserveUsd - fail case (exceeds cap after spending)
      const ok4 = ledger.reserveUsd(s.id, 4.0);
      assert(!ok4, "reserveUsd 4.0 fails (only 3.5 remaining)");

      // 7. getBalance on non-existent session
      const nullBal = ledger.getBalance("non-existent");
      assert(nullBal === null, "getBalance returns null for non-existent session");

      // 8.: reserveCalls + settleCalls (per-call billing).
      ledger.initBudget(s2.id, { tokenCap: 100000, usdCap: 10.0, timeLimitMs: 60000, callCap: 10 });
      const ok5 = ledger.reserveCalls(s2.id, 3); // reserve 3 calls
      assert(ok5, "reserveCalls 3 succeeds");
      ledger.settleCalls(s2.id, 3, 2); // actual: only 2 succeeded
      const bal7 = ledger.getBalance(s2.id);
      assert(bal7 !== null, "balance after settle calls");
      assert(bal7!.billableCalls === 2, "billableCalls = 2 (actual)");
      assert(bal7!.reservedCalls === 0, "reservedCalls = 0 after settle");

      // 9.: reserveCalls exceeds call_cap fails.
      // s2 already has billable_calls=2, reserved=0, call_cap=10 -> remaining=8
      const ok6 = ledger.reserveCalls(s2.id, 9); // would be 9 > 8 remaining
      assert(!ok6, "reserveCalls 9 fails (only 8 remaining: cap=10 - spent=2)");
      const ok7 = ledger.reserveCalls(s2.id, 8); // exactly remaining
      assert(ok7, "reserveCalls 8 succeeds (exactly at remaining)");

      // 10. #187: no budget row = unmetered = every reserve passes.
      //     Reserving on an unconfigured session must not lazily create a row.
      const s3 = await store.createSession("unmetered");
      assert(ledger.getBalance(s3.id) === null, "no budget row after session registration without [budget]");
      assert(ledger.reserveTokens(s3.id, 999999), "reserveTokens passes with no row (unmetered)");
      assert(ledger.reserveUsd(s3.id, 9999), "reserveUsd passes with no row (unmetered)");
      assert(ledger.reserveCalls(s3.id, 5), "reserveCalls passes with no row (unmetered)");
      assert(ledger.getBalance(s3.id) === null, "reserving does not create a row (still unmetered)");

      // 11. #187: a configured row with explicit cap 0 rejects on every dimension —
      //     the distinguishable "explicit zero" state, not the "no row" state.
      const s4 = await store.createSession("zero-caps");
      ledger.initBudget(s4.id, { tokenCap: 0, usdCap: 0, timeLimitMs: 0, callCap: 0 });
      assert(ledger.getBalance(s4.id) !== null, "explicit zero still has a row");
      assert(!ledger.reserveTokens(s4.id, 1), "cap 0 rejects tokens");
      assert(!ledger.reserveUsd(s4.id, 0.01), "cap 0 rejects USD");
      assert(!ledger.reserveCalls(s4.id, 1), "cap 0 rejects calls");
      // "Reject everything" includes a zero-count reserve: the cap > 0 guard
      // makes explicit 0 stricter than a merely exhausted positive budget.
      assert(!ledger.reserveTokens(s4.id, 0), "cap 0 rejects even a zero token reserve");
      assert(!ledger.reserveUsd(s4.id, 0), "cap 0 rejects even a zero USD reserve");
      assert(!ledger.reserveCalls(s4.id, 0), "cap 0 rejects even a zero call reserve");

      // 12. #187: omitted caps inside a declared [budget] are unlimited, not 0.
      const s5 = await store.createSession("partial-caps");
      ledger.initBudget(s5.id, { tokenCap: 0 });
      const balPartial = ledger.getBalance(s5.id);
      assert(balPartial !== null, "partial [budget] creates a row");
      assert(balPartial!.callCap === Number.MAX_SAFE_INTEGER, "omitted callCap persists as unlimited, not 0");
      assert(balPartial!.usdCap === Number.MAX_SAFE_INTEGER, "omitted usdCap persists as unlimited");
      assert(!ledger.reserveTokens(s5.id, 1), "explicit tokenCap 0 still rejects");
      assert(ledger.reserveCalls(s5.id, 100000), "unlimited callCap passes");

      // 13. #187: re-registering the same session refreshes caps in place —
      //     one row, spent/reserved counters preserved (no duplicate inserts).
      const s6 = await store.createSession("reinit");
      ledger.initBudget(s6.id, { tokenCap: 1000, usdCap: 1, timeLimitMs: 1000, callCap: 5 });
      assert(ledger.reserveCalls(s6.id, 2), "initial reserve calls succeeds");
      ledger.settleCalls(s6.id, 2, 1);
      ledger.initBudget(s6.id, { tokenCap: 2000, usdCap: 2, timeLimitMs: 2000, callCap: 10 });
      const balReinit = ledger.getBalance(s6.id);
      assert(balReinit!.tokenCap === 2000 && balReinit!.callCap === 10, "re-init refreshes caps");
      assert(balReinit!.billableCalls === 1, "re-init preserves billable calls");
      const rows = (store as any).db.prepare("SELECT COUNT(*) AS c FROM budget_ledger WHERE session_id = ?").get(s6.id) as { c: number };
      assert(rows.c === 1, "re-init keeps exactly one budget row per session");

      // 14. #187: dropping [budget] releases an existing row's caps (unlimited,
      //     spend history preserved) while a never-configured session stays
      //     row-less. This keeps "active domain at registration" honest across
      //     durable-anchor restarts / domain switches.
      const s7 = await store.createSession("release");
      ledger.clearBudgetCaps(s7.id);
      assert(ledger.getBalance(s7.id) === null, "clearBudgetCaps is a no-op when no row exists");
      ledger.initBudget(s7.id, { tokenCap: 100, callCap: 2 });
      assert(ledger.reserveCalls(s7.id, 1), "release fixture reserves a call");
      ledger.settleCalls(s7.id, 1, 1);
      ledger.clearBudgetCaps(s7.id);
      // #187: a released row is deactivated and presented as unmetered, so
      // #177's ensureRow (which reads getBalance === null) will re-init it.
      assert(ledger.getBalance(s7.id) === null, "released row is unmetered from getBalance's perspective");
      const rawReleased = (store as any).db
        .prepare("SELECT configured, token_cap, call_cap, billable_calls FROM budget_ledger WHERE session_id = ?")
        .get(s7.id) as { configured: number; token_cap: number; call_cap: number; billable_calls: number };
      assert(rawReleased.configured === 0, "release flips configured to 0 (history retained)");
      assert(rawReleased.token_cap === Number.MAX_SAFE_INTEGER && rawReleased.call_cap === Number.MAX_SAFE_INTEGER,
        "release resets every cap to unlimited");
      assert(rawReleased.billable_calls === 1, "release preserves the spend counters");
      assert(ledger.reserveCalls(s7.id, 100000), "released session passes a large reserve");
      // Re-enabling the same row preserves the spend history (#177 path).
      ledger.initBudget(s7.id, { tokenCap: 500, callCap: 5 });
      const reenabled = ledger.getBalance(s7.id);
      assert(reenabled?.tokenCap === 500 && reenabled?.callCap === 5, "re-init re-enables the released row with new caps");
      assert(reenabled?.billableCalls === 1, "re-init after release keeps the spend history");

      // 15. #187: a legacy database with duplicate budget rows must still OPEN.
      //     The unique index is a protected migration outside db.exec(schema),
      //     so a duplicate-row failure warns instead of skipping later DDL.
      const legacyDir = mkdtempSync(join(tmpdir(), "ans-budget-legacy-"));
      const legacyPath = join(legacyDir, "legacy.db");
      const raw = new Database(legacyPath);
      try {
        raw.exec(`
          CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            domain TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE TABLE budget_ledger (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            token_cap INTEGER NOT NULL DEFAULT 0 CHECK (token_cap >= 0),
            usd_cap REAL NOT NULL DEFAULT 0 CHECK (usd_cap >= 0),
            time_limit_ms INTEGER NOT NULL DEFAULT 0 CHECK (time_limit_ms >= 0),
            call_cap INTEGER NOT NULL DEFAULT 0 CHECK (call_cap >= 0),
            reserved_tokens INTEGER NOT NULL DEFAULT 0 CHECK (reserved_tokens >= 0),
            spent_tokens INTEGER NOT NULL DEFAULT 0 CHECK (spent_tokens >= 0),
            reserved_usd REAL NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
            spent_usd REAL NOT NULL DEFAULT 0 CHECK (spent_usd >= 0),
            reserved_calls INTEGER NOT NULL DEFAULT 0 CHECK (reserved_calls >= 0),
            billable_calls INTEGER NOT NULL DEFAULT 0 CHECK (billable_calls >= 0),
            started_at TEXT NOT NULL DEFAULT (datetime('now')),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT INTO sessions (id, domain) VALUES ('legacy-s', 'default');
          INSERT INTO budget_ledger (session_id, token_cap, usd_cap, time_limit_ms, call_cap) VALUES ('legacy-s', 100, 1, 1000, 5);
          INSERT INTO budget_ledger (session_id, token_cap, usd_cap, time_limit_ms, call_cap) VALUES ('legacy-s', 200, 2, 2000, 10);
        `);
      } finally {
        raw.close();
      }
      const origWrite = process.stderr.write;
      let captured = "";
      process.stderr.write = ((chunk: unknown) => { captured += String(chunk); return true; }) as typeof process.stderr.write;
      let legacyStore: SqliteSessionStore | undefined;
      try {
        legacyStore = new SqliteSessionStore(legacyPath); // must not throw
        assert(/budget_ledger unique-session index not created/.test(captured),
          "duplicate legacy rows surface a warning instead of blocking open");
        const legacyRows = (legacyStore as any).db
          .prepare("SELECT COUNT(*) AS c FROM budget_ledger WHERE session_id = 'legacy-s'")
          .get() as { c: number };
        assert(legacyRows.c === 2, "legacy rows are preserved (no destructive migration)");
        // The upsert cannot be prepared while duplicates block the unique index;
        // the composition roots catch initBudget and stay unmetered. This is the
        // documented degraded state for a legacy corrupt DB, not a schema bust.
        let initThrew = false;
        try { legacyStore.initBudget("legacy-s", { tokenCap: 1 }); } catch { initThrew = true; }
        assert(initThrew, "legacy duplicate DB degrades budget init (caller fail-open), store stays open");
      } finally {
        process.stderr.write = origWrite;
        legacyStore?.close();
        try { rmSync(legacyDir, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
      }

      store.close();
    }
    console.log("--- BudgetLedger tests: " + passed + " passed, " + failed + " failed ---");
    if (failed > 0) process.exit(1);
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* Windows WAL lock */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
