// AnySearch provider adapter (ADR-0005 decision 3).
// atomcode research: AnySearch MCP service exposes 4 tools (search/get_sub_domains/batch_search/extract).
// MVP: uses REST API /v1/search (returns JSON {code, message, data: {results, metadata}}).
// MCP Streamable HTTP transport can be added later for deeper integration.
// Endpoint: https://api.anysearch.com/v1/search
// Auth: optional API key via Authorization: Bearer. Anonymous has lower rate limit.

import type { SearchProvider, SearchRequest, NormalizedResult, ProviderEnvelope } from "../contract";

// ADR-0059 D7 (T-6.4) DEFERRED-WITH-DEADLINE: ownership of api.anysearch.com is an internal
// confirmation item (legal/ops), not a code decision. Round-58 verification surface was the
// infrastructure layer only (CloudFront CNAME + cert + status subdomain) — never the /v1/search
// route. R81 re-verified (ADR-0082): cert rotated 2026-09-22, now valid to 2027-04-07 (Amazon RSA
// 2048 M04, SAN *.anysearch.com+anysearch.com); /health 200, apex/status 200 — infrastructure
// alive. But GET /v1/search = 404 (route-level dead) while POST /mcp is a live MCP Streamable
// HTTP endpoint (initialize/tools-list/tools-call green). The REST arm below is currently
// non-functional; the MCP migration is tracked as fix-r82-anysearch-rest-contract.
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
    // ADR-0063 (R62 T2): ANYSEARCH_ENDPOINT env override — dead-port fault
    // injection keeps the install-smoke offline leg hermetic; explicit arg wins.
    this.endpoint = endpoint ?? process.env.ANYSEARCH_ENDPOINT ?? ANYSEARCH_ENDPOINT;
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
