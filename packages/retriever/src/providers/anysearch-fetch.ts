// AnySearch 读页臂。
//
// `extract` 一次只收一个网址，所以 `maxUrlsPerCall` 是 1，工具按 1 切批，一次上游
// 请求正好记一次 calls。回包是 `structuredContent: {url, title, content}`。
//
// `isError` 的回包统一走 pageFault，靠错误类分开：配额 / 鉴权 / 会话没了这几类会让
// 工具把这家记下来、本轮不再叫；其余只是这一页读不动。PDF、图片、音视频读不了，
// 就是后一种，交给下一家。

import { classifyProviderError, providerErrorClassOf, providerErrorText } from "../contract";
import { FETCH_ARM_FAULT_CLASSES, FETCH_PAGE_MAX_CHARS, isCallDeadlineAbort, pageFault, type FetchEnvelope, type FetchFailure, type FetchPage, type FetchProvider, type FetchRequest } from "../fetch-contract";
import { AnySearchMcpClient, toolResultBodyText, toolResultErrorText, type McpToolResult } from "./anysearch-mcp";
import { PROVIDER_FACTS } from "./provider-facts";

interface ExtractStructured {
  url?: unknown;
  title?: unknown;
  content?: unknown;
}

/** 这一页读到了，还是没读到。 */
function isPage(reading: FetchPage | FetchFailure): reading is FetchPage {
  return "text" in reading;
}

/** 回包结构化那半边的标题，没给就是空串。 */
function titleOf(reply: McpToolResult<ExtractStructured>): string {
  const title = reply.structuredContent?.title;
  return typeof title === "string" ? title.trim() : "";
}

function readExtractReply(
  url: string,
  reply: McpToolResult<ExtractStructured>,
  maxCharacters: number,
): FetchPage | FetchFailure {
  if (reply.isError === true) {
    // 分类交给 pageFault：配额 / 鉴权 / 会话过期这几类会让工具把这家记下来，
    // 其余（这一页没了、格式读不了）只算这一页，这家还能接着用。
    // 拼接口径走 toolResultErrorText：上游把「额度」「用完」拆成两段时得拼回一行。
    return pageFault(url, toolResultErrorText(reply));
  }
  const structured = reply.structuredContent?.content;
  const title = titleOf(reply);
  const structuredText = typeof structured === "string" && structured.trim() ? structured : undefined;
  if (structuredText !== undefined) {
    return { url, ...(title ? { title } : {}), text: structuredText.slice(0, maxCharacters) };
  }
  // 结构部分没给（或只给空白）就退回文字部分，而且不挑段的 type：上游要不标 type，
  // 正文照样读得到，不应为一个字段没标就把整家赶下去。
  const fallback = toolResultBodyText(reply);
  if (!fallback.trim()) {
    // 有正文位置但是空的：这一页没正文，换一家可以再试；两路都空才是回包坏了。
    if (typeof structured === "string") return pageFault(url, "");
    throw new Error("AnySearch MCP tools/call extract malformed reply (no structuredContent.content and no text)");
  }
  // 文字部分当正文之前先认一下：没配 key 时那道配额墙回的是 HTTP 200 + 正文里一段
  // 「已经给你自动开了账号」之类的话、没有正文段；当正文收下的话，墙的原文就进资料库。
  // 这条道只认「免费额度用完」这一种：回包并不是 isError，正文里出现「403」「额度」
  // 这种字眼说明不了这家坏了（讲 HTTP 错误的文章满地都是），鉴权类的失败由上面
  // isError 那条道负责。墙本身也就一两百字，再加一道长度上限，免得长文误伤。
  const cls = classifyProviderError(fallback);
  if (cls === "free-quota-exhausted" && fallback.length <= 600) return pageFault(url, fallback);
  return { url, ...(title ? { title } : {}), text: fallback.slice(0, maxCharacters) };
}

export class AnySearchFetchProvider implements FetchProvider {
  readonly id = PROVIDER_FACTS.anysearch.id;
  readonly maxUrlsPerCall = PROVIDER_FACTS.anysearch.fetchMaxUrlsPerCall;

  constructor(private readonly client: AnySearchMcpClient) { }

  async fetch(req: FetchRequest, signal: AbortSignal): Promise<FetchEnvelope> {
    signal.throwIfAborted();
    const maxCharacters = Math.min(FETCH_PAGE_MAX_CHARS, Math.max(1, req.maxCharacters));
    const pages: FetchPage[] = [];
    const failures: FetchFailure[] = [];
    for (const url of req.urls) {
      let reading: FetchPage | FetchFailure;
      try {
        const reply = await this.client.callTool("extract", { url }, signal) as unknown as McpToolResult<ExtractStructured>;
        // 读回包也在 try 里：回包形状不对同样是这一家坏了，但不能把前面读到的页带走。
        reading = readExtractReply(url, reply, maxCharacters);
      } catch (error) {
        // 调用方自己取消：往上抛（工具已经不要这些页了）。工具给的那道超时墙不算
        // 取消：这一页记成超时失败，前面读到的页照常带回去。
        const timedOut = isCallDeadlineAbort(signal);
        if (signal.aborted && !timedOut) signal.throwIfAborted();
        const text = providerErrorText(error);
        failures.push({
          ...pageFault(url, text),
          errorClass: timedOut ? "transient" : (providerErrorClassOf(error) ?? classifyProviderError(text)),
          // 超时只是这一页慢，不让这家退场；其余（握手、回包读不出来）是这家的事。
          ...(timedOut ? {} : { armFault: true }),
        });
        break;
      }
      if (isPage(reading)) pages.push(reading);
      else {
        failures.push(reading);
        // 这一页已经证明这家撞墙了（配额、鉴权、会话没了）：同一批剩下的网址不再一个个
        // 去打，留给下一家。今天一次只递一个网址，所以这条还没出现在账单上。
        if (FETCH_ARM_FAULT_CLASSES.includes(reading.errorClass)) break;
      }
    }
    return { provider: this.id, pages, failures };
  }
}

/** 和搜索臂同一个工厂形状：给了 key 就用，没给就读环境变量。 */
export function createAnySearchFetchProvider(apiKey?: string, endpoint?: string): FetchProvider {
  return new AnySearchFetchProvider(new AnySearchMcpClient(apiKey, endpoint));
}
