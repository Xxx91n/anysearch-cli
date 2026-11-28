// The corpus file name and the scope predicates, in a leaf module so the kernel
// stub test can import them without the store barrel. A store test pins which
// value each predicate claims.
import type { GoldenScope } from "./docs-golden";

export const GOLDEN_FILE = "eval-golden.json";

export function isLiveScope(scope: unknown): scope is Extract<GoldenScope, "live" | "both"> {
  return scope === "live" || scope === "both";
}

export function isStubScope(scope: unknown): scope is Extract<GoldenScope, "stub" | "both"> {
  return scope === "stub" || scope === "both";
}
