// Lines printed by more than one command, so they cannot drift apart.

/** Printed when a command exits non-zero over a broken credential file. */
export const REPAIR_HINT = "Fix the file: ans auth repair   (keeps the keys it can read)";

/** A command that gave up before touching the file. */
export const NOTHING_CHANGED = "Nothing was changed.";

/** A write that landed but failed its access check, said for one command's own subject. */
export function publishedButUnverified(fact: string): string {
  return "The write went through but failed its access check, so the file may " + fact +
    ", or may have been removed taking every other provider's key with it. " +
    "Check it with `ans auth list` before storing anything again.";
}

/** The same case when the caller cannot tell whether the write landed. */
export const WRITE_OUTCOME_UNKNOWN =
  "The write was refused and it is not clear whether the file was replaced or removed. " +
  "Check it with `ans auth list` before storing anything again.";
