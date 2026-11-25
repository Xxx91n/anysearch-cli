// One plain sentence per error class saying what to do next (`unknown` has
// none). `{wait}` is filled by the caller from the arm's retry-after.
//
// Design: one table in the kernel, not one per host — both hosts print these
// sentences, and a copy per host is how the two drift apart.
import type { ProviderErrorClass } from "@anysearch-cli/retriever";
import { REMOVE_KEY_COMMAND } from "@anysearch-cli/store";

export const PROVIDER_ERROR_HINTS: Record<ProviderErrorClass, string | undefined> = {
  "quota-exhausted": "the key is fine but the plan is used up — top up or upgrade; retrying or swapping the key will not help",
  "free-quota-exhausted": "the free quota is used up — wait {wait} and retry, or add a key for this provider",
  "permanent-auth": "no key is set, or the key is wrong or lacks permission — set a valid one, or delete the key (unset the env var, or " +
    REMOVE_KEY_COMMAND + ") to run on the free quota",
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
