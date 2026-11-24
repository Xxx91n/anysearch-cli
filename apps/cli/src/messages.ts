// Lines printed by more than one command, so they cannot drift apart.
//
// Design: the fault sentence from `readUserCredentials` already ends with what to
// do about it (store owns it, and `credentialFileWarning` hands it to search and
// chat too). A command prints that one sentence and never adds a second wording
// of the fix beside it, so the user reads the way out once.

/** A command that gave up before touching the file. */
export const NOTHING_CHANGED = "Nothing was changed.";

/** A write that landed but failed its access check, said for one command's own subject. */
export function publishedButUnverified(fact: string): string {
  return "The write went through but failed its access check, so the file may " + fact +
    ", or may have been removed taking every other provider's key with it. " +
    "Check it with `ans auth list` before storing anything again.";
}
