// Exa provider adapter (decision 3).
// atomcode research: exa-js >=2.26.0, new Exa(apiKey), search(query, {contents}, {signal}), answer(query, opts, {signal}).
// NormalizedResult mapping: title/url direct, text->snippet (contents.text, 500 chars), publishedDate->publishedAt, score preserved.
// searchAndContents is deprecated - use search(query, {contents: {text: true}}) instead.
// Design: forward the contract AbortSignal as exa-js trailing RequestOptions on
// search()/answer() — exa-js >=2.26.0 exposes per-request transport options, and
// dropping the signal left provider calls uncancellable (#216).

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
  // exa-js BaseSearchOptions.includeDomains is a first-class
  // typed field (walled-garden RAG positioning per Exa docs).
  readonly domainFilterSupported = true;
  private client: Exa;

  constructor(apiKey?: string) {
    // atomcode research: new Exa(apiKey), key falls back to EXA_API_KEY env.
    // 不传 key 时 exa-js 自己会去读环境变量，读不到就当场抛；这个分支由
    // createExaProvider 决定，装配方不直接 new 这个类。
    this.client = new Exa(apiKey);
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
      source: "exa",
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

/**
 * 装配 exa 这一臂时该走的入口（#499）。kernel 的装配表和 `ans doctor` 的构造函数
 * 表都调它，不再各自决定「传不传 key」。
 *
 * Design: 装配 exa 只留这一个入口，判断和构造都在这里 — 以前「传不传 key」散在
 * 调用方（两张表各自把可选的 key 递进来）、「怎么建」藏在构造器的三元里；收到工厂
 * 之后改一处就够，下一票（#500）长出免费额度那一支时也只动这里。
 *
 * 空串、纯空格、没传都算没配 key：凭据解析器（`resolveSearchCredentials`）本来就
 * 把纯空格当没配（#459），产品路径递进来的值早 trim 过；这里再 trim 一次，是挡住
 * 绕过解析器直接调工厂的人。
 *
 * 没配 key 这一支今天还是老路：不带 key 去建同一个 REST 适配器，exa-js 自己再读一次
 * EXA_API_KEY，读不到就当场抛，装配把这条臂记成「构造失败」并点名，用户看到的东西
 * 一个字没变。产品路径上 env 早被解析器读过一遍，那个兜底找不到第二把钥匙，只剩
 * 「读不到就抛」这一个作用；#500 会把整支换成走免费额度的 MCP 客户端，兜底一起消失。
 */
export function createExaProvider(apiKey?: string): SearchProvider {
  const key = apiKey?.trim();
  if (!key) return new ExaProvider();
  return new ExaProvider(key);
}
