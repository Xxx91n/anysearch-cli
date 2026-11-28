// AnySearch 搜索臂。传输（握手、回包、session 重试、endpoint 改写）在
// anysearch-mcp.ts，这个文件只管把回包翻译成搜索结果。
//
// tools/call search 的入参是 {query, max_results (最多 10), domain, sub_domain,
// sub_domain_params}；回包的文字部分是一段 markdown（## Search Results (N results,
// Tms) 加 ### N. 标题 / - **URL**: <地址> / 摘要行），结构部分若是未来版本带上来就优先读。
// result.isError:true（例如 invalid_api_key）直接让这条臂失败：不静默返回 0 条。
//
// 端点与协议版本都在 PROVIDER_FACTS.anysearch 那一格，适配器、探针都从那里取。

import type { Mode, SearchProvider, SearchRequest, NormalizedResult, ProviderEnvelope, ProviderErrorClass } from "../contract";
import { canonicalizeVertical, classifyProviderError, isExplicitAuthFault, providerErrorMarker, QUOTA_EXHAUSTED_TEXT, PROVISIONING_REPLY_TEXT, withProviderErrorClass } from "../contract";
import { redactSecrets } from "../redact";
import { AnySearchMcpClient, toolResultBodyText, toolResultErrorText, toolResultText, type McpToolResult } from "./anysearch-mcp";
import { PROVIDER_FACTS } from "./provider-facts";

// 端点的归属和证书证据写在仓库根的 `providers/anysearch/README.md`（「## 端点」那一节）；
// 回包里的 request_id 只做诊断（也是 X-Request-ID），不是幂等键。不可达或回包读不出来时
// 这条臂降级，不影响融合结果。

/** 结构部分的一条结果。 */
type StructuredSearchItem = { title?: string; url?: string; snippet?: string; content?: string };

function toResult(url: string, title: string, snippet: string): NormalizedResult {
  return { url, title: title || url, snippet: snippet.slice(0, 500), source: PROVIDER_FACTS.anysearch.id };
}

function mapStructuredResults(list: StructuredSearchItem[]): NormalizedResult[] {
  return list
    .filter((r) => typeof r?.url === "string" && r.url.length > 0)
    .map((r) => toResult(r.url!, r.title ?? "", r.snippet ?? r.content ?? ""));
}

// ## Search Results (N results, Tms) envelope → blocks of ### N. title +
// - **URL** u + free-text snippet lines. Tolerant: a block with no title
// still yields its URL; a block with no URL is skipped.
function parseSearchMarkdown(md: string): { results: NormalizedResult[]; elapsedMs?: number } {
  const results: NormalizedResult[] = [];
  const blockRe = /###[ \t]+\d+\.[ \t]*([^\n]*)\n([\s\S]*?)(?=\n###[ \t]+\d+\.|\s*$)/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(md)) !== null) {
    const title = m[1].trim();
    const body = m[2];
    const urlLine = /-\s*\*\*URL\*\*:\s*(\S+)/.exec(body);
    if (!urlLine) continue;
    const lines = body.split("\n");
    const urlIdx = lines.findIndex((l) => /-\s*\*\*URL\*\*:/.test(l));
    const snippet = lines
      .slice(urlIdx + 1)
      .map((l) => l.trim().replace(/^-\s*/, ""))
      .filter(Boolean)
      .join(" ");
    results.push(toResult(urlLine[1], title, snippet));
  }
  const em = /\(\d+\s*results?,\s*(\d+)\s*ms\)/.exec(md);
  return { results, elapsedMs: em ? Number(em[1]) : undefined };
}

// True throttle signals: upstream is asking us to slow down. Checked first, so
// "too many requests: daily quota reached" stays a throttle.
const THROTTLE_NOTICE = /rate.?limit|too many requests|限流|频繁/i;

// Same quota list as contract.ts; the adapter adds nothing, so a sentence does
// not change class just because it arrived through a different path.
const QUOTA_EXHAUSTED_NOTICE = new RegExp(QUOTA_EXHAUSTED_TEXT, "i");

// A polite "retry later" can ride along with a used-up plan; it only becomes a
// retry signal when no throttle or quota words are present.
const RETRY_NOTICE = /retry after|try again later|稍后再试|稍后重试/i;

type ReplyFailure = { cls: ProviderErrorClass; prefix: string };
// The reply text, classified once: the shape guess (if any) plus what the shared
// classifier says about the same text.
type ReplyReading = { failure?: ReplyFailure; classifier: ProviderErrorClass };

// Provisioning replies name the issued key as `api_key=...`, `"api_key": "..."`
// or `apiKey: ...`. This pattern redacts the value in any of those forms.
const KEY_FIELD_SOURCE = "(?:api_key|apikey)\"?\\s*[=:]\\s*(\"[^\"]*\"|'[^']*'|[^\\s\"',;]+)";
const KEY_FIELD_GLOBAL = new RegExp(KEY_FIELD_SOURCE, "gi");

// A sign-up/issuance reply, not just any message that mentions a key. The
// automatic-generation wording needs an account or key next to it; "this bill
// was automatically generated" is not one. Shared with contract.ts's
// classifier, which sees the same text through the error seam.
const PROVISIONING_NOTICE = new RegExp(PROVISIONING_REPLY_TEXT, "i");

// Name a reply failure by its text. The class it returns is carried by the
// caller's error object; the marker in the message is only for a human.
function replyFailurePrefix(md: string): ReplyFailure | undefined {
  if (PROVISIONING_NOTICE.test(md)) {
    return { cls: "free-quota-exhausted", prefix: "free quota exhausted: upstream returned a sign-up/issued-key reply instead of results" };
  }
  if (THROTTLE_NOTICE.test(md)) {
    return { cls: "transient", prefix: "rate limited: upstream returned a rate-limit notice instead of results" };
  }
  if (QUOTA_EXHAUSTED_NOTICE.test(md)) {
    return { cls: "quota-exhausted", prefix: "quota exhausted: upstream says the account's quota is used up" };
  }
  if (RETRY_NOTICE.test(md)) {
    return { cls: "transient", prefix: "rate limited: upstream returned a retry-later notice instead of results" };
  }
  return undefined;
}

// The reply scan above with an explicit credential fault taking precedence: a
// 403 body that happens to say a key was issued is a wrong key, not a quota.
// `failure` is undefined when no shape matched — the caller decides then (the
// isError path falls back to `classifier`, a plain reply text is malformed).
function readReply(md: string): ReplyReading {
  const classifier = classifyProviderError(md);
  const guessed = replyFailurePrefix(md);
  if (!guessed) return { classifier };
  if (isExplicitAuthFault(classifier)) {
    return { classifier, failure: { cls: classifier, prefix: "auth fault: upstream rejected the credential" } };
  }
  return { classifier, failure: guessed };
}

// result._meta.request_id 是服务端给的诊断关联号（真跑 2026-11-07 看到的）。它只进观测
// 轨迹，不进结果、不当幂等键；128 字的上限对 UUID 很宽裕，也挡得住乱写的上游把
// 上报字段撑大。
const MAX_REQUEST_ID_LENGTH = 128;

function requestIdOf(result: Record<string, unknown>): string | undefined {
  const meta = result._meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
  const requestId = (meta as { request_id?: unknown }).request_id;
  return typeof requestId === "string" && requestId.length > 0
    ? requestId.slice(0, MAX_REQUEST_ID_LENGTH)
    : undefined;
}

/** 结果信封的头。上游改写法时只改这里。 */
const RESULT_HEADER = /##\s+Search Results/;

/** 搜索回包：结构部分按搜索结果定型（content / isError 都在同一份里）。 */
type SearchToolResult = McpToolResult<{ results?: StructuredSearchItem[] }>;

function upstreamTextSuffix(raw: string): string {
  const shown = redactSecrets(raw, { keepPaths: false })
    .replace(KEY_FIELD_GLOBAL, "api_key=[redacted]")
    .slice(0, 200);
  return " [upstream text: " + (shown || "(no text)") + "]";
}

// 回包一律先过这一关：isError、200 但形状不对（没有「## Search Results」头，
// 结构部分也不是数组）都抛错，这条臂降级，不静默返回 0 条。Content-Type 的
// 检查在传输那一层（anysearch-mcp.ts 的 post），这里拿到的已经是解析过的消息。
function mapToolsCallResult(result: Record<string, unknown>): { results: NormalizedResult[]; elapsedMs?: number } {
  const r = result as SearchToolResult;
  if (r.isError === true) {
    // 报错文案用一行拼：中文配额文案的窗口不跨换行，上游把「额度」「用尽」拆成两段时
    // 必须拼回同一行才认得出，而且不挑段的 type（上游报错时不一定标）。
    const full = toolResultErrorText(r);
    const { failure, classifier } = readReply(full);
    // Fix the class here (reply shape, else the shared classifier); the marker
    // below is for the human reading the error, and the declared class is what
    // the engine records.
    const cls = failure?.cls ?? (classifier === "unknown" ? "permanent-protocol" : classifier);
    const head = (failure ? failure.prefix : "isError") + " " + providerErrorMarker(cls);
    throw withProviderErrorClass(new Error("AnySearch MCP tools/call " + head + upstreamTextSuffix(full)), cls);
  }
  const sc = r.structuredContent;
  if (sc && Array.isArray(sc.results)) {
    return { results: mapStructuredResults(sc.results) };
  }
  const md = toolResultText(r);
  // 有没有字、怎么分类都看松拼接那一份：这条路上游常常不标 type（匿名配额墙就是 HTTP 200、
  // 正文里带话、没有结果体），只挑 type 会把整段挑空，最后误报成 permanent-protocol。
  // md 是 loose 的子集，loose 空了 md 一定也是空的。
  const loose = toolResultErrorText(r);
  if (!loose.trim()) throw new Error("AnySearch MCP tools/call returned no text content");
  // 门槛看两路：md 里没结果头时，再看不挑 type 的那份有没有。两份拼法不同：
  // 解析得用保留换行的，空格拼的会把 markdown 行结构压平。
  let envelopeText = "";
  if (RESULT_HEADER.test(md)) envelopeText = md;
  else if (RESULT_HEADER.test(loose)) envelopeText = toolResultBodyText(r);
  if (!envelopeText) {
    // 不是结果信封：先看形状（自动签发 / 配额 / 限流），形状认不出再退回共享分类器，
    // 和 isError 那条路的先后一致——只靠形状会把「payment required，请充值」这种分类器
    // 认得出的话当成协议坏，整条臂白退场。
    const { failure, classifier } = readReply(loose);
    if (failure) {
      throw withProviderErrorClass(
        new Error("AnySearch MCP tools/call " + failure.prefix + " " + providerErrorMarker(failure.cls) + upstreamTextSuffix(loose)),
        failure.cls,
      );
    }
    if (classifier !== "unknown") {
      throw withProviderErrorClass(
        new Error("AnySearch MCP tools/call " + providerErrorMarker(classifier) + upstreamTextSuffix(loose)),
        classifier,
      );
    }
    // 两边都认不出（把工具清单当成搜索答复的那类回包）：当形状坏。
    throw new Error("AnySearch MCP tools/call malformed text (no '## Search Results' header)");
  }
  return parseSearchMarkdown(envelopeText);
}

export class AnySearchProvider implements SearchProvider {
  readonly id = PROVIDER_FACTS.anysearch.id;
  // eval leg /: the MCP domain param is a vertical-routing
  // enum (academic..travel, 17 values) — NOT a hostname allowlist, so it cannot
  // carry SearchRequest.includeDomains. This arm stays post-filter-only on the
  // host axis; the orthogonal vertical axis is served by verticalDomainSupported.
  readonly domainFilterSupported = PROVIDER_FACTS.anysearch.domainFilterSupported;
  // declared — SearchRequest.vertical maps to the MCP
  // search tool's domain/sub_domain/sub_domain_params arguments in callSearch.
  readonly verticalDomainSupported = PROVIDER_FACTS.anysearch.verticalDomainSupported;
  readonly modes: readonly Mode[] = PROVIDER_FACTS.anysearch.modes;
  // AnySearch 没有 Exa/Tavily 那样的 answer 模式；线协议上没有 mode 这个参数（多传
  // 一个字段有被拒的风险），所以 req.mode 从不发出去——要 answer 的请求降级成普通
  // 搜索，不报错。
  private readonly client: AnySearchMcpClient;

  constructor(apiKey?: string, endpoint?: string) {
    // 传输全在 anysearch-mcp.ts；读页臂用的是同一个客户端实现，不是同一个实例。
    this.client = new AnySearchMcpClient(apiKey, endpoint);
  }

  async search(req: SearchRequest, signal: AbortSignal): Promise<ProviderEnvelope> {
    const start = Date.now();
    const result = await this.callSearch(req, signal);
    const mapped = mapToolsCallResult(result);
    const requestId = requestIdOf(result);
    // vertical-hit marker — machine-readable stamp on
    // every result routed through a vertical domain (audit + fusion layers can
    // read NormalizedResult.extra.vertical; fusion preserves extra).
    if (req.vertical) {
      for (const r of mapped.results) {
        r.extra = {
          ...(r.extra ?? {}),
          vertical: {
            domain: req.vertical.domain,
            ...(req.vertical.subDomain ? { subDomain: req.vertical.subDomain } : {}),
          },
        };
      }
    }
    return {
      provider: this.id,
      results: mapped.results,
      answers: [],
      elapsedMs: mapped.elapsedMs ?? (Date.now() - start),
      usage: undefined,
      ...(requestId ? { diagnostics: { requestId } } : {}),
    };
  }

  private async callSearch(req: SearchRequest, signal: AbortSignal): Promise<Record<string, unknown>> {
    return this.client.callTool("search", {
      query: req.query,
      // 数字截到 1–10（MCP 的 schema 上限是 10，超了服务端会自己截，不如自己截）。
      max_results: Math.min(Math.max(req.maxResults ?? 10, 1), 10),
      // vertical 的三个字段只在这轮真有 vertical 时才发：没有 vertical 就三个键都
      // 不出现，不留空串默认值。规范化也在发送前做一次（canonicalizeVertical），
      // 所以 params 传空对象和完全不传是一回事。
      ...(req.vertical
        ? (() => {
          const v = canonicalizeVertical(req.vertical);
          return {
            domain: v.domain,
            ...(v.subDomain ? { sub_domain: v.subDomain } : {}),
            ...(v.params ? { sub_domain_params: v.params } : {}),
          };
        })()
        : {}),
    }, signal);
  }

  async usage(): Promise<{ remaining?: number; limit?: number; resetAt?: string } | undefined> {
    // ponytail: the MCP surface (tools/list) has no usage tool, so there is nothing to map.
    return undefined;
  }
}
