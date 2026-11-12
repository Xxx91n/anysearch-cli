// Budget ledger: Mole reserve-then-settle pattern.
// decision 4: non-negative constraint in SQLite schema layer.
// Budget = resource consumption, belongs to store layer (not kernel).
// atomcode research: Mole DB schema non-negative constraint, 0% overshoot.

import type Database from "better-sqlite3";
import { hostname } from "node:os";
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

/** One budget_ledger counter, as recorded in budget_reservations (#275). */
export type ReservationDim = "tokens" | "usd" | "calls";

/** Who held a reservation: the two facts a live owner can be checked against. */
export interface ReservationOwner {
  pid: number;
  host: string;
}

/**
 * Whether a pid is still running. EPERM means the process exists but belongs
 * to another user, so it is alive; any other error means no such process.
 */
function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

// #275: the owner of every reservation this process makes. Defaults to this
// process; a test (or a probe) can stand in for another one.
export interface BudgetLedgerOptions {
  owner?: ReservationOwner;
  /** Liveness probe for a same-host owner; injected so tests need no real kill. */
  isOwnerAlive?: (pid: number) => boolean;
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
    reserveTokens: Database.Statement;
    reserveUsd: Database.Statement;
    settleTokens: Database.Statement;
    settleUsd: Database.Statement;
    reserveCalls: Database.Statement;
    settleCalls: Database.Statement;
    getBalance: Database.Statement;
    // #275: per-owner reservation bookkeeping.
    addReservation: Database.Statement;
    reduceReservation: Database.Statement;
    deleteEmptyReservation: Database.Statement;
    deleteReservation: Database.Statement;
    sessionReservations: Database.Statement;
    rawCounters: Database.Statement;
    releaseReservedTokens: Database.Statement;
    releaseReservedUsd: Database.Statement;
    releaseReservedCalls: Database.Statement;
  };

  private readonly owner: ReservationOwner;
  private readonly isOwnerAlive: (pid: number) => boolean;

  constructor(private db: Database.Database, opts: BudgetLedgerOptions = {}) {
    this.owner = opts.owner ?? { pid: process.pid, host: hostname() };
    this.isOwnerAlive = opts.isOwnerAlive ?? pidIsAlive;
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
      // configured = 0 (history kept after [budget] was removed); reserve still
      // records units but does not enforce caps, and getBalance looks unmetered.
      // #187/CodeRabbit: an unconfigured row still RECORDS the reservation (it just
      // does not enforce a cap), so a later initBudget activation can settle it
      // without a negative counter. configured=1 keeps the cap enforcement.
      reserveTokens: db.prepare("UPDATE budget_ledger SET reserved_tokens = reserved_tokens + ? WHERE session_id = ? AND (configured = 0 OR (token_cap > 0 AND reserved_tokens + spent_tokens + ? <= token_cap))"),
      reserveUsd: db.prepare("UPDATE budget_ledger SET reserved_usd = reserved_usd + ? WHERE session_id = ? AND (configured = 0 OR (usd_cap > 0 AND reserved_usd + spent_usd + ? <= usd_cap))"),
      // #187/CodeRabbit: settle must be safe when the row was deactivated after a
      // reservation AND when it was activated after an unconfigured reservation.
      // The counter is clamped for every row (never negative CHECK); a
      // configured=0 row with no recorded reservation is a no-op. Recording the
      // reservation even while configured=0 is what makes later activation safe.
      settleTokens: db.prepare("UPDATE budget_ledger SET reserved_tokens = MAX(0, reserved_tokens - ?), spent_tokens = spent_tokens + ? WHERE session_id = ? AND (configured = 1 OR reserved_tokens > 0)"),
      settleUsd: db.prepare("UPDATE budget_ledger SET reserved_usd = MAX(0, reserved_usd - ?), spent_usd = spent_usd + ? WHERE session_id = ? AND (configured = 1 OR reserved_usd > 0)"),
      reserveCalls: db.prepare("UPDATE budget_ledger SET reserved_calls = reserved_calls + ? WHERE session_id = ? AND (configured = 0 OR (call_cap > 0 AND reserved_calls + billable_calls + ? <= call_cap))"),
      settleCalls: db.prepare("UPDATE budget_ledger SET reserved_calls = MAX(0, reserved_calls - ?), billable_calls = billable_calls + ? WHERE session_id = ? AND (configured = 1 OR reserved_calls > 0)"),
      getBalance: db.prepare("SELECT session_id as sessionId, token_cap as tokenCap, usd_cap as usdCap, time_limit_ms as timeLimitMs, call_cap as callCap, reserved_tokens as reservedTokens, spent_tokens as spentTokens, reserved_usd as reservedUsd, spent_usd as spentUsd, reserved_calls as reservedCalls, billable_calls as billableCalls FROM budget_ledger WHERE session_id = ? AND configured = 1"),
      // #275: the owner of a reservation. One aggregate row per
      // (session, dim, owner) — a run reserves and settles many times and the
      // settle call only carries an amount, so the owner's total is what a
      // takeover can judge and release.
      addReservation: db.prepare("INSERT INTO budget_reservations (session_id, dim, owner_pid, owner_host, amount) VALUES (?, ?, ?, ?, ?) ON CONFLICT (session_id, dim, owner_pid, owner_host) DO UPDATE SET amount = amount + excluded.amount"),
      reduceReservation: db.prepare("UPDATE budget_reservations SET amount = MAX(0, amount - ?) WHERE session_id = ? AND dim = ? AND owner_pid = ? AND owner_host = ?"),
      deleteEmptyReservation: db.prepare("DELETE FROM budget_reservations WHERE session_id = ? AND dim = ? AND owner_pid = ? AND owner_host = ? AND amount = 0"),
      // #275: a reclaimed owner's row goes whatever its recorded amount was —
      // that row belongs to the dead holder, not to a live settle's leftover.
      deleteReservation: db.prepare("DELETE FROM budget_reservations WHERE session_id = ? AND dim = ? AND owner_pid = ? AND owner_host = ?"),
      sessionReservations: db.prepare("SELECT dim as dim, owner_pid as pid, owner_host as host, amount as amount FROM budget_reservations WHERE session_id = ?"),
      // The raw counters, without getBalance's configured = 1 filter: the
      // unowned sweep has to see the numbers a deactivated row still carries,
      // or the residue would survive a later re-activation.
      rawCounters: db.prepare("SELECT reserved_tokens as tokens, reserved_usd as usd, reserved_calls as calls FROM budget_ledger WHERE session_id = ?"),
      // #275: release a dead owner's share from the ledger counter. The amount
      // is the one recorded for that owner, and the decrement is clamped, so an
      // already-settled counter cannot go negative.
      releaseReservedTokens: db.prepare("UPDATE budget_ledger SET reserved_tokens = MAX(0, reserved_tokens - ?) WHERE session_id = ?"),
      releaseReservedUsd: db.prepare("UPDATE budget_ledger SET reserved_usd = MAX(0, reserved_usd - ?) WHERE session_id = ?"),
      releaseReservedCalls: db.prepare("UPDATE budget_ledger SET reserved_calls = MAX(0, reserved_calls - ?) WHERE session_id = ?"),
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
      // #275: registration is the point every host passes on start, so a
      // reservation left behind by a killed run is released here rather than
      // surfacing later as a phantom "budget exhausted".
      this.reclaimDeadReservations(sessionId);
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
        this.reclaimDeadReservations(sessionId);
        return;
      }
      throw e;
    }
    // A fresh row has no reservations; a legacy row can (the reservation table
    // may be newer than the ledger rows), so the reclaim runs on this path too.
    this.reclaimDeadReservations(sessionId);
  }

  // #187: an existing row whose Active Domain dropped [budget] (or switched to
  // a domain without it) must stop metering. The row is deactivated
  // (configured = 0) and its caps become unlimited; reserved / spent counters
  // stay as the audit history. `getBalance` then returns null (unmetered) and a
  // later initBudget re-enables the same row. A session with no row is a no-op.
  clearBudgetCaps(sessionId: string): void {
    this.stmts.clearCaps.run(UNLIMITED_BUDGET_CAP, UNLIMITED_BUDGET_CAP, UNLIMITED_BUDGET_CAP, UNLIMITED_BUDGET_CAP, sessionId);
  }

  // #187: no row = unmetered pass (no write). An existing row — even
  // configured=0 — records the reservation so a later initBudget activation can
  // settle it without a negative counter; configured=1 also enforces the cap.
  private hasBudgetRow(sessionId: string): boolean {
    return this.stmts.hasAnyBudgetRow.get(sessionId) !== undefined;
  }

  // #275: record this process as the holder of the amount it just reserved.
  // Only called after the counter really moved, so the owner table never
  // claims a reservation the ledger did not take.
  private recordOwner(sessionId: string, dim: ReservationDim, amount: number): void {
    if (!(amount > 0)) return;
    this.stmts.addReservation.run(sessionId, dim, this.owner.pid, this.owner.host, amount);
  }

  /**
   * #275: take a reservation as one unit — the counter moves and the owner row
   * appears together.
   *
   * Two separate writes would leave a gap in which the counter is up but
   * nothing claims the amount, and the exclusive-writer sweep would then read
   * that as unowned residue and release it under this very run. Both writes
   * inside one transaction removes the gap.
   *
   * Returns whether the counter moved (the cap said yes). "No row" is decided
   * by the caller before this.
   */
  private takeReservation(sessionId: string, dim: ReservationDim, amount: number): boolean {
    const stmt =
      dim === "tokens" ? this.stmts.reserveTokens
      : dim === "usd" ? this.stmts.reserveUsd
      : this.stmts.reserveCalls;
    const apply = this.db.transaction((): boolean => {
      if (stmt.run(amount, sessionId, amount).changes === 0) return false;
      this.recordOwner(sessionId, dim, amount);
      return true;
    });
    return apply();
  }

  // #275: refund the owner's share of a released reservation. The ledger
  // counter is the authority for the amount (its own clamped decrement already
  // ran); this only keeps the owner table in step so a later reclaim reads a
  // true number.
  private releaseOwnerReservation(sessionId: string, dim: ReservationDim, amount: number): void {
    if (!(amount > 0)) return;
    // The amount is the first placeholder in this statement (SET ... = ?),
    // unlike the DELETE below where it is absent; keep the two call sites'
    // argument order straight or the owner row silently stops shrinking.
    this.stmts.reduceReservation.run(amount, sessionId, dim, this.owner.pid, this.owner.host);
    this.stmts.deleteEmptyReservation.run(sessionId, dim, this.owner.pid, this.owner.host);
  }

  /**
   * #275: release the reservations whose owner this machine can prove is gone,
   * and return how many owner entries were released. A SIGKILL'd run never
   * reaches its `finally`, so its reservation would otherwise sit in the
   * counters for the life of the session and make later runs look exhausted.
   *
   * Only a same-host owner with a dead pid is released. A live local owner is
   * never touched — a concurrently running consolidation holds reservations
   * without the session lock, and clearing them would loosen that session's cap
   * for the rest of its run. An owner on another host cannot be confirmed from
   * here, so it is kept (the same conservative rule the session lock uses).
   *
   * The release amount is what that owner recorded, and every counter
   * decrement is clamped, so a counter that was already settled cannot go
   * negative.
   */
  reclaimDeadReservations(sessionId: string): number {
    const rows = this.stmts.sessionReservations.all(sessionId) as Array<{
      dim: ReservationDim; pid: number; host: string; amount: number;
    }>;
    const releasable = rows.filter(
      (r) => r.host === this.owner.host && !this.isOwnerAlive(r.pid),
    );
    if (releasable.length === 0) return 0;
    const apply = this.db.transaction(() => {
      for (const r of releasable) {
        const stmt =
          r.dim === "tokens" ? this.stmts.releaseReservedTokens
          : r.dim === "usd" ? this.stmts.releaseReservedUsd
          : this.stmts.releaseReservedCalls;
        stmt.run(r.amount, sessionId);
        this.stmts.deleteReservation.run(sessionId, r.dim, r.pid, r.host);
      }
    });
    apply();
    return releasable.length;
  }

  /**
   * #275: clear reservation counters that no owner claims.
   *
   * A database written before this table existed has counters but no owner
   * rows — exactly the residue the ticket measured (reserved_tokens = 12304,
   * spent_tokens = 0, left by a killed run). Nothing can attribute that amount,
   * so the dead-owner rule above can never release it on its own.
   *
   * This is only safe when the caller has proven it is the session's exclusive
   * writer, so the runtime calls it after taking the session lock and nowhere
   * else. Consolidation reserves without that lock, so it must not call this:
   * its reservations are recorded under an owner and stay untouched.
   *
   * A run of an older build that recorded no owner is the one live thing this
   * can clear, and an older build did not take the session lock either. The
   * window is one upgrade and it can only loosen the cap for that run, never
   * tighten it.
   *
   * Returns the amount released per dimension, so a caller can report it.
   */
  reclaimUnownedReservations(sessionId: string): Record<ReservationDim, number> {
    const balance = this.stmts.rawCounters.get(sessionId) as
      | { tokens: number; usd: number; calls: number }
      | undefined;
    const released: Record<ReservationDim, number> = { tokens: 0, usd: 0, calls: 0 };
    if (!balance) return released;
    const owned = { tokens: 0, usd: 0, calls: 0 };
    for (const r of this.stmts.sessionReservations.all(sessionId) as Array<{ dim: ReservationDim; amount: number }>) {
      if (r.dim in owned) owned[r.dim] += Number(r.amount) || 0;
    }
    const unowned = {
      tokens: Number(balance.tokens) - owned.tokens,
      usd: Number(balance.usd) - owned.usd,
      calls: Number(balance.calls) - owned.calls,
    };
    // A rounding tail on the usd dimension is not worth a write.
    for (const dim of ["tokens", "usd", "calls"] as ReservationDim[]) {
      const amount = unowned[dim];
      if (!(amount > (dim === "usd" ? 1e-9 : 0))) continue;
      released[dim] = amount;
    }
    if (released.tokens === 0 && released.usd === 0 && released.calls === 0) return released;
    const apply = this.db.transaction(() => {
      if (released.tokens > 0) this.stmts.releaseReservedTokens.run(released.tokens, sessionId);
      if (released.usd > 0) this.stmts.releaseReservedUsd.run(released.usd, sessionId);
      if (released.calls > 0) this.stmts.releaseReservedCalls.run(released.calls, sessionId);
    });
    apply();
    return released;
  }

  // Reserve tokens before a call. No row passes; a configured row enforces its
  // cap; an unconfigured row records the reservation without enforcement.
  //
  // #275: a rejection is not accepted as final on the first try. A dead
  // process's leftover reservation looks exactly like real exhaustion to the
  // cap test, so dead owners are released once and the cap is tested again.
  // When nothing was released the same rejection stands — reclaiming never
  // turns real exhaustion into a pass.
  reserveTokens(sessionId: string, amount: number): boolean {
    if (!this.hasBudgetRow(sessionId)) return true;
    if (this.takeReservation(sessionId, "tokens", amount)) return true;
    if (this.reclaimDeadReservations(sessionId) === 0) return false;
    return this.takeReservation(sessionId, "tokens", amount);
  }

  // Reserve USD before a call. Same contract as tokens.
  reserveUsd(sessionId: string, amount: number): boolean {
    if (!this.hasBudgetRow(sessionId)) return true;
    if (this.takeReservation(sessionId, "usd", amount)) return true;
    if (this.reclaimDeadReservations(sessionId) === 0) return false;
    return this.takeReservation(sessionId, "usd", amount);
  }

  // Settle tokens after a call: move from reserved to spent (adjust if actual != reserved).
  // The decrement is clamped so a lost/never-recorded reservation cannot trip
  // the non-negative CHECK.
  settleTokens(sessionId: string, reservedAmount: number, actualAmount: number): void {
    this.stmts.settleTokens.run(reservedAmount, actualAmount, sessionId);
    this.releaseOwnerReservation(sessionId, "tokens", reservedAmount);
  }

  // Settle USD after a call.
  settleUsd(sessionId: string, reservedAmount: number, actualAmount: number): void {
    this.stmts.settleUsd.run(reservedAmount, actualAmount, sessionId);
    this.releaseOwnerReservation(sessionId, "usd", reservedAmount);
  }

  // decision 2C: reserve per-call budget by provider count. No row passes; an
  // unconfigured row records; a configured row enforces call_cap. #275's
  // dead-owner retry applies here too.
  reserveCalls(sessionId: string, count: number): boolean {
    if (!this.hasBudgetRow(sessionId)) return true;
    if (this.takeReservation(sessionId, "calls", count)) return true;
    if (this.reclaimDeadReservations(sessionId) === 0) return false;
    return this.takeReservation(sessionId, "calls", count);
  }

  // decision 2C: settle calls — actual successful providers.
  settleCalls(sessionId: string, reservedCount: number, actualCount: number): void {
    this.stmts.settleCalls.run(reservedCount, actualCount, sessionId);
    this.releaseOwnerReservation(sessionId, "calls", reservedCount);
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
