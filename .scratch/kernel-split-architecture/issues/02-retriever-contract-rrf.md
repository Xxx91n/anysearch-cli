# 02: SearchProvider contract + RRF pure function (candidate 2, seam 1+2)

Implement:
- packages/retriever/src/contract.ts: SearchProvider interface + NormalizedResult
- packages/retriever/src/rrf.ts: rrfScores(lists, k=60) pure function
- FusedEnvelope type { results, answers, metadata }

Reference: atomcode-kernel-split-architecture research (seam 1+2).
RRF formula: RRF_score(d) = sum_r 1/(k + rank_r(d)), k=60.