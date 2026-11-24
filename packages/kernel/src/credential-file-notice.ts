// One plain sentence per credential-file fault kind, plus the record the engine
// publishes. Same rule as PROVIDER_ERROR_HINTS: one table in the kernel, not one
// per host - `ans search --json`, both MCP tools and the CLI text read this, so
// three surfaces cannot drift into three stories about the same file.
//
// No path and no parse message: the sentence from `readUserCredentials` quotes
// the line/column and, for a bad entry, the provider value it found. This one
// names the kind only, which is all a machine-readable surface may carry
// (#533, spec S2).

import type { CredentialFileFault, CredentialFileFaultKind } from "@anysearch-cli/store";

/** The engine's record: the classification plus the sentence built from it. */
export interface CredentialFileNotice extends CredentialFileFault {
  notice: string;
}

/**
 * Every sentence ends the same way. A search command rereads the file on its
 * next run, but an MCP server reads it once at startup - the old "...; then
 * retry" wording was wrong there, and a host that keeps the stale read is
 * exactly how a user fixes the file and sees no change.
 */
const RESTART = "then restart ans (an MCP server reads the file once, at startup)";

/** `{errno}` is filled from the fault; empty when the read failure gave no known code. */
export const CREDENTIAL_FILE_HINTS: Record<CredentialFileFaultKind, string> = {
  "not-json":
    "the user credential file is not valid JSON — the keys in it are not in use; " +
    "fix or remove it, " + RESTART,
  "invalid-structure":
    "the user credential file is not a valid key file — the keys in it are not in use; " +
    "fix or remove it, " + RESTART,
  unreadable:
    "the user credential file could not be read{errno} — the keys in it are not in use; " +
    "fix its permissions, " + RESTART,
};

export function credentialFileNotice(fault: CredentialFileFault): CredentialFileNotice {
  const notice = CREDENTIAL_FILE_HINTS[fault.kind]
    .replace("{errno}", fault.errno ? " (" + fault.errno + ")" : "");
  return { ...fault, notice };
}
