// #304: one paid MCP tool call is one task, and the Active Domain's [budget]
// caps that task's run.
//
// search_web and research_web share this wiring so the two cannot answer
// "was this call metered?" or "did a budget stop it?" differently. The task
// itself is registered by withMcpTask; this module only decides the budget:

// - established: a task row with the declared caps; the engine's per-call
//   reserve/settle lands on it, and every research round draws from the SAME
//   row (the automatic internal steps share one quota).
// - undeclared: the scope still travels (a no-row ledger); nothing is capped
//   and nothing is invented.
// - declared but not established: a fault. The call stops before any provider
//   request, and the answer says why in machine-readable form.
//
// Materials from several sessions or no session at all do not change any of
// this: the run bills its own task, so there is no "first chat" to charge.
//
// Design: one shared wiring for both search tools — two copies would drift on
// "was this call metered?" and "why did it stop?", the same failure the kernel's
// wireTaskBudget exists to prevent.

import {
  wireTaskBudget,
  type CompositionResult,
  type BudgetStopReason,
  type TaskBudgetWiring,
} from "@anysearch-cli/kernel";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { currentMcpTask } from "../mcp-task.js";

// A resident MCP server would print the degradation line on every call while
// the store stays broken, so dedupe by corner: the key omits the per-call task
// id even though the message text names it.
const WARNED_MAX = 16;
const warned = new Set<string>();

/** Test hook: forget which budget degradations were already announced. */
export function resetToolBudgetWarnings(): void {
  warned.clear();
}

function warnDegraded(message: string, key: string): void {
  if (warned.has(key)) return;
  if (warned.size >= WARNED_MAX) warned.clear();
  warned.add(key);
  // stdout stays protocol-pure for MCP; a dead stderr must not break the call.
  try {
    process.stderr.write("[anysearch] " + message + "\n");
  } catch { /* fail-open */ }
}

/** Establish this call's task budget from the Active Domain's [budget]. */
export function establishToolBudget(eng: CompositionResult): TaskBudgetWiring {
  return wireTaskBudget(eng.store, currentMcpTask()?.taskId, eng.config?.budget, {
    warn: warnDegraded,
    // A bare search has no session account: the fallback is not "session form".
    fallbackText: "this call is unmetered",
  });
}

/**
 * The one place both search tools ask "may this call run, and on which
 * budget?". `stop` is the ready-made answer for a declared budget that could
 * not be established; otherwise `taskBudget` is the scope to pass to the
 * engine (absent for a call with no registered task).
 */
export function beginToolBudget(
  eng: CompositionResult,
  toolName: string,
): { stop: CallToolResult } | { taskBudget: TaskBudgetWiring["taskBudget"] } {
  const wiring = establishToolBudget(eng);
  if (wiring.taskBudgetFault) {
    return {
      stop: toolBudgetStop(
        toolName,
        wiring.taskBudgetFaultReason ?? "budget-not-established",
        wiring.taskBudgetFault,
      ),
    };
  }
  return { taskBudget: wiring.taskBudget };
}

/**
 * The result for a call refused because the Active Domain could not be read:
 * classified in structuredContent so a host can switch on it without reading
 * prose, and carrying the task id plus whatever the run already spent. It is
 * not a `budget` stop — the fix is to repair the TOML, not to raise a cap.
 */
export function toolDomainStop(
  toolName: string,
  detail: string,
  extra: { taskId?: string; usage?: unknown } = {},
): CallToolResult {
  const task = extra.taskId ?? currentMcpTask()?.taskId;
  return {
    isError: true,
    content: [{ type: "text", text: toolName + "：" + detail }],
    structuredContent: {
      operation: toolName,
      errorKind: "domain-not-established",
      domain: { stopped: true, detail },
      ...(task ? { taskId: task } : {}),
      ...(extra.usage !== undefined ? { usage: extra.usage } : {}),
    },
  };
}

/**
 * The structured answer for a budget stop: isError carries "this call did not
 * finish", and structuredContent carries the machine-readable class. The task
 * wrapper attaches the closeout to exactly this shape (#303), so a host can
 * tell a budget stop from an upstream failure without reading prose.
 */
export function toolBudgetStop(
  toolName: string,
  kind: BudgetStopReason,
  detail: string,
): CallToolResult {
  const notEstablished = kind === "budget-not-established";
  const label = notEstablished
    ? "this call's task budget could not be established"
    : "this call was stopped by its task budget";
  // Say what the stop cost without claiming more than is known: an unbuildable
  // budget stops before anything runs; a refusal stops at the provider call it
  // could not reserve, so earlier spend stays on the task's row (a research
  // call's earlier rounds are exactly that case).
  const tail = notEstablished
    ? "\nNo provider request was sent for this call."
    : "\nThe call stopped at the provider request its budget refused; anything already spent stays on the task's row.";
  const task = currentMcpTask();
  return {
    isError: true,
    content: [{ type: "text", text: toolName + ": " + label + " — " + detail + tail }],
    structuredContent: {
      operation: toolName,
      errorKind: kind,
      budget: {
        stopped: true,
        reason: notEstablished ? "not-established" : "rejected",
        detail,
      },
      ...(task ? { taskId: task.taskId } : {}),
    },
  };
}
