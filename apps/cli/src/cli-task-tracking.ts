// #302: the main program's uniform task registration.
//
// Every CLI command dispatch goes through here: the process itself is
// registered as a process record, and each command invocation is registered
// as a task record with a role. That is what "统一登记" buys — a command added
// to the dispatch table tomorrow is registered without anyone remembering to
// write registration code for it, which is the whole point of upgrade
// admission (#309) being able to rely on the registry.
//
// Classification:
// - process entry commands (today: `mcp`) register ONLY a process record.
//   A resident MCP server's lifetime is a process fact, not a business task —
//   registering it as a task would be exactly the "permanently unfinished
//   task" the registry exists to avoid. Its business work is per-request
//   tasks (#303).
// - business commands do real work an upgrade must wait out.
// - management commands are status/diagnostic/config operations. They are
//   registered too — with role='management' — so an admission pause can keep
//   them usable (#309 reads the role; this layer only records the fact).
//
// Failure behavior: three outcomes, deliberately kept apart.
// - a broken registry warns on stderr and the command runs unregistered;
// - an upgrade closing admission is NOT a failure. It comes back as
//   `admissionRefusal` and the entry decides the exit code (index.ts: exit 4,
//   handler never runs). Squashing it into the fail-open branch would start the
//   very work the gate exists to refuse;
// - downstream, a chat whose domain declares [budget] cannot establish a task
//   budget without a registered task, and that run stops (see
//   commands/chat-task-budget.ts).
//
// Run from tests: pnpm --filter @anysearch-cli/cli test

import { resolveDbPath } from "@anysearch-cli/kernel";
import { AdmissionClosedError, ensureOwnerOnlyDb, openTaskRegistry, type RegisteredProcess, type RegisteredTask, type TaskRegistry, type TaskRole } from "@anysearch-cli/store";
import { runWithCliTask, type CliTaskIdentity } from "./cli-task-context";

/**
 * Commands whose invocation IS a host process rather than one business task.
 * They register a process record only.
 */
const PROCESS_ENTRY_COMMANDS = new Set(["mcp"]);

/**
 * Commands that are status/diagnostic/config operations rather than work an
 * upgrade must wait out. Everything not listed here registers as business —
 * the conservative default, so an unknown NEW command is visible to a future
 * admission gate instead of invisible to it.
 */
const MANAGEMENT_COMMANDS = new Set([
  "doctor", "auth", "llm", "domain", "switch-state", "access-chain", "hitl",
  // #309: the upgrade commands themselves must work while admission is closed —
  // they are how a paused upgrade is inspected, waited on, and ended.
  "upgrade",
]);

export function cliTaskKind(cmd: string): string {
  return "cli." + cmd;
}

export function cliTaskRole(cmd: string): TaskRole {
  return MANAGEMENT_COMMANDS.has(cmd) ? "management" : "business";
}

export interface CliCommandTracking {
  /** Run the handler inside the task context; absent when no task registered. */
  task?: {
    run<T>(fn: () => T): T;
    /** Record the task's end with the handler's exit code. Idempotent. */
    finish(exitCode: number): void;
  };
  /**
   * #309: set when an upgrade closed admission and this command's work was
   * refused. The handler must NOT run: the entry stops with its own message
   * and exit code instead of degrading to an unregistered run (which would be
   * exactly the "check then start" gap the gate exists to close).
   */
  admissionRefusal?: AdmissionClosedError;
  /** Close the process record; called on the exit path before teardown. */
  endProcess(): void;
}

function warnOnce(msg: string): void {
  try {
    process.stderr.write("[warn] " + msg + "\n");
  } catch { /* stderr unavailable */ }
}

/**
 * One registration write with the warning-not-blocker contract: a thrown write
 * degrades to `undefined` (nothing registered) plus a named stderr line, so
 * the command still runs — the same shape an un-openable registry produces.
 *
 * Exported for tests the same way wireChatMemory/wireChatTaskBudget are: the
 * guard is a wiring unit, and its contract (throw -> degraded, never escapes)
 * is what a broken-registry day actually exercises.
 */
export function tryRegister<T>(write: () => T, label: string): T | undefined {
  try {
    return write();
  } catch (e: any) {
    warnOnce(label + " failed (" + (e?.message || String(e)) + ") — continuing without " + label);
    return undefined;
  }
}

/**
 * Register this CLI invocation: a process record for the process, and — unless
 * the command is a process entry — a task record for the command's work.
 *
 * The registry shares the durable DB (ANS_DB_PATH / ~/.ans/anysearch.db)
 * with the engine, on its own connection, opened with the same owner-only
 * hygiene createPersistentEngine applies. Opening it here means every command
 * now touches the DB — including commands that never did — which is the cost
 * of uniform registration; it is bounded (one open + idempotent schema).
 */
export function trackCliCommand(cmd: string): CliCommandTracking {
  let registry: TaskRegistry;
  try {
    const dbPath = resolveDbPath();
    ensureOwnerOnlyDb(dbPath);
    registry = openTaskRegistry(dbPath);
  } catch (e: any) {
    warnOnce(
      "task registry unavailable (" + (e?.message || String(e)) +
      ") — continuing without task registration",
    );
    return { endProcess: () => { /* nothing registered */ } };
  }
  // #302: registration failures are warnings, not blockers — a broken registry
  // must not stop `doctor` or any other command from running. That applies to
  // the writes too, not only the open: a registry that opened but cannot write
  // (a contended DB lock, a full disk) throws here, and the same degraded
  // shape comes back — no task, no process record, the command runs on.
  const processRecord: RegisteredProcess | undefined = tryRegister(
    () => registry.registerProcess({ entry: "cli" }),
    "process registration",
  );
  let taskRecord: RegisteredTask | undefined;
  let identity: CliTaskIdentity | undefined;
  let admissionRefusal: AdmissionClosedError | undefined;
  if (!PROCESS_ENTRY_COMMANDS.has(cmd)) {
    const kind = cliTaskKind(cmd);
    const role = cliTaskRole(cmd);
    // #309: an admission refusal is a DECISION, not a broken registry, so it is
    // not squashed into the fail-open branch. It comes back as its own field and
    // the entry stops; every other write failure keeps the old "warn and run
    // unregistered" behavior.
    try {
      taskRecord = registry.registerTask({ kind, role, entry: "cli" });
    } catch (e) {
      if (e instanceof AdmissionClosedError) admissionRefusal = e;
      else warnOnce("task registration failed (" + (e instanceof Error ? e.message : String(e)) + ") — continuing without task registration");
    }
    if (taskRecord) {
      identity = { taskId: taskRecord.taskId, kind, role, attachSession: (s) => taskRecord!.attachSession(s) };
    }
  }
  return {
    task: identity
      ? {
          run: <T,>(fn: () => T): T => runWithCliTask(identity!, fn),
          finish: (exitCode: number): void => {
            try {
              taskRecord!.finish({ exitCode });
            } catch (e: any) {
              warnOnce("task end registration failed (" + (e?.message || String(e)) + ")");
            }
          },
        }
      : undefined,
    ...(admissionRefusal ? { admissionRefusal } : {}),
    endProcess: (): void => {
      try {
        processRecord?.end();
      } catch { /* already ended or the store closed first */ }
    },
  };
}
