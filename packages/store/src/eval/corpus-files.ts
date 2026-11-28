// Corpus file names and the scope predicates live here, in a leaf module: the
// look ledger's stale-block notice and kernel's stub executor test import this
// file, and a value import of the vocabulary would drag the 550-line corpus
// reader into both. The predicates therefore spell the vocabulary out and a
// store test pins which value each one claims.
import type { GoldenScope } from "./docs-golden";

export const GOLDEN_FILE = "eval-golden.json";

export function isLiveScope(scope: unknown): scope is Extract<GoldenScope, "live" | "both"> {
  return scope === "live" || scope === "both";
}

export function isStubScope(scope: unknown): scope is Extract<GoldenScope, "stub" | "both"> {
  return scope === "stub" || scope === "both";
}
