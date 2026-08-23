// SearchProvider contract: normalized interface for all search providers.
// Seam 1 from atomcode-kernel-split-architecture research.

export type Mode = "fast" | "index" | "deep" | "answer";

export interface SearchRequest {
  query: string;
  mode: Mode;
  maxResults?: number;
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
    providerAnswers?: Array<{ provider: string; text: string }>;
    // ADR-0022 D4: fail-open marker — false when no queried provider
    // supports answer mode (e.g. AnySearch-only future).
    answersAvailable?: boolean;
  };
}
