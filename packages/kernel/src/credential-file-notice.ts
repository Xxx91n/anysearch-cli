// One plain sentence per credential-file fault kind, plus the record the engine
// publishes.
//
// Design: one sentence table in the kernel, not one per host — `ans search
// --json` and both MCP tools carry this sentence verbatim, and a copy per host
// is how those surfaces drift into three stories about the same file. (The CLI's
// human-readable text is Chinese and keeps its own label; the fact and the
// classification are shared, the wording is not.) Same reason
// `PROVIDER_ERROR_HINTS` exists.
//
// No path and no parse message: the sentence from `readUserCredentials` quotes
// the line/column and, for a bad entry, the provider value it found. This one
// names the kind only, which is all a machine-readable surface may carry
// (#533, spec S2).

import type {
  CredentialFileFault,
  CredentialFileFaultErrno,
  CredentialFileFaultKind,
} from "@anysearch-cli/store";

/** The engine's record: the classification plus the sentence built from it. */
export interface CredentialFileNotice extends CredentialFileFault {
  notice: string;
}

/**
 * Every sentence ends the same way.
 *
 * Design: state the restart as a fact, not as a second imperative — a search
 * command rereads the file on its next run, but an MCP server reads it once at
 * startup, and a host that keeps the stale read is how a user fixes the file and
 * sees no change. Stating it here keeps this sentence from arguing with the
 * "then retry" a CLI reader sees on stderr.
 */
const RESTART = "a running MCP server keeps the old read until it restarts";

/**
 * What the user can do about a read failure, keyed by the errno the file
 * reported: "fix its permissions" is wrong advice for a path that turns out to
 * be a directory or a full disk, and the errno is the one thing that says which.
 * Codes without an entry fall back to the plain "fix it".
 */
const READ_REMEDY: Partial<Record<CredentialFileFaultErrno, string>> = {
  EACCES: "fix its permissions",
  EPERM: "fix its permissions",
  EROFS: "fix its permissions",
  EISDIR: "remove what is at that path and put the key file there",
  ENOTDIR: "fix the path: a parent directory is a file",
  ENAMETOOLONG: "shorten the path",
  ENOSPC: "free some disk space",
  EMFILE: "close some open files and run ans again",
  ENFILE: "close some open files and run ans again",
  EBUSY: "retry once nothing else is using the file",
  ETIMEDOUT: "retry once the file is reachable",
};

/** `{errno}` and `{remedy}` are filled from the fault; no errno leaves both plain. */
export const CREDENTIAL_FILE_HINTS: Record<CredentialFileFaultKind, string> = {
  "not-json":
    "the user credential file is not valid JSON — the keys in it are not in use; " +
    "fix or remove it (" + RESTART + ")",
  "invalid-structure":
    "the user credential file is not a valid key file — the keys in it are not in use; " +
    "fix or remove it (" + RESTART + ")",
  unreadable:
    "the user credential file could not be read{errno} — the keys in it are not in use; " +
    "{remedy} (" + RESTART + ")",
};

export function credentialFileNotice(fault: CredentialFileFault): CredentialFileNotice {
  const notice = CREDENTIAL_FILE_HINTS[fault.kind]
    .replace("{errno}", fault.errno ? " (" + fault.errno + ")" : "")
    .replace("{remedy}", (fault.errno && READ_REMEDY[fault.errno]) ?? "fix it");
  return { ...fault, notice };
}
