/**
 * Whether a pid is still running.
 *
 * Design: only ESRCH is proof of death — every other outcome counts as
 * "cannot confirm", so the owner is treated as alive. The earlier rule was
 * "any error except EPERM means dead", and that released work on errors that
 * say nothing about liveness: a malformed pid raises
 * ERR_INVALID_ARG_TYPE, and Windows has other probe failures of its own.
 *
 * This module imports nothing: it is the one liveness rule shared by the task
 * ledger and the work-file sweep, and the config write path must not load a
 * database binding to ask whether a pid runs.
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
