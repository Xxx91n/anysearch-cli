// One plain sentence per credential-file fault kind, plus the record the engine
// publishes.
//
// Design: one sentence table in the kernel, not one per host — `ans search
// --json`, both MCP tools and the CLI text all read it, and a copy per host is
// how three surfaces drift into three stories about the same file. Same reason
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
 * Design: say "restart", not "retry" — a search command rereads the file on its
 * next run, but an MCP server reads it once at startup, and the old "...; then
 * retry" wording left a host that keeps the stale read as the way a user fixes
 * the file and sees no change.
 */
const RESTART = "then restart ans (an MCP server reads the file once, at startup)";

/**
 * What the user can do about a read failure. Keyed by errno because "fix its
 * permissions" is wrong advice for a path that is a directory or a full disk,
 * and the errno is the one thing here that says which it is.
 */
const READ_REMEDY: Partial<Record<CredentialFileFaultErrno, string>> = {
  EACCES: "fix its permissions",
  EPERM: "fix its permissions",
  EROFS: "fix its permissions",
  EISDIR: "put the key file where that path expects one",
  ENOTDIR: "put the key file where that path expects one",
  ENOSPC: "free some disk space",
};

/** `{errno}` and `{remedy}` are filled from the fault; an unknown code leaves both plain. */
export const CREDENTIAL_FILE_HINTS: Record<CredentialFileFaultKind, string> = {
  "not-json":
    "the user credential file is not valid JSON — the keys in it are not in use; " +
    "fix or remove it, " + RESTART,
  "invalid-structure":
    "the user credential file is not a valid key file — the keys in it are not in use; " +
    "fix or remove it, " + RESTART,
  unreadable:
    "the user credential file could not be read{errno} — the keys in it are not in use; " +
    "{remedy}, " + RESTART,
};

export function credentialFileNotice(fault: CredentialFileFault): CredentialFileNotice {
  const notice = CREDENTIAL_FILE_HINTS[fault.kind]
    .replace("{errno}", fault.errno ? " (" + fault.errno + ")" : "")
    .replace("{remedy}", (fault.errno && READ_REMEDY[fault.errno]) ?? "fix it");
  return { ...fault, notice };
}
