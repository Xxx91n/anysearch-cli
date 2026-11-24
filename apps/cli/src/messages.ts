// Lines printed by more than one command, so they cannot drift apart.
import { REPAIR_COMMAND, type CredentialFileContents } from "@anysearch-cli/store";

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
 * What a user can do about a broken file. One decision for every command: only a
 * bad record inside a readable file leaves anything to keep, and a file that
 * cannot be read at all gets its own advice, because on a full disk the file is
 * fine and removing it would take every other key with it.
 */
export type FaultAdvice = "repair" | "read" | "replace";

export function faultAdvice(file: CredentialFileContents): FaultAdvice {
  if (file.fault?.kind === "invalid-record") return "repair";
  if (file.fault?.kind === "unreadable") return "read";
  return "replace";
}

/** The one line a command prints when it exits non-zero over a broken file. */
export function brokenFileHint(file: CredentialFileContents): string {
  switch (faultAdvice(file)) {
    case "repair":
      return "Fix the file: " + REPAIR_COMMAND + "   (keeps the keys it can read)";
    case "read":
      return "Fix what the read error says, then " + STORE_AGAIN;
    case "replace":
      return "Fix or remove the file, then " + STORE_AGAIN;
  }
}
