// One plain sentence per error class saying what to do next; `unknown` has
// none. The table lives here rather than in one host, because both hosts print
// it: the MCP tools append it to the all-failed text, and `ans search` prints
// it under the "Providers failed" line.
//
// A sentence may carry `{wait}`: the classes whose remedy names a wait fill it
// with the arm's retry-after ("3600 seconds") or with "a moment" when the
// upstream did not say. The wait value is per arm, so it cannot be baked into
// the table.
//
// Design: the table lives in the kernel rather than in one host — both print
// it (MCP appends it to the all-failed text, `ans search` prints it under
// "Providers failed"), and a copy per host is how the two drift apart.
import type { ProviderErrorClass } from "@anysearch-cli/retriever";

export const PROVIDER_ERROR_HINTS: Record<ProviderErrorClass, string | undefined> = {
  "quota-exhausted": "the key is fine but the plan is used up — top up or upgrade; retrying or swapping the key will not help",
  "free-quota-exhausted": "the free quota is used up — wait {wait} and retry, or add a key for this provider",
  "permanent-auth": "no key is set, or the key is wrong or lacks permission — set a valid one",
  "transient": "the upstream had a temporary problem — retry in a moment",
  "permanent-protocol": "the upstream reply could not be read — check what it returned",
  "session-expired": "the session ended — re-initialize the connection",
  "unknown": undefined,
};

/**
 * That class's sentence with `{wait}` filled from the arm's retry-after.
 * Without a number the sentence says "a moment" instead of inventing one.
 */
export function providerErrorHint(cls: ProviderErrorClass, retryAfterSeconds?: number): string | undefined {
  const sentence = PROVIDER_ERROR_HINTS[cls];
  if (!sentence) return undefined;
  if (!sentence.includes("{wait}")) return sentence;
  // Design: a missing number says "a moment" — the reader still gets an
  // action, and the template's braces never reach the output.
  const known = retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0;
  return sentence.replace("{wait}", known ? retryAfterSeconds + " seconds" : "a moment");
}

/** provider id → plain-language remedy, for failed arms whose class has one. */
export function providerErrorHints(
  providersFailed: readonly string[],
  providerErrorClasses?: Record<string, ProviderErrorClass>,
  retryAfter?: Record<string, number>,
): Record<string, string> {
  const hints: Record<string, string> = {};
  for (const id of providersFailed) {
    const cls = providerErrorClasses?.[id];
    const hint = cls ? providerErrorHint(cls, retryAfter?.[id]) : undefined;
    if (hint) hints[id] = hint;
  }
  return hints;
}
