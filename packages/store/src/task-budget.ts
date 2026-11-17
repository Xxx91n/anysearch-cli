// #302: per-execution task budget — the compatible new accounting form.
//
// Same reserve-then-settle shape as BudgetLedger (Mole pattern, non-negative
// constraints at the schema layer), but the scope key is a task id, not a
// session id. One chat execution gets its own budget row: resuming a
// conversation does not consume the history's quota, and the history's own
// budget_ledger row stays untouched for callers that have not migrated yet
// (MCP ans_chat, consolidate — #303/#304).
//
// No budget_reservations twin and no dead-owner reclaim, on purpose. A task's
// budget is established fresh for that execution and never reserved against
// again afterwards, so a killed task's leftover reservation cannot eat a
// future run's cap the way a session's can (#275). The leftover stays
// recorded — honest history — and the owner identity for diagnostics lives in
// task_records, not here.
//
// The method names match BudgetLedgerPort on purpose: a task ledger is
// structurally a BudgetLedgerPort whose methods take the task id as their
// scope, so the kernel's existing budget call sites can route either form
// through one port shape ("one implementation now, two = real seam" —
// decision 2A anticipated exactly this).

import type Database from "better-sqlite3";
import { UNLIMITED_BUDGET_CAP, type BudgetCaps } from "./budget-ledger";

// The task twin of BudgetBalance: the scope field names the task, not the
// session. Everything else is the same shape so a report can render either.
export interface TaskBudgetBalance {
  taskId: string;
  tokenCap: number;
  usdCap: number;
  timeLimitMs: number;
  callCap: number;
  reservedTokens: number;
  spentTokens: number;
  reservedUsd: number;
  spentUsd: number;
  reservedCalls: number;
  billableCalls: number;
  remainingTokens: number;
  remainingUsd: number;
  remainingTimeMs: number;
  remainingCalls: number;
}

export class TaskBudgetLedger {
  private stmts: {
    upsertCaps: Database.Statement;
    clearCaps: Database.Statement;
    hasRow: Database.Statement;
    reserveTokens: Database.Statement;
    reserveUsd: Database.Statement;
    reserveCalls: Database.Statement;
    settleTokens: Database.Statement;
    settleUsd: Database.Statement;
    settleCalls: Database.Statement;
    getBalance: Database.Statement;
  };

  constructor(db: Database.Database) {
    // The same three-state cap semantics as budget_ledger: no row = undeclared
    // (reserve passes, nothing recorded); configured=1 = enforce; configured=0
    // (the [budget] section was dropped mid-task) = record the reservation but
    // do not enforce, so a later re-declare can settle it without going negative.
    this.stmts = {
      // A brand-new table with a PRIMARY KEY, so the upsert can be a real
      // upsert — the SELECT-then-INSERT dance in BudgetLedger exists for legacy
      // databases whose budget_ledger predates its unique constraint; task
      // tables have no legacy shape to accommodate.
      upsertCaps: db.prepare(
        "INSERT INTO task_budgets (task_id, token_cap, usd_cap, time_limit_ms, call_cap, configured) VALUES (?, ?, ?, ?, ?, 1) " +
        "ON CONFLICT (task_id) DO UPDATE SET token_cap = excluded.token_cap, usd_cap = excluded.usd_cap, time_limit_ms = excluded.time_limit_ms, call_cap = excluded.call_cap, configured = 1",
      ),
      clearCaps: db.prepare(
        "UPDATE task_budgets SET configured = 0, token_cap = ?, usd_cap = ?, time_limit_ms = ?, call_cap = ? WHERE task_id = ?",
      ),
      hasRow: db.prepare("SELECT 1 AS present FROM task_budgets WHERE task_id = ?"),
      reserveTokens: db.prepare(
        "UPDATE task_budgets SET reserved_tokens = reserved_tokens + ? WHERE task_id = ? AND (configured = 0 OR (token_cap > 0 AND reserved_tokens + spent_tokens + ? <= token_cap))",
      ),
      reserveUsd: db.prepare(
        "UPDATE task_budgets SET reserved_usd = reserved_usd + ? WHERE task_id = ? AND (configured = 0 OR (usd_cap > 0 AND reserved_usd + spent_usd + ? <= usd_cap))",
      ),
      reserveCalls: db.prepare(
        "UPDATE task_budgets SET reserved_calls = reserved_calls + ? WHERE task_id = ? AND (configured = 0 OR (call_cap > 0 AND reserved_calls + billable_calls + ? <= call_cap))",
      ),
      settleTokens: db.prepare(
        "UPDATE task_budgets SET reserved_tokens = MAX(0, reserved_tokens - ?), spent_tokens = spent_tokens + ? WHERE task_id = ? AND (configured = 1 OR reserved_tokens > 0)",
      ),
      settleUsd: db.prepare(
        "UPDATE task_budgets SET reserved_usd = MAX(0, reserved_usd - ?), spent_usd = spent_usd + ? WHERE task_id = ? AND (configured = 1 OR reserved_usd > 0)",
      ),
      settleCalls: db.prepare(
        "UPDATE task_budgets SET reserved_calls = MAX(0, reserved_calls - ?), billable_calls = billable_calls + ? WHERE task_id = ? AND (configured = 1 OR reserved_calls > 0)",
      ),
      getBalance: db.prepare(
        "SELECT task_id as taskId, token_cap as tokenCap, usd_cap as usdCap, time_limit_ms as timeLimitMs, call_cap as callCap, reserved_tokens as reservedTokens, spent_tokens as spentTokens, reserved_usd as reservedUsd, spent_usd as spentUsd, reserved_calls as reservedCalls, billable_calls as billableCalls FROM task_budgets WHERE task_id = ? AND configured = 1",
      ),
    };
  }

  /**
   * Establish (or refresh) the budget row for one task.
   *
   * Called by the chat wiring when the domain declares [budget]: the row's
   * appearance is what separates "declared and established" from "declared
   * but failed to establish" (S9's three states). An INSERT that violates the
   * task_records foreign key — the task was never registered — throws, and
   * the caller turns that into "the run must not start", not "unmetered".
   * Refresh in place keeps counters, exactly like the session form's
   * initBudget: a run-boundary TOML re-read updates caps without wiping spend.
   */
  initBudget(taskId: string, caps: BudgetCaps): void {
    this.stmts.upsertCaps.run(
      taskId,
      caps.tokenCap ?? UNLIMITED_BUDGET_CAP,
      caps.usdCap ?? UNLIMITED_BUDGET_CAP,
      caps.timeLimitMs ?? UNLIMITED_BUDGET_CAP,
      caps.callCap ?? UNLIMITED_BUDGET_CAP,
    );
  }

  // A declared budget whose [budget] section disappeared between runs (the
  // run-boundary re-read) deactivates the row: counters stay as history,
  // reserves stop enforcing. Mirrors clearBudgetCaps for the session form.
  clearBudgetCaps(taskId: string): void {
    this.stmts.clearCaps.run(
      UNLIMITED_BUDGET_CAP,
      UNLIMITED_BUDGET_CAP,
      UNLIMITED_BUDGET_CAP,
      UNLIMITED_BUDGET_CAP,
      taskId,
    );
  }

  private hasBudgetRow(taskId: string): boolean {
    return this.stmts.hasRow.get(taskId) !== undefined;
  }

  // The one reserve algorithm the session form uses, minus the reclaim retry:
  // no owner rows exist here, so nothing can be swept between the two attempts
  // (see the class comment for why a task never needs that sweep).
  private reserve(stmt: Database.Statement, taskId: string, amount: number): boolean {
    if (!this.hasBudgetRow(taskId)) return true;
    return stmt.run(amount, taskId, amount).changes > 0;
  }

  // Reserve tokens before a call. No row passes (undeclared task); a
  // configured row enforces its cap; an unconfigured row records the
  // reservation without enforcement. Same contract as the session form.
  reserveTokens(taskId: string, amount: number): boolean {
    return this.reserve(this.stmts.reserveTokens, taskId, amount);
  }

  reserveUsd(taskId: string, amount: number): boolean {
    return this.reserve(this.stmts.reserveUsd, taskId, amount);
  }

  reserveCalls(taskId: string, count: number): boolean {
    return this.reserve(this.stmts.reserveCalls, taskId, count);
  }

  // Settle: move reserved to spent, clamped so a lost reservation cannot trip
  // the non-negative CHECK. Settle-by-actuals — a usage figure larger than the
  // reservation still records the real number.
  settleTokens(taskId: string, reservedAmount: number, actualAmount: number): void {
    this.stmts.settleTokens.run(reservedAmount, actualAmount, taskId);
  }

  settleUsd(taskId: string, reservedAmount: number, actualAmount: number): void {
    this.stmts.settleUsd.run(reservedAmount, actualAmount, taskId);
  }

  settleCalls(taskId: string, reservedCount: number, actualCount: number): void {
    this.stmts.settleCalls.run(reservedCount, actualCount, taskId);
  }

  // Current balance for one task, or null when it has no enforceable row
  // (undeclared, or caps cleared). The "this run" report reads this after the
  // drain; the conversation's own history is a different row in a different
  // table, so the two reports can never blur together.
  getBalance(taskId: string): TaskBudgetBalance | null {
    const row = this.stmts.getBalance.get(taskId) as Omit<TaskBudgetBalance, "remainingTokens" | "remainingUsd" | "remainingTimeMs" | "remainingCalls"> | undefined;
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
