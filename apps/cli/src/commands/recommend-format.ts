// `ans recommend` presentation helpers — pure, type-only imports (no runtime store/kernel
// import), so the output contract is unit-testable without pulling the kernel module graph
// (same pattern as search-abstain.ts).
//
// Contract: high confidence prints a single suggestion `ans domain <id>`; low confidence
// prints the candidate list plus a structured one-line "why no recommendation" — never a
// guess. The command NEVER switches domains itself (`switched: false` in --json is the
// structural marker; persistence stays with `ans domain <name>`).

import type { RecommendResult } from "@anysearch-cli/store";

// Exit codes mirror `ans search`: 0 = recommendation produced (high OR low — a low-confidence
// candidate list is a first-class outcome, homomorphic with abstain), 1 = no candidate matched
// at all, 2 = usage error (handled by the caller before this runs).
export function recommendExitCode(r: Pick<RecommendResult, "decision">): number {
  return r.decision === "none" ? 1 : 0;
}

const round = (n: number): string => n.toFixed(3);

export function formatRecommendText(r: RecommendResult): string {
  const lines: string[] = [];
  lines.push('ans recommend — "' + r.query + '"');
  lines.push("Search arms: " + (r.arms.embedding === "present" ? "fts+embedding" : "fts (embedding arm " + r.arms.embedding + ")"));
  if (r.decision === "high" && r.recommendation) {
    lines.push("Confidence: high (" + round(r.confidence ?? 0) + ")");
    lines.push("Suggestion: ans domain " + r.recommendation.id);
    const top = r.candidates[0];
    if (top) lines.push("  " + top.id + " — " + top.description);
    lines.push("(no switch performed — run the command yourself)");
  } else if (r.decision === "low") {
    lines.push("Confidence: low (" + round(r.confidence ?? 0) + ")");
    if (r.why) lines.push("why no recommendation: " + r.why.code + " — " + r.why.detail);
    lines.push("Candidates (pick manually):");
    for (const c of r.candidates) {
      lines.push(
        "  " + c.rank + ". " + c.id + " (score " + round(c.score) + ", coverage " + round(c.coverage) + ") — " + c.description,
      );
    }
    lines.push("Choose with: ans domain <name>");
  } else {
    lines.push("No domain matched.");
    if (r.why) lines.push("why no recommendation: " + r.why.code + " — " + r.why.detail);
  }
  return lines.join("\n");
}

// --json envelope: single JSON document, machine-readable contract.
export function formatRecommendJson(r: RecommendResult): string {
  return JSON.stringify(
    {
      query: r.query,
      decision: r.decision,
      switched: false, // never auto-switches — structural marker
      recommendation: r.recommendation
        ? { id: r.recommendation.id, name: r.recommendation.name, confidence: r.recommendation.confidence, suggest: "ans domain " + r.recommendation.id }
        : null,
      confidence: r.confidence,
      why: r.why,
      candidates: r.candidates.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        rank: c.rank,
        score: c.score,
        coverage: c.coverage,
        arms: c.arms,
      })),
      arms: r.arms,
      topK: r.topK,
    },
    null,
    2,
  );
}
