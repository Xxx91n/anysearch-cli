// Corpus file names and the scope predicates live here, in a leaf module: the
// look ledger's stale-block notice and kernel's stub executor test must not pull
// the corpus validator in with them. The predicates spell the vocabulary out
// themselves; a store test pins which value each one claims.
import type { GoldenScope } from "./docs-golden";

export const GOLDEN_FILE = "eval-golden.json";

export function isLiveScope(scope: unknown): scope is Extract<GoldenScope, "live" | "both"> {
  return scope === "live" || scope === "both";
}

export function isStubScope(scope: unknown): scope is Extract<GoldenScope, "stub" | "both"> {
  return scope === "stub" || scope === "both";
}
