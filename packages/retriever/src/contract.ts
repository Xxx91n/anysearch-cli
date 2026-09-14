import type { AttributionReport } from "./attribution";

// SearchProvider contract: normalized interface for all search providers.
// Seam 1 from atomcode-kernel-split-architecture research.

export type Mode = "fast" | "index" | "deep" | "answer";

export interface SearchRequest {
  query: string;
  mode: Mode;
  maxResults?: number;
  // ADR-0062 D2 (T1): capability-negotiated provider pre-filter. Kernel sets this
  // per provider to the domain's canonical allow hosts; only adapters that declare
  // domainFilterSupported forward it (tavily include_domains / exa includeDomains).
  // The provider parameter is an entry-convergence hint, never the authority —
  // the kernel post-filter remains the fail-closed egress gate.
  includeDomains?: string[];
}

export interface NormalizedResult {
  url: string;
  title: string;
  snippet: string;
  source: string; // provider id
  publishedAt?: string;
  extra?: Record<string, unknown>;
  // ADR-0009 D3: entity configurable — overrides URL as entity key for multi-URL same-entity scenarios.
  entity?: string;
}

export interface ProviderEnvelope {
  provider: string;
  results: NormalizedResult[];
  answers?: string[]; // for "answer" mode providers
  // ADR-0022 D3 round-47 fix: parallel provider-attributed answers with optional citations.
  // answers and answersMeta must have the same length when both are populated; the engine
  // aligns per-index and prefers answersMeta over re-deriving provider attribution.
  // Answers remain text-only in FusedEnvelope.answers; provenance moves to metadata.providerAnswers.
  answersMeta?: ProviderAnswer[];
  elapsedMs: number;
  usage?: UsageInfo;
}

export interface UsageInfo {
  remaining?: number;
  limit?: number;
  resetAt?: string;
}

export interface SearchProvider {
  readonly id: string;
  readonly modes: readonly Mode[];
  // ADR-0062 D2 (T1): domain-filter capability bit. true = the adapter forwards
  // SearchRequest.includeDomains to a provider-side domain parameter. Absent or
  // false = unsupported; the engine degrades that provider to post-filter-only
  // and records it in the retrieval.domain_filter.pre audit event.
  readonly domainFilterSupported?: boolean;
  search(req: SearchRequest, signal: AbortSignal): Promise<ProviderEnvelope>;
  usage?(): Promise<UsageInfo | undefined>;
}

// ADR-0014 D3: MVSS four-segment sufficiency signal.
// verdict: CRAG three-state quantifier aggregation (correct/incorrect/ambiguous).
// agreement: rank-derived (Jaccard@K + RBO@K), always computable.
// volume: hygiene signals (uniqueResults/uniqueDomains/successfulProviders).
// spread: rrfVariance (rank-derived weak signal) + scoreScale (native score dimension).
// perProvider: native scores attached, explicitly not cross-source normalized.
// Hard ceiling: cheap-signal AUC ceiling approx 0.76 — MVSS only promises escalate.
export interface SufficiencySignal {
  verdict: "correct" | "incorrect" | "ambiguous";
  agreement: {
    jaccardAtK: number;
    rboAtK: number;
  };
  volume: {
    uniqueResults: number;
    uniqueDomains: number;
    successfulProviders: number;
  };
  spread: {
    rrfVariance: number;
    scoreScale?: { min: number; max: number };
  };
  perProvider?: Record<string, number[]>;
}

// ADR-0022 D2/D3: provider answer with mandatory unverified marker + optional citations.
// Single source of truth for the providerAnswers item shape — ProviderEnvelope.answersMeta
// and FusedEnvelope.metadata.providerAnswers both reference this alias.
export interface ProviderAnswer {
  provider: string;
  text: string;
  verified: false;
  citations?: Array<{ url: string; title?: string }>;
}

// ADR-0046 D5: per-web-run observational ledger. It is intentionally separate from
// the gated sufficiency signal and may never drive a ship verdict or durable table.
export interface WebProviderLedger {
  providerOverlap: Record<string, number>;
  exclusiveHits: Record<string, number>;
  nativeScoresMissing: Record<string, number>;
  failures: string[];
}

// ADR-0045 D2/D3 (r118 impl): common fusion provenance shape — the six registered fields
// instance/labels/lists/weights/fusedIds/scoreKind. Memory-only texts (session-store ArmProvenance)
// and web-only nativeScores (below) are instance extensions on top of this base.
export interface FusionProvenance {
  instance: "memory" | "web";
  labels: string[];      // arm labels or provider ids, parallel to lists/weights
  lists: string[][];     // pre-truncation per-source key lists (memory: rowids; web: normalized urls)
  weights: number[];     // effective per-list weights used for this fusion run
  fusedIds: string[];    // full fused id order (pre-truncation)
  // D3: fused score is a rank_fusion signal only — never confidence/threshold/cross-query comparable.
  scoreKind: "rank_fusion";
}

// Fused envelope: the output of RRF consensus fusion across N providers.
export interface FusedEnvelope {
  results: NormalizedResult[];
  answers: string[];
  metadata: {
    providersQueried: string[];
    providersFailed: string[];
    providersCancelled: string[];
    elapsedMs: number;
    // ADR-0014 D3/D7: MVSS sufficiency signal from computeSufficiency().
    sufficiency?: SufficiencySignal;
    // ADR-0022 D3: per-provider answer attribution for transparency
    // without restructuring envelope.answers (stays string[]).
    // D2: verified=false locked in at contract layer (single source of truth); consumers must not re-stamp.
    // D3-D4 round-47 fix: optional provider citations for transparency (Exa supplies; Tavily grounding is same-batch).
    providerAnswers?: ProviderAnswer[];
    // ADR-0022 D4: capability marker, computed from provider.modes (NOT output).
    // False when no queried provider advertises answer mode support
    // (e.g. AnySearch-only future, or runtime stub stripping the capability).
    answersAvailable?: boolean;
    // ADR-0045 D2/D3 (r118 impl): pre-truncation WebFusion provenance snapshot. nativeScores are
    // raw provider scores per normalized url (web-only extension); they never enter fusion ranking.
    fusion?: FusionProvenance & { nativeScores: Record<string, Record<string, number>> };
    // ADR-0046 D5: observational-only zone. webProviderLedger is the engine-side
    // counterpart to the eval report's Observational zone; no threshold, no gate, no table.
    observational?: {
      webProviderLedger?: WebProviderLedger;
    };
    // ADR-0062 D3 (T2): first-class abstain marker. Set by the kernel post-filter
    // when a domain allowlist policy is active and zero results survive (including
    // the cold-domain zero-arrival case). A successful policy execution, never an
    // error. preFiltered = provider results that reached the authoritative gate;
    // postFiltered = survivors (0 whenever abstain is set). Consumed by the CLI
    // one-line message (exit 0) and MCP structuredContent.abstain (isError:false).
    abstain?: {
      abstain: true;
      reason: "domain_filter_empty";
      domain?: string;
      preFiltered: number;
      postFiltered: number;
      // ADR-0062 D3: which stage left the pool empty — "pre" when providers
      // returned zero arrivals (pre-filter/provider side), "post" when the
      // authoritative kernel gate dropped every arrival.
      gate: "pre" | "post";
    };
  };

  // ADR-0034 D4: first-class attribution field — claim-level evidence linkage, orthogonal to verified:false.
  attribution?: AttributionReport;
}
