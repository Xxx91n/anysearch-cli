// Exa provider adapter (ADR-0005 decision 3).
// atomcode research: exa-js 2.18.1, new Exa(apiKey), search(query, {contents}), answer(query, opts).
// NormalizedResult mapping: title/url direct, text/highlights->snippet, publishedDate->publishedAt, score preserved.
// searchAndContents is deprecated - use search(query, {contents: {text: true}}) instead.

import Exa from "exa-js";
import type { ProviderAnswer, SearchProvider, SearchRequest, NormalizedResult, ProviderEnvelope, Mode } from "../contract";

// Mode mapping: our modes -> Exa search type.
const MODE_TYPE: Record<Mode, "auto" | "fast" | "deep-lite" | "deep"> = {
  fast: "fast",
  index: "auto",
  deep: "deep",
  answer: "auto",
};

export class ExaProvider implements SearchProvider {
  readonly id = "exa";
  readonly modes: readonly Mode[] = ["fast", "index", "deep", "answer"];
  private client: Exa;

  constructor(apiKey?: string) {
    // atomcode research: new Exa(apiKey), key falls back to EXA_API_KEY env.
    this.client = apiKey ? new Exa(apiKey) : new Exa();
  }

  async search(req: SearchRequest, signal: AbortSignal): Promise<ProviderEnvelope> {
    const start = Date.now();
    const type = MODE_TYPE[req.mode] ?? "auto";
    // atomcode research: search() with contents for text snippet. searchAndContents deprecated.
    const res = await this.client.search(req.query, {
      type,
      numResults: req.maxResults ?? 10,
      contents: { text: { maxCharacters: 500 } }, // snippet-sized text
    });

    // Map Exa results to NormalizedResult.
    const results: NormalizedResult[] = (res.results || []).map((r) => ({
      url: r.url,
      title: r.title ?? r.url, // title can be null in Exa
      snippet: ((r as any).text ?? "").slice(0, 500), // text from contents
      source: "exa",
      publishedAt: r.publishedDate,
      extra: r.score ? { score: r.score } : undefined,
    }));

    // answer mode: use exa.answer() separately.
    // ADR-0022 D2/D3 round-47 fix: surface citations (Exa returns answer+citations paired)
    // and log answer() failure to stderr instead of silent-swallow (failure must be visible;
    // search results still return unblocked per ponytail fail-open).
    const answers: string[] = [];
    let answersMeta: ProviderAnswer[] | undefined;
    if (req.mode === "answer") {
      try {
        const ans = await this.client.answer(req.query, { model: "exa" });
        if (typeof ans.answer === "string") {
          answers.push(ans.answer);
          const citations = Array.isArray((ans as { citations?: Array<{ url?: string; title?: string }> }).citations)
            ? (ans as { citations?: Array<{ url?: string; title?: string }> }).citations!
                .filter((c): c is { url: string; title?: string } => typeof c.url === "string")
                .map((c) => ({ url: c.url, title: c.title }))
            : undefined;
          answersMeta = [{ provider: this.id, text: ans.answer, verified: false, ...(citations?.length ? { citations } : {}) }];
        }
      } catch (err) {
        // fail-open: search results still return, but answer failure is observable on stderr.
        console.error(`[exa] answer() failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return {
      provider: "exa",
      results,
      answers,
      ...(answersMeta ? { answersMeta } : {}),
      elapsedMs: Date.now() - start,
      usage: undefined, // ponytail: Exa usage comes per-call in costDollars, no standalone API.
    };
  }

  // ponytail: Exa usage comes per-call in costDollars, no standalone API.
  // No standalone usage() method — contract's usage?() is optional.
}
