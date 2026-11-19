// The per-execution task budget every paid entry bills one run to: `ans chat`,
// MCP `ans_chat`, `ans search`, MCP `search_web` / `research_web`, and
// `ans consolidate` (#302/#303/#304).
//
// Three states:
// - undeclared: no task_budgets row and no caps. The scope still travels, so the
//   run's internal calls route to its task instead of the session.
// - established: the row carries the declared caps and the runtime enforces them.
// - declared but failed: a fault; the run stops before any controlled call.
//
// Degradation: with no task to bill, or no ledger to hand out, an UNDECLARED
// domain runs without a task budget and says so once; a DECLARED one faults in
// the same corner. The sentence after the dash is the host's: chat keeps its
// session form, a bare search is simply unmetered (see WireTaskBudgetOptions).
// The scope travels only in the established case — the fallback has no ledger
// object to route anything to.

import { toBudgetCaps, type BudgetConfig, type TaskBudgetLedger } from "@anysearch-cli/store";
import type { BudgetStopReason, RuntimeErrorReason } from "./runtime";
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
  taskBudgetFaultReason?: BudgetStopReason;
}

/**
 * The runtime reasons that mean "a budget stopped this run".
 *
 * Keyed by the kernel union, so adding a reason there is a type error here until
 * this table says whether it is a budget stop. #306 added
 * `domain-not-established`, which is a stop but not a budget one: it must not
 * be reported as a cap the caller should raise.
 */
const BUDGET_STOP_REASONS: Record<RuntimeErrorReason, boolean> = {
  "budget-not-established": true,
  "budget-rejected": true,
  "domain-not-established": false,
};

export function isBudgetStopReason(value: unknown): value is BudgetStopReason {
  return typeof value === "string"
    && Object.hasOwn(BUDGET_STOP_REASONS, value)
    && BUDGET_STOP_REASONS[value as RuntimeErrorReason];
}

export interface WireTaskBudgetOptions {
  /**
   * What the host really does when no task budget can be attached. The fallback
   * differs by entry point — `ans_chat` keeps billing its session form, while a
   * bare search has no session account at all — so the host supplies the
   * sentence instead of the kernel guessing (review finding): a log line that
   * says "unmetered" for chat would be false, and one that says "session form"
   * for search would be too.
   */
  fallbackText?: string;
  /**
   * Where a degradation is reported. `key` names that corner without the task
   * id, so a long-lived host can dedupe without parsing the message. Defaults
   * to a no-op so unit tests stay quiet.
   */
  warn?: (message: string, key: string) => void;
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
  // One shape for every corner: a declared cap that cannot be established is a
  // fault (stop, never fail open); the same corner with no declaration runs
  // without a task budget and says so once.
  //
  // The warn call is isolated: the sink is caller-supplied and writes to stderr,
  // and neither a dead pipe nor a sink bug may abort the command.
  const say = (message: string, key: string): void => {
    try { warn(message, key); } catch { /* a dead stderr must not break the wiring */ }
  };
  const fallback = opts.fallbackText ?? "this run has no task budget";
  const stop = (faultText: string, causeText: string, key: string): TaskBudgetWiring => {
    if (declared) {
      return { declared, taskBudgetFault: faultText, taskBudgetFaultReason: "budget-not-established" };
    }
    say("task " + taskId + " " + causeText + " — " + fallback, key);
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
  // Name the missing STORE and the missing SEAM differently. Both stop a
  // declared run, but they point a debugger at different places.
  if (!store) {
    return stop(
      "no session store to hold this run's budget",
      "has no store to bill",
      "no-store",
    );
  }
  let ledger: TaskBudgetLedger | undefined;
  try {
    // Optional seam, same discipline as initBudget: a hand-built store without it
    // cannot hold a task budget, which for a declared [budget] is a fault.
    ledger = store.createTaskBudgetLedger?.();
  } catch (e: unknown) {
    // The ledger cannot even be constructed (broken store connection). Declared:
    // "declared but failed to establish". Undeclared: the runtime reports any
    // later ledger fault by name, so the wiring must not crash here.
    return stop(
      "task budget ledger unavailable: " + errText(e),
      "has no usable ledger (" + errText(e) + ")",
      "no-ledger",
    );
  }
  if (!ledger) {
    return stop(
      "session store lacks createTaskBudgetLedger",
      "has no ledger seam",
      "no-ledger",
    );
  }
  if (budget) {
    try {
      ledger.initBudget(taskId, toBudgetCaps(budget));
    } catch (e: unknown) {
      // The FK on task_budgets makes "task was never registered" land here too.
      // Only a declared budget reaches this, so there is no degraded text.
      return stop("task budget establishment failed: " + errText(e), "", "establish-failed");
    }
  }
  return { declared, taskBudget: { taskId, ledger } };
}
