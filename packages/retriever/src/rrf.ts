// RRF (Reciprocal Rank Fusion) pure function.
// Split 2 from the atomcode kernel-split research.
// Formula: RRF_score(d) = sum_r 1/(k + rank_r(d)).
// ref: Cormack, Clarke, Buttcher 2009 SIGIR; BigData Boutique RRF guide.

// ponytail: pure function, no I/O, no network. Key-agnostic (uses URL as document id).
// no implicit k default — k is injected by the caller from FUSION_REGISTRY
// (L0 primitive stays governance-free; L1 owns all registered values).

export function rrfScores(
  lists: string[][],
  k: number,
  weights?: number[], // per-arm weight (FTS 1.0 / entity 0.5); default 1 per list
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

// RRF scores here are ~1e-2 and real gaps are ≥1e-4; 1e-12 only absorbs
// floating-point noise. Revisit if arm weights grow into the thousands.
const SCORE_QUANTUM = 1e12;

function rankedIds(scores: Map<string, number>, preferred?: ReadonlySet<string>): string[] {
  // Quantize before comparing: equal keys tie, `preferred` breaks the tie, and
  // ids that are still equal keep their input order.
  const key = (score: number) => Math.round(score * SCORE_QUANTUM);
  return [...scores.entries()]
    .sort((a, b) => {
      const byScore = key(b[1]) - key(a[1]);
      if (byScore !== 0) return byScore;
      return (preferred?.has(b[0]) ? 1 : 0) - (preferred?.has(a[0]) ? 1 : 0);
    })
    .map(([id]) => id);
}

// Sort document ids by RRF score descending. Returns ordered array.
export function rrfRank(
  lists: string[][],
  k: number,
  weights?: number[],
): string[] {
  return rankedIds(rrfScores(lists, k, weights));
}

// Same order with an explicit tie-break: ids in `preferred` come first when
// their scores are indistinguishable. Ids stay strings, like everywhere else in
// this primitive (a URL or an archive rowid are both valid document ids).
export function rrfRankWithPreferred(
  lists: string[][],
  k: number,
  preferred: ReadonlySet<string>,
  weights?: number[],
): string[] {
  return rankedIds(rrfScores(lists, k, weights), preferred);
}
