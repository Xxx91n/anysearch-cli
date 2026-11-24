// The sentence for each credential-file fault kind, plus the record the engine
// publishes.
//
// Design: one table for every surface — `ans search --json` and both MCP tools
// carry the same sentence, and per-host copies drift. The CLI's own text is
// Chinese and keeps its label; only the fact and the classification are shared.
//
// No path, no parse message: the raw error from `readUserCredentials` quotes the
// line/column and sometimes the value it found, so it stays on stderr.

import { FIX_OR_REPLACE, isCredentialFaultErrno, KEEP_KEYS, readFaultRemedy } from "@anysearch-cli/store";
import type { CredentialFileFault, CredentialFileFaultKind } from "@anysearch-cli/store";

/**
 * The published classification: the reader's kinds, plus `unknown` when a
 * public seam reported a kind this build does not recognize.
 */
export type CredentialFileNoticeKind = CredentialFileFaultKind | "unknown";

/** The engine's record: the classification plus the sentence built from it. */
export interface CredentialFileNotice extends Omit<CredentialFileFault, "kind"> {
  kind: CredentialFileNoticeKind;
  /** Wording for people. Branch on `kind`/`errno`, never on this string. */
  notice: string;
}

/** A search command rereads the file on its next run; an MCP server reads it once at startup. */
const RESTART = "a running MCP server keeps the old read until it restarts";

/**
 * Sentences per kind. `unreadable` is a template with `{errno}` and `{remedy}`
 * slots — read the final text from `credentialFileNotice`, not this table.
 *
 * Repair is promised only for `invalid-record`: a file that does not parse, or
 * cannot be read at all, has nothing left for it to keep.
 */
export const CREDENTIAL_FILE_HINTS: Record<CredentialFileNoticeKind, string> = {
  "not-json":
    "the user credential file is not valid JSON — the keys in it are not in use; " +
    FIX_OR_REPLACE + " (" + RESTART + ")",
  "invalid-structure":
    "the user credential file is not a valid key file — the keys in it are not in use; " +
    FIX_OR_REPLACE + " (" + RESTART + ")",
  "invalid-record":
    "one record in the user credential file cannot be read, so none of its keys are in use; " +
    FIX_OR_REPLACE + ", " + KEEP_KEYS + " (" + RESTART + ")",
  unreadable:
    "the user credential file could not be read{errno} — the keys in it are not in use; " +
    "{remedy} (" + RESTART + ")",
  unknown:
    "the user credential file could not be used; " + FIX_OR_REPLACE + " (" + RESTART + ")",
};

export function credentialFileNotice(fault: CredentialFileFault): CredentialFileNotice {
  // The record can arrive through the public `searchCredentials` seam, so a kind
  // or code this build does not know is mapped into the closed sets, not
  // forwarded. Own-property lookups keep `"toString"` off the prototype.
  const kind: CredentialFileNoticeKind = Object.hasOwn(CREDENTIAL_FILE_HINTS, fault.kind)
    ? fault.kind
    : "unknown";
  const errno = kind === "unreadable" && isCredentialFaultErrno(fault.errno) ? fault.errno : undefined;
  const notice = CREDENTIAL_FILE_HINTS[kind]
    .replace("{errno}", errno ? " (" + errno + ")" : "")
    .replace("{remedy}", readFaultRemedy(errno));
  return errno ? { kind, errno, notice } : { kind, notice };
}
