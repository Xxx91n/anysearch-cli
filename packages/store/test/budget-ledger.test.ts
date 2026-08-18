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

      store.close();
    }
    console.log("--- BudgetLedger tests: " + passed + " passed, " + failed + " failed ---");
    if (failed > 0) process.exit(1);
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* Windows WAL lock */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
