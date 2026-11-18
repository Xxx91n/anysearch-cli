// #303 — one MCP tool call is one task.
//
// Why this exists: an MCP server is a resident process. `ans mcp` registers the
// process once (#302), and registering the server's whole lifetime as a task
// would be exactly the "permanently unfinished task" the registry was built to
// avoid. What a later upgrade admission (#309) has to wait for is the work: one
// tool call, from the moment the handler starts to the moment its late work is
// really done.
//
// The late work is the point of this module. A reply is not the end of a task:
// background summaries, the settlement of what the run already spent, and the
// observation write all happen around it. The task row is therefore ended
// AFTER the handler's promise resolves — `flushMemory()` is awaited inside the
// handler and `observeTool()` wraps it — so a cancelled request cannot leave a
// finished-looking task with settlement still in flight. A cancellation ends
// the WAIT, not the work (spec S6).
//
// Fail-open, like the CLI's registration: a store without the registry seam, or
// a registry that throws, warns on stderr and the call runs unregistered. The
// one downstream consequence is the same as #302's: a declared [budget] that
// cannot be attached to a task is a fault the run stops on (see
// wireTaskBudget), never a silent unmetered run.
//
// Reuse: `withMcpTask` is the entry point for the tools that have not migrated
// yet (MCP search / research / standalone consolidate, #304). Wrapping a
// handler is the whole migration step for the task identity; the budget wiring
// is independent and each tool opts in by reading `currentMcpTask()`.

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
 * `state: "finished"` is not decoration: it is written only after the handler
 * resolved, which means the late settlement, the background summaries and the
 * observation write are done. `state: "open"` means the end write failed — the
 * record stays open on purpose (an upgrade must see it as a blocker, not read a
 * missing row as "nothing was running").
 */
export interface McpTaskCloseout {
  taskId: string;
  kind: string;
  state: "finished" | "open";
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
  return storage?.getStore();
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
  } catch (e: any) {
    warnOnce("register:" + (e?.message || String(e)),
      "task registration failed (" + (e?.message || String(e)) + ") — running unregistered");
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
      } catch (e: any) {
        warnOnce("finish:" + (e?.message || String(e)),
          "task end write failed (" + (e?.message || String(e)) + ") — the record stays open");
        wroteEnd = false;
      }
      return wroteEnd;
    },
  };
}

/** The result shape a wrapper can read back: MCP's callback result. */
interface AttachableResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

function asAttachable(result: unknown): AttachableResult | undefined {
  return result && typeof result === "object" ? (result as AttachableResult) : undefined;
}

function attachCloseout<R>(result: R, identity: McpTaskIdentity, wroteEnd: boolean, exitCode: number): R {
  const readable = asAttachable(result);
  // #204 keeps ERROR results free of structuredContent (the error channel and
  // the output schema stay apart). A budget stop is the one exception, because
  // #303 requires it to be machine-distinguishable from an upstream failure —
  // that result already carries its own structuredContent and gets the
  // closeout added to it. A generic error result stays bare.
  const isError = readable?.isError === true;
  if (isError && readable?.structuredContent === undefined) return result;
  const closeout: McpTaskCloseout = {
    taskId: identity.taskId,
    kind: identity.kind,
    state: wroteEnd ? "finished" : "open",
    exitCode,
    interrupted: readable?.structuredContent?.interrupted === true,
  };
  return {
    ...(result as unknown as Record<string, unknown>),
    structuredContent: { ...(readable?.structuredContent ?? {}), closeout },
  } as unknown as R;
}

/**
 * Run one tool handler under a registered task.
 *
 * Order matters and is the whole contract:
 * 1. register (fail-open: a broken registry never breaks the call),
 * 2. run the handler inside the task context so it can read `currentMcpTask()`,
 * 3. await it — this is the late work; `flushMemory()` and `observeTool()` are
 *    inside there,
 * 4. write the task's end with the outcome's exit code,
 * 5. hand the closeout back in the result.
 *
 * A handler that throws ends the task as failed (exit 1) and the error
 * propagates unchanged — the wrapper does not turn a throw into a result.
 */
export async function withMcpTask<R>(
  eng: CompositionResult,
  toolName: string,
  handler: (task: McpTaskIdentity | undefined) => Promise<R>,
): Promise<R> {
  const tracking = trackMcpToolCall(eng, toolName);
  const identity = tracking.identity;
  let result: R;
  try {
    result = identity ? await storage.run(identity, () => handler(identity)) : await handler(undefined);
  } catch (e) {
    tracking.finish(1);
    throw e;
  }
  const readable = asAttachable(result);
  // An interrupted answer is not a completed task: the run stopped before its
  // final answer, so the record carries exit 1 even though the tool result is
  // not an error (#211 keeps the handle and reports unknown usage). A later
  // admission (#309) must not read a cut-off turn as clean work.
  const interrupted = readable?.structuredContent?.interrupted === true;
  const failed = readable?.isError === true || interrupted;
  const exitCode = failed ? 1 : 0;
  const wroteEnd = tracking.finish(exitCode);
  return identity ? attachCloseout(result, identity, wroteEnd, exitCode) : result;
}
