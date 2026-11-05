// `ans recommend` presentation helpers — pure, type-only imports (no runtime store/kernel
// import), so the output contract is unit-testable without pulling the kernel module graph
// (same pattern as search-abstain.ts).
//
// Contract: high confidence prints a single suggestion `ans domain <id>`; low confidence
// prints the candidate list plus a structured one-line "why no recommendation" — never a
// guess. The command NEVER switches domains itself (`switched: false` in --json is the
// structural marker; persistence stays with `ans domain <name>`).
//
// Ordering: the candidate list is best-first among the confidence candidates, with ONE
// documented exception (#172): the final slot may hold the reserved CJK stage row whose raw
// fused score can exceed the rows printed above it (the printed score is the honest fused
// value — never demoted). The slot is display presence for a recall arm BM25 crowded out,
// never a rank, never a suggestion: `Suggestion` reads the anchor, and the candidate printed
// above a higher score is the BM25 arm the lexical anchor chose.

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
  // #125 item 5: print the lexical stages the candidates actually carry (RecommendCandidate.arms:
  // "fts" = BM25, "cjk" = substring stage — the same labels --json prints), unioned in stage order
  // (BM25 anchor first), not rank order. No candidates ⇒ the "fts" baseline: the BM25 arm always
  // ran and the result carries no evidence of any other stage. Embedding disclosure is unchanged.
  const stages = new Set(r.candidates.flatMap((c) => c.arms));
  const arms = ["fts", "cjk"].filter((a) => stages.has(a));
  if (arms.length === 0) arms.push("fts");
  if (r.arms.embedding === "present") arms.push("embedding");
  lines.push(
    "Search arms: " + arms.join("+") + (r.arms.embedding === "present" ? "" : " (embedding arm " + r.arms.embedding + ")"),
  );
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
