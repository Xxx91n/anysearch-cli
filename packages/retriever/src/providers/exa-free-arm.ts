// Exa free-quota transport: one stateless tools/call to mcp.exa.ai.
// Search and page-read adapters share this; each parses the text itself.


import { createParser, type EventSourceMessage } from "eventsource-parser";
import { PROVIDER_FACTS } from "./provider-facts";

const FREE_ARM = PROVIDER_FACTS.exa.freeArm;

interface JsonRpcMessage {
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string };
}

// 这个端点从没回过 structuredContent；真出现了也不猜它的形状。
interface McpToolResult {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
}

// 上游给的等待秒数挂在错误对象上，providerErrorText 会把它写回错误串，引擎据此记进
// providerErrorRetryAfterSeconds。头里要么是秒数，要么是 HTTP 日期（RFC 9110）；两种都认，
// 其余写法当没有，不猜。
function waitSeconds(resp: Response): number | undefined {
  const raw = resp.headers.get("retry-after")?.trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return seconds;
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return undefined;
  const delta = Math.ceil((at - Date.now()) / 1000);
  return delta > 0 ? delta : undefined;
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

// SSE 可能一次带好几帧，JSON 也可能回批量数组；都按请求 id 取那一条，别拿第一帧充数。
// id 按文本比：服务端回数字还是字符串都认。
function isReplyFor(message: JsonRpcMessage, id: number): boolean {
  return message.id !== undefined && message.id !== null && String(message.id) === String(id);
}

function jsonRpcError(message: JsonRpcMessage): Error {
  return new Error(
    "Exa MCP tools/call JSON-RPC error " + (message.error?.code ?? "?") + ": " + (message.error?.message ?? "?"),
  );
}

async function readSseJsonRpc(resp: Response, id: number): Promise<JsonRpcMessage> {
  const events: EventSourceMessage[] = [];
  const parser = createParser({ onEvent: (e) => events.push(e) });
  parser.feed(await resp.text());
  let match: JsonRpcMessage | undefined;
  let failed: JsonRpcMessage | undefined;
  for (const ev of events) {
    if (!ev.data) continue;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(ev.data) as JsonRpcMessage;
    } catch {
      continue;
    }
    if (isReplyFor(message, id)) match = message;
    else if (message.error && (message.id === null || message.id === undefined)) failed = message;
  }
  if (match) return match;
  if (failed) throw jsonRpcError(failed);
  throw new Error("Exa MCP tools/call SSE stream carried no reply for id " + id);
}

function readJsonReply(body: string, id: number): JsonRpcMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new Error("Exa MCP tools/call malformed reply (body is not JSON)");
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  const message = messages.find((item): item is JsonRpcMessage =>
    !!item && typeof item === "object" && isReplyFor(item as JsonRpcMessage, id));
  if (message) return message;
  const failed = messages.find((item): item is JsonRpcMessage =>
    !!item && typeof item === "object" &&
    ((item as JsonRpcMessage).id === null || (item as JsonRpcMessage).id === undefined) &&
    !!(item as JsonRpcMessage).error);
  if (failed) throw jsonRpcError(failed);
  const seen = messages.map((item) => (item as JsonRpcMessage | null)?.id).join(", ");
  throw new Error("Exa MCP tools/call reply id mismatch (expected " + id + ", got " + seen + ")");
}

function textOf(result: McpToolResult | undefined): string {
  if (!Array.isArray(result?.content)) return "";
  return result.content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n");
}

let nextId = 1;

export async function callExaMcpTool(tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const id = nextId++;
  // 无状态：不握手、不发 MCP-Protocol-Version、不带任何凭据。Accept 必须同时带
  // application/json 和 text/event-stream，少了后者上游回 406。
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
      params: { name: tool, arguments: args },
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
  if (message.error) throw jsonRpcError(message);
  if (!message.result || typeof message.result !== "object") {
    throw new Error("Exa MCP tools/call malformed reply (no result object)");
  }

  const result = message.result as McpToolResult;
  const text = textOf(result);
  // 工具自己的失败也是失败：正文读出来，绝不静默变成 0 条。
  if (result.isError) throw new Error("Exa MCP tools/call isError: " + (text.trim() || "(no text)"));
  if (!text.trim()) throw new Error("Exa MCP tools/call returned no text content");
  return text;
}
