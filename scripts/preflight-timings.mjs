// The gate's own waits, in one place: the gate spends them, and the tests that
// budget for the gate's answer read the same numbers instead of copying them.

/** How long a run that already ended may keep the gate waiting on a pipe holder. */
export const CLOSE_CAP_MS = 10_000;
/** How long the output file gets to flush before it counts as incomplete. */
export const DUMP_FLUSH_MS = 2_000;
/** How long the gate's own output gets to flush before it exits. */
export const FLUSH_MS = 1_000;
