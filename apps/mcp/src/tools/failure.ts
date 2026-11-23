// MCP execution-result semantics (#204): per the MCP specification a tool
// EXECUTION failure is a result with isError:true and actionable text, while a
// protocol fault stays a JSON-RPC error. Empty results are not failures.
//
// Error results deliberately carry no structuredContent: the error channel and
// the output schema stay separate. A partial search (at least one arm answered)
// is a success whose content and structuredContent name the degraded arms.
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { CompositionResult } from "@anysearch-cli/kernel";
import type { ProviderErrorClass, SearchOutcome } from "@anysearch-cli/retriever";
import { providerErrorHints } from "@anysearch-cli/kernel";

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
 * Failure metadata for a result that is still a success (at least one arm
 * answered). Runtime failures and construction-time build faults travel
 * together so a host can audit the whole chain. Undefined when every arm is
 * healthy, which keeps the output shape of a clean search unchanged.
 */
export function providerFailureMetadata(
  eng: CompositionResult,
  providersFailed: string[],
  providerErrorClasses?: Record<string, ProviderErrorClass>,
  providerErrorRetryAfterSeconds?: Record<string, number>,
): ProviderFailureMetadata | undefined {
  const buildErrors = eng.providerBuildErrors ?? {};
  if (providersFailed.length === 0 && Object.keys(buildErrors).length === 0) return undefined;
  const hints = providerErrorHints(providersFailed, providerErrorClasses, providerErrorRetryAfterSeconds);
  return {
    providersFailed: [...providersFailed],
    providerErrorClasses: { ...(providerErrorClasses ?? {}) },
    ...(Object.keys(hints).length > 0 ? { providerErrorHints: hints } : {}),
    providerBuildErrors: { ...buildErrors },
  };
}

/**
 * The envelope's own verdict, read instead of re-decided here: the kernel
 * classifies a search once and writes metadata.outcome, so this surface and the
 * audit trace cannot disagree about what happened. The fallback is the
 * classifier's own default for a hand-built envelope that predates the field,
 * not a second rule. `failed` is the one outcome that is an error: every
 * queried arm failed and nothing came back. Zero queried arms cannot be an
 * outage, and a cancelled arm is a transport outcome, so neither classifies as
 * `failed`.
 */
export function outcomeOf(envelope: { metadata?: { outcome?: SearchOutcome } }): SearchOutcome {
  return envelope.metadata?.outcome ?? "empty";
}

/**
 * Actionable all-provider-outage text that names the failed arms and says what
 * to do about each class the reader can act on.
 */
export function allProvidersFailedText(
  toolName: string,
  providersFailed: readonly string[],
  providerErrorClasses?: Record<string, ProviderErrorClass>,
  providerErrorRetryAfterSeconds?: Record<string, number>,
): string {
  const classes = providersFailed
    .map((id) => id + "=" + (providerErrorClasses?.[id] ?? "unknown"))
    .join(", ");
  const hints = Object.entries(providerErrorHints(providersFailed, providerErrorClasses, providerErrorRetryAfterSeconds))
    .map(([id, hint]) => id + ": " + hint)
    .join(" | ");
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
