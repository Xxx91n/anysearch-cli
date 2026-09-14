// ADR-0062 D3 (T3): abstain presentation helpers — pure, no imports, so the
// contract is unit-testable without pulling the kernel module graph (apps/cli
// has no "type":"module"; CJS resolution cannot reach ESM-only pi-agent-core).

// Exit codes: 0 = ok (including abstain), 1 = generic failure / zero results
// outside any domain policy, 2 = usage error, 3 = abstain with --fail-on-abstain
// (dedicated nonzero so automation can discriminate without scraping text).
export function searchExitCode(input: { resultCount: number; abstain?: boolean; failOnAbstain: boolean }): number {
  if (input.abstain) return input.failOnAbstain ? 3 : 0;
  return input.resultCount > 0 ? 0 : 1;
}

// One-line structured abstain message (ADR-0062 D3): domain, pre/post gate
// counts, and which gate left the pool empty. Single line so it survives pipes.
export function formatAbstainLine(abstain: { domain?: string; preFiltered: number; postFiltered: number; gate: "pre" | "post" }): string {
  return "abstain: no results within allowed " + (abstain.domain ?? "domain") + " domain(s)" +
    " (pre-filtered " + abstain.preFiltered + ", post-filtered " + abstain.postFiltered + ", gate " + abstain.gate + ")";
}
