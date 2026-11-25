/**
 * One pid-liveness probe for the whole product (#570).
 *
 * Only ESRCH proves death. Every other error means the probe could not confirm
 * the state: EPERM is a process that exists for another user, a malformed pid
 * raises ERR_INVALID_ARG_TYPE, and Windows has other probe failures. A caller
 * that only needs "may I treat the owner as gone?" uses `pidIsAlive`; a caller
 * that must word a user-facing message (the skill lock) uses `probePid` to tell
 * a live holder from an owner it cannot confirm.
 *
 * This module imports nothing, so the config write path can ask about a pid
 * without loading the database binding.
 */
export type PidLiveness = "alive" | "dead" | "unknown";

export function probePid(pid: number): PidLiveness {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === "ESRCH") return "dead";
    // EPERM: the process exists but belongs to another user.
    if (code === "EPERM") return "alive";
    return "unknown";
  }
}

/** True unless the pid is proven gone; see the module comment. */
export function pidIsAlive(pid: number): boolean {
  return probePid(pid) !== "dead";
}
