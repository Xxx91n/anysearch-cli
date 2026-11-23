// Exa 免费额度臂（#500）的适配器测试。
// Mock-based: global fetch 用 stub 顶着，驱动真实的 ExaMcpProvider.search()——和
// anysearch.test.ts 同一个做法。只钉外部行为：请求长什么样、两种回包怎么解析、
// 缺字段的形状、isError、429 的分类和 retry-after。
// ponytail: no test framework, assert-based demo.

import { ExaMcpProvider } from "../src/providers/exa-mcp";
import { classifyProviderError, providerErrorText, retryAfterSeconds, type NormalizedResult } from "../src/contract";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

type FetchCall = { url: string; method: string; headers: Record<string, string>; body: any; signal?: AbortSignal | null };
type RespSpec = { status?: number; statusText?: string; ct?: string; body?: string; headers?: Record<string, string> };

function installFetch(handler: (call: FetchCall) => RespSpec | Error) {
  const calls: FetchCall[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const headers: Record<string, string> = {};
    const h = init?.headers ?? {};
    for (const k of Object.keys(h)) headers[k.toLowerCase()] = String(h[k]);
    const call: FetchCall = {
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: init?.body ? JSON.parse(init.body) : undefined,
      signal: init?.signal,
    };
    calls.push(call);
    const r = handler(call);
    if (r instanceof Error) throw r;
    return new Response(r.body ?? "", {
      status: r.status ?? 200,
      statusText: r.statusText ?? "",
      headers: { "content-type": r.ct ?? "application/json", ...(r.headers ?? {}) },
    });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

// 2026-11-23 实测的形状（#447）：一条记录一个文本块，字段固定，缺的写 N/A。
const RECORDS = [
  "Title: Cloudflare Workers",
  "URL: https://www.cloudflare.com/products/workers/",
  "Published: 2026-03-15T00:00:00.000Z",
  "Author: N/A",
  "Highlights:",
  "Deploy serverless functions globally.",
  "",
  "Title: Workers docs",
  "URL: https://developers.cloudflare.com/workers/",
  "Published: N/A",
  "Author: Yuki Tanaka",
  "Highlights:",
  "The developer docs site.",
].join("\n");

const SSE = (id: unknown, text: string, extra: Record<string, unknown> = {}) =>
  "event: message\ndata: " + JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text, _meta: { searchTime: 155.7 } }], ...extra },
  }) + "\n\n";

const JSON_REPLY = (id: unknown, text: string) =>
  JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });

const REQ = { query: "cloudflare workers", mode: "fast" as const, maxResults: 7 };
const SIG = new AbortController().signal;

async function rejection(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return undefined;
}

async function main() {
  // 1. 请求长什么样：一条 tools/call、两个 Accept 类型、不带任何凭据。
  {
    const f = installFetch((call) => ({ ct: "text/event-stream", body: SSE(call.body.id, RECORDS) }));
    try {
      const provider = new ExaMcpProvider();
      const env = await provider.search(REQ, SIG);
      assert(f.calls.length === 1, "one POST, no handshake (" + f.calls.length + ")");
      const call = f.calls[0]!;
      assert(call.url === "https://mcp.exa.ai/mcp", "the free-quota endpoint is the MCP one, got " + call.url);
      assert(call.method === "POST", "POST");
      assert(call.headers["content-type"] === "application/json", "Content-Type is application/json");
      assert(call.headers["accept"] === "application/json, text/event-stream", "Accept carries both media types");
      assert(call.headers["authorization"] === undefined, "no Authorization header");
      assert(call.headers["x-api-key"] === undefined, "no x-api-key header");
      assert(call.headers["mcp-protocol-version"] === undefined, "no protocol-version header");
      assert(call.signal === SIG, "the contract signal is forwarded");
      assert(call.body.jsonrpc === "2.0", "JSON-RPC 2.0");
      assert(call.body.method === "tools/call", "method is tools/call");
      assert(call.body.params?.name === "web_search_exa", "tool name is web_search_exa");
      assert(
        JSON.stringify(call.body.params?.arguments) === JSON.stringify({ query: REQ.query, numResults: 7 }),
        "arguments carry query and numResults only, got " + JSON.stringify(call.body.params?.arguments),
      );
      assert(env.provider === "exa", "provider id is still exa");
      assert(Array.isArray(env.answers) && env.answers.length === 0, "the free arm produces no answers");
      assert(env.elapsedMs >= 0, "elapsedMs is measured");
      assert(env.results.length === 2, "two records mapped, got " + env.results.length);
      assert(env.results[0]!.url === "https://www.cloudflare.com/products/workers/", "url mapped");
      assert(env.results[0]!.title === "Cloudflare Workers", "title mapped");
      assert(env.results[0]!.snippet === "Deploy serverless functions globally.", "highlights map to the snippet");
      assert(env.results[0]!.publishedAt === "2026-03-15T00:00:00.000Z", "Published maps to publishedAt");
      assert(env.results[0]!.source === "exa", "source = exa");
      assert(env.results[1]!.publishedAt === undefined, "a literal N/A is not a date");
    } finally { f.restore(); }
  }

  // 2. application/json 和 text/event-stream 两种回包解析出同样的结果。
  {
    const sse = installFetch((call) => ({ ct: "text/event-stream", body: SSE(call.body.id, RECORDS) }));
    let fromSse: NormalizedResult[] = [];
    try {
      fromSse = (await new ExaMcpProvider().search(REQ, SIG)).results;
    } finally { sse.restore(); }

    const json = installFetch((call) => ({ ct: "application/json", body: JSON_REPLY(call.body.id, RECORDS) }));
    let fromJson: NormalizedResult[] = [];
    try {
      fromJson = (await new ExaMcpProvider().search(REQ, SIG)).results;
    } finally { json.restore(); }

    assert(JSON.stringify(fromSse) === JSON.stringify(fromJson), "both reply formats normalize to the same results");
  }

  // 3. 文本块的三种缺字段形状：缺 Title 回落到 url，缺 Highlights 就是空摘要，没 URL 丢掉。
  {
    const missingTitle = [
      "URL: https://example.com/no-title",
      "Published: N/A",
      "Author: N/A",
      "Highlights:",
      "body text",
    ].join("\n");
    const f = installFetch((call) => ({ ct: "text/event-stream", body: SSE(call.body.id, missingTitle) }));
    try {
      const env = await new ExaMcpProvider().search(REQ, SIG);
      assert(env.results.length === 1, "a record without Title still maps");
      assert(env.results[0]!.title === "https://example.com/no-title", "missing Title falls back to the url");
      assert(env.results[0]!.snippet === "body text", "its highlights still map");
    } finally { f.restore(); }
  }
  {
    const noHighlights = [
      "Title: Bare",
      "URL: https://example.com/bare",
      "Published: N/A",
      "Author: N/A",
      "Title: Next",
      "URL: https://example.com/next",
      "Published: N/A",
      "Author: N/A",
      "Highlights:",
      "next body",
    ].join("\n");
    const f = installFetch((call) => ({ ct: "text/event-stream", body: SSE(call.body.id, noHighlights) }));
    try {
      const env = await new ExaMcpProvider().search(REQ, SIG);
      assert(env.results.length === 2, "a record without Highlights does not swallow the next one");
      assert(env.results[0]!.title === "Bare" && env.results[0]!.snippet === "", "missing Highlights -> empty snippet");
      assert(env.results[1]!.title === "Next" && env.results[1]!.snippet === "next body", "the next record stays its own");
    } finally { f.restore(); }
  }
  {
    const noUrl = [
      "Title: Dropped",
      "Published: N/A",
      "Author: N/A",
      "Highlights:",
      "no url anywhere",
      "Title: Kept",
      "URL: https://example.com/kept",
      "Published: N/A",
      "Author: N/A",
      "Highlights:",
      "kept body",
    ].join("\n");
    const f = installFetch((call) => ({ ct: "text/event-stream", body: SSE(call.body.id, noUrl) }));
    try {
      const env = await new ExaMcpProvider().search(REQ, SIG);
      assert(env.results.length === 1, "a record without URL is dropped, got " + env.results.length);
      assert(env.results[0]!.url === "https://example.com/kept", "the record with a URL survives");
    } finally { f.restore(); }
  }

  // 4. Highlights 截到 500 字。
  {
    const long = "A".repeat(600);
    const text = ["Title: Long", "URL: https://example.com/long", "Published: N/A", "Author: N/A", "Highlights:", long].join("\n");
    const f = installFetch((call) => ({ ct: "text/event-stream", body: SSE(call.body.id, text) }));
    try {
      const env = await new ExaMcpProvider().search(REQ, SIG);
      assert(env.results[0]!.snippet.length === 500, "snippet truncated to 500 chars, got " + env.results[0]!.snippet.length);
    } finally { f.restore(); }
  }

  // 5. isError: true 也是失败，正文读出来，绝不静默变成 0 条。
  {
    const f = installFetch((call) => ({
      ct: "text/event-stream",
      body: SSE(call.body.id, "MCP error -32602: Input validation error: query too short", { isError: true }),
    }));
    try {
      const error = await rejection(() => new ExaMcpProvider().search(REQ, SIG));
      assert(error instanceof Error, "isError rejects");
      assert((error as Error).message.includes("isError"), "the message names isError, got " + (error as Error).message);
      assert((error as Error).message.includes("query too short"), "the reply body is read, got " + (error as Error).message);
    } finally { f.restore(); }
  }

  // 6. 429：不重试，分类 transient，retry-after 挂到错误对象上让引擎记下来。
  {
    const rateLimited = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "You've hit Exa's free MCP rate limit." },
    });
    const f = installFetch(() => ({
      status: 429,
      ct: "application/json",
      headers: { "retry-after": "1" },
      body: rateLimited,
    }));
    try {
      const error = await rejection(() => new ExaMcpProvider().search(REQ, SIG));
      assert(f.calls.length === 1, "429 is not retried (" + f.calls.length + " calls)");
      assert(error instanceof Error, "429 rejects");
      const message = (error as Error).message;
      assert(message.includes("HTTP 429"), "the message carries the HTTP status, got " + message);
      assert(message.includes("free MCP rate limit"), "the reply body is read, got " + message);
      const text = providerErrorText(error);
      assert(classifyProviderError(text) === "transient", "429 is transient, got " + classifyProviderError(text));
      assert(retryAfterSeconds(text) === 1, "retry-after lands on the error object, got " + text);
    } finally { f.restore(); }
  }

  // 7. 其它非 2xx：状态码和正文都进错误串，分类器按状态码判。
  {
    const f = installFetch(() => ({ status: 500, ct: "application/json", body: "upstream boom" }));
    try {
      const error = await rejection(() => new ExaMcpProvider().search(REQ, SIG));
      const message = (error as Error).message;
      assert(message.includes("HTTP 500"), "the message carries the HTTP status, got " + message);
      assert(message.includes("upstream boom"), "the body excerpt rides along, got " + message);
      assert(classifyProviderError(providerErrorText(error)) === "transient", "5xx is transient");
    } finally { f.restore(); }
  }

  // 8. 200 + JSON-RPC error（比如工具名不认识）也是失败。
  {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Unknown tool: agent_run" } });
    const f = installFetch(() => ({ ct: "application/json", body }));
    try {
      const error = await rejection(() => new ExaMcpProvider().search(REQ, SIG));
      assert((error as Error).message.includes("-32602"), "the JSON-RPC code is named, got " + (error as Error).message);
      assert((error as Error).message.includes("Unknown tool"), "the JSON-RPC message is named");
    } finally { f.restore(); }
  }

  console.log("--- ExaMcpProvider tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
export {};
