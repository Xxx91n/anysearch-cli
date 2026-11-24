// Lines printed by more than one command, so they cannot drift apart.
import type { CredentialFileContents } from "@anysearch-cli/store";

const REPAIRED = "Fix the file: ans auth repair   (keeps the keys it can read)";
const STORE_AGAIN = "store the key again: ans auth set <provider>";

/** A command that gave up before touching the file. */
export const NOTHING_CHANGED = "Nothing was changed.";

/** A write that landed but failed its access check, said for one command's own subject. */
export function publishedButUnverified(fact: string): string {
  return "The write went through but failed its access check, so the file may " + fact +
    ", or may have been removed taking every other provider's key with it. " +
    "Check it with `ans auth list` before storing anything again.";
}

/**
 * Whether `ans auth repair` can help: only a bad record inside a readable file
 * leaves anything to keep. A file that does not parse, or cannot be read at all,
 * is refused by repair too, so pointing there sends the user into the same error.
 */
export function canRepair(file: CredentialFileContents): boolean {
  return file.fault?.kind === "invalid-record";
}

/**
 * The one line a command prints when it exits non-zero over a broken file.
 * A read failure keeps its own advice: on a full disk the file is fine, and
 * telling the user to remove it would take every other key with it.
 */
export function brokenFileHint(file: CredentialFileContents): string {
  if (canRepair(file)) return REPAIRED;
  if (file.fault?.kind === "unreadable") return "Fix what the line above says, then " + STORE_AGAIN;
  return "Fix or remove the file, then " + STORE_AGAIN;
}
