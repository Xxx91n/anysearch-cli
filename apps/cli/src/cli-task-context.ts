// #302: CLI task identity, threaded through the dispatch context.
//
// The main program registers the task (index.ts wraps every command), and the
// command that needs it reads it here — chat needs the task id to establish
// its own per-execution budget. AsyncLocalStorage for the same reason MCP
// uses it for request identity: the handle must survive across awaits without
// becoming a global anyone can write.
//
// Failure mode: AsyncLocalStorage unavailable (very old Node) → falls back to
// undefined and the caller degrades to "no registered task" — same shape as
// a registration failure, handled by the same code path.

import { AsyncLocalStorage } from "node:async_hooks";
import type { TaskRole } from "@anysearch-cli/store";

export interface CliTaskIdentity {
  taskId: string;
  kind: string;
  role: TaskRole;
  /** Attach the context handle (session id) the task ran under, best-effort. */
  attachSession: (sessionId: string) => void;
}

let storage: AsyncLocalStorage<CliTaskIdentity> | undefined;
try {
  storage = new AsyncLocalStorage<CliTaskIdentity>();
} catch { /* unavailable: reads stay undefined */ }

export function runWithCliTask<T>(identity: CliTaskIdentity, fn: () => T): T {
  return storage ? storage.run(identity, fn) : fn();
}

export function currentCliTask(): CliTaskIdentity | undefined {
  return storage?.getStore();
}
