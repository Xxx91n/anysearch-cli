// Lines printed by more than one command, so they cannot drift apart.
import type { CredentialFileContents } from "@anysearch-cli/store";

const REPAIRED = "ans auth repair   (keeps the keys it can read)";
const RESTORED = "ans auth set <provider>   (after fixing or removing the file)";

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

/**
 * Whether `ans auth repair` can help: only a bad record inside a readable file
 * leaves anything to keep. A file that does not parse, or cannot be read at all,
 * is refused by repair too, so pointing there sends the user into the same error.
 */
export function canRepair(file: CredentialFileContents): boolean {
  return file.fault?.kind === "invalid-record";
}

/** The one line a command prints when it exits non-zero over a broken file. */
export function brokenFileHint(file: CredentialFileContents): string {
  return canRepair(file) ? "Fix the file: " + REPAIRED : "Fix or remove the file, then store the keys again: " + RESTORED;
}
