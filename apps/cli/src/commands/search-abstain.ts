// Search presentation helpers — pure, no imports, so the
// contract is unit-testable without pulling the kernel module graph (apps/cli
// has no "type":"module"; CJS resolution cannot reach ESM-only pi-agent-core).
// Abstain line + provider build-failure absence line share this module: both
// are presentation contracts of `ans search` — stdout in the result/abstain
// render; the absence line additionally rides stderr on the error path.

// Exit codes: 0 = ok (including abstain), 1 = generic failure / zero results
// outside any domain policy, 2 = usage error, 3 = abstain with --fail-on-abstain
// (dedicated nonzero so automation can discriminate without scraping text).
export function searchExitCode(input: { resultCount: number; abstain?: boolean; failOnAbstain: boolean }): number {
  if (input.abstain) return input.failOnAbstain ? 3 : 0;
  return input.resultCount > 0 ? 0 : 1;
}

// One-line structured abstain message: domain, pre/post gate
// counts, and which gate left the pool empty. Single line so it survives pipes.
export function formatAbstainLine(abstain: { domain?: string; preFiltered: number; postFiltered: number; gate: "pre" | "post" }): string {
  return "abstain: no results within allowed " + (abstain.domain ?? "domain") + " domain(s)" +
    " (pre-filtered " + abstain.preFiltered + ", post-filtered " + abstain.postFiltered + ", gate " + abstain.gate + ")";
}

// Provider build-failure absence line (#180, follow-up to #41's kernel-side
// record): pairs the kernel's construction-time providerBuildErrors record
// with the runtime provider chain lines ("Providers queried" / "Providers
// failed") so the user can self-serve a key/config fix — which arm never
// entered the fanout, and under which safe category. Only the kernel's
// category wording rides verbatim (CWE-532: raw construction error text never
// reaches this surface — the record itself is category-only by kernel
// contract). One line for the whole absence list, "; "-joined per arm;
// undefined when every enabled arm built, so the healthy path is zero-noise.
export function formatProviderAbsentLine(buildErrors: Record<string, string>): string | undefined {
  const entries = Object.entries(buildErrors);
  if (entries.length === 0) return undefined;
  return "Providers absent (build failure): " + entries.map(([id, category]) => id + " — " + category).join("; ");
}
