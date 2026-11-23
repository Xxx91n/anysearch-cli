// Exa 的免费额度臂：没配 key 时打 Exa 自己的 MCP 端点，只借它的 web_search_exa。
//
// Design: Exa 自己写一份最小 MCP 客户端，不和 anysearch.ts 合成一个、也不抽公共层
// （#449）— 两家的传输和回包有三处对不上：
// 1. 握手不一样。anysearch 要先 initialize + notifications/initialized，404 还要重跑一次握手；
//    Exa 这条是无状态的，不握手直接 tools/call 也回 200，会话 id 给了也被忽略。
// 2. 错误通道不一样。anysearch 的失败是 200 + 正文里的 isError；Exa 的限流和协议错是
//    HTTP 状态码 + application/json，只有工具自己失败才回 isError。
// 3. 回包不一样。anysearch 是「## Search Results」开头的 markdown；这条是 Title / URL /
//    Published / Author / Highlights 的文本块。两套解析器没有一行能共用。
// 合在一份客户端里，省下的重复还没有为这三种差异打的补丁多。等出现第三家走 MCP 的适配器，
// 或者 anysearch 的传输层本来就要大改（那时三家一起改，公共层才有人分摊维护），再抽。
//
// 事实来源：#447 的实测（工具名、两种回包、429 的形状）；端点和能力读
// PROVIDER_FACTS.exa.freeArm。#503 会把这条路写进 providers/exa/README.md。
// 这个端点不开放环境变量开关：免费额度这条路不给用户换地址（#448）。

import { createParser, type EventSourceMessage } from "eventsource-parser";
import type { Mode, NormalizedResult, ProviderEnvelope, SearchProvider, SearchRequest } from "../contract";
import { PROVIDER_FACTS } from "./provider-facts";

const FREE_ARM = PROVIDER_FACTS.exa.freeArm;

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string };
}

// 这个端点从没回过 structuredContent；真出现了也不猜它的形状（#447）。
interface McpToolResult {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
}

// 上游给的等待秒数挂在错误对象上，providerErrorText 会把它写回错误串，引擎据此记进
// providerErrorRetryAfterSeconds。只认整数秒；认不出来的写法就当没有，不猜。
function waitSeconds(resp: Response): number | undefined {
  const raw = resp.headers.get("retry-after")?.trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

// 非 2xx：状态码写进错误串（分类器认得「HTTP 429」），正文截一段带上，绝不静默变成 0 条。
function httpFailure(resp: Response, body: string): Error {
  const detail = body.trim().slice(0, 300);
  const error = new Error(
    "Exa MCP tools/call HTTP " + resp.status + (resp.statusText ? " " + resp.statusText : "") +
    (detail ? ": " + detail : ""),
  );
  const retryAfter = waitSeconds(resp);
  if (retryAfter !== undefined) Object.assign(error, { retryAfter });
  return error;
}

// SSE 是这条传输的常规回包（单条请求就一帧）；按请求 id 取那一条，别拿第一帧充数。
async function readSseJsonRpc(resp: Response, id: number): Promise<JsonRpcMessage> {
  const events: EventSourceMessage[] = [];
  const parser = createParser({ onEvent: (e) => events.push(e) });
  parser.feed(await resp.text());
  let match: JsonRpcMessage | undefined;
  for (const ev of events) {
    if (!ev.data) continue;
    const message = JSON.parse(ev.data) as JsonRpcMessage;
    if (message.id === id) match = message;
  }
  if (!match) throw new Error("Exa MCP tools/call SSE stream carried no reply for id " + id);
  return match;
}

function readJsonReply(body: string, id: number): JsonRpcMessage {
  const message = JSON.parse(body) as JsonRpcMessage;
  if (message.id === undefined || message.id === null || String(message.id) !== String(id)) {
    throw new Error("Exa MCP tools/call reply id mismatch (expected " + id + ", got " + String(message.id) + ")");
  }
  return message;
}

// 成功正文是一条 text 里按记录拼的文本块：Title / URL / Published / Author / Highlights，
// 一条记录一个结果。缺 Title 的记录回落到 url；没有 URL 的记录丢掉；Published 的 N/A 算没有。
type TextRecord = { title?: string; url?: string; published?: string; highlights: string[] };

const FIELD = /^(Title|URL|Published|Author|Highlights):[ \t]*(.*)$/;

// 正文里换行、空行都可能有（Highlights 是 markdown），所以不能按空行切记录：
// 抬头是一串连续的字段行，Highlights 之后才是正文。正文里再见到一个像抬头的行
// （Title 后面跟 URL/Published/Author/Highlights 之一，或者没写 Title 时 URL 后面跟
// 那三个之一），就是下一条记录开始了。正文里引用一句「Title: ...」不会被当成新记录。
function parseSearchText(text: string): NormalizedResult[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const records: TextRecord[] = [];
  let current: TextRecord | undefined;
  let inBody = false;
  let sawField = false;

  const begin = () => {
    current = { highlights: [] };
    records.push(current);
    inBody = false;
    sawField = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const field = FIELD.exec(line);
    if (inBody) {
      // 下一条记录也要有抬头的样子：Title 后面得跟 URL/Published/Author/Highlights 之一，
      // 或者（没写 Title 时）URL 后面跟 Published/Author/Highlights。正文里引用一句
      // 「Title: ...」不会被当成新记录。
      const next = lines[i + 1] ?? "";
      const startsNext =
        field !== null &&
        ((field[1] === "Title" && /^(URL|Published|Author|Highlights):/.test(next)) ||
          (field[1] === "URL" && /^(Published|Author|Highlights):/.test(next)));
      if (!startsNext) {
        current!.highlights.push(line);
        continue;
      }
      current = undefined;
      inBody = false;
      sawField = false;
    }
    if (!field) {
      // 抬头被一行普通内容打断：这条记录没写 Highlights，剩下的按正文算。
      if (current) {
        inBody = true;
        current.highlights.push(line);
      }
      continue;
    }
    // 抬头还没读完就又见到 Title（或第二个 URL）：上一条没写 Highlights，新的一条开始了。
    const restart =
      field[1] === "Title" ? sawField : field[1] === "URL" && current?.url !== undefined;
    if (restart) begin();
    if (!current) begin();
    sawField = true;
    switch (field[1]) {
      case "Title": current!.title = field[2]; break;
      case "URL": current!.url = field[2]; break;
      case "Published": current!.published = field[2]; break;
      case "Author": break;
      case "Highlights":
        inBody = true;
        // 服务端把正文写在下一行；万一哪天跟着冒号写在同一行，也别把它丢了。
        if (field[2].trim()) current!.highlights.push(field[2]);
        break;
    }
  }

  const results: NormalizedResult[] = [];
  for (const record of records) {
    const url = cleanField(record.url);
    if (!url) continue;
    const published = cleanField(record.published);
    results.push({
      url,
      title: cleanField(record.title) ?? url,
      snippet: record.highlights.join("\n").trim().slice(0, 500),
      source: PROVIDER_FACTS.exa.id,
      ...(published ? { publishedAt: published } : {}),
    });
  }
  return results;
}

// 上游缺字段时写的是字面量 N/A，不是省略，也不是空串。
function cleanField(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed !== "N/A" ? trimmed : undefined;
}

function textOf(result: McpToolResult | undefined): string {
  return (result?.content ?? [])
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("");
}

export class ExaMcpProvider implements SearchProvider {
  readonly id = PROVIDER_FACTS.exa.id;
  readonly modes: readonly Mode[] = FREE_ARM.modes;
  readonly domainFilterSupported = FREE_ARM.domainFilterSupported;
  readonly verticalDomainSupported = FREE_ARM.verticalDomainSupported;
  private nextId = 1;

  async search(req: SearchRequest, signal: AbortSignal): Promise<ProviderEnvelope> {
    const start = Date.now();
    const id = this.nextId++;
    // 无状态：不握手、不发 MCP-Protocol-Version、不带任何凭据。Accept 两个类型都要带，
    // 少了 text/event-stream 上游回 406（#447 实测）。
    const resp = await fetch(FREE_ARM.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: "web_search_exa",
          // 免费工具只认 query 和 numResults（objective 标了 required，服务端不校验，不发）。
          arguments: { query: req.query, numResults: req.maxResults ?? 10 },
        },
      }),
      signal,
    });

    // 非 2xx 一律失败：读正文给用户看原因，429 不重试，只把等待秒数带回引擎。
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw httpFailure(resp, body);
    }

    const contentType = (resp.headers.get("content-type") ?? "").toLowerCase();
    let message: JsonRpcMessage;
    if (contentType.includes("text/event-stream")) {
      message = await readSseJsonRpc(resp, id);
    } else if (contentType.includes("application/json")) {
      message = readJsonReply(await resp.text(), id);
    } else {
      throw new Error("Exa MCP tools/call unexpected Content-Type: " + (contentType || "(none)"));
    }
    if (message.error) {
      throw new Error(
        "Exa MCP tools/call JSON-RPC error " + (message.error.code ?? "?") + ": " + (message.error.message ?? "?"),
      );
    }
    if (!message.result || typeof message.result !== "object") {
      throw new Error("Exa MCP tools/call malformed reply (no result object)");
    }

    const result = message.result as McpToolResult;
    const text = textOf(result);
    // 工具自己的失败也是失败：正文读出来，绝不静默变成 0 条。
    if (result.isError) throw new Error("Exa MCP tools/call isError: " + (text.trim() || "(no text)"));
    if (!text.trim()) throw new Error("Exa MCP tools/call returned no text content");

    return {
      provider: this.id,
      results: parseSearchText(text),
      answers: [],
      elapsedMs: Date.now() - start,
      usage: undefined,
    };
  }
}
