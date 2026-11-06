// Budget Ledger: Mole reserve-then-settle pattern.
// decision 4: non-negative constraint in SQLite schema layer.
// Budget = resource consumption, belongs to store layer (not kernel).
// atomcode research: Mole DB schema non-negative constraint, 0% overshoot.

import type Database from "better-sqlite3";
import type { BudgetConfig } from "./domain-schema";

// #187: sentinel persisted for a dimension that has no configured cap. A row
// still exists (so "configured" is distinguishable from "no row"), but every
// reserve passes. An explicit TOML 0 is a real cap of zero and rejects.
export const UNLIMITED_BUDGET_CAP = Number.MAX_SAFE_INTEGER;

export interface BudgetCaps {
  tokenCap?: number;
  usdCap?: number;
  timeLimitMs?: number;
  callCap?: number; // decision 2B: per-call cap
}

// #187: map an optional [budget] section onto persisted caps. Missing fields
// become UNLIMITED_BUDGET_CAP (not 0); explicit 0 stays 0. An explicit 0 makes
// the reserve SQL reject even a zero-count reserve (`cap > 0` guard), matching
// the "reject everything" reading rather than only refusing positive amounts.
export function toBudgetCaps(budget: BudgetConfig): BudgetCaps {
  return {
    tokenCap: budget.tokenCap ?? UNLIMITED_BUDGET_CAP,
    usdCap: budget.usdCap ?? UNLIMITED_BUDGET_CAP,
    timeLimitMs: UNLIMITED_BUDGET_CAP,
    callCap: budget.callCap ?? UNLIMITED_BUDGET_CAP,
  };
}

export interface BudgetBalance {
  sessionId: string;
  tokenCap: number;
  usdCap: number;
  timeLimitMs: number;
  reservedTokens: number;
  spentTokens: number;
  reservedUsd: number;
  spentUsd: number;
  reservedCalls: number;
  billableCalls: number;
  callCap: number;
  // Derived: remaining = cap - reserved - spent
  remainingTokens: number;
  remainingUsd: number;
  remainingTimeMs: number;
  remainingCalls: number;
}

// ponytail: thinnest ledger - reserve/settle/getBalance, plus #187's
// initBudget/clearBudgetCaps registration seam.
// No interface/port separation (unlike SessionStore) - this is a concrete store-layer utility.
// Kernel calls these via store injection, never imports better-sqlite3 directly.
export class BudgetLedger {
  private stmts: {
    insertBudget: Database.Statement;
    updateCaps: Database.Statement;
    hasAnyBudgetRow: Database.Statement;
    clearCaps: Database.Statement;
    hasRow: Database.Statement;
    reserveTokens: Database.Statement;
    reserveUsd: Database.Statement;
    settleTokens: Database.Statement;
    settleUsd: Database.Statement;
    reserveCalls: Database.Statement;
    settleCalls: Database.Statement;
    getBalance: Database.Statement;
  };

  constructor(private db: Database.Database) {
    this.stmts = {
      // #187: SELECT-then-UPDATE/INSERT instead of ON CONFLICT. A legacy database
      // can lack the unique constraint (duplicate rows block the migration), and
      // a constructor-time `ON CONFLICT` prepare would make every ledger
      // operation — including getBalance/reserve — unavailable. This form still
      // reuses the row and is concurrency-safe on clean databases: the second
      // concurrent INSERT hits the unique index and is retried as an UPDATE.
      insertBudget: db.prepare("INSERT INTO budget_ledger (session_id, token_cap, usd_cap, time_limit_ms, call_cap, configured) VALUES (?, ?, ?, ?, ?, 1)"),
      updateCaps: db.prepare("UPDATE budget_ledger SET token_cap = ?, usd_cap = ?, time_limit_ms = ?, call_cap = ?, configured = 1 WHERE session_id = ?"),
      hasAnyBudgetRow: db.prepare("SELECT 1 AS present FROM budget_ledger WHERE session_id = ?"),
      // #187: returning to a no-[budget] Active Domain deactivates the row
      // (configured = 0) without deleting the spend history. A subsequent
      // initBudget reuses the row and re-enables it. No row -> no-op.
      clearCaps: db.prepare("UPDATE budget_ledger SET configured = 0, token_cap = ?, usd_cap = ?, time_limit_ms = ?, call_cap = ? WHERE session_id = ?"),
      // #187: configured = 1 is the enforceable-bit. A row can exist with
      // configured = 0 (history kept after [budget] was removed); reserve must
      // pass and getBalance must look unmetered, so row existence alone is not
      // the configured signal.
      hasRow: db.prepare("SELECT 1 AS present FROM budget_ledger WHERE session_id = ? AND configured = 1"),
      reserveTokens: db.prepare("UPDATE budget_ledger SET reserved_tokens = reserved_tokens + ? WHERE session_id = ? AND configured = 1 AND token_cap > 0 AND reserved_tokens + spent_tokens + ? <= token_cap"),
      reserveUsd: db.prepare("UPDATE budget_ledger SET reserved_usd = reserved_usd + ? WHERE session_id = ? AND configured = 1 AND usd_cap > 0 AND reserved_usd + spent_usd + ? <= usd_cap"),
      // #187/CodeRabbit: settle must be safe when the row was deactivated after a
      // reservation. configured=1 settles normally; configured=0 only settles
      // reservations that were actually recorded before clear (reserved > 0),
      // clamping the decrement so the non-negative CHECK cannot fire. With no
      // recorded reservation (configured=0, reserved=0) the WHERE guard makes
      // the whole settle a no-op — no phantom spend on an unmetered row.
      settleTokens: db.prepare("UPDATE budget_ledger SET reserved_tokens = CASE WHEN configured = 1 THEN reserved_tokens - ? ELSE MAX(0, reserved_tokens - ?) END, spent_tokens = spent_tokens + ? WHERE session_id = ? AND (configured = 1 OR reserved_tokens > 0)"),
      settleUsd: db.prepare("UPDATE budget_ledger SET reserved_usd = CASE WHEN configured = 1 THEN reserved_usd - ? ELSE MAX(0, reserved_usd - ?) END, spent_usd = spent_usd + ? WHERE session_id = ? AND (configured = 1 OR reserved_usd > 0)"),
      reserveCalls: db.prepare("UPDATE budget_ledger SET reserved_calls = reserved_calls + ? WHERE session_id = ? AND configured = 1 AND call_cap > 0 AND reserved_calls + billable_calls + ? <= call_cap"),
      settleCalls: db.prepare("UPDATE budget_ledger SET reserved_calls = CASE WHEN configured = 1 THEN reserved_calls - ? ELSE MAX(0, reserved_calls - ?) END, billable_calls = billable_calls + ? WHERE session_id = ? AND (configured = 1 OR reserved_calls > 0)"),
      getBalance: db.prepare("SELECT session_id as sessionId, token_cap as tokenCap, usd_cap as usdCap, time_limit_ms as timeLimitMs, call_cap as callCap, reserved_tokens as reservedTokens, spent_tokens as spentTokens, reserved_usd as reservedUsd, spent_usd as spentUsd, reserved_calls as reservedCalls, billable_calls as billableCalls FROM budget_ledger WHERE session_id = ? AND configured = 1"),
    };
  }

  // Initialize (or refresh) the budget row for a session. Called on each
  // registration. Caps and configured=1 refresh in place so a TOML change takes
  // effect on the next process start while reserved/spent counters survive; a
  // missing cap means "no cap", not zero. Idempotent: the writing session is
  // the same durable anchor `ans chat` re-registers on every start.
  initBudget(sessionId: string, caps: BudgetCaps): void {
    const tokenCap = caps.tokenCap ?? UNLIMITED_BUDGET_CAP;
    const usdCap = caps.usdCap ?? UNLIMITED_BUDGET_CAP;
    const timeLimitMs = caps.timeLimitMs ?? UNLIMITED_BUDGET_CAP;
    const callCap = caps.callCap ?? UNLIMITED_BUDGET_CAP;
    if (this.stmts.hasAnyBudgetRow.get(sessionId) !== undefined) {
      this.stmts.updateCaps.run(tokenCap, usdCap, timeLimitMs, callCap, sessionId);
      return;
    }
    try {
      this.stmts.insertBudget.run(sessionId, tokenCap, usdCap, timeLimitMs, callCap);
    } catch (e) {
      // Concurrent registration on a clean DB: the unique constraint rejects
      // the losing INSERT, and the winner's row is refreshed instead. Accept the
      // base constraint code only when the message names THIS unique key —
      // generic SQLITE_CONSTRAINT also covers FK/CHECK/NOTNULL and must not be
      // mistaken for a benign race.
      const code = (e as { code?: string })?.code;
      const message = e instanceof Error ? e.message : String(e);
      const uniqueSessionConflict =
        code === "SQLITE_CONSTRAINT_UNIQUE" ||
        (code === "SQLITE_CONSTRAINT" && /UNIQUE constraint failed: budget_ledger\.session_id/.test(message));
      if (uniqueSessionConflict) {
        const result = this.stmts.updateCaps.run(tokenCap, usdCap, timeLimitMs, callCap, sessionId);
        // The row can be deleted in the race window; do not report a silent init.
        if (result.changes === 0) throw e;
        return;
      }
      throw e;
    }
  }

  // #187: an existing row whose Active Domain dropped [budget] (or switched to
  // a domain without it) must stop metering. The row is deactivated
  // (configured = 0) and its caps become unlimited; reserved / spent counters
  // stay as the audit history. `getBalance` then returns null (unmetered) and a
  // later initBudget re-enables the same row. A session with no row is a no-op.
  clearBudgetCaps(sessionId: string): void {
    this.stmts.clearCaps.run(UNLIMITED_BUDGET_CAP, UNLIMITED_BUDGET_CAP, UNLIMITED_BUDGET_CAP, UNLIMITED_BUDGET_CAP, sessionId);
  }

  // #187: "no row" means the domain declared no [budget] for this session and
  // must not meter. This is deliberately checked before each UPDATE so a
  // present row with cap 0 (explicit "reject everything") stays distinguishable
  // from an absent row (pass).
  private hasConfiguredBudget(sessionId: string): boolean {
    return this.stmts.hasRow.get(sessionId) !== undefined;
  }

  // Reserve tokens before a call. Returns false only when a configured row
  // would exceed its cap (non-negative constraint); an unconfigured session
  // passes.
  reserveTokens(sessionId: string, amount: number): boolean {
    if (!this.hasConfiguredBudget(sessionId)) return true;
    const result = this.stmts.reserveTokens.run(amount, sessionId, amount);
    return result.changes > 0;
  }

  // Reserve USD before a call. Same no-row-passes contract as tokens.
  reserveUsd(sessionId: string, amount: number): boolean {
    if (!this.hasConfiguredBudget(sessionId)) return true;
    const result = this.stmts.reserveUsd.run(amount, sessionId, amount);
    return result.changes > 0;
  }

  // Settle tokens after a call: move from reserved to spent (adjust if actual != reserved).
  settleTokens(sessionId: string, reservedAmount: number, actualAmount: number): void {
    this.stmts.settleTokens.run(reservedAmount, reservedAmount, actualAmount, sessionId);
  }

  // Settle USD after a call.
  settleUsd(sessionId: string, reservedAmount: number, actualAmount: number): void {
    this.stmts.settleUsd.run(reservedAmount, reservedAmount, actualAmount, sessionId);
  }

  // decision 2C: reserve per-call budget by provider count. Unconfigured
  // sessions (no row) pass; a configured row enforces call_cap.
  reserveCalls(sessionId: string, count: number): boolean {
    if (!this.hasConfiguredBudget(sessionId)) return true;
    const result = this.stmts.reserveCalls.run(count, sessionId, count);
    return result.changes > 0;
  }

  // decision 2C: settle calls — actual successful providers.
  settleCalls(sessionId: string, reservedCount: number, actualCount: number): void {
    this.stmts.settleCalls.run(reservedCount, reservedCount, actualCount, sessionId);
  }

  // Get current balance for a session.
  getBalance(sessionId: string): BudgetBalance | null {
    const row = this.stmts.getBalance.get(sessionId) as Omit<BudgetBalance, "remainingTokens" | "remainingUsd" | "remainingTimeMs"> | undefined;
    if (!row) return null;
    return {
      ...row,
      remainingTokens: row.tokenCap - row.reservedTokens - row.spentTokens,
      remainingUsd: row.usdCap - row.reservedUsd - row.spentUsd,
      remainingTimeMs: row.timeLimitMs,
      remainingCalls: row.callCap - row.reservedCalls - row.billableCalls,
    };
  }
}
