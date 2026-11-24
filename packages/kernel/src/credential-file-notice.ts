// The sentence for each credential-file fault kind, plus the record the engine
// publishes.
//
// Design: one table for every surface — `ans search --json` and both MCP tools
// carry the same sentence, and per-host copies drift. The CLI's own text is
// Chinese and keeps its label; only the fact and the classification are shared.
//
// No path, no parse message: the raw error from `readUserCredentials` quotes the
// line/column and sometimes the value it found, so it stays on stderr.

import type {
  CredentialFileFault,
  CredentialFileFaultErrno,
  CredentialFileFaultKind,
} from "@anysearch-cli/store";

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
 * What the user can do, by the errno the file reported: "fix its permissions"
 * is wrong advice for a path that is a directory or a full disk.
 *
 * Design: a total map — adding a code to the closed set fails compilation
 * until someone writes the remedy. The runtime lookup still falls back, because
 * this record can arrive through the public `searchCredentials` seam.
 */
const READ_REMEDY: Record<CredentialFileFaultErrno, string> = {
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
  EIO: "check the disk and retry the read",
};

/**
 * Sentences per kind. `unreadable` is a template with `{errno}` and `{remedy}`
 * slots — read the final text from `credentialFileNotice`, not this table.
 */
export const CREDENTIAL_FILE_HINTS: Record<CredentialFileNoticeKind, string> = {
  "not-json":
    "the user credential file is not valid JSON — the keys in it are not in use; " +
    "fix or remove it (" + RESTART + ")",
  "invalid-structure":
    "the user credential file is not a valid key file — the keys in it are not in use; " +
    "fix or remove it (" + RESTART + ")",
  unreadable:
    "the user credential file could not be read{errno} — the keys in it are not in use; " +
    "{remedy} (" + RESTART + ")",
  unknown:
    "the user credential file could not be used; fix or remove it (" + RESTART + ")",
};

export function credentialFileNotice(fault: CredentialFileFault): CredentialFileNotice {
  // The record can arrive through the public `searchCredentials` seam, so a kind
  // or code this build does not know is mapped into the closed sets, not
  // forwarded. Own-property lookups keep `"toString"` off the prototype.
  const kind: CredentialFileNoticeKind = Object.hasOwn(CREDENTIAL_FILE_HINTS, fault.kind)
    ? fault.kind
    : "unknown";
  const errno = kind === "unreadable" && fault.errno && Object.hasOwn(READ_REMEDY, fault.errno)
    ? fault.errno
    : undefined;
  const notice = CREDENTIAL_FILE_HINTS[kind]
    .replace("{errno}", errno ? " (" + errno + ")" : "")
    .replace("{remedy}", errno ? READ_REMEDY[errno] : "fix it");
  return errno ? { kind, errno, notice } : { kind, notice };
}
