// #302 — the per-execution task budget `ans chat` bills to.
//
// Own module (like chat-memory.ts) so the wiring is testable without pulling
// in the ESM-only pi-agent-core chain through chat.ts.
//
// The three states S9 keeps apart, decided here:
// - undeclared (domain has no [budget]): no task_budgets row is created and
//   no caps are enforced — unmetered, same as an undeclared session. The
//   scope still travels, so an undeclared REGISTERED task's internal searches
//   route to its no-row ledger (a pass) instead of billing the session.
// - established: the row is created with the declared caps; the runtime
//   enforces them on this execution's own budget.
// - declared but failed (no registered task, or row creation threw): the
//   wiring returns a fault, and the runtime stops the run before any
//   controlled call. This is the deliberate replacement of the old
//   fail-open behavior (session form keeps it until #303/#304 migrate);
//   a declared constraint that cannot be established must not turn into
//   uncontrolled calls.
//
// Degradation, said plainly: when NO task was registered (broken registry)
// or the store lacks the seam, an UNDECLARED domain returns an empty wiring
// and the run falls back to the session form — the same shape every
// unmigrated caller still runs, not a hidden guarantee. A DECLARED domain
// in the same corner returns a fault and stops instead.
//
// Run from tests: pnpm --filter @anysearch-cli/cli test

import { toBudgetCaps, type BudgetConfig, type TaskBudgetLedger } from "@anysearch-cli/store";
import type { SessionStorePort } from "@anysearch-cli/kernel";

export interface ChatTaskBudgetWiring {
  /** The established task budget; absent when undeclared or faulted. Typed
   * concretely (not as kernel TaskBudgetScope) because the CLI's final report
   * reads `ledger.getBalance(taskId)` — a read seam the kernel port doesn't
   * carry, since billing call sites never need it. */
  taskBudget?: { taskId: string; ledger: TaskBudgetLedger };
  /** The reason a declared budget could not be established. */
  taskBudgetFault?: string;
}

export function wireChatTaskBudget(
  store: SessionStorePort,
  taskId: string | undefined,
  budget: BudgetConfig | undefined,
): ChatTaskBudgetWiring {
  if (!taskId) {
    // No registered task (registry failed to open, or the context is absent).
    // Undeclared: nothing to establish, the run is unmetered. Declared: the
    // constraint exists and cannot be attached to anything — stop, do not
    // fall open to unmetered.
    return budget
      ? { taskBudgetFault: "the main program registered no task to hold this run's budget" }
      : {};
  }
  let ledger: TaskBudgetLedger | undefined;
  try {
    // Optional seam, same discipline as initBudget: a hand-built store without
    // it cannot hold a task budget, which for a declared [budget] is a fault —
    // the same reading chat-memory.ts gives "store lacks initBudget".
    ledger = store.createTaskBudgetLedger?.();
  } catch (e: any) {
    // The task ledger cannot even be constructed (broken store connection).
    // With a declared budget this is "declared but failed to establish". Without
    // one there is no constraint, and the runtime reports any later ledger fault
    // by name — the broken-store corner must not crash the wiring itself.
    return budget
      ? { taskBudgetFault: "task budget ledger unavailable: " + (e?.message || String(e)) }
      : {};
  }
  if (budget && !ledger) {
    return { taskBudgetFault: "session store lacks createTaskBudgetLedger" };
  }
  if (budget && ledger) {
    try {
      ledger.initBudget(taskId, toBudgetCaps(budget));
    } catch (e: any) {
      // The FK on task_budgets makes "task was never registered" land here too
      // — the establishment failure the runtime turns into a hard stop.
      return { taskBudgetFault: "task budget establishment failed: " + (e?.message || String(e)) };
    }
  }
  return ledger ? { taskBudget: { taskId, ledger } } : {};
}
