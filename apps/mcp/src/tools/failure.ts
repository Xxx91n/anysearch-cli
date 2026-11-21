// MCP execution-result semantics (#204): per the MCP specification a tool
// EXECUTION failure is a result with isError:true and actionable text, while a
// protocol fault stays a JSON-RPC error. Empty results are not failures.
//
// Error results deliberately carry no structuredContent: the error channel and
// the output schema stay separate. A partial search (at least one arm answered)
// is a success whose content and structuredContent name the degraded arms.
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { CompositionResult } from "@anysearch-cli/kernel";
import type { ProviderErrorClass } from "@anysearch-cli/retriever";

/** Execution-failure result: isError true, text content, no structuredContent. */
export function toolFailure(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

/** Execution-failure result with the surface's stable "<tool> error: " prefix. */
export function toolError(toolName: string, detail: string): CallToolResult {
  return toolFailure(toolName + " error: " + detail);
}

export interface ProviderFailureMetadata {
  providersFailed: string[];
  providerErrorClasses: Record<string, ProviderErrorClass>;
  providerErrorHints?: Record<string, string>;
  providerBuildErrors: Record<string, string>;
}

/**
 * One plain sentence per error class saying who has to act, so the reader does
 * not have to know what `quota-exhausted` means. `unknown` has no entry on
 * purpose: there is nothing honest to say about an error nobody classified.
 */
const PROVIDER_ERROR_HINTS: Record<ProviderErrorClass, string | undefined> = {
  "quota-exhausted": "the key is fine but the plan is used up — top up or upgrade; retrying or swapping the key will not help",
  "permanent-auth": "the key is wrong or lacks permission — replace it with a valid one; retrying will not help",
  "transient": "the upstream had a temporary problem — retry in a moment",
  "permanent-protocol": "the upstream reply could not be read — check for a newer version",
  "session-expired": "the session ended — re-initialize the connection",
  "unknown": undefined,
};

/** provider id → plain-language remedy, for failed arms whose class has one. */
export function providerErrorHints(
  providersFailed: readonly string[],
  providerErrorClasses?: Record<string, ProviderErrorClass>,
): Record<string, string> {
  const hints: Record<string, string> = {};
  for (const id of providersFailed) {
    const cls = providerErrorClasses?.[id];
    const hint = cls ? PROVIDER_ERROR_HINTS[cls] : undefined;
    if (hint) hints[id] = hint;
  }
  return hints;
}

/**
 * Failure metadata for a result that is still a success (at least one arm
 * answered). Runtime failures and construction-time build faults travel
 * together so a host can audit the whole chain. Undefined when every arm is
 * healthy, which keeps the output shape of a clean search unchanged.
 */
export function providerFailureMetadata(
  eng: CompositionResult,
  providersFailed: string[],
  providerErrorClasses?: Record<string, ProviderErrorClass>,
): ProviderFailureMetadata | undefined {
  const buildErrors = eng.providerBuildErrors ?? {};
  if (providersFailed.length === 0 && Object.keys(buildErrors).length === 0) return undefined;
  const hints = providerErrorHints(providersFailed, providerErrorClasses);
  return {
    providersFailed: [...providersFailed],
    providerErrorClasses: { ...(providerErrorClasses ?? {}) },
    ...(Object.keys(hints).length > 0 ? { providerErrorHints: hints } : {}),
    providerBuildErrors: { ...buildErrors },
  };
}

/**
 * True when every queried arm failed: a provider outage, not an empty search.
 * Zero queried arms cannot be an outage, and a cancelled arm is a transport
 * outcome rather than a failure, so neither satisfies this predicate alone.
 */
export function allProvidersFailed(
  providersQueried: readonly string[],
  providersFailed: readonly string[],
): boolean {
  if (providersQueried.length === 0) return false;
  return providersQueried.every((id) => providersFailed.includes(id));
}

/**
 * Actionable all-provider-outage text that names the failed arms and says what
 * to do about each class the reader can act on.
 */
export function allProvidersFailedText(
  toolName: string,
  providersFailed: readonly string[],
  providerErrorClasses?: Record<string, ProviderErrorClass>,
): string {
  const classes = providersFailed
    .map((id) => id + "=" + (providerErrorClasses?.[id] ?? "unknown"))
    .join(", ");
  const hints = Object.entries(providerErrorHints(providersFailed, providerErrorClasses))
    .map(([id, hint]) => id + ": " + hint)
    .join("; ");
  return (
    toolName +
    " error: all providers failed (providersFailed: " +
    providersFailed.join(", ") +
    "; providerErrorClasses: " +
    classes +
    ")" +
    (hints ? ". " + hints + "." : "")
  );
}
