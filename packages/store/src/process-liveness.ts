/**
 * Whether a pid is still running.
 *
 * Design: only ESRCH is proof of death; every other outcome means "cannot
 * confirm", so the owner counts as alive. Do not narrow this to EPERM — a
 * malformed pid raises ERR_INVALID_ARG_TYPE, and Windows has other probe
 * failures of its own.
 *
 * This module imports nothing, so the config write path can ask about a pid
 * without loading the database binding.
 */
export function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // ESRCH: no such process. Anything else (EPERM, a malformed pid, an
    // unexpected probe failure) is unconfirmed and treated as still holding.
    return (e as NodeJS.ErrnoException)?.code !== "ESRCH";
  }
}
