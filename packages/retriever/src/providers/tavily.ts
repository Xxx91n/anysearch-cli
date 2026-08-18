// Tavily provider adapter (ADR-0005 decision 3).
// atomcode research: @tavily/core 0.7.7, tavily() factory, search(query, opts), extract(urls, opts).
// NormalizedResult mapping: title/url direct, content->snippet, publishedDate->publishedAt, score preserved.

import { tavily } from "@tavily/core";
import type { SearchProvider, SearchRequest, NormalizedResult, ProviderEnvelope, Mode } from "../contract";

// Mode mapping: our modes -> Tavily searchDepth.
const MODE_DEPTH: Record<Mode, "basic" | "advanced" | "fast" | "ultra-fast"> = {
  fast: "fast",
  index: "basic",
  deep: "advanced",
  answer: "advanced",
};

export class TavilyProvider implements SearchProvider {
  readonly id = "tavily";
  readonly modes: readonly Mode[] = ["fast", "index", "deep", "answer"];
  private client: ReturnType<typeof tavily>;

  constructor(apiKey?: string) {
    // atomcode research: tavily() factory, key falls back to TAVILY_API_KEY env, supports keyless.
    this.client = tavily(apiKey ? { apiKey } : {});
  }

  async search(req: SearchRequest, signal: AbortSignal): Promise<ProviderEnvelope> {
    const start = Date.now();
    const depth = MODE_DEPTH[req.mode] ?? "basic";
    // atomcode research: @tavily/core 0.7.7 has no AbortSignal support in search options.
    // signal param accepted per contract but SDK doesn't forward it. SDK uses internal timeout.
    // atomcode research: maxResults 0-20, includeAnswer for answer mode.
    const res = await this.client.search(req.query, {
      searchDepth: depth,
      maxResults: req.maxResults ?? 10,
      includeAnswer: req.mode === "answer",
      includeRawContent: false,
      timeout: 60,
    });

    // Map Tavily results to NormalizedResult.
    const results: NormalizedResult[] = (res.results || []).map((r) => ({
      url: r.url,
      title: r.title,
      snippet: r.content.slice(0, 500), // ponytail: truncate to snippet size
      source: "tavily",
      publishedAt: r.publishedDate,
      extra: { score: r.score },
    }));

    const answers: string[] = [];
    if (res.answer) answers.push(res.answer);

    return {
      provider: "tavily",
      results,
      answers,
      elapsedMs: res.responseTime ?? (Date.now() - start),
      usage: undefined, // ponytail: Tavily usage comes per-call in response.usage.credits, no standalone API.
    };
  }

  // ponytail: Tavily usage comes per-call in response.usage.credits, no standalone API.
  // No standalone usage() method — contract's usage?() is optional.
}
