// Lines printed by more than one command, so they cannot drift apart.

/** Printed when a command exits non-zero over a broken credential file. */
export const REPAIR_HINT = "Fix the file: ans auth repair   (keeps the keys it can read)";

/** A command that gave up before touching the file. */
export const NOTHING_CHANGED = "Nothing was changed.";

/** A write that landed but failed its access check: the file may be new, or gone. */
export const PUBLISHED_BUT_UNVERIFIED =
  "The write went through but failed its access check, so the file may hold the new key or have been removed. " +
  "Check it with `ans auth list`, then store the key again if needed.";
