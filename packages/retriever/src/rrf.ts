// RRF (Reciprocal Rank Fusion) pure function.
// Seam 2 from atomcode-kernel-split-architecture research.
// Formula: RRF_score(d) = sum_r 1/(k + rank_r(d)).
// ref: Cormack, Clarke, Buttcher 2009 SIGIR; BigData Boutique RRF guide.

// ponytail: pure function, no I/O, no network. Key-agnostic (uses URL as document id).
// ADR-0045 D2: no implicit k default — k is injected by the caller from FUSION_REGISTRY
// (L0 primitive stays governance-free; L1 owns all registered values).

export function rrfScores(
  lists: string[][],
  k: number,
  weights?: number[], // ADR-0031 D4: per-arm weight (FTS 1.0 / entity 0.5); default 1 per list
): Map<string, number> {
  const scores = new Map<string, number>();
  for (let li = 0; li < lists.length; li++) {
    const list = lists[li]!;
    const w = weights?.[li] ?? 1;
    // Deduplicate within a single list to prevent double-counting.
    const seen = new Set<string>();
    for (let rank = 0; rank < list.length; rank++) {
      const doc = list[rank];
      if (seen.has(doc)) continue;
      seen.add(doc);
      const score = w / (k + rank + 1);
      scores.set(doc, (scores.get(doc) ?? 0) + score);
    }
  }
  return scores;
}

// Sort document ids by RRF score descending. Returns ordered array.
export function rrfRank(
  lists: string[][],
  k: number,
  weights?: number[],
): string[] {
  const scores = rrfScores(lists, k, weights);
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map((entry) => entry[0]);
}
