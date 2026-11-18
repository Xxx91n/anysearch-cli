// #302/#303 — the per-execution task budget a host bills one run to.
//
// Design: one implementation, two hosts. The CLI (#302) and the MCP `ans_chat`
// tool (#303) both need the same three-state decision, and answering it twice
// is how the two entries would end up disagreeing about whether a run was
// metered. The states, decided here:
//
// - undeclared (the domain has no [budget]): no task_budgets row is created and
//   no caps are enforced — unmetered. The scope still travels, so an undeclared
//   registered task's internal searches route to its no-row ledger (a pass)
//   instead of billing the session.
// - established: the row is created with the declared caps; the runtime
//   enforces them on this execution's own budget.
// - declared but failed (no registered task, or row creation threw): the
//   wiring returns a fault, and the runtime stops the run before any controlled
//   call. A declared constraint that cannot be established must not turn into
//   uncontrolled calls.
//
// Degradation, said plainly: when NO task was registered (a broken registry, or
// a host that never registered one) or the store cannot hand out a ledger, an
// UNDECLARED domain returns an empty wiring and the run falls back to the
// session form — the shape every unmigrated caller still runs, not a hidden
// guarantee. "Cannot hand out a ledger" is a real corner, not an oversight: with
// no ledger object there is nothing for the engine's per-call routing to bill,
// so "the scope still travels" cannot hold there. A DECLARED domain in the same
// corner returns a fault and stops instead.
//
// Run from tests: pnpm --filter @anysearch-cli/kernel test

import { toBudgetCaps, type BudgetConfig, type TaskBudgetLedger } from "@anysearch-cli/store";
import type { SessionStorePort } from "./ports";

export interface TaskBudgetWiring {
  /** The established task budget; absent when undeclared or faulted. Typed
   * concretely (not as TaskBudgetScope) because the hosts' final reports read
   * `ledger.getBalance(taskId)` — a read seam the kernel port doesn't carry,
   * since billing call sites never need it. */
  taskBudget?: { taskId: string; ledger: TaskBudgetLedger };
  /** The reason a declared budget could not be established. */
  taskBudgetFault?: string;
}

export interface WireTaskBudgetOptions {
  /**
   * Where a degradation is reported. Called for the corner that would otherwise
   * be invisible: an UNDECLARED domain with a registered task whose store cannot
   * hand out a ledger — the run then falls back to the session form, which is
   * indistinguishable from "correctly unmetered" without a line somewhere.
   * Defaults to a no-op so unit tests stay quiet.
   */
  warn?: (message: string) => void;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function wireTaskBudget(
  store: SessionStorePort | undefined,
  taskId: string | undefined,
  budget: BudgetConfig | undefined,
  opts: WireTaskBudgetOptions = {},
): TaskBudgetWiring {
  const warn = opts.warn ?? (() => {});
  if (!taskId) {
    // No registered task (registry failed to open, or the context is absent).
    // Undeclared: nothing to establish, the run is unmetered. Declared: the
    // constraint exists and cannot be attached to anything — stop, do not
    // fall open to unmetered.
    return budget
      ? { taskBudgetFault: "the main program registered no task to hold this run's budget" }
      : {};
  }
  // Design: name the missing STORE and the missing SEAM differently. Both stop a
  // declared run, but they point a debugger at different places, and "lacks
  // createTaskBudgetLedger" about an absent store would send it to the wrong one.
  if (!store) {
    if (!budget) warn("task " + taskId + " has no store to bill — falling back to the session form");
    return budget ? { taskBudgetFault: "no session store to hold this run's budget" } : {};
  }
  let ledger: TaskBudgetLedger | undefined;
  try {
    // Optional seam, same discipline as initBudget: a hand-built store without
    // it cannot hold a task budget, which for a declared [budget] is a fault —
    // the same reading chat-memory.ts gives "store lacks initBudget".
    ledger = store.createTaskBudgetLedger?.();
  } catch (e: unknown) {
    // The task ledger cannot even be constructed (broken store connection).
    // With a declared budget this is "declared but failed to establish".
    // Without one there is no constraint, and the runtime reports any later
    // ledger fault by name — the broken-store corner must not crash the
    // wiring itself.
    if (!budget) warn("task " + taskId + " has no usable ledger (" + errText(e) + ") — falling back to the session form");
    return budget
      ? { taskBudgetFault: "task budget ledger unavailable: " + errText(e) }
      : {};
  }
  if (budget && !ledger) {
    return { taskBudgetFault: "session store lacks createTaskBudgetLedger" };
  }
  if (!ledger) {
    // Undeclared + a store that cannot hand out a ledger: no ledger object
    // means there is nothing for the engine's per-call routing to bill, so the
    // declared "scope still travels" cannot hold here. Say so once instead of
    // looking exactly like a healthy unmetered run.
    warn("task " + taskId + " has no ledger seam — internal calls bill the session form");
    return {};
  }
  if (budget) {
    try {
      ledger.initBudget(taskId, toBudgetCaps(budget));
    } catch (e: unknown) {
      // The FK on task_budgets makes "task was never registered" land here too
      // — the establishment failure the runtime turns into a hard stop.
      return { taskBudgetFault: "task budget establishment failed: " + errText(e) };
    }
  }
  return { taskBudget: { taskId, ledger } };
}
