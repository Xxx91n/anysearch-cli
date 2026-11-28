// 读页的契约。
//
// 搜索回答「有哪些页」，这里要的是已经放行的那些页的正文。谁来读由工具定；适配器
// 只把一串网址变成页和失败，别的事不管。

import { classifyProviderError, type ProviderErrorClass } from "./contract";
import { redactSecrets } from "./redact";
import { normalizeUrlIdentity } from "./url-identity";

/** 一页正文的上限，超了截断再入库。 */
export const FETCH_PAGE_MAX_CHARS = 100_000;

/** 工具侧的批上限：一次 `fetch` 最多带这么多个网址。 */
export const FETCH_MAX_URLS_PER_CALL = 5;

/** 读到了但没正文时说的话。 */
export const FETCH_EMPTY_BODY_MESSAGE = "该网址没有返回正文";

/**
 * 换一家也没用的失败：地址本身没了——404/410、域名解析不出来、网址不合法。
 * 404/410 只认状态码形状（`HTTP 404`、`status=410`、`404 Not Found`），网址路径里
 * （`/404-guide`）或查询串里（`?id=404`）的数字不算；笼统的 `not found` 也不算
 * （`content not found` 是这家没抽到正文，下一家也许读得到）。
 *
 * ENOTFOUND 归在这里，共享分类器那边是 `transient`：两边答的不是同一个问题——
 * 分类器答「这个请求要不要重试」，这里答「换一家还有没有意义」。
 */
export const FETCH_FINAL_PAGE_FAULT =
  /(?:HTTP\s*|\bstatus(?:Code)?\s*[:=]?\s*)(?:404|410)\b|\b(?:404|410)\s+(?:not\s+found|gone)\b|no such host|invalid url|unsupported (?:url|scheme)|ENOTFOUND/i;

/**
 * 说的是一家而不是这一页的失败类：配额、403（key 死了或整站挡了）、免费额度墙、
 * 上游已经把会话结束了。某一页的失败带着这几类时，这家本轮退场，没读的网址交给
 * 下一家——跟适配器直接抛错一个效果。其他都只算这一页。
 */
export const FETCH_ARM_FAULT_CLASSES: readonly ProviderErrorClass[] = [
  "permanent-auth",
  "quota-exhausted",
  "free-quota-exhausted",
  "session-expired",
];

/** 把上游给的原因剪成能给模型看的一行：秘密抹掉、最多 `max` 字。空进空出。 */
export function oneLineFault(message: string, max: number): string {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) return "";
  return redactSecrets(text, { keepPaths: false }).replace(/\s+/g, " ").trim().slice(0, max);
}

/** 同一行，只是什么都没拿到时用「没返回正文」那句顶上。 */
function pageFaultMessage(message: string, max = 200): string {
  return oneLineFault(message, max) || FETCH_EMPTY_BODY_MESSAGE;
}

/**
 * 适配器拿到一段自由文本的原因时，给一个网址报的失败：分类、抹过秘密的原因，以及
 * 「定局」与否。整家坏的那几类（配额、403）在这里也是可重试：工具会让这家退场、
 * 把这一页交给下一家。
 */
export function pageFault(url: string, message: string): FetchFailure {
  const text = typeof message === "string" ? message.trim() : "";
  return {
    url,
    errorClass: classifyProviderError(text),
    message: pageFaultMessage(text),
    retryable: !FETCH_FINAL_PAGE_FAULT.test(text),
  };
}

/** 一次上游请求里适配器能收到的东西。 */
export interface FetchRequest {
  /** 完整网址（带 scheme），已经过工具放行。 */
  urls: string[];
  /**
   * 每个网址的字数预算，上限是 FETCH_PAGE_MAX_CHARS。一批五个网址就要五倍这么多。
   * 超出上限的字在入库前就没了，给模型的那份还要再截一次。
   */
  maxCharacters: number;
}

export interface FetchPage {
  /**
   * 请求时写的那个网址。单个网址用跳转时，这里报的还是请求那个地址，落的地址不暴露。
   */
  url: string;
  title?: string;
  text: string;
}

export interface FetchFailure {
  url: string;
  errorClass: ProviderErrorClass;
  message?: string;
  /**
   * false = 换一家也读不到（404/410、网址非法）。true 或不写 = 「这一页的事，不是这家
   * 的事」：空正文、这家读不了的格式，工具可以把网址交给下一家。
   */
  retryable?: boolean;
  /**
   * 这条失败说的是一家而不是这一页（请求本身挂了：握手失败、回包读不出来，或适配器
   * 自己那层超时）。工具据此让这家本轮退场，这一批已经读到的页留着。
   * 注意工具那道总超时墙不算：那只是这一页慢，按页失败报（`transient`）。
   */
  armFault?: boolean;
}

export interface FetchEnvelope {
  provider: string;
  pages: FetchPage[];
  failures: FetchFailure[];
}

export interface FetchProvider {
  readonly id: string;
  /** 这一家一次上游请求最多收几个网址。 */
  readonly maxUrlsPerCall: number;
  fetch(req: FetchRequest, signal: AbortSignal): Promise<FetchEnvelope>;
}

/**
 * 工具给每次上游调用套的那道墙（和调用方的取消并在一起）到点时，signal 的原因
 * 叫这个名字；调用方自己取消带的是别的原因。适配器靠它分清「这一页慢了」和
 * 「调用方不要了」：前者还能把已读的页带回去，后者必须往上抛。
 */
export function isCallDeadlineAbort(signal: AbortSignal): boolean {
  const reason = signal.reason as { name?: string } | undefined;
  return signal.aborted && reason?.name === "TimeoutError";
}

/**
 * 对回时用的 key：在 `normalizeUrlIdentity` 的基础上再把路径尾斜杠折掉，`/a` 和 `/a/`
 * 算同一页（上游回跳时常常补一个斜杠）。存档用的 identity 不变：这一步只在把上游回的
 * 页对回请求时生效，入库还是调用方写的那个 URL。
 * 带查询串的网址只折路径那一段（`/a/?q=1` 查找时仍带查询串）。
 */
export function fetchIdentity(url: string): string {
  const base = normalizeUrlIdentity(url);
  // 只看路径那一段：查询串也可能以 `/` 结尾（`?path=docs/`），削了就把两个不同网址
  // 对成同一个 key。
  const cut = base.indexOf("?");
  const path = cut === -1 ? base : base.slice(0, cut);
  const rest = cut === -1 ? "" : base.slice(cut);
  return path.replace(/\/+$/, "") + rest;
}

/**
 * 把上游回的页对回请求里的写法：同一个网址的 http/https、`www.`、主机大小写差异、
 * 路径尾斜杠都算同一页。命中就用调用方写的那个 URL，对不上的用 failureFor 造一条
 * 失败。exa 和 tavily 共用这一份（anysearch 一次只读一个网址，直接按请求出页），
 * 对齐规则只改一处。
 */
export function mapReading(
  requested: readonly string[],
  pages: readonly FetchPage[],
  failureFor: (url: string) => FetchFailure,
): { pages: FetchPage[]; failures: FetchFailure[] } {
  const byIdentity = new Map(pages.map((page) => [fetchIdentity(page.url), page]));
  const outPages: FetchPage[] = [];
  const failures: FetchFailure[] = [];
  for (const url of requested) {
    const page = byIdentity.get(fetchIdentity(url));
    if (page) {
      outPages.push({ ...page, url });
      continue;
    }
    failures.push(failureFor(url));
  }
  return { pages: outPages, failures };
}
