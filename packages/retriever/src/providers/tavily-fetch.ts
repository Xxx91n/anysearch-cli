// Tavily 的读页臂：通过 @tavily/core 打 POST /extract。
//
// 一次递几个网址看 provider-facts 的 `fetchMaxUrlsPerCall`（为什么是 5 不写 20，理由
// 在那一格）。key 的规则跟搜索臂一致：显式 key 优先，否则 SDK 自己读 TAVILY_API_KEY，
// 再不行走匿名通道（匿名有每日上限，撞墙抛 TavilyKeylessLimitError，共享分类器读成
// free-quota-exhausted）。
//
// 逐页失败就是这一页的事，除非错因是整家坏的那几类（配额、403）：那时工具会把
// 这家记下来，这一页和没读的网址一起交给下一家。SDK 抛错同样是这家坏了。

import { tavily } from "@tavily/core";
import { FETCH_PAGE_MAX_CHARS, fetchIdentity, isCallDeadlineAbort, mapReading, pageFault, type FetchEnvelope, type FetchPage, type FetchProvider, type FetchRequest } from "../fetch-contract";
import { PROVIDER_FACTS } from "./provider-facts";

/** The one SDK call this adapter needs; a test passes its own object. */
export interface TavilyExtractClient {
  extract(
    urls: string[],
    options: { extractDepth: "basic"; format: "markdown"; timeout: number },
  ): Promise<{ results?: TavilyExtractResult[]; failedResults?: TavilyExtractFailedResult[] }>;
}

export interface TavilyExtractResult {
  url?: unknown;
  title?: unknown;
  rawContent?: unknown;
}

export interface TavilyExtractFailedResult {
  url?: unknown;
  error?: unknown;
}

/** Keep the arm's own deadline inside the tool's 20s one, with room to spare. */
const EXTRACT_TIMEOUT_SECONDS = 15;

export class TavilyFetchProvider implements FetchProvider {
  readonly id = PROVIDER_FACTS.tavily.id;
  readonly maxUrlsPerCall = PROVIDER_FACTS.tavily.fetchMaxUrlsPerCall;

  constructor(private readonly client: TavilyExtractClient) { }

  async fetch(req: FetchRequest, signal: AbortSignal): Promise<FetchEnvelope> {
    signal.throwIfAborted();
    const maxCharacters = Math.min(FETCH_PAGE_MAX_CHARS, Math.max(1, req.maxCharacters));
    const response = await this.client.extract(req.urls, {
      extractDepth: "basic",
      format: "markdown",
      timeout: EXTRACT_TIMEOUT_SECONDS,
    });
    // 工具那道墙响了就当这一批还是拿到了：结果已经付过钱，不能因为几毫秒的差把
    // 它们全扔了、让下一家重抓一遍。只有调用方自己取消才往上抛。
    if (signal.aborted && !isCallDeadlineAbort(signal)) signal.throwIfAborted();
    // `results` 和 `failedResults` 在 SDK 类型上都是可选的：全成功时可能没有
    // `failedResults`，全失败时可能只回 `failedResults`、不带 `results`。所以
    // `results` 缺了不算回包坏——前提是 `failedResults` 里真有失败原因；两样都
    // 没有才是真坏回包（一个空对象）。
    const rawFailed = response?.failedResults;
    const rawResults = response?.results;
    const failed = Array.isArray(rawFailed) ? rawFailed : [];
    const results = Array.isArray(rawResults) ? rawResults : [];
    if (!Array.isArray(rawResults) && failed.length === 0) {
      throw new Error("Tavily extract: malformed response (neither results nor failedResults)");
    }
    const pages: FetchPage[] = [];
    for (const result of results) {
      const url = typeof result?.url === "string" ? result.url.trim() : "";
      const text = typeof result?.rawContent === "string" ? result.rawContent : "";
      if (!url || !text.trim()) continue;
      const title = typeof result?.title === "string" ? result.title.trim() : "";
      pages.push({
        url,
        ...(title ? { title } : {}),
        text: text.slice(0, maxCharacters),
      });
    }
    const failuresByIdentity = new Map<string, string>();
    for (const failure of failed) {
      const url = typeof failure?.url === "string" ? failure.url.trim() : "";
      if (!url) continue;
      failuresByIdentity.set(fetchIdentity(url), typeof failure?.error === "string" ? failure.error : "");
    }
    // 对回请求时写的那个 URL：入库按身份对，报给调用方的是它自己写的写法。
    // 失败原因也按同一个身份找，不然上游补一个尾斜杠时 404 会被读成「没正文」。
    const reading = mapReading(req.urls, pages, (url) =>
      pageFault(url, failuresByIdentity.get(fetchIdentity(url)) ?? ""));
    return { provider: this.id, pages: reading.pages, failures: reading.failures };
  }
}

/** Same factory shape as the search arm: an explicit key wins, else the SDK's env/keyless chain. */
export function createTavilyFetchProvider(apiKey?: string): FetchProvider {
  const key = apiKey?.trim();
  const client = tavily(key ? { apiKey: key } : {});
  return new TavilyFetchProvider({
    extract: (urls, options) => client.extract(urls, options),
  });
}
