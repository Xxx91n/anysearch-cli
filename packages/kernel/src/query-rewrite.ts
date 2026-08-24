// ADR-0023 D2 (Q2=B): S1 query rewrite — kernel-side pure function + LLM seam.
// rewriteQuery(query, qdf) returns 3 FTS5-query variants: [original, paraphrase, qdf-flavored variant].
// ports.ts is the dependency-inversion core; this module stays LLM-seam-free by injecting `llmFn`.
// Fail-open: if llmFn is absent OR throws, output equals the single-variant [query] — no dead code path.

// qdf: time-sensitive / evergreen hint — keeps QDF tags aligned with @anysearch/store time-decay.ts taxonomy.
export type QdfHint = "time_sensitive" | "evergreen" | "neutral";

// Detect QDF hint synchronously using the same rule sources used by store-side ranking.
// No re-implementation: re-uses exported classifiers from @anysearch/store via the kernel import surface.
export function classifyQdf(query: string, classifier?: { isTimeSensitive: (q: string) => boolean; isEvergreen: (q: string) => boolean }): QdfHint {
  if (classifier) {
    if (classifier.isTimeSensitive(query)) return "time_sensitive";
    if (classifier.isEvergreen(query)) return "evergreen";
  }
  return "neutral";
}

// LLM seam type: single-run variant generator (~200 tokens caller-owned budget).
// Returned array must contain at least one non-empty string; each entry is one FTS5 raw query variant.
export type LlmRewriteFn = (query: string, qdf: QdfHint) => Promise<string[]>;

// rewriteQuery: deterministic pre-fix + optional LLM seam. Always returns array whose [0] is the original query.
// Why array-of-3: D2 fixes 3 variants because LLM-grade recall studies (MemTX/Mem0 patterns) target this band;
// consumer side fuses via RRF k=60 (store.searchMemoryMulti).
export async function rewriteQuery(query: string, qdf: QdfHint, llmFn?: LlmRewriteFn): Promise<string[]> {
  const base = query.trim();
  if (!base) return [];
  if (!llmFn) return [base];
  try {
    const variants = await llmFn(base, qdf);
    const out = [base];
    for (const v of variants) {
      const t = (v ?? "").trim();
      if (t && t !== base && !out.includes(t)) out.push(t);
    }
    return out.slice(0, 3); // D2 cap: original + 2 LLM variants
  } catch {
    // Fail-open: single-variant degrades to exact legacy behavior (pre-S1 path).
    return [base];
  }
}
