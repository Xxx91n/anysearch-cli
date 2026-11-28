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
 * These probes answer about ONE pid on this host. A negative pid addresses a
 * whole process GROUP and answers for the group, not for one process, so do
 * not route it through this module; scripts/probe-process.mjs and
 * scripts/preflight-test.mjs own that question.
 *
 * This module imports nothing, so the config write path can ask about a pid
 * without loading the database binding.
 */
export type PidLiveness = "alive" | "dead" | "unknown";

// Same shape as retriever's isPositiveWholeInt, spelled here because this module
// imports nothing (see above).
export function probePid(pid: number): PidLiveness {
  // Only one positive pid can be answered; anything else is unknown, not a guess.
  if (!Number.isInteger(pid) || pid <= 0) return "unknown";
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

/**
 * True unless the pid is proven gone; see the module comment.
 *
 * `true` means "not proven dead", not "proven alive": a probe that could not
 * classify the pid lands here too, and each caller decides what to do with an
 * unconfirmed owner.
 */
export function pidIsAlive(pid: number): boolean {
  return probePid(pid) !== "dead";
}
