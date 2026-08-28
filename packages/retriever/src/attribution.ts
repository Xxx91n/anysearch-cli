// ADR-0034 D4: first-class attribution field on FusedEnvelope.
// Orthogonal to ADR-0022 verified:false (provider self-declare vs local signal fusion).
// MIR (Modular IR) pattern: the contract layer declares the type; kernel produces the value.

// Claim label — three-state, matching SufficiencySignal verdict grammar.
export type ClaimLabel = "supported" | "uncertain" | "unsupported";

// D4 evidence boundary: max 3 per claim (Facciani AAAI 2025 + Profound 66% turns use 1-4 sources).
export interface AttributionEvidence {
  url: string;
  title?: string;
  provider: string;      // e.g. "exa", "tavily", "anysearch"
  sourceKey: string;     // e.g. "retrieval_results[0]" — arms provenance (ADR-0033 D8)
  entity?: string;       // ADR-0031/0032 entity hit if applicable
  span?: string;         // snippet text that grounds the claim
}

export interface AttributionClaim {
  id: string;            // e.g. "c1", deterministic per-envelope
  text: string;          // claim text (sentence-extracted, L0 Intl.Segmenter)
  label: ClaimLabel;
  confidence?: number;   // 0..1 fused signal score; undefined when deterministic-only
  evidence: AttributionEvidence[];  // <= 3 (D4 boundary)
  rationale?: string;    // why this label — one sentence, human-readable
  // D6 L2 span anchor: byte offsets into envelope.answers[i] that generated this claim.
  answerIndex?: number;
  spanStart?: number;
  spanEnd?: number;
}

// D7 unsupported named-gap escalation (ADR-0023 sufficiency-gate bridge).
export interface GapRequest {
  assertion: string;   // the core assertion that could not be verified
  evidenceState: "no_evidence" | "partial_evidence" | "conflicting_evidence";
  gapQuery: string;    // rewritten query for reround
}

export interface AttributionReport {
  schema: "anysearch/attribution-report@1";
  generatedAt: string;  // ISO-8601
  claims: AttributionClaim[];
  gaps: GapRequest[];
  // D3 tier labels for gate decisions.
  supportedCount: number;
  uncertainCount: number;
  unsupportedCount: number;
  // Judge-enhanced flag: true if judge escalation ran on >=1 uncertain claim (ADR-0034 D3).
  judgeEnhanced: boolean;
}
