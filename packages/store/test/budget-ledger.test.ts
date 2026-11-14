// Budget ledger test (G004). Mole reserve-then-settle pattern.
// Self-check via assert-based demo (ponytail: no test framework).
// Uses SqliteSessionStore to create session, then BudgetLedger on same db.

import Database from "better-sqlite3";
import { SqliteSessionStore } from "../src/session-store";
import { BudgetLedger } from "../src/budget-ledger";
import { tmpdir, hostname } from "node:os";
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
      // #187: a released row is deactivated and presented as unmetered;
      // #187's initBudget (hasAnyBudgetRow) reuses the released row.
      assert(ledger.getBalance(s7.id) === null, "released row is unmetered from getBalance's perspective");
      const rawReleased = (store as any).db
        .prepare("SELECT configured, token_cap, call_cap, billable_calls FROM budget_ledger WHERE session_id = ?")
        .get(s7.id) as { configured: number; token_cap: number; call_cap: number; billable_calls: number };
      assert(rawReleased.configured === 0, "release flips configured to 0 (history retained)");
      assert(rawReleased.token_cap === Number.MAX_SAFE_INTEGER && rawReleased.call_cap === Number.MAX_SAFE_INTEGER,
        "release resets every cap to unlimited");
      assert(rawReleased.billable_calls === 1, "release preserves the spend counters");
      assert(ledger.reserveCalls(s7.id, 100000), "released session passes a large reserve");
      // Re-enabling the same row preserves the spend history (#187 re-activation).
      ledger.initBudget(s7.id, { tokenCap: 500, callCap: 5 });
      const reenabled = ledger.getBalance(s7.id);
      assert(reenabled?.tokenCap === 500 && reenabled?.callCap === 5, "re-init re-enables the released row with new caps");
      assert(reenabled?.billableCalls === 1, "re-init after release keeps the spend history");

      // 15. #187/CodeRabbit: a legacy database with duplicate budget rows is
      //     merged before the unique index. One row remains; spend/reserved are
      //     summed and caps take the most restrictive active row.
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
          INSERT INTO budget_ledger (session_id, token_cap, usd_cap, time_limit_ms, call_cap, spent_tokens, billable_calls) VALUES ('legacy-s', 100, 1, 1000, 5, 30, 1);
          INSERT INTO budget_ledger (session_id, token_cap, usd_cap, time_limit_ms, call_cap, spent_tokens, billable_calls) VALUES ('legacy-s', 200, 2, 2000, 10, 20, 2);
        `);
      } finally {
        raw.close();
      }
      let legacyStore: SqliteSessionStore | undefined;
      try {
        legacyStore = new SqliteSessionStore(legacyPath); // must not throw
        const legacyRows = (legacyStore as any).db
          .prepare("SELECT COUNT(*) AS c FROM budget_ledger WHERE session_id = 'legacy-s'")
          .get() as { c: number };
        assert(legacyRows.c === 1, "legacy duplicate rows are merged into one row");
        const legacyLedger = new BudgetLedger((legacyStore as any).db);
        const merged = legacyLedger.getBalance("legacy-s");
        assert(merged?.tokenCap === 100 && merged?.callCap === 5,
          "merge keeps the most restrictive active caps");
        assert(merged?.spentTokens === 50 && merged?.billableCalls === 3,
          "merge sums spend/reserved history instead of dropping it");
        legacyLedger.initBudget("legacy-s", { tokenCap: 300, usdCap: 3, timeLimitMs: 3000, callCap: 7 });
        const updatedLegacy = legacyLedger.getBalance("legacy-s");
        assert(updatedLegacy?.tokenCap === 300 && updatedLegacy?.callCap === 7 && updatedLegacy?.spentTokens === 50,
          "legacy duplicate DB budget init updates in place, keeping merged spend");
      } finally {
        legacyStore?.close();
        try { rmSync(legacyDir, { recursive: true, force: true }); } catch { /* Windows WAL lock */ }
      }

      // 16. #187: concurrent-registration retry. Force the SELECT to miss while
      //     the row exists, so the INSERT hits the unique constraint and the
      //     catch path refreshes the winner's row instead of throwing.
      const s8 = await store.createSession("insert-race");
      ledger.initBudget(s8.id, { tokenCap: 100, callCap: 2 });
      (ledger as any).stmts.hasAnyBudgetRow = { get: () => undefined };
      ledger.initBudget(s8.id, { tokenCap: 999, callCap: 9 });
      const raced = ledger.getBalance(s8.id);
      assert(raced?.tokenCap === 999 && raced?.callCap === 9,
        "unique-conflict INSERT retries as an UPDATE (concurrent registration)");
      const raceRows = (store as any).db
        .prepare("SELECT COUNT(*) AS c FROM budget_ledger WHERE session_id = ?")
        .get(s8.id) as { c: number };
      assert(raceRows.c === 1, "concurrent registration still leaves one row");

      // 17. #187/CodeRabbit: settle must be safe across clear and activation.
      //     - reservations recorded before clear still settle (spend recorded);
      //     - an unconfigured row records new reservations without enforcement,
      //       so a later initBudget activation can settle them (no negative CHECK);
      //     - a configured=0 row with no recorded reservation settles as a no-op.
      const settleLedger = new BudgetLedger((store as any).db);
      const s9 = await store.createSession("settle-after-clear");
      settleLedger.initBudget(s9.id, { tokenCap: 1000, usdCap: 10, timeLimitMs: 1000, callCap: 5 });
      assert(settleLedger.reserveCalls(s9.id, 1), "pre-clear call reservation");
      assert(settleLedger.reserveTokens(s9.id, 100), "pre-clear token reservation");
      assert(settleLedger.reserveUsd(s9.id, 1), "pre-clear USD reservation");
      settleLedger.clearBudgetCaps(s9.id);
      settleLedger.settleCalls(s9.id, 1, 1);
      settleLedger.settleTokens(s9.id, 100, 100);
      settleLedger.settleUsd(s9.id, 1, 1);
      const afterSettle = (store as any).db
        .prepare("SELECT configured, reserved_calls, billable_calls, reserved_tokens, spent_tokens, reserved_usd, spent_usd FROM budget_ledger WHERE session_id = ?")
        .get(s9.id) as { configured: number; reserved_calls: number; billable_calls: number; reserved_tokens: number; spent_tokens: number; reserved_usd: number; spent_usd: number };
      assert(afterSettle.configured === 0, "row stays deactivated after settlement");
      assert(afterSettle.reserved_calls === 0 && afterSettle.billable_calls === 1,
        "pre-clear call reservation settles without a negative counter");
      assert(afterSettle.reserved_tokens === 0 && afterSettle.spent_tokens === 100,
        "pre-clear token reservation settles without a negative counter");
      assert(afterSettle.reserved_usd === 0 && afterSettle.spent_usd === 1,
        "pre-clear USD reservation settles without a negative counter");

      // Activation after an unconfigured reservation: the reserve is recorded
      // while configured=0, then initBudget activates the same row, then settle.
      const s9b = await store.createSession("activate-after-reserve");
      settleLedger.initBudget(s9b.id, { tokenCap: 1000, usdCap: 10, timeLimitMs: 1000, callCap: 5 });
      settleLedger.clearBudgetCaps(s9b.id);
      assert(settleLedger.reserveCalls(s9b.id, 1), "unconfigured row records a call reservation");
      assert(settleLedger.reserveTokens(s9b.id, 100), "unconfigured row records a token reservation");
      assert(settleLedger.reserveUsd(s9b.id, 1), "unconfigured row records a USD reservation");
      settleLedger.initBudget(s9b.id, { tokenCap: 1000, usdCap: 10, timeLimitMs: 1000, callCap: 5 });
      settleLedger.settleCalls(s9b.id, 1, 1);
      settleLedger.settleTokens(s9b.id, 100, 100);
      settleLedger.settleUsd(s9b.id, 1, 1);
      const afterActivate = (store as any).db
        .prepare("SELECT configured, reserved_calls, billable_calls, reserved_tokens, spent_tokens, reserved_usd, spent_usd FROM budget_ledger WHERE session_id = ?")
        .get(s9b.id) as { configured: number; reserved_calls: number; billable_calls: number; reserved_tokens: number; spent_tokens: number; reserved_usd: number; spent_usd: number };
      assert(afterActivate.configured === 1, "activation keeps the row configured");
      assert(afterActivate.reserved_calls === 0 && afterActivate.billable_calls === 1,
        "activation after unconfigured reserve settles calls without a negative counter");
      assert(afterActivate.reserved_tokens === 0 && afterActivate.spent_tokens === 100,
        "activation after unconfigured reserve settles tokens");
      assert(afterActivate.reserved_usd === 0 && afterActivate.spent_usd === 1,
        "activation after unconfigured reserve settles USD");

      const s10 = await store.createSession("settle-empty-unconfigured");
      settleLedger.initBudget(s10.id, { callCap: 5 });
      settleLedger.clearBudgetCaps(s10.id);
      settleLedger.settleCalls(s10.id, 1, 1);
      settleLedger.settleTokens(s10.id, 0, 5);
      settleLedger.settleUsd(s10.id, 0, 5);
      const emptySettle = (store as any).db
        .prepare("SELECT reserved_calls, billable_calls, spent_tokens, spent_usd FROM budget_ledger WHERE session_id = ?")
        .get(s10.id) as { reserved_calls: number; billable_calls: number; spent_tokens: number; spent_usd: number };
      assert(emptySettle.reserved_calls === 0 && emptySettle.billable_calls === 0,
        "unconfigured row with no recorded call reservation settles as a no-op");
      assert(emptySettle.spent_tokens === 0 && emptySettle.spent_usd === 0,
        "unconfigured row with no recorded token/USD reservation settles as a no-op");

      const s11 = await store.createSession("settle-no-row");
      assert(settleLedger.reserveCalls(s11.id, 1), "no-row reserve passes");
      settleLedger.settleCalls(s11.id, 1, 1);
      settleLedger.settleTokens(s11.id, 0, 10);
      settleLedger.settleUsd(s11.id, 0, 1);
      assert(settleLedger.getBalance(s11.id) === null, "settling a row-less session does not create a row");

      // 18. #275: the reported bug. A run killed by SIGKILL never reaches its
      //     settle, so its reservation stays in the counters and the next run
      //     is refused as "exhausted". The fixture is the measured case from
      //     the ticket: reserved_tokens = 12304, spent_tokens = 0.
      const s12 = await store.createSession("sigkill-leftover");
      // A killed owner is simulated by its pid and a liveness probe that reports
      // it dead; no real process is spawned (the rule under test is the ledger's,
      // and the pid check itself is the session lock's tested concern).
      const deadOwner = { pid: 999_999, host: hostname() };
      const killedLedger = new BudgetLedger((store as any).db, {
        owner: deadOwner,
        isOwnerAlive: (pid) => pid !== deadOwner.pid,
      });
      killedLedger.initBudget(s12.id, { tokenCap: 20000, usdCap: 5, timeLimitMs: 60_000, callCap: 10 });
      const killedReserve = killedLedger.reserveTokens(s12.id, 12304);
      assert(killedReserve, "#275 fixture: the killed run reserved 12304 tokens");
      const killedRaw = (store as any).db
        .prepare("SELECT reserved_tokens, spent_tokens FROM budget_ledger WHERE session_id = ?")
        .get(s12.id) as { reserved_tokens: number; spent_tokens: number };
      assert(killedRaw.reserved_tokens === 12304 && killedRaw.spent_tokens === 0,
        "#275 fixture matches the measured leftover (reserved 12304, spent 0)");

      // Before the fix this is the false "budget exhausted": 12304 + 9000 > 20000.
      // The control treats the killed pid as alive, which is the pre-fix
      // behaviour (the ledger never asked). It shows the leftover alone is what
      // refuses the run, so the fix below is judged against it rather than
      // against an empty table.
      const controlLedger = new BudgetLedger((store as any).db, { isOwnerAlive: () => true });
      assert(!controlLedger.reserveTokens(s12.id, 9000),
        "#275 control: with the leftover counted, 9000 is refused as exhausted");
      // The survivor is alive and only the killed pid is dead — the state this
      // process really is in. A blanket `() => false` probe would say the
      // survivor itself is dead, which is not a state that can occur.
      const survivor = new BudgetLedger((store as any).db, { isOwnerAlive: (pid) => pid !== 999_999 });
      const survivorOk = survivor.reserveTokens(s12.id, 9000);
      // 12304 + 9000 = 21304 > 20000, so this must be rejected until the dead
      // owner's share is released. The rejection triggers the release, so the
      // SAME call is what proves the fix: it must now succeed.
      assert(survivorOk,
        "#275: a reserve rejected by a dead owner's leftover is retried after releasing it");
      const afterReclaim = survivor.getBalance(s12.id)!;
      assert(afterReclaim.reservedTokens === 9000,
        "#275: only the dead owner's 12304 was released, the live run's 9000 remains");
      assert(survivor.reserveTokens(s12.id, 11001) === false,
        "#275: real exhaustion still rejects — reclaim never invents headroom");
      // The dead owner's rows must be gone, and nothing else may have been
      // released: the live run's own reservation is still counted below.
      const liveRowsNow = (store as any).db
        .prepare("SELECT owner_pid, amount FROM budget_reservations WHERE session_id = ?")
        .all(s12.id) as Array<{ owner_pid: number; amount: number }>;
      assert(liveRowsNow.every((r) => r.amount === 9_000),
        "#275: only the dead owner's row was released (got " + JSON.stringify(liveRowsNow) + ")");
      survivor.settleTokens(s12.id, 9000, 8000);
      const settled = survivor.getBalance(s12.id)!;
      assert(settled.reservedTokens === 0 && settled.spentTokens === 8000,
        "#275: the recovering run settles normally after the reclaim");
      // The dead owner's rows must be gone as evidence of the release.
      const remainingReservations = (store as any).db
        .prepare("SELECT owner_pid, amount FROM budget_reservations WHERE session_id = ?")
        .all(s12.id) as Array<{ owner_pid: number; amount: number }>;
      assert(remainingReservations.length === 0,
        "#275: no owner row outlives its release (got " + JSON.stringify(remainingReservations) + ")");

      // 19. #275: a live local owner is never touched. This is the case the
      //     "clear the whole session" shortcut would break: consolidation
      //     reserves without the session lock, so a chat run must not wipe it.
      const s13 = await store.createSession("concurrent-owner");
      const liveOwner = new BudgetLedger((store as any).db, {
        owner: { pid: 1234, host: hostname() },
        isOwnerAlive: () => true,
      });
      liveOwner.initBudget(s13.id, { tokenCap: 5000, timeLimitMs: 60_000 });
      assert(liveOwner.reserveTokens(s13.id, 4000), "#275 fixture: a live second owner reserves 4000");
      const other = new BudgetLedger((store as any).db, { isOwnerAlive: () => true });
      other.initBudget(s13.id, { tokenCap: 5000, timeLimitMs: 60_000 });
      const released = other.reclaimDeadReservations(s13.id);
      assert(released === 0, "#275: a live owner's reservation is never released");
      assert(other.getBalance(s13.id)!.reservedTokens === 4000,
        "#275: the live owner's 4000 is still reserved after a sweep");

      // 20. #275: an owner on another host cannot be confirmed, so it is kept.
      //     Same conservative rule the session lock uses for a foreign host.
      const s14 = await store.createSession("foreign-owner");
      const foreign = new BudgetLedger((store as any).db, {
        owner: { pid: 4321, host: "some-other-machine" },
        isOwnerAlive: (pid) => pid !== 4321,
      });
      foreign.initBudget(s14.id, { tokenCap: 4000, timeLimitMs: 60_000 });
      assert(foreign.reserveTokens(s14.id, 3000), "#275 fixture: a foreign owner reserves 3000");
      const local = new BudgetLedger((store as any).db, { isOwnerAlive: (pid) => pid !== 4321 });
      assert(local.reclaimDeadReservations(s14.id) === 0,
        "#275: a foreign-host owner is kept even when its pid looks dead here");
      assert(local.getBalance(s14.id)!.reservedTokens === 3000,
        "#275: the foreign owner's reservation is still reserved");

      // 21. #275 boundary: an amount with no owner row cannot be released by
      //     the dead-owner rule, and this build deliberately does not clear it.
      //     Such an amount is left by a pre-#275 build, which does not take the
      //     session lock either; clearing it would let that still-running old
      //     process and this run both spend against the cap. The upgrade window
      //     is tracked in #279, so here the residue is asserted to STAY — a
      //     build that started clearing it silently would fail this case.
      const s15 = await store.createSession("unowned-residue");
      const residueLedger = new BudgetLedger((store as any).db);
      residueLedger.initBudget(s15.id, { tokenCap: 20000, timeLimitMs: 60_000 });
      // Simulate the pre-#275 write: the counter moved with no owner recorded.
      (store as any).db.prepare(
        "UPDATE budget_ledger SET reserved_tokens = 12304 WHERE session_id = ?"
      ).run(s15.id);
      assert(residueLedger.reclaimDeadReservations(s15.id) === 0,
        "#275: the dead-owner rule cannot release an amount with no owner row");
      assert(residueLedger.getBalance(s15.id)!.reservedTokens === 12304,
        "#275/#279: the unowned amount is kept, not silently cleared");
      // A live owner's recorded share is untouched by that rule too. The
      // liveness answer is pinned: a fixed pid number is not "alive" on every
      // host, and this case is about the rule, not about this machine's
      // process table.
      const s16 = await store.createSession("unowned-vs-owned");
      const livePid = 5678;
      const ownedLedger = new BudgetLedger((store as any).db, {
        owner: { pid: livePid, host: hostname() },
        isOwnerAlive: (pid) => pid === livePid,
      });
      ownedLedger.initBudget(s16.id, { tokenCap: 20000, timeLimitMs: 60_000 });
      (store as any).db.prepare("UPDATE budget_ledger SET reserved_tokens = 1000 WHERE session_id = ?").run(s16.id);
      assert(ownedLedger.reserveTokens(s16.id, 1304), "#275 fixture: a live owner records 1304");
      assert(ownedLedger.reclaimDeadReservations(s16.id) === 0,
        "#275: a live owner's recorded share is never released");
      assert(ownedLedger.getBalance(s16.id)!.reservedTokens === 2304,
        "#275: the unowned 1000 and the owned 1304 are both still counted");
      // 21b. #279: the read-only probe behind the rejected-reserve hint. The
      //     s15 residue (12304 with no owner row) reads true; a session whose
      //     reserved tokens are claimed by an owner row reads false. The probe
      //     clears nothing — the residue stays, by the #279 direction-1 rule.
      assert(residueLedger.hasUnownedReservedTokens(s15.id),
        "#279: the probe sees the unowned residue on s15");
      assert(!ownedLedger.hasUnownedReservedTokens(s16.id),
        "#279: an owner row claiming the tokens dim reads false even with unowned residue present");
      assert(residueLedger.getBalance(s15.id)!.reservedTokens === 12_304,
        "#279: the probe is read-only — the residue is kept, not cleared");
      // 21c. #279: an owner row in another dimension does not mask an unowned
      //      token residue — the probe looks at the tokens dim only.
      const s24 = await store.createSession("unowned-tokens-owned-usd");
      const mixedLedger = new BudgetLedger((store as any).db);
      mixedLedger.initBudget(s24.id, { tokenCap: 20_000, usdCap: 5, timeLimitMs: 60_000 });
      (store as any).db.prepare(
        "UPDATE budget_ledger SET reserved_tokens = 12304 WHERE session_id = ?"
      ).run(s24.id);
      assert(mixedLedger.reserveUsd(s24.id, 1), "#279 fixture: a live owner holds a usd reservation");
      assert(mixedLedger.hasUnownedReservedTokens(s24.id),
        "#279: a usd owner row does not mask the unowned token residue");

      // 22. #275: the leak exists in all three counters, so the release must too
      //     (CodeRabbit on #274 explicitly asked for usd and calls, not only
      //     tokens). A killed run reserving in each dimension is released in
      //     each dimension, and a settle moves the same amount to spend.
      const s17 = await store.createSession("sigkill-all-dims");
      const dimOwner = { pid: 999_998, host: hostname() };
      const killedDims = new BudgetLedger((store as any).db, {
        owner: dimOwner,
        isOwnerAlive: (pid) => pid !== dimOwner.pid,
      });
      killedDims.initBudget(s17.id, { tokenCap: 30_000, usdCap: 5, timeLimitMs: 60_000, callCap: 8 });
      assert(killedDims.reserveTokens(s17.id, 12_304), "#275 fixture: killed run reserved tokens");
      assert(killedDims.reserveUsd(s17.id, 2.5), "#275 fixture: killed run reserved usd");
      assert(killedDims.reserveCalls(s17.id, 3), "#275 fixture: killed run reserved calls");
      const survivorAll = new BudgetLedger((store as any).db, { isOwnerAlive: (pid) => pid !== 999_998 });
      const killedAll = survivorAll.reclaimDeadReservations(s17.id);
      assert(killedAll === 3, "#275: one owner entry released per dimension (got " + killedAll + ")");
      const releasedAll = survivorAll.getBalance(s17.id)!;
      assert(releasedAll.reservedTokens === 0 && releasedAll.reservedUsd === 0 && releasedAll.reservedCalls === 0,
        "#275: all three counters are back to zero after the dead-owner release (got "
        + JSON.stringify([releasedAll.reservedTokens, releasedAll.reservedUsd, releasedAll.reservedCalls]) + ")");
      // The live run can then use the whole cap again, and settling books the
      // spend in each dimension instead of leaving a reservation behind.
      assert(survivorAll.reserveUsd(s17.id, 2.5), "#275: usd headroom is usable after the release");
      assert(survivorAll.reserveCalls(s17.id, 3), "#275: call headroom is usable after the release");
      survivorAll.settleUsd(s17.id, 2.5, 2.5);
      survivorAll.settleCalls(s17.id, 3, 3);
      const afterAll = survivorAll.getBalance(s17.id)!;
      assert(afterAll.spentUsd === 2.5 && afterAll.reservedUsd === 0,
        "#275: usd settle books spend and releases the reservation");
      assert(afterAll.billableCalls === 3 && afterAll.reservedCalls === 0,
        "#275: call settle books spend and releases the reservation");

      // 24. #275: a settle that forgets to release the owner row leaves a stale,
      //     LARGER row behind; the next sweep would subtract that stale amount
      //     from the shared counter and could wipe a live owner's reservation on
      //     the same session. So after a settle the owner table must be empty.
      //     This is the case that fails when `settle` skips its release call —
      //     verified by mutation, unlike the sweep cases above.
      const s20 = await store.createSession("settle-leaves-no-owner-row");
      const settling = new BudgetLedger((store as any).db, { owner: { pid: 6161, host: hostname() } });
      settling.initBudget(s20.id, { tokenCap: 50_000, timeLimitMs: 60_000 });
      assert(settling.reserveTokens(s20.id, 9_000), "#275 fixture: this run reserves 9000");
      settling.settleTokens(s20.id, 9_000, 7_000);
      const ownerRowsAfterSettle = (store as any).db
        .prepare("SELECT owner_pid, dim, amount FROM budget_reservations WHERE session_id = ?")
        .all(s20.id) as Array<{ owner_pid: number; dim: string; amount: number }>;
      assert(ownerRowsAfterSettle.length === 0,
        "#275: a completed settle leaves no owner row behind (got "
        + JSON.stringify(ownerRowsAfterSettle) + ")");
      // Concrete form of the harm: with no stale row, another live owner's
      // reservation on this session survives the next sweep untouched.
      const liveNow = new BudgetLedger((store as any).db, { owner: { pid: 7171, host: hostname() } });
      assert(liveNow.reserveTokens(s20.id, 5_000), "#275 fixture: another live owner holds 5000");
      const sweepAfterSettle = new BudgetLedger((store as any).db, { isOwnerAlive: () => true });
      assert(sweepAfterSettle.reclaimDeadReservations(s20.id) === 0,
        "#275: nothing is left to claim after a clean settle");
      assert(sweepAfterSettle.getBalance(s20.id)!.reservedTokens === 5_000,
        "#275: the later live owner's 5000 is intact (got "
        + sweepAfterSettle.getBalance(s20.id)!.reservedTokens + ")");

      // 23. #275: the release is idempotent per owner row — a swept row is gone
      //     and its amount released once, while a live owner keeps its share.
      //
      // Scope note: these sweeps run one after another on one thread. What that
      // pins is the observable outcome, not the race: the race is two processes
      // reading the same row before either deletes, and this repo's
      // single-connection fixture cannot create that moment. Removing the
      // `changes === 0` guard does NOT make this file fail — verified with a
      // mutation — so do not read these assertions as proof of the race fix.
      // The immediate transaction in `reclaimDeadReservations` is what closes it.
      const s18 = await store.createSession("double-sweep");
      const doomed = new BudgetLedger((store as any).db, {
        owner: { pid: 999_997, host: hostname() },
        isOwnerAlive: (pid) => pid !== 999_997,
      });
      doomed.initBudget(s18.id, { tokenCap: 100_000, timeLimitMs: 60_000 });
      assert(doomed.reserveTokens(s18.id, 12_304), "#275 fixture: dead owner holds 12304");
      // A live owner holding a real reservation on the same session.
      const bystander = new BudgetLedger((store as any).db, { owner: { pid: 4242, host: hostname() } });
      assert(bystander.reserveTokens(s18.id, 5_000), "#275 fixture: live owner holds 5000");
      // Live only for the real owner pids this case puts on the session; every
      // 999_99x fixture pid is dead. A blanket probe would claim every process
      // on this machine is dead, including the live bystander, and prove
      // nothing about the rule.
      const deadPids = new Set([999_997, 999_996, 999_995]);
      const sweepA = new BudgetLedger((store as any).db, { isOwnerAlive: (pid) => !deadPids.has(pid) });
      const sweepB = new BudgetLedger((store as any).db, { isOwnerAlive: (pid) => !deadPids.has(pid) });
      assert(sweepA.reclaimDeadReservations(s18.id) === 1, "#275: the first sweep releases the dead owner");
      assert(sweepB.reclaimDeadReservations(s18.id) === 0,
        "#275: a second sweep releases nothing (the owner row was already claimed)");
      // A second, distinct dead owner on the same session: the sweep must still
      // release it while leaving the live owner alone. This is what separates
      // "released what it claimed" from "cleared the session's counters".
      const doomed2 = new BudgetLedger((store as any).db, {
        owner: { pid: 999_996, host: hostname() },
        isOwnerAlive: (pid) => pid !== 999_996,
      });
      doomed2.initBudget(s18.id, { tokenCap: 100_000, timeLimitMs: 60_000 });
      assert(doomed2.reserveTokens(s18.id, 2_000), "#275 fixture: a second dead owner holds 2000");
      assert(sweepA.reclaimDeadReservations(s18.id) === 1, "#275: the extra dead owner is released");
      const afterDouble = sweepA.getBalance(s18.id)!;
      assert(afterDouble.reservedTokens === 5_000,
        "#275: the live owner's 5000 survives every sweep (got " + afterDouble.reservedTokens + ")");
      assert(afterDouble.spentTokens === 0,
        "#275: releasing a dead reservation never books spend (got " + afterDouble.spentTokens + ")");
      // #279 boundary: usd / calls amounts with no owner row are kept too, on
      // every dimension — not only tokens.
      (store as any).db.prepare(
        "UPDATE budget_ledger SET reserved_usd = 3.5, reserved_calls = 4 WHERE session_id = ?"
      ).run(s18.id);
      assert(sweepA.reclaimDeadReservations(s18.id) === 0,
        "#275: the dead-owner rule releases nothing when every owner row is live");
      const afterUnowned = sweepA.getBalance(s18.id)!;
      assert(afterUnowned.reservedUsd === 3.5 && afterUnowned.reservedCalls === 4
        && afterUnowned.reservedTokens === 5_000,
        "#275/#279: unowned usd/calls are kept alongside the owned token share (got "
        + JSON.stringify([afterUnowned.reservedTokens, afterUnowned.reservedUsd, afterUnowned.reservedCalls]) + ")");

      // 25. #275/CodeRabbit: only ESRCH counts as death — the liveness probe's
      //     own default rule, driven through the real `process.kill` rather than
      //     an injected stub. Each branch is its own fixture because the probe
      //     is a per-instance option.
      //     What this pins: an unconfirmed owner keeps its reservation, which is
      //     the conservative direction the ticket requires. A probe that treated
      //     "unknown" as dead would release a live run's headroom.
      {
        const seen: Array<{ pid: number; outcome: string }> = [];
        const originalKill = process.kill;
        // Stand in for the probe's error, then restore. The real function is
        // replaced only for the duration of one sweep.
        const withKillError = (code: string | undefined, expectedPid: number): void => {
          (process as any).kill = (pid: number, sig: number | string) => {
            if (sig === 0 && pid === expectedPid) {
              seen.push({ pid, outcome: code ?? "no-code" });
              const err: any = new Error("probe failure");
              if (code !== undefined) err.code = code;
              throw err;
            }
            return originalKill.call(process, pid, sig as any);
          };
        };
        const restore = () => { (process as any).kill = originalKill; };
        try {
          // ESRCH -> confirmed dead -> released.
          const s21 = await store.createSession("probe-esrch");
          const esrchOwner = new BudgetLedger((store as any).db, { owner: { pid: 888_001, host: hostname() } });
          esrchOwner.initBudget(s21.id, { tokenCap: 20_000, timeLimitMs: 60_000 });
          assert(esrchOwner.reserveTokens(s21.id, 5_000), "#275 fixture: esrch owner holds 5000");
          withKillError("ESRCH", 888_001);
          assert(esrchOwner.reclaimDeadReservations(s21.id) === 1,
            "#275: an ESRCH probe releases the reservation (confirmed dead)");
          assert(esrchOwner.getBalance(s21.id)!.reservedTokens === 0,
            "#275: ESRCH leaves the counter released");
          restore();
          // EPERM -> exists, other user -> kept.
          const s22 = await store.createSession("probe-eperm");
          const epermOwner = new BudgetLedger((store as any).db, { owner: { pid: 888_002, host: hostname() } });
          epermOwner.initBudget(s22.id, { tokenCap: 20_000, timeLimitMs: 60_000 });
          assert(epermOwner.reserveTokens(s22.id, 5_000), "#275 fixture: eperm owner holds 5000");
          withKillError("EPERM", 888_002);
          assert(epermOwner.reclaimDeadReservations(s22.id) === 0,
            "#275: an EPERM probe is kept — the process exists for another user");
          assert(epermOwner.getBalance(s22.id)!.reservedTokens === 5_000,
            "#275: EPERM leaves the reservation in place");
          restore();
          // An unknown probe failure -> cannot confirm -> kept. This is the
          // branch the fix changed: treating it as dead released live headroom.
          const s23 = await store.createSession("probe-unknown");
          const unknownOwner = new BudgetLedger((store as any).db, { owner: { pid: 888_003, host: hostname() } });
          unknownOwner.initBudget(s23.id, { tokenCap: 20_000, timeLimitMs: 60_000 });
          assert(unknownOwner.reserveTokens(s23.id, 5_000), "#275 fixture: unknown owner holds 5000");
          withKillError("ERR_INVALID_ARG_TYPE", 888_003);
          assert(unknownOwner.reclaimDeadReservations(s23.id) === 0,
            "#275: an unconfirmable probe keeps the reservation instead of guessing");
          assert(unknownOwner.getBalance(s23.id)!.reservedTokens === 5_000,
            "#275: an unknown probe error leaves the reservation in place");
          restore();
        } finally {
          restore();
        }
        assert(seen.length === 3, "#275: all three probe branches really ran (got " + JSON.stringify(seen) + ")");
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
