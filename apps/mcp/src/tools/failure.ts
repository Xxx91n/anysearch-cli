// MCP execution-result semantics (#204): per the MCP specification a tool
// EXECUTION failure is a result with isError:true and actionable text, while a
// protocol fault stays a JSON-RPC error. Empty results are not failures.
//
// Error results deliberately carry no structuredContent: the error channel and
// the output schema stay separate. A partial search (at least one arm answered)
// is a success whose content and structuredContent name the degraded arms.
import type { CompositionResult } from "@anysearch-cli/kernel";
import type { ProviderErrorClass } from "@anysearch-cli/retriever";

export interface ToolFailure {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
}

/** Execution-failure result: isError true, text content, no structuredContent. */
export function toolFailure(text: string): ToolFailure {
  return { isError: true, content: [{ type: "text", text }] };
}

/** Execution-failure result with the surface's stable "<tool> error: " prefix. */
export function toolError(toolName: string, detail: string): ToolFailure {
  return toolFailure(toolName + " error: " + detail);
}

export interface ProviderFailureMetadata {
  providersFailed: string[];
  providerErrorClasses: Record<string, ProviderErrorClass>;
  providerBuildErrors: Record<string, string>;
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
  return {
    providersFailed: [...providersFailed],
    providerErrorClasses: { ...(providerErrorClasses ?? {}) },
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

/** Actionable all-provider-outage text that names the failed arms. */
export function allProvidersFailedText(
  toolName: string,
  providersFailed: readonly string[],
  providerErrorClasses?: Record<string, ProviderErrorClass>,
): string {
  const classes = providersFailed
    .map((id) => id + "=" + (providerErrorClasses?.[id] ?? "unknown"))
    .join(", ");
  return (
    toolName +
    " error: all providers failed (providersFailed: " +
    providersFailed.join(", ") +
    "; providerErrorClasses: " +
    classes +
    ")"
  );
}
