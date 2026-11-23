// Exa provider adapter (decision 3).
// atomcode research: exa-js >=2.26.0, new Exa(apiKey), search(query, {contents}, {signal}), answer(query, opts, {signal}).
// NormalizedResult mapping: title/url direct, text->snippet (contents.text, 500 chars), publishedDate->publishedAt, score preserved.
// searchAndContents is deprecated - use search(query, {contents: {text: true}}) instead.
// Design: forward the contract AbortSignal as exa-js trailing RequestOptions on
// search()/answer() — exa-js >=2.26.0 exposes per-request transport options, and
// dropping the signal left provider calls uncancellable (#216).

import Exa from "exa-js";
import type { ProviderAnswer, SearchProvider, SearchRequest, NormalizedResult, ProviderEnvelope, Mode } from "../contract";
import { PROVIDER_FACTS } from "./provider-facts";
import { ExaMcpProvider } from "./exa-mcp";

// Mode mapping: our modes -> Exa search type.
const MODE_TYPE: Record<Mode, "auto" | "fast" | "deep-lite" | "deep"> = {
  fast: "fast",
  index: "auto",
  deep: "deep",
  answer: "auto",
};

export class ExaProvider implements SearchProvider {
  readonly id = PROVIDER_FACTS.exa.id;
  readonly modes: readonly Mode[] = PROVIDER_FACTS.exa.modes;
  // exa-js BaseSearchOptions.includeDomains is a first-class
  // typed field (walled-garden RAG positioning per Exa docs).
  readonly domainFilterSupported = PROVIDER_FACTS.exa.domainFilterSupported;
  readonly verticalDomainSupported = PROVIDER_FACTS.exa.verticalDomainSupported;
  private client: Exa;

  constructor(apiKey?: string) {
    // atomcode research: new Exa(apiKey), key falls back to EXA_API_KEY env.
    // 直接 new 这个类是付费 REST 臂：没拿到 key 时 exa-js 自己会去读环境变量，读不到就当场抛。
    // 「没 key 走免费额度」是工厂 createExaProvider 的分岔，不在这个类里。
    this.client = new Exa(apiKey?.trim() || undefined);
  }

  async search(req: SearchRequest, signal: AbortSignal): Promise<ProviderEnvelope> {
    const start = Date.now();
    const type = MODE_TYPE[req.mode] ?? "auto";
    // atomcode research: search() with contents for text snippet. searchAndContents deprecated.
    const res = await this.client.search(req.query, {
      type,
      numResults: req.maxResults ?? 10,
      contents: { text: { maxCharacters: 500 } }, // snippet-sized text
      // pre-filter send-down (provider-side domain restriction).
      ...(req.includeDomains?.length ? { includeDomains: req.includeDomains } : {}),
    }, { signal });

    // Map Exa results to NormalizedResult.
    const results: NormalizedResult[] = (res.results || []).map((r) => ({
      url: r.url,
      title: r.title ?? r.url, // title can be null in Exa
      snippet: ((r as any).text ?? "").slice(0, 500), // text from contents
      source: this.id,
      publishedAt: r.publishedDate,
      extra: r.score ? { score: r.score } : undefined,
    }));

    // answer mode: use exa.answer() separately.
    // surface citations (Exa returns answer+citations paired)
    // and log answer() failure to stderr instead of silent-swallow (failure must be visible;
    // search results still return unblocked per ponytail fail-open).
    const answers: string[] = [];
    let answersMeta: ProviderAnswer[] | undefined;
    if (req.mode === "answer") {
      try {
        const ans = await this.client.answer(req.query, { model: "exa" }, { signal });
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
      provider: this.id,
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

/**
 * 装配方调这个工厂 — 换构造方式、换走哪条路时只改这里，两张装配表不用跟着动。
 *
 * Design: 分岔只看传进来的这一个值 — trim 后非空走 REST，空串、纯空格、没传都走免费额度臂
 * （Exa 自己的 MCP 端点）。不在这里读 EXA_API_KEY：装配把解析好的 key 传进来（#301、#500），
 * 工厂再看一眼环境变量的话，「没传」到底算不算有 key 就要看现场，诊断和装配会各说各话。
 * 坏 key 不退（#448），照旧在构造时抛。
 */
export function createExaProvider(apiKey?: string): SearchProvider {
  const key = apiKey?.trim();
  return key ? new ExaProvider(key) : new ExaMcpProvider();
}
