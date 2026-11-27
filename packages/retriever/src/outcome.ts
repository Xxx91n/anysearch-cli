// How a search ended — the one judgment.
//
// The engine classifies a search once and writes the answer into the envelope
// (metadata.outcome) and the audit span (anysearch.outcome); the CLI, search_web
// and the trace read that value and never decide again. research_web makes one
// mapping at its exit, because its verdict describes the call rather than the
// last round (see that tool). The five values are first match wins;
// classifySearchOutcome below says which one fires when.

export const SEARCH_OUTCOMES = ["answer", "failed", "cancelled", "abstain", "empty"] as const;

export type SearchOutcome = (typeof SEARCH_OUTCOMES)[number];

/**
 * One fanout was cut short: at least one arm was asked but not waited for. The
 * engine records only which arms were cut. This judges a single fanout; a tool
 * that merges several rounds decides the call-level answer itself.
 */
export function isPartialPool(providersCancelled: readonly string[]): boolean {
  return providersCancelled.length > 0;
}

/**
 * Everything the judgment needs. The arm lists, the result count and the answer
 * count are what the envelope will carry; `domainActive` and `gateDropped` are
 * the two facts only the engine has, because the gate runs there.
 */
export interface SearchOutcomeEvidence {
  resultCount: number;
  answerCount: number;
  providersQueried: readonly string[];
  providersFailed: readonly string[];
  providersCancelled: readonly string[];
  /** An allowlist was in force for this request. */
  domainActive: boolean;
  /** Arrivals the authoritative gate threw away. */
  gateDropped: number;
}

/** Arms that finished: asked, and neither failed nor cut off. */
function answeredProviders(e: SearchOutcomeEvidence): string[] {
  return e.providersQueried.filter(
    (id) => !e.providersFailed.includes(id) && !e.providersCancelled.includes(id),
  );
}

/** Every queried arm failed: an outage. Zero queried arms is not one. */
function allQueriedArmsFailed(e: SearchOutcomeEvidence): boolean {
  return e.providersQueried.length > 0 && e.providersQueried.every((id) => e.providersFailed.includes(id));
}

/**
 * The abstain predicate: the domain policy emptied the pool AND the search can
 * say why. Two ways to say it — the gate itself dropped arrivals, or every
 * queried arm answered with nothing and none failed. An arm cut off mid-flight
 * rules it out either way: without the whole fanout, "not in this domain" is an
 * overreach. Zero results and no provider answer are prerequisites, not
 * evidence.
 */
export function shouldAbstain(e: SearchOutcomeEvidence): boolean {
  if (!e.domainActive || e.resultCount > 0 || e.answerCount > 0) return false;
  if (isPartialPool(e.providersCancelled)) return false;
  // Same order as the classifier, so both give one answer: an outage is never
  // a refusal, even if the gate counters said arrivals were dropped.
  if (allQueriedArmsFailed(e)) return false;
  if (e.gateDropped > 0) return true;
  return answeredProviders(e).length > 0 && e.providersFailed.length === 0;
}

/** The verdict; the order is the one above. */
export function classifySearchOutcome(e: SearchOutcomeEvidence): SearchOutcome {
  if (e.resultCount > 0 || e.answerCount > 0) return "answer";
  if (allQueriedArmsFailed(e)) return "failed";
  if (isPartialPool(e.providersCancelled)) return "cancelled";
  if (shouldAbstain(e)) return "abstain";
  return "empty";
}
