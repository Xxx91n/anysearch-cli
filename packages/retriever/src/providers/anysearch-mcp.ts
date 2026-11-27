// AnySearch 的 MCP 传输，搜索臂和读页臂共用。
//
// 端点是无状态的 Streamable HTTP：每个客户端握手一次，之后发 JSON-RPC 的
// tools/call。请求带着 session id 却回 404，说明服务端把会话结束了，那就重新
// 握手、重试一次。endpoint 从哪来：构造函数参数 > ANYSEARCH_ENDPOINT > 表里那一格
// （`PROVIDER_FACTS.anysearch.freeProbe.endpoint`）；其中写成 `/v1/search` 的会改写成
// `/mcp` 并提示一次（这个适配器只走 MCP）。

import { createParser } from "eventsource-parser";
import { oneLineFault, waitSecondsFromHeader } from "../fetch-contract";
import { ANYSEARCH_LEGACY_REST_SUFFIX, PROVIDER_FACTS, resolveAnySearchEndpoint } from "./provider-facts";

let endpointRewriteWarned = false;

// 打一行提示，但 stderr 关掉/断掉时不能把建臂带塌：写失败时错误是异步发 'error' 事件的
// （不是同步抛），没人接就是未捕获异常、进程直接没了；同步抛也一起挡住。
function writeDiagnostic(message: string): void {
  const stderr = process.stderr;
  const swallow = () => { };
  stderr.once("error", swallow);
  try {
    stderr.write(message, (error) => {
      // 写成功才摘监听：失败时 Node 先回调再发 'error'，摘早了就没人接。
      if (!error) stderr.off("error", swallow);
    });
  } catch {
    stderr.off("error", swallow);
  }
}

// 端点写成 REST 搜索尾巴的，换成 /mcp 形式，提示一次；空串算没配，退回表里那一格。
// 提示里不打地址：端点可能带 userinfo。
function normalizeEndpoint(raw: string | undefined): string {
  const { endpoint, rewritten } = resolveAnySearchEndpoint(raw);
  if (rewritten && !endpointRewriteWarned) {
    endpointRewriteWarned = true;
    writeDiagnostic(
      "[anysearch] 端点写成了 " + ANYSEARCH_LEGACY_REST_SUFFIX +
      "（这个适配器只走 MCP），已改用 /mcp 形式\n",
    );
  }
  return endpoint;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

// 带着 session id 的请求回 404：服务端把会话结束了。
class SessionExpiredError extends Error { }

/** 回包里的一段文字。 */
export interface McpTextPart {
  type?: string;
  text?: string;
}

/** tools/call 的回包：文字部分 + 结构部分 + 错误标记，两个适配器共用一份。 */
export interface McpToolResult<TStructured = unknown> {
  content?: McpTextPart[];
  structuredContent?: TStructured;
  isError?: boolean;
}

/** 回包里的文字段；`content` 形状不对（不是数组）时当没有，不让下游 `filter` 直接炸。 */
function contentParts(reply: McpToolResult | undefined): McpTextPart[] {
  return Array.isArray(reply?.content) ? reply.content : [];
}

/** 不看 type 的文字段：有的上游根本不标 type，挑类型会把整段挑空。 */
function looseText(reply: McpToolResult | undefined): string[] {
  return contentParts(reply)
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean);
}

/** 把回包文字部分拼成一段（只有 text 类型的段算），段间保留换行：搜索臂的 markdown 信封靠行首认块。 */
export function toolResultText(reply: McpToolResult | undefined): string {
  return contentParts(reply)
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n");
}

/**
 * 报错回包的文字，两处跟 `toolResultText` 不一样：
 * - 不看 type：上游报错时不一定标 type，挑类型会把整段文字挑空；
 * - 段间用空格拼、行内换行也压成空格：中文配额文案的匹配窗口不跨换行，上游把
 *   「今日额度已」「用完，请稍后重试」拆成两段时，拼回一行才认得出（搜索臂和读页臂
 *   都靠这个分类，拆开就落成 unknown，撞墙了也不会退场）。
 */
export function toolResultErrorText(reply: McpToolResult | undefined): string {
  return looseText(reply).join(" ").replace(/\s*\n+\s*/g, " ");
}

/**
 * 不挑 type 的文字部分，段间保留换行。读页臂拿它当正文的兜底：上游要是不标 type，
 * 正文照样读得到，不会因为一个字段没标就把整家当坏的赶下去。
 */
export function toolResultBodyText(reply: McpToolResult | undefined): string {
  return looseText(reply).join("\n");
}

// SSE 也是这个传输允许的回包形式（现在线上实际回 application/json）。边收边解，
// 只认 id 对得上的那条；保活帧、半截帧一律跳过——一个坏帧不该把整家弄成「坏了」。
// 拿到答复就停下并取消读取：Streamable HTTP 允许服务端把流留着不关，等 EOF 会一路
// 等到工具那 20 秒墙，本来能读完的网址全推给下一家。
async function readSseJsonRpc(resp: Response, id: number, method: string): Promise<JsonRpcMessage> {
  const reader = resp.body?.getReader();
  if (!reader) throw new Error("AnySearch MCP " + method + " SSE reply carried no body");
  const seen: { reply?: JsonRpcMessage; failure?: JsonRpcMessage } = {};
  const decoder = new TextDecoder();
  const parser = createParser({
    onEvent: (ev) => {
      if (!ev.data) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(ev.data) as unknown;
      } catch {
        return;
      }
      // `data: null` 也能解析成功；不是对象就当坏帧跳过，别让读 id 那一步抛 TypeError。
      if (!parsed || typeof parsed !== "object") return;
      const message = parsed as JsonRpcMessage;
      if (isReplyFor(message, id)) seen.reply = message;
      else if (isIdlessError(message)) seen.failure = message;
    },
  });
  try {
    while (!seen.reply && !seen.failure) {
      const { value, done } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.cancel().catch(() => { });
  }
  if (seen.reply) return seen.reply;
  if (seen.failure) throw jsonRpcError(method, seen.failure);
  throw new Error("AnySearch MCP " + method + " SSE stream carried no reply for id " + id);
}

/** 上游给的 JSON-RPC 错误：把它自己写的话原样报出来，别翻译。 */
function jsonRpcError(method: string, message: JsonRpcMessage): Error {
  return new Error(
    "AnySearch MCP " + method + " JSON-RPC error " + (message.error?.code ?? "?") + ": " + (message.error?.message ?? "?"),
  );
}

/** id 可能被服务端回成字符串，两种写法都算对上。 */
function isReplyFor(message: JsonRpcMessage, id: number): boolean {
  return message.id !== undefined && message.id !== null && String(message.id) === String(id);
}

/**
 * JSON 回包挑出这一次请求的答复：先按 id 找（服务端可能把 id 回成字符串），找不到再
 * 找不带 id 的错误帧——那是它给整条请求的答复，得原样报出来；批量数组也照挑。
 * 都没有才报 id 对不上，并把收到的 id 列出来。
 */
function readJsonReply(body: string, id: number, method: string): JsonRpcMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new Error("AnySearch MCP " + method + " malformed reply (body is not JSON)");
  }
  const messages = (Array.isArray(parsed) ? parsed : [parsed])
    .filter((item): item is JsonRpcMessage => !!item && typeof item === "object");
  const match = messages.find((item) => isReplyFor(item, id));
  if (match) return match;
  const failed = messages.find((item) => isIdlessError(item));
  if (failed) throw jsonRpcError(method, failed);
  const seen = messages
    .map((item) => (item.id === undefined || item.id === null ? "(no id)" : String(item.id)))
    .join(", ");
  throw new Error("AnySearch MCP " + method + " reply id mismatch (expected " + id + ", got " + (seen || "(nothing)") + ")");
}

/** 不带 id 的错误帧是整条请求失败，不是某一帧的事。 */
function isIdlessError(message: JsonRpcMessage): boolean {
  return !!message.error && (message.id === null || message.id === undefined);
}

/** 非 2xx 回包的正文尾巴：上游写的原因得带出来，不然只剩状态码。读掉也能早点放掉连接。 */
async function bodySuffix(resp: Response): Promise<string> {
  let body = "";
  try {
    body = await resp.text();
  } catch {
    return "";
  }
  const shown = oneLineFault(body, 300);
  return shown ? " — " + shown : "";
}

/** 一个客户端对应一个 MCP 会话；适配器只用 `callTool`，其余都是内部实现。 */
export class AnySearchMcpClient {
  private apiKey?: string;
  private endpoint: string;
  private protocolVersion: string = PROVIDER_FACTS.anysearch.mcpProtocolVersion;
  private sessionId?: string;
  private handshake?: Promise<void>;
  private nextId = 1;

  constructor(apiKey?: string, endpoint?: string) {
    // 空字符串的 key 当成没配：发一个裸的 "Bearer " 头比匿名还差。显式给空串也不去
    // 读环境变量（测试靠这条保持 hermetic）；带空白/换行的 key 得先 trim，不然拼出来的
    // Authorization 头上游会当无效。
    const rawKey = apiKey ?? process.env.ANYSEARCH_API_KEY;
    this.apiKey = rawKey?.trim() || undefined;
    // 这里只用 `||` 不用 `??`：空串（或只有空白）算没配，用 `??` 会把 "" 带下去，
    // 最后报 `Failed to parse URL`。优先级和改写规则在文件头。
    this.endpoint = normalizeEndpoint(endpoint?.trim() || process.env.ANYSEARCH_ENDPOINT?.trim());
  }

  /** 发一次 tools/call；会话被结束就重新握手、只重试一次。 */
  async callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    try {
      await this.ensureInitialized(signal);
      return await this.rpc("tools/call", { name, arguments: args }, signal);
    } catch (e) {
      if (!(e instanceof SessionExpiredError)) throw e;
      this.sessionId = undefined;
      this.handshake = undefined;
      await this.ensureInitialized(signal);
      return this.rpc("tools/call", { name, arguments: args }, signal);
    }
  }

  private ensureInitialized(signal: AbortSignal): Promise<void> {
    // 握手只做一次（端点无状态，没有会话要保）。握手失败就把缓存清掉，下次重新试。
    this.handshake ??= (async () => {
      const res = await this.rpc("initialize", {
        protocolVersion: PROVIDER_FACTS.anysearch.mcpProtocolVersion,
        capabilities: {},
        clientInfo: { name: "anysearch-cli", version: "0.2.0" },
      }, signal);
      const negotiated = res["protocolVersion"];
      if (typeof negotiated === "string" && negotiated) this.protocolVersion = negotiated;
      await this.notify("notifications/initialized", signal);
    })();
    this.handshake.catch(() => { this.handshake = undefined; });
    return this.handshake;
  }

  private async rpc(method: string, params: unknown, signal: AbortSignal): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const msg = await this.post({ jsonrpc: "2.0", id, method, params }, signal);
    if (!msg || typeof msg.result !== "object" || msg.result === null) {
      throw new Error("AnySearch MCP " + method + " malformed reply (no result object)");
    }
    return msg.result as Record<string, unknown>;
  }

  private async notify(method: string, signal: AbortSignal): Promise<void> {
    await this.post({ jsonrpc: "2.0", method }, signal);
  }

  private async post(payload: Record<string, unknown>, signal: AbortSignal): Promise<JsonRpcMessage | undefined> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      // 两种回包形式都要接。
      "Accept": "application/json, text/event-stream",
      // 每个 POST 都带协议版本。
      "MCP-Protocol-Version": this.protocolVersion,
    };
    if (this.apiKey) headers["Authorization"] = "Bearer " + this.apiKey;
    // 服务端在 initialize 时给了 session id 就一路带着。
    if (this.sessionId) headers["MCP-Session-Id"] = this.sessionId;
    const resp = await fetch(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal,
    });
    // 404 要先拿「发请求时带出去的那个 session id」判：服务端可能在 404 上顺手
    // 回一个新 id，那不能被当成「会话没了」。
    const sentSession = this.sessionId;
    const assigned = resp.headers.get("mcp-session-id");
    if (assigned) this.sessionId = assigned;
    if (resp.status === 404 && sentSession) {
      throw new SessionExpiredError("AnySearch MCP " + String(payload.method) + " HTTP 404 (session terminated)");
    }
    const id = payload.id as number | undefined;
    if (id === undefined) {
      // 通知类请求：202 + 空响应就是正常答复。
      if (!resp.ok) throw new Error("AnySearch MCP " + String(payload.method) + " HTTP " + resp.status + (await bodySuffix(resp)));
      return undefined;
    }
    if (!resp.ok) {
      const suffix = await bodySuffix(resp);
      const error = new Error("AnySearch MCP " + String(payload.method) + " HTTP " + resp.status + " " + resp.statusText + suffix);
      // 上游给了「等多少秒」就挂上去：providerErrorText 会把它写回错误串，引擎据此提示等待。
      const retryAfter = waitSecondsFromHeader(resp);
      if (retryAfter !== undefined) Object.assign(error, { retryAfter });
      throw error;
    }
    const ct = (resp.headers.get("content-type") ?? "").toLowerCase();
    let msg: JsonRpcMessage;
    if (ct.includes("text/event-stream")) {
      msg = await readSseJsonRpc(resp, id, String(payload.method));
    } else if (ct.includes("application/json")) {
      msg = readJsonReply(await resp.text(), id, String(payload.method));
    } else {
      throw new Error("AnySearch MCP " + String(payload.method) + " unexpected Content-Type: " + (ct || "(none)"));
    }
    if (msg.error) throw jsonRpcError(String(payload.method), msg);
    return msg;
  }
}
