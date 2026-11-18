// #303 — one MCP tool call is one task.
//
// A resident server's lifetime is a process fact, not work; what an upgrade has
// to wait out is one tool call, including its late work (background summaries,
// settlement, the observation write). So the task row is ended AFTER the handler
// resolves — a cancellation ends the wait, not the work. Registration is
// fail-open like the CLI's; a declared [budget] that cannot be attached is the
// one thing that stops the run. `withMcpTask` is also the migration point for
// the tools still on the session form (#304).

import { AsyncLocalStorage } from "node:async_hooks";
import type { CompositionResult } from "@anysearch-cli/kernel";
import type { RegisteredTask } from "@anysearch-cli/store";

/** The task this MCP tool call runs under. Read via `currentMcpTask()`. */
export interface McpTaskIdentity {
  taskId: string;
  /** e.g. "mcp.ans_chat" — the registry's kind column. */
  kind: string;
  /** Best-effort context link: which conversation handle this call used. */
  attachSession(sessionId: string): void;
}

/**
 * What the caller is told about the task's end (#303).
 *
 * The end is written only after the handler resolved, which means the background
 * summaries and the observation write are done. One tail can still land
 * afterwards: a provider stream that never closed books its usage later (#188),
 * and `structuredContent.lateSettlement` says whether that already happened or
 * is still on its way.
 */
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
 * Register this tool call as a business task.
 *
 * The registry comes from the store seam, so the task record and the task's
 * budget row are written through the engine's own connection (one database,
 * one set of statements) and a test's temp store registers into its temp file.
 */
export function trackMcpToolCall(eng: CompositionResult, toolName: string): Tracking {
  const kind = "mcp." + toolName;
  let record: RegisteredTask | undefined;
  try {
    const registry = eng.store?.createTaskRegistry?.();
    if (!registry) {
      warnOnce("no-seam", "store has no task registry seam — running unregistered");
      return { finish: () => false };
    }
    record = registry.registerTask({ kind, role: "business", entry: "mcp" });
  } catch (e: unknown) {
    warnOnce("register:" + errText(e),
      "task registration failed (" + errText(e) + ") — running unregistered");
    return { finish: () => false };
  }
  if (!record) {
    // Unreachable in practice (registerTask either returns or throws), kept so
    // the writer below never runs on an absent record.
    return { finish: () => false };
  }
  const task: RegisteredTask = record;
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

/** One reading of a tool result, so the exit code and the closeout cannot disagree. */
interface ResultVerdict {
  isError: boolean;
  interrupted: boolean;
  /** A budget stop — the one error shape that carries a closeout (#303). */
  budgetStop: boolean;
  structuredContent?: Record<string, unknown>;
}

function readVerdict(result: unknown): ResultVerdict {
  const readable = result && typeof result === "object"
    ? (result as { isError?: boolean; structuredContent?: Record<string, unknown> })
    : undefined;
  const structuredContent = readable?.structuredContent;
  const errorKind = structuredContent?.errorKind;
  return {
    isError: readable?.isError === true,
    interrupted: structuredContent?.interrupted === true,
    budgetStop: errorKind === "budget-rejected" || errorKind === "budget-not-established",
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
  // Design: #204 keeps ERROR results out of the success output schema. Only two
  // error shapes carry structuredContent at all, and a closeout belongs on just
  // one of them:
  // - a budget stop (`errorKind`) is the exception #303 adds, because it must
  //   be machine-distinguishable from an upstream failure — it gets the
  //   closeout;
  // - the summary-rebuild report (#264) is an error that already carries
  //   `summaryRebuilds`; mixing a task block in would change a shape clients
  //   parse, so it is left alone.
  // Every other error stays bare. The task record is still written and ended in
  // all three cases — the row is where the closeout lives.
  if (verdict.isError && !verdict.budgetStop) return result;
  // A handler is free to return a non-object (a future #304 tool might hand back
  // a bare string): spreading one would silently replace it with an object and
  // lose the original. Leave such a result exactly as it is — the task row is
  // still written and ended above.
  if (!result || typeof result !== "object") return result;
  const closeout: McpTaskCloseout = {
    taskId: identity.taskId,
    kind: identity.kind,
    state: wroteEnd ? "ended" : "open",
    exitCode,
    interrupted: verdict.interrupted,
  };
  return {
    ...(result as unknown as Record<string, unknown>),
    structuredContent: { ...(verdict.structuredContent ?? {}), closeout },
  } as unknown as R;
}

/**
 * Run one tool handler under a registered task.
 *
 * Order matters and is the whole contract:
 * 1. register (fail-open: a broken registry never breaks the call),
 * 2. run the handler inside the task context so it can read `currentMcpTask()`
 *    — one channel, not a parameter and a context that could disagree,
 * 3. await it — this is the late work; `flushMemory()` and `observeTool()` are
 *    inside there,
 * 4. write the task's end with the outcome's exit code,
 * 5. hand the closeout back in the result.
 *
 * A handler that throws ends the task as failed (exit 1) and the error
 * propagates unchanged — the wrapper does not turn a throw into a result.
 *
 * Handler contract: a handler that stops early because the caller cancelled
 * must say so in its result (`structuredContent.interrupted: true`). The
 * wrapper cannot infer it — a bare empty result looks identical to a real one,
 * and treating the request signal as the answer would misreport an answer that
 * completed just as the caller hung up. `ans_chat` does this on every
 * cancellation path (`buildAnsChatCancelledResult`); a tool that migrates later
 * (#304) must do the same.
 */
export async function withMcpTask<R>(
  eng: CompositionResult,
  toolName: string,
  handler: () => Promise<R>,
): Promise<R> {
  const tracking = trackMcpToolCall(eng, toolName);
  const identity = tracking.identity;
  let result: R;
  try {
    result = identity ? await storage.run(identity, handler) : await handler();
  } catch (e) {
    // Design: a throw anywhere in the handler — the run itself or its late work
    // — ends the task as failed, because that is what the caller sees: the SDK
    // turns an uncaught throw into an error result. The run's own usage was
    // already settled on the way out (flushMemory / the runtime's finally), so
    // the record's exit 1 is about the failed CALL, not about a lost bill.
    tracking.finish(1);
    throw e;
  }
  const verdict = readVerdict(result);
  // Design: an interrupted answer is not a completed task — the run stopped
  // before its final answer, so the record carries exit 1 even though the tool
  // result is not an error (#211 keeps the handle and reports unknown usage).
  // A later admission (#309) must not read a cut-off turn as clean work.
  const exitCode = verdict.isError || verdict.interrupted ? 1 : 0;
  const wroteEnd = tracking.finish(exitCode);
  return identity ? attachCloseout(result, identity, verdict, wroteEnd, exitCode) : result;
}
