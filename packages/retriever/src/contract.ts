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
  usage?(): Promise<UsageInfo>;
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
  };
}