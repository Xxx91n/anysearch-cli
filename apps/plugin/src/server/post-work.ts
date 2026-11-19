// 钩子服务自己的后置工作（#307）。
//
// 钩子进程一次工具事件就退出，它要办的活（写项目索引、读策略时补审计）在
// 这个长驻服务里办。以前这两件事没有任务记录，升级看不出服务里还有活在跑。
//
// 做了三件事：
// - 每个单元登记一条 origin=follow-up 的任务行，干完或失败才写结束（失败记 1）；
// - /index 等这条行收尾再回话，/policy 的审计等回话出去之后才开工；
// - registry 打不开就照常干活，只在 stderr 说一句，服务不停。
//
// 后置工作不是新请求：它因为别的请求结束才存在，可以等父任务结束之后再开始。
// 父任务号只记真有的那行，查不到就记「不知道」，不编。

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

export interface PostWorkOptions<T = unknown> {
  /** Context handle the HTTP request carried (x-anysearch-session-id), if any. */
  sessionId?: string;
  /** The task this work belongs to, when the caller could name one. */
  parentTaskId?: string;
  /**
   * Whether the work's own result says it failed.
   *
   * #307 review: work that reports a failure by RETURNING (a write helper that
   * stays fail-open, a per-entry loop that counts rejected rows) would otherwise
   * end the task as exit 0 — a record claiming success over a reported problem.
   * A work function that throws needs nothing here.
   */
  isFailure?: (result: T) => boolean;
}

// 去重同一句话，别在长驻服务里每次请求刷一行。这是一份有界去重的小工具，
// CLI（cli-task-tracking.ts）和 MCP（mcp-task.ts）各有一份同形的。三份都留在
// 各自的包里，是因为它们分别是独立打包的入口，为这点逻辑新建一个共用模块要把
// store 变成日志源头，那是跨包重构，不属于这张票。前缀各带各的模块名，读日志时
// 能分清是谁在抱怨。
const WARNED_MAX = 32;
const warned = new Set<string>();

function warnOnce(message: string): void {
  if (warned.has(message)) return;
  if (warned.size >= WARNED_MAX) warned.clear();
  warned.add(message);
  try { process.stderr.write("[anysearch] post-work: " + message + "\n"); } catch { /* dead stderr */ }
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
  run<T>(kind: string, opts: PostWorkOptions<T>, work: () => T | Promise<T>): Promise<{ result: T; outcome: PostWorkOutcome }>;
  /** Register this service's own lifetime as a process record (not a task). */
  start(): void;
  /**
   * Run one unit later: count it NOW, start the work after this turn ends.
   *
   * The count happens here, not inside the deferred body, so a stop signal that
   * lands between "answer sent" and "unit started" still sees the unit and
   * waits. Counting only registered units made `drain()` answer "empty" in that
   * window and the queued unit was then dropped by the exit — the exact loss
   * the gate exists to prevent.
   */
  runLater<T>(kind: string, opts: PostWorkOptions<T>, work: () => T | Promise<T>): void;
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
  // Two counters, on purpose: `inFlight` counts units whose work has started,
  // `scheduled` counts units promised by runLater that have not started yet.
  // `pending()` and `drain()` read their sum, so a stop signal in the gap
  // between "answer sent" and "work started" still waits — and a single unit is
  // still counted as ONE, not two.
  let inFlight = 0;
  let scheduled = 0;
  const total = (): number => inFlight + scheduled;
  const waiters = new Set<() => void>();
  const release = (): void => {
    for (const done of waiters) done();
  };
  const settle = (): void => {
    inFlight -= 1;
    release();
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
    async run<T>(kind: string, opts: PostWorkOptions<T>, work: () => T | Promise<T>): Promise<{ result: T; outcome: PostWorkOutcome }> {
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
          warnOnce("post-work task registration failed for " + kind + " (" + errText(e) + ") — running unregistered");
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
          warnOnce("post-work task " + task!.taskId + " (" + kind + ") end write failed with exit " + exitCode +
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
        // A work function that reports its failure by returning still has to
        // end the row as failed — otherwise the record claims success over a
        // reported problem (#307 review).
        const failed = opts.isFailure ? opts.isFailure(result) : false;
        return { result, outcome: close(failed ? 1 : 0) };
      } finally {
        settle();
      }
    },
    pending(): number {
      return total();
    },
    runLater<T>(kind: string, opts: PostWorkOptions<T>, work: () => T | Promise<T>): void {
      // Count first: the unit exists from this moment, even though its work
      // starts a turn later. It goes to `scheduled`, NOT `inFlight` — the work
      // has not started, and when it does, run() takes its own count. Adding to
      // inFlight here would count one unit twice and make the shutdown message
      // claim two units are stuck when one is.
      scheduled += 1;
      setImmediate(() => {
        scheduled -= 1;
        // A unit leaving the scheduled bucket may be the last one, so wake the
        // drain waiters before the work even starts.
        if (inFlight === 0) release();
        void this.run<T>(kind, opts, work)
          .catch((e: unknown) => {
            // run() already ended the row (or the registry failed); this line is
            // for the operator.
            try {
              process.stderr.write("[anysearch] post-work " + kind + " failed: " + errText(e) + "\n");
            } catch { /* dead stderr */ }
          });
      });
    },
    drain(timeoutMs: number): Promise<boolean> {
      if (total() === 0) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        let done = false;
        const finish = (value: boolean): void => {
          if (done) return;
          done = true;
          waiters.delete(onSettle);
          clearTimeout(timer);
          resolve(value);
        };
        const onSettle = (): void => { if (total() === 0) finish(true); };
        // NOT unref'd on purpose (#307 review, CI-caught on ubuntu): this timer
        // is the only thing that can answer when the work never settles. An
        // unref'd timer lets the event loop run dry while the promise is still
        // pending, and the caller is then reported as "resolution still pending
        // but the event loop has already resolved". The wait is bounded by
        // design, so holding the loop for it is the correct cost.
        const timer = setTimeout(() => finish(false), timeoutMs);
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
