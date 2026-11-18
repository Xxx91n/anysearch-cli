// #302/#303 — the per-execution task budget a host bills one run to.
//
// Design: one implementation, two hosts. The CLI (#302) and the MCP `ans_chat`
// tool (#303) need the same three-state answer, and answering it twice is how
// the entries drift apart. Three states here:
//
// - undeclared: no task_budgets row, no caps enforced (unmetered), and the scope
//   still travels so an undeclared task's internal searches route to its no-row
//   ledger instead of billing the session.
// - established: the row carries the declared caps and the runtime enforces it.
// - declared but failed: a fault, and the run stops before any controlled call.
//
// Degradation: with no task, or no ledger to hand out, an UNDECLARED domain falls
// back to the session form (the shape every unmigrated caller still runs) and
// says so; a DECLARED one faults in the same corner.
//
// Run from tests: pnpm --filter @anysearch-cli/kernel test

import { toBudgetCaps, type BudgetConfig, type TaskBudgetLedger } from "@anysearch-cli/store";
import type { RuntimeErrorReason } from "./runtime";
import type { SessionStorePort } from "./ports";

export interface TaskBudgetWiring {
  /** The established task budget; absent when faulted. Typed concretely (not as
   * TaskBudgetScope) because the hosts' final reports read
   * `ledger.getBalance(taskId)` — a read seam the kernel port doesn't carry,
   * since billing call sites never need it. Present for an undeclared domain
   * too (a no-row ledger); `declared` is what says whether caps were set. */
  taskBudget?: { taskId: string; ledger: TaskBudgetLedger };
  /** THE domain declared `[budget]`. Read this instead of re-reading the config:
   * the wiring already made that decision and a second read can disagree. */
  declared: boolean;
  /** The reason a declared budget could not be established. */
  taskBudgetFault?: string;
  /** The machine-readable class of the same fault, so callers stop guessing. */
  taskBudgetFaultReason?: RuntimeErrorReason;
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
  const declared = budget !== undefined;
  // Design: one shape for every corner. A DECLARED constraint that cannot be
  // established is a fault (S9's third state: stop, never fall open); an
  // UNDECLARED domain in the same corner degrades to the session form and says
  // so once. Four hand-written copies of that pair is exactly the drift the
  // header argues against, so they all go through `stop`.
  //
  // The warn call is isolated: it writes to stderr, and a closed pipe (EPIPE on
  // a piped `ans chat`) must not abort the command it is only trying to inform.
  const say = (message: string): void => {
    try { warn(message); } catch { /* a dead stderr must not break the wiring */ }
  };
  const stop = (faultText: string, degradedText: string): TaskBudgetWiring => {
    if (declared) {
      return { declared, taskBudgetFault: faultText, taskBudgetFaultReason: "budget-not-established" };
    }
    say((taskId ? "task " + taskId + " " : "no registered task ") + degradedText);
    return { declared };
  };
  if (!taskId) {
    // No registered task: the registry's own warning already said why (the CLI
    // and the MCP entry both announce a broken registry), so this corner stays
    // QUIET — a second line on every run would just be noise. A declared
    // [budget] still stops.
    return declared
      ? {
          declared,
          taskBudgetFault: "the main program registered no task to hold this run's budget",
          taskBudgetFaultReason: "budget-not-established",
        }
      : { declared };
  }
  // Design: name the missing STORE and the missing SEAM differently. Both stop a
  // declared run, but they point a debugger at different places, and "lacks
  // createTaskBudgetLedger" about an absent store would send it to the wrong one.
  if (!store) {
    return stop(
      "no session store to hold this run's budget",
      "has no store to bill — falling back to the session form",
    );
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
    return stop(
      "task budget ledger unavailable: " + errText(e),
      "has no usable ledger (" + errText(e) + ") — falling back to the session form",
    );
  }
  if (!ledger) {
    // Declared: the store cannot hold a task budget. Undeclared: no ledger
    // object means there is nothing for the engine's per-call routing to bill,
    // so the declared "scope still travels" cannot hold here — say so once
    // instead of looking exactly like a healthy unmetered run.
    return stop(
      "session store lacks createTaskBudgetLedger",
      "has no ledger seam — internal calls bill the session form",
    );
  }
  if (budget) {
    try {
      ledger.initBudget(taskId, toBudgetCaps(budget));
    } catch (e: unknown) {
      // The FK on task_budgets makes "task was never registered" land here too
      // — the establishment failure the runtime turns into a hard stop. Only a
      // declared budget can reach this, so the degraded text never prints.
      return stop(
        "task budget establishment failed: " + errText(e),
        "could not establish its budget — falling back to the session form",
      );
    }
  }
  return { declared, taskBudget: { taskId, ledger } };
}
