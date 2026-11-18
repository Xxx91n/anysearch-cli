// #307: the hook service's own post-work, run under the same task lifecycle as
// every other entry point.
//
// A hook process lives for one tool event and exits; the work it asks for (a
// project-index write, the policy audit that rides a /policy read) runs HERE,
// in the long-lived service. Before #307 those writes had no task record at
// all, so an upgrade could not tell "the hook service is still writing" from
// "nothing is running" — and the policy audit was fire-and-forget, so the
// response could return before its row landed.
//
// Shape of the fix:
// - every post-work unit registers a task row (role=business, origin=follow-up)
//   in the shared durable DB, and its END is written only after the work
//   finished (or failed) — the HTTP response is sent after that.
// - the row is a follow-up, not a new independent request: a reader can tell
//   "this exists because another call finished" from "a caller asked for this".
// - the parent link is written only when a real parent row is named; the hook
//   service cannot see another process's task id today, so a follow-up usually
//   records no link rather than an invented one (the registry verifies the id
//   and degrades to "unknown" when the row does not exist).
// - a follow-up registration never waits for the parent to end and is allowed
//   while it is still open: late work belongs to the task that caused it, and
//   #309's admission decides about NEW independent tasks, not about the tail of
//   an old one.
//
// Failure behavior: a broken registry must not break the service. Registration
// and the end write are fail-open (a stderr line names what degraded); the work
// itself runs either way. This mirrors the CLI (#302) and MCP (#303) wiring.

import { ensureOwnerOnlyDb, openTaskRegistry, type RegisteredProcess, type RegisteredTask, type TaskRegistry } from "@anysearch-cli/store";

/** What a caller is told about one post-work unit, for the service's own logs. */
export interface PostWorkOutcome {
  /** The task this unit ran as, when the registry was usable. */
  taskId?: string;
  /** How the parent link landed — see RegisteredTask.parentLink. */
  parentLink: "linked" | "unknown" | "none";
  /**
   * Whether the record's end was written. "unregistered" means no row exists
   * at all (the registry is broken and the work ran anyway).
   */
  state: "ended" | "open" | "unregistered";
  exitCode: number;
}

export interface PostWorkOptions {
  /** Context handle the HTTP request carried (x-anysearch-session-id), if any. */
  sessionId?: string;
  /** The task this work belongs to, when the caller could name one. */
  parentTaskId?: string;
  /** Where a degradation is reported. Defaults to stderr with a fixed prefix. */
  warn?: (message: string) => void;
}

const WARNED_MAX = 32;
const warned = new Set<string>();

function warnOnce(message: string): void {
  if (warned.has(message)) return;
  if (warned.size >= WARNED_MAX) warned.clear();
  warned.add(message);
  // The service's stdout is not a host protocol (only the hooks write stdout),
  // but stderr is where every other warning in this process goes.
  try { process.stderr.write("[anysearch] " + message + "\n"); } catch { /* dead stderr */ }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * The service's task registry, opened on its own connection to the shared
 * durable DB.
 *
 * Undefined when it cannot be opened: the service still answers, and each
 * endpoint keeps the behavior it had before #307. The failure is named once.
 */
export function openPostWorkRegistry(dbPath: string): TaskRegistry | undefined {
  try {
    ensureOwnerOnlyDb(dbPath);
    return openTaskRegistry(dbPath);
  } catch (e: unknown) {
    warnOnce("post-work registry unavailable (" + errText(e) + ") — hooks still run, their work is unregistered");
    return undefined;
  }
}

/** One open service: the registry plus the process row that names this lifetime. */
export interface PostWorkTracker {
  /**
   * Run one unit of post-work under a follow-up task.
   *
   * The task is registered before `work` runs and ended after it settles, so
   * the end write is a statement about the work, never about the request
   * starting. A throw ends the task as failed (exit 1) and propagates unchanged.
   */
  run<T>(kind: string, opts: PostWorkOptions, work: () => T | Promise<T>): Promise<{ result: T; outcome: PostWorkOutcome }>;
  /** Register this service's own lifetime as a process record (not a task). */
  start(): void;
  /** How many units are running right now. */
  pending(): number;
  /**
   * Wait until every running unit settled (bounded by `timeoutMs`).
   *
   * Used on shutdown so a stop signal does not cut a write in half: the
   * caller waits, then closes resources. The return value says whether the
   * wait succeeded — `false` means work is still running and the caller must
   * report that instead of pretending the service drained.
   */
  drain(timeoutMs: number): Promise<boolean>;
  /**
   * Write the process end, then close the registry. A registry borrowed for the
   * service's lifetime is closed here, not by whichever endpoint runs last.
   */
  stop(): void;
}

/**
 * Build the service's tracker. Pass no registry to run with post-work
 * unregistered (the shape a broken registry produces) — the service stays up.
 */
export function createPostWorkTracker(registry: TaskRegistry | undefined): PostWorkTracker {
  let processRecord: RegisteredProcess | undefined;
  let inFlight = 0;
  const waiters = new Set<() => void>();
  const settle = (): void => {
    inFlight -= 1;
    for (const done of waiters) done();
  };
  return {
    start(): void {
      if (!registry) return;
      try {
        processRecord = registry.registerProcess({ entry: "server" });
      } catch (e: unknown) {
        warnOnce("process registration failed (" + errText(e) + ") — this service runs unrecorded");
      }
    },
    async run<T>(kind: string, opts: PostWorkOptions, work: () => T | Promise<T>): Promise<{ result: T; outcome: PostWorkOutcome }> {
      const warn = opts.warn ?? warnOnce;
      let task: RegisteredTask | undefined;
      if (registry) {
        try {
          task = registry.registerTask({
            kind,
            role: "business",
            entry: "server",
            origin: "follow-up",
            ...(opts.parentTaskId ? { parentTaskId: opts.parentTaskId } : {}),
          });
          if (opts.sessionId) {
            try { task.attachSession(opts.sessionId); } catch { /* best-effort link */ }
          }
        } catch (e: unknown) {
          warn("post-work task registration failed for " + kind + " (" + errText(e) + ") — running unregistered");
          task = undefined;
        }
      }
      if (!task) {
        inFlight += 1;
        try {
          return { result: await work(), outcome: { parentLink: "none", state: "unregistered", exitCode: 0 } };
        } finally {
          settle();
        }
      }
      // One closeout per unit: both paths go through it, so the row cannot be
      // left open on the success path while an error path writes its end.
      const close = (exitCode: number): PostWorkOutcome => {
        let state: PostWorkOutcome["state"] = "ended";
        try {
          task!.finish({ exitCode });
        } catch (e: unknown) {
          state = "open";
          warn("post-work task " + task!.taskId + " (" + kind + ") end write failed with exit " + exitCode +
            " (" + errText(e) + ") — the record stays open");
        }
        return { taskId: task!.taskId, parentLink: task!.parentLink, state, exitCode };
      };
      inFlight += 1;
      try {
        let result: T;
        try {
          result = await work();
        } catch (e: unknown) {
          close(1);
          throw e;
        }
        return { result, outcome: close(0) };
      } finally {
        settle();
      }
    },
    pending(): number {
      return inFlight;
    },
    drain(timeoutMs: number): Promise<boolean> {
      if (inFlight === 0) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        let done = false;
        const finish = (value: boolean): void => {
          if (done) return;
          done = true;
          waiters.delete(onSettle);
          clearTimeout(timer);
          resolve(value);
        };
        const onSettle = (): void => { if (inFlight === 0) finish(true); };
        const timer = setTimeout(() => finish(false), timeoutMs);
        timer.unref?.();
        waiters.add(onSettle);
      });
    },
    stop(): void {
      try { processRecord?.end(); } catch { /* already ended */ }
      try { registry?.close(); } catch { /* already closed */ }
    },
  };
}

/** Test hook: forget which post-work degradations were already announced. */
export function resetPostWorkWarnings(): void {
  warned.clear();
}
