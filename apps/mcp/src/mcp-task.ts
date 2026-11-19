// One MCP tool call is one task.
//
// A resident server's lifetime is a process fact, not work; what an upgrade has
// to wait out is one tool call, including its late work (background summaries,
// settlement, the observation write). So the task row is ended AFTER the handler
// resolves — a cancellation ends the wait, not the work. Registration is
// fail-open like the CLI's; a declared [budget] that cannot be attached is the
// one thing that stops the run. A standalone `ans-mcp` entry still registers no
// process record of its own (#309).

import { AsyncLocalStorage } from "node:async_hooks";
import { isBudgetStopReason, type CompositionResult } from "@anysearch-cli/kernel";
import { AdmissionClosedError, type RegisteredTask, type TaskRegistry } from "@anysearch-cli/store";

/** The task this MCP tool call runs under. Read via `currentMcpTask()`. */
export interface McpTaskIdentity {
  taskId: string;
  /** e.g. "mcp.ans_chat" — the registry's kind column. */
  kind: string;
  /** Best-effort context link: which conversation handle this call used. */
  attachSession(sessionId: string): void;
}

/** What the caller is told about the task's end. */
export interface McpTaskCloseout {
  taskId: string;
  kind: string;
  /**
   * Whether the record's end was written — NOT how the turn went. `"ended"`
   * says the row is closed, `"open"` says the end write failed and the record
   * stays open on purpose (an upgrade must see it as a blocker, not read a
   * missing row as "nothing was running"). The outcome lives in `exitCode` and
   * `interrupted`, so a caller cannot mistake a cut-off turn for a clean one by
   * reading this field alone.
   */
  state: "ended" | "open";
  exitCode: number;
  /** The answer stopped early (cancelled / run interrupted); late work still finished before this closeout was written. */
  interrupted: boolean;
}

interface Tracking {
  identity?: McpTaskIdentity;
  /**
   * Set when an upgrade closed admission and this call was refused: the handler
   * must not run. Distinct from `!identity`, which is a broken registry and
   * still runs (fail-open). Filled by `trackMcpToolCall`, read by `withMcpTask`.
   */
  refusal?: AdmissionClosedError;
  /** End the task row. Returns false when the write failed (record stays open). */
  finish(exitCode: number): boolean;
}

const storage = new AsyncLocalStorage<McpTaskIdentity>();

export function currentMcpTask(): McpTaskIdentity | undefined {
  // No optional chain on purpose: `storage` is a module constant, so the only
  // two answers are "no identity in this async context" or a live one.
  return storage.getStore();
}

// Dedupe per failure reason, same discipline (and bound) as the ans_chat
// session wiring: a long-lived stateless host calls this per request, and a
// broken registry must not print one line per call.
const WARNED_MAX = 32;
const warned = new Set<string>();

/** Test hook: forget which task-registration failures were already announced. */
export function resetMcpTaskWarnings(): void {
  warned.clear();
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function warnOnce(key: string, detail: string): void {
  if (warned.has(key)) return;
  if (warned.size >= WARNED_MAX) warned.clear();
  warned.add(key);
  // stdout stays protocol-pure for MCP; a dead stderr must not break the call.
  try {
    process.stderr.write("[anysearch] mcp task registration: " + detail + "\n");
  } catch {
    /* fail-open */
  }
}

/**
 * Register this call, or say why it runs unregistered and return undefined.
 *
 * #309: an admission refusal is returned separately — it is a decision, not a
 * broken registry, and the call must NOT run. Every other failure keeps the
 * fail-open contract (a broken registry never breaks the tool).
 */
function registerTask(
  eng: CompositionResult,
  kind: string,
): { task: RegisteredTask } | { refusal: AdmissionClosedError } | undefined {
  let registry: TaskRegistry | undefined;
  try {
    // The registry comes from the store seam, so the task record and its budget
    // row are written through the engine's own connection.
    registry = eng.store?.createTaskRegistry?.();
  } catch (e: unknown) {
    warnOnce("seam:" + errText(e),
      "task registry unavailable (" + errText(e) + ") — running unregistered");
    return undefined;
  }
  if (!registry) {
    warnOnce("no-seam", "store has no task registry seam — running unregistered");
    return undefined;
  }
  try {
    return { task: registry.registerTask({ kind, role: "business", entry: "mcp" }) };
  } catch (e: unknown) {
    if (e instanceof AdmissionClosedError) return { refusal: e };
    warnOnce("register:" + errText(e),
      "task registration failed (" + errText(e) + ") — running unregistered");
    return undefined;
  }
}

/**
 * Register this tool call as a business task. An unregistered call still runs:
 * a broken registry never breaks the tool.
 *
 * Not exported: `withMcpTask` is the only thing allowed to decide what a
 * refusal means. An exported refusal field would be optional at every call site,
 * and one caller forgetting to look turns the admission gate off silently.
 */
function trackMcpToolCall(eng: CompositionResult, toolName: string): Tracking {
  const kind = "mcp." + toolName;
  const registered = registerTask(eng, kind);
  if (registered && "refusal" in registered) return { refusal: registered.refusal, finish: () => false };
  const task = registered?.task;
  if (!task) return { finish: () => false };
  let finished = false;
  let wroteEnd = false;
  return {
    identity: {
      taskId: task.taskId,
      kind,
      attachSession: (sessionId: string): void => {
        try {
          if (!finished) task.attachSession(sessionId);
        } catch { /* best-effort link; the task still bills on its own */ }
      },
    },
    finish: (exitCode: number): boolean => {
      if (finished) return wroteEnd;
      finished = true;
      try {
        task.finish({ exitCode });
        wroteEnd = true;
      } catch (e: unknown) {
        // The closeout is the only place a failed end write becomes visible, and
        // error paths do not carry one (#204). Name the task, its kind and the
        // exit code here too, so an upgrade admission (#309) has a discoverable
        // stderr signal instead of a silently open row.
        warnOnce("finish:" + errText(e),
          "task " + task.taskId + " (" + kind + ") end write failed with exit " + exitCode +
          " (" + errText(e) + ") — the record stays open");
        wroteEnd = false;
      }
      return wroteEnd;
    },
  };
}

/**
 * #309: the answer for a call refused by upgrade admission.
 *
 * `errorKind: "upgrade-in-progress"` is a classification the host can switch on
 * (like the budget stops); the text says the same in words for a human. No
 * taskId: this call never had a task, and inventing one would make a refusal
 * look like work that ran and stopped.
 */
function refusalResult(toolName: string, refusal: AdmissionClosedError): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  return {
    isError: true,
    content: [{
      type: "text",
      text: toolName + ": upgrade in progress — this call was refused before it started. " +
        "It is NOT queued and will not be replayed; retry after the upgrade finishes. (" +
        refusal.message + ")",
    }],
    structuredContent: {
      operation: toolName,
      errorKind: "upgrade-in-progress",
      upgrade: { admitted: false, gate: refusal.gate },
    },
  };
}

/** One reading of a tool result, so the exit code and the closeout cannot disagree. */
interface ResultVerdict {
  isError: boolean;
  interrupted: boolean;
  /** A budget or domain stop: an error the handler classified for the host. */
  classifiedStop: boolean;
  structuredContent?: Record<string, unknown>;
}

function readVerdict(result: unknown): ResultVerdict {
  // Design: the handler owns the result's shape (the SDK's callback result is an
  // open object), so this reads defensively rather than trusting a type the
  // wrapper cannot check.
  const readable = result && typeof result === "object"
    ? (result as { isError?: boolean; structuredContent?: Record<string, unknown> })
    : undefined;
  const structuredContent = readable?.structuredContent;
  // Only a stop classification earns a closeout. An error that carries other
  // structuredContent (the rebuild report, for one) keeps its shape untouched.
  const errorKind = structuredContent?.errorKind;
  const classifiedStop = isBudgetStopReason(errorKind) || errorKind === "domain-not-established";
  return {
    isError: readable?.isError === true,
    interrupted: structuredContent?.interrupted === true,
    classifiedStop,
    ...(structuredContent ? { structuredContent } : {}),
  };
}

function attachCloseout<R>(
  result: R,
  identity: McpTaskIdentity,
  verdict: ResultVerdict,
  wroteEnd: boolean,
  exitCode: number,
): R {
  // #204 keeps ERROR results out of the success output schema. A classified
  // stop (budget or domain) carries structuredContent and gets the closeout so
  // the caller knows which task it belonged to; every other error stays bare,
  // including one that carries structuredContent for its own reasons.
  if (verdict.isError && !verdict.classifiedStop) return result;
  // A handler may still return a bare string; spreading one would replace it
  // with an object. Leave non-object results exactly as they are.
  if (!result || typeof result !== "object") return result;
  const closeout: McpTaskCloseout = {
    taskId: identity.taskId,
    kind: identity.kind,
    state: wroteEnd ? "ended" : "open",
    exitCode,
    interrupted: verdict.interrupted,
  };
  // The MCP callback result type is opaque to this module (the SDK declares an
  // open object), which is why the round-trip through Record goes through
  // `unknown`.
  return {
    ...(result as unknown as Record<string, unknown>),
    structuredContent: { ...(verdict.structuredContent ?? {}), closeout },
  } as unknown as R;
}

/**
 * Run one tool handler under a registered task: register (fail-open), run the
 * handler inside the task context, await its late work, write the end, then
 * attach the closeout (best-effort).
 *
 * A handler that throws ends the task as failed and the error propagates
 * unchanged. A handler that stops early because the caller cancelled must say
 * so (`interrupted: true`) — the wrapper cannot infer it, since a bare empty
 * result looks identical to a real one.
 */
export async function withMcpTask<R>(
  eng: CompositionResult,
  toolName: string,
  handler: () => Promise<R>,
): Promise<R> {
  const tracking = trackMcpToolCall(eng, toolName);
  // #309: refused before the handler runs and before any provider request. The
  // answer is a structured classification, not prose a host has to parse, and
  // there is deliberately no task row: nothing ran, so nothing is left open to
  // block the upgrade that refused it.
  // The MCP callback result type is opaque to this module (the SDK declares an
  // open object), so the refusal result is cast the same way attachCloseout
  // casts its spread — the shape is ours, the generic is the caller's.
  if (tracking.refusal) return refusalResult(toolName, tracking.refusal) as unknown as R;
  const identity = tracking.identity;
  let result: R;
  try {
    result = identity ? await storage.run(identity, handler) : await handler();
  } catch (e) {
    // A throw anywhere in the handler — the run itself or its late work — ends
    // the task as failed, because that is what the caller sees: the SDK turns an
    // uncaught throw into an error result. The run's own usage was already
    // settled on the way out, so exit 1 is about the failed CALL, not lost spend.
    tracking.finish(1);
    throw e;
  }
  let verdict: ResultVerdict;
  try {
    verdict = readVerdict(result);
  } catch {
    // An unreadable result is treated as a failed call: the row records exit 1
    // and the caller still gets the handler's own result unchanged.
    tracking.finish(1);
    return result;
  }
  // An interrupted answer is not a completed task — the run stopped before its
  // final answer, so the record carries exit 1 even though the tool result is
  // not an error (#211 keeps the handle and reports unknown usage).
  const exitCode = verdict.isError || verdict.interrupted ? 1 : 0;
  const wroteEnd = tracking.finish(exitCode);
  if (!identity) return result;
  try {
    return attachCloseout(result, identity, verdict, wroteEnd, exitCode);
  } catch {
    return result;
  }
}
