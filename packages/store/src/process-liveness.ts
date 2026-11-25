/**
 * Whether a pid is still running. Only ESRCH proves death; every other error
 * means the probe could not confirm, so the owner counts as alive — a malformed
 * pid raises ERR_INVALID_ARG_TYPE, and Windows has other probe failures.
 *
 * This module imports nothing, so the config write path can ask about a pid
 * without loading the database binding.
 */
export function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code !== "ESRCH";
  }
}
