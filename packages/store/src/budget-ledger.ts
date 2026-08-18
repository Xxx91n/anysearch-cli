// Budget Ledger: Mole reserve-then-settle pattern.
// ADR-0005 decision 4: non-negative constraint in SQLite schema layer.
// Budget = resource consumption, belongs to store layer (not kernel).
// atomcode research: Mole DB schema non-negative constraint, 0% overshoot.

import type Database from "better-sqlite3";

export interface BudgetCaps {
  tokenCap: number;
  usdCap: number;
  timeLimitMs: number;
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
  // Derived: remaining = cap - reserved - spent
  remainingTokens: number;
  remainingUsd: number;
  remainingTimeMs: number;
}

// ponytail: thinnest ledger - 3 methods (reserve/settle/getBalance).
// No interface/port separation (unlike SessionStore) - this is a concrete store-layer utility.
// Kernel calls these via store injection, never imports better-sqlite3 directly.
export class BudgetLedger {
  private stmts: {
    initBudget: Database.Statement;
    reserveTokens: Database.Statement;
    reserveUsd: Database.Statement;
    settleTokens: Database.Statement;
    settleUsd: Database.Statement;
    getBalance: Database.Statement;
  };

  constructor(private db: Database.Database) {
    this.stmts = {
      initBudget: db.prepare("INSERT INTO budget_ledger (session_id, token_cap, usd_cap, time_limit_ms) VALUES (?, ?, ?, ?)"),
      reserveTokens: db.prepare("UPDATE budget_ledger SET reserved_tokens = reserved_tokens + ? WHERE session_id = ? AND reserved_tokens + spent_tokens + ? <= token_cap"),
      reserveUsd: db.prepare("UPDATE budget_ledger SET reserved_usd = reserved_usd + ? WHERE session_id = ? AND reserved_usd + spent_usd + ? <= usd_cap"),
      settleTokens: db.prepare("UPDATE budget_ledger SET reserved_tokens = reserved_tokens - ?, spent_tokens = spent_tokens + ? WHERE session_id = ?"),
      settleUsd: db.prepare("UPDATE budget_ledger SET reserved_usd = reserved_usd - ?, spent_usd = spent_usd + ? WHERE session_id = ?"),
      getBalance: db.prepare("SELECT session_id as sessionId, token_cap as tokenCap, usd_cap as usdCap, time_limit_ms as timeLimitMs, reserved_tokens as reservedTokens, spent_tokens as spentTokens, reserved_usd as reservedUsd, spent_usd as spentUsd FROM budget_ledger WHERE session_id = ?"),
    };
  }

  // Initialize budget for a session. Called once when session starts.
  initBudget(sessionId: string, caps: BudgetCaps): void {
    this.stmts.initBudget.run(sessionId, caps.tokenCap, caps.usdCap, caps.timeLimitMs);
  }

  // Reserve tokens before a call. Returns false if would exceed cap (non-negative constraint).
  reserveTokens(sessionId: string, amount: number): boolean {
    const result = this.stmts.reserveTokens.run(amount, sessionId, amount);
    return result.changes > 0;
  }

  // Reserve USD before a call. Returns false if would exceed cap.
  reserveUsd(sessionId: string, amount: number): boolean {
    const result = this.stmts.reserveUsd.run(amount, sessionId, amount);
    return result.changes > 0;
  }

  // Settle tokens after a call: move from reserved to spent (adjust if actual != reserved).
  settleTokens(sessionId: string, reservedAmount: number, actualAmount: number): void {
    this.stmts.settleTokens.run(reservedAmount, actualAmount, sessionId);
  }

  // Settle USD after a call.
  settleUsd(sessionId: string, reservedAmount: number, actualAmount: number): void {
    this.stmts.settleUsd.run(reservedAmount, actualAmount, sessionId);
  }

  // Get current balance for a session.
  getBalance(sessionId: string): BudgetBalance | null {
    const row = this.stmts.getBalance.get(sessionId) as Omit<BudgetBalance, "remainingTokens" | "remainingUsd" | "remainingTimeMs"> | undefined;
    if (!row) return null;
    return {
      ...row,
      remainingTokens: row.tokenCap - row.reservedTokens - row.spentTokens,
      remainingUsd: row.usdCap - row.reservedUsd - row.spentUsd,
      remainingTimeMs: row.timeLimitMs, // time is wall-clock, checked at runtime not ledger
    };
  }
}
