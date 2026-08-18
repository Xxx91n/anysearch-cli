// RRF (Reciprocal Rank Fusion) pure function.
// Seam 2 from atomcode-kernel-split-architecture research.
// Formula: RRF_score(d) = sum_r 1/(k + rank_r(d)), k=60.
// ref: Cormack, Clarke, Buttcher 2009 SIGIR; BigData Boutique RRF guide.

// ponytail: pure function, no I/O, no network. Key-agnostic (uses URL as document id).

export function rrfScores(
  lists: string[][],
  k = 60,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    // Deduplicate within a single list to prevent double-counting.
    const seen = new Set<string>();
    for (let rank = 0; rank < list.length; rank++) {
      const doc = list[rank];
      if (seen.has(doc)) continue;
      seen.add(doc);
      const score = 1 / (k + rank + 1);
      scores.set(doc, (scores.get(doc) ?? 0) + score);
    }
  }
  return scores;
}

// Sort document ids by RRF score descending. Returns ordered array.
export function rrfRank(
  lists: string[][],
  k = 60,
): string[] {
  const scores = rrfScores(lists, k);
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map((entry) => entry[0]);
}