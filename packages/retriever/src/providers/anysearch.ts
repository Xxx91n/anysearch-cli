// AnySearch provider adapter (ADR-0005 decision 3).
// atomcode research: AnySearch MCP service exposes 4 tools (search/get_sub_domains/batch_search/extract).
// MVP: uses REST API /v1/search (returns JSON {code, message, data: {results, metadata}}).
// MCP Streamable HTTP transport can be added later for deeper integration.
// Endpoint: https://api.anysearch.com/v1/search
// Auth: optional API key via Authorization: Bearer. Anonymous has lower rate limit.

import type { SearchProvider, SearchRequest, NormalizedResult, ProviderEnvelope } from "../contract";

// ADR-0059 D7 (T-6.4) DEFERRED-WITH-DEADLINE: ownership of api.anysearch.com is an internal
// confirmation item (legal/ops), not a code decision. Verified live at round 58: CloudFront CNAME,
// Amazon wildcard cert valid to 2026-12-03, fresh status subdomain cert - NOT dead infrastructure.
// Fail-open: an unreachable endpoint degrades the anysearch arm, never the fused envelope.
// Owner: anysearch-retriever (docs/deferred-registry.json: defer-anysearch-domain-ownership).
// Review: quarterly cadence (ADR-0010 precedent); CT/expiry monitoring tracks the cert renewal.
const ANYSEARCH_ENDPOINT = "https://api.anysearch.com/v1/search";

// atomcode research: REST response shape from official docs.
interface AnySearchResponse {
  code: number;
  message: string;
  request_id?: string;
  data: {
    results: Array<{
      title: string;
      url: string;
      snippet: string;
      content?: string;
    }>;
    metadata: {
      total_results: number;
      search_time_ms: number;
    };
  };
}

export class AnySearchProvider implements SearchProvider {
  readonly id = "anysearch";
  // ADR-0062 D2 (T1): the /v1/search REST surface has no domain parameter —
  // declared unsupported so the engine records the post-filter-only degrade
  // in the pre audit event instead of faking a filter.
  readonly domainFilterSupported = false;
  readonly modes: readonly ("fast" | "index" | "deep" | "answer")[] = ["fast", "index", "deep"];
  // ponytail: AnySearch does not have an "answer" mode like Tavily/Exa.
  // atomcode research: 4 tools are search/get_sub_domains/batch_search/extract - no standalone answer.
  private apiKey?: string;
  private endpoint: string;

  constructor(apiKey?: string, endpoint?: string) {
    this.apiKey = apiKey ?? process.env.ANYSEARCH_API_KEY;
    this.endpoint = endpoint ?? ANYSEARCH_ENDPOINT;
  }

  async search(req: SearchRequest, signal: AbortSignal): Promise<ProviderEnvelope> {
    const start = Date.now();
    // atomcode research: REST params: tag (vertical domain), params (sub_domain_params),
    // zone (cn/intl), language, max_results 1-20.
    const params = new URLSearchParams({
      query: req.query,
      max_results: String(req.maxResults ?? 10),
    });

    const headers: Record<string, string> = { "Accept": "application/json" };
    if (this.apiKey) headers["Authorization"] = "Bearer " + this.apiKey;

    const resp = await fetch(this.endpoint + "?" + params.toString(), {
      method: "GET",
      headers,
      signal,
    });

    if (!resp.ok) {
      throw new Error("AnySearch API error: " + resp.status + " " + resp.statusText);
    }

    const body = await resp.json() as AnySearchResponse;

    // Map REST results to NormalizedResult.
    const results: NormalizedResult[] = (body.data?.results ?? []).map((r) => ({
      url: r.url,
      title: r.title,
      snippet: r.snippet ?? (r.content ?? "").slice(0, 500),
      source: "anysearch",
    }));

    return {
      provider: "anysearch",
      results,
      answers: [],
      elapsedMs: body.data?.metadata?.search_time_ms ?? (Date.now() - start),
      usage: undefined,
    };
  }

  async usage(): Promise<{ remaining?: number; limit?: number; resetAt?: string } | undefined> {
    // ponytail: AnySearch usage not exposed via standalone API (1000 req/day free).
    return undefined;
  }
}
