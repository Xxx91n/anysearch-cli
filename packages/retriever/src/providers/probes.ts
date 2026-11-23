// 免费面探针：一次不花钱的调用，只回答「这把 key 好不好」和路上看到的事实。
//
// 一家的免费面只有一条：
//  tavily     GET /usage             好 key 200 + 用量；坏 key 401；套餐满 432
//  exa        POST /search 空体 {}    好 key 400 INVALID_REQUEST_BODY；坏 key 401
//  anysearch  initialize + tools/list + 空参数 tools/call
//                                    好 key isError「query is required」；坏 key invalid_api_key
//
// 一次真搜索都不跑：这条请求本身就是搜索入口，带上 query 就变成真查询、花额度。
// 探针是各自独立的最小实现，不 import 适配器 —— 那样就分不清「适配器坏」还是「上游坏」。
// 三家回包的确切形状（含坏 key 那几种）钉在 test/provider-probes.test.ts 的夹具里。
import { createParser, type EventSourceMessage } from "eventsource-parser";
import { classifyProviderError, type ProviderErrorClass } from "../contract";

/** 一次探针请求多久算超时。服务器回了响应头再卡住，也在这一条时限里。 */
const PROBE_TIMEOUT_MS = 10_000;

export type ProbeProviderId = "tavily" | "exa" | "anysearch";

/**
 * 免费面天生验不到的错误类。三家的免费面现在都认得出坏 key，所以今天的取值只有
 * quota；auth 留着是给以后那些只看连通、分不出 key 好坏的新源用。
 */
export type UndetectableClass = "auth" | "quota";

/** key 的三种结论。unverified 必须说出来，不然绿勾会被读成「验过了」。 */
export type ProbeAuth = "ok" | "rejected" | "unverified";

/** 失败类：连接层单列，因为它连 HTTP 状态都没有。 */
export type ProbeFaultClass = ProviderErrorClass | "unreachable";

export interface ProbeProblem {
  class: ProbeFaultClass;
  /** HTTP 状态；连不上时没有。 */
  status?: number;
  /** 连不上时的短标记（TIMEOUT / ECONNREFUSED / ENOTFOUND）。原始报错不打，可能带 key。 */
  code?: string;
}

/** 一次探针的结论。doctor 渲染成一行，ans auth set 拿它决定存不存。 */
export interface ProbeOutcome {
  auth: ProbeAuth;
  /** 这家免费面验不到什么，跟着结论一起报。 */
  undetectable: readonly UndetectableClass[];
  usage?: { plan?: string; used?: number; limit?: number | null };
  tools?: { count: number; searchTool: boolean; queryArg: boolean; protocolVersion?: string };
  problem?: ProbeProblem;
}

export interface ProbeInput {
  apiKey: string;
  /** 打哪个入口；不传走这家的公开端点。测试靠它把探针指到本地假端点。 */
  endpoint?: string;
}

/** 上游文字里明说这把 key 不认的标记。Exa 是「Invalid API key」，AnySearch 是「invalid_api_key」。 */
const AUTH_REJECTED_TEXT = /invalid[_ ]?api[_ ]?key|unauthorized|invalid token|api key is invalid/i;

/** 一次探针请求，带超时。网络层失败直接抛，由调用方翻成 unreachable。 */
async function probeFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
}

/**
 * 只有 401 / 403，或者 4xx 正文里明说 key 不认，才敢说 key 被拒。
 *
 * 5xx 一律归 transient：网关和 CDN 的错误页里带一句 unauthorized 很常见，那时候
 * key 是好的 —— 判成 rejected 会让 ans auth set 拒存一把好 key。2xx 也不看正文：
 * 那个状态本身就是「这条免费面不该成功」，属于入口变了。
 */
function httpOutcome(
  status: number,
  bodyText: string,
  undetectable: readonly UndetectableClass[],
): ProbeOutcome {
  const authSaid = status >= 400 && status < 500 && AUTH_REJECTED_TEXT.test(bodyText);
  if (status === 401 || status === 403 || authSaid) {
    return { auth: "rejected", undetectable, problem: { class: "permanent-auth", status } };
  }
  // 免费面上这条请求本来就不该成功：2xx 说明回包形状变了，不是 key 的事。
  if (status >= 200 && status < 300) {
    return { auth: "unverified", undetectable, problem: { class: "permanent-protocol", status } };
  }
  // 5xx 就是上游坏了，跟 key 无关，不用再看正文 —— 错误页里出现什么词都不改变这一点。
  if (status >= 500) {
    return { auth: "unverified", undetectable, problem: { class: "transient", status } };
  }
  return {
    auth: "unverified",
    undetectable,
    problem: { class: classifyProviderError("HTTP " + status + " " + bodyText.slice(0, 200)), status },
  };
}

/** 连不上：DNS、拒绝连接、超时、读到一半断。原始报错不打（Node 的头部报错会带 key 的值）。 */
function networkOutcome(error: unknown, undetectable: readonly UndetectableClass[]): ProbeOutcome {
  const code = networkCode(error);
  return {
    auth: "unverified",
    undetectable,
    problem: { class: "unreachable", ...(code ? { code } : {}) },
  };
}

function networkCode(error: unknown): string | undefined {
  const carrier = error as { name?: unknown; cause?: { code?: unknown } } | undefined;
  for (const candidate of [carrier?.cause?.code, carrier?.name]) {
    if (typeof candidate === "string" && /^[A-Za-z_]{3,24}$/.test(candidate)) return candidate;
  }
  return undefined;
}

// ── Tavily：GET /usage ────────────────────────────────────────────────
// 坏 key 401（认证在用量之前判）；套餐用满的时候这个接口照样 200，用量说话。
const TAVILY_ENDPOINT = "https://api.tavily.com";
const TAVILY_UNDETECTABLE: readonly UndetectableClass[] = [];

export async function probeTavily(input: ProbeInput): Promise<ProbeOutcome> {
  const base = (input.endpoint ?? TAVILY_ENDPOINT).replace(/\/+$/, "");
  let resp: Response;
  let body: string;
  try {
    resp = await probeFetch(base + "/usage", {
      method: "GET",
      headers: { Authorization: "Bearer " + input.apiKey },
    });
    // 读正文也在 try 里：超时管的是整条请求，服务器回了头再卡住就是在这里断的。
    body = await resp.text();
  } catch (error) {
    return networkOutcome(error, TAVILY_UNDETECTABLE);
  }
  if (resp.status === 432) {
    // 套餐用尽的回包是纯文本 HTTP 432。状态落在 4xx 里，但意思不是「请求写错了」，
    // 是「额度没了」—— key 本身是好的。
    return { auth: "ok", undetectable: TAVILY_UNDETECTABLE, problem: { class: "quota-exhausted", status: 432 } };
  }
  if (!resp.ok) return httpOutcome(resp.status, body, TAVILY_UNDETECTABLE);
  const usage = parseTavilyUsage(body);
  if (!usage) {
    return {
      auth: "unverified",
      undetectable: TAVILY_UNDETECTABLE,
      problem: { class: "permanent-protocol", status: resp.status },
    };
  }
  const full = typeof usage.used === "number" && typeof usage.limit === "number" && usage.used >= usage.limit;
  return {
    auth: "ok",
    undetectable: TAVILY_UNDETECTABLE,
    usage,
    ...(full ? { problem: { class: "quota-exhausted" as const, status: resp.status } } : {}),
  };
}

/** 回包形状见 docs/research/real-baseline-2026-11-22.md 的 `/usage` 那条。 */
function parseTavilyUsage(body: string): ProbeOutcome["usage"] | null {
  let parsed: { account?: { current_plan?: unknown; plan_usage?: unknown; plan_limit?: unknown } };
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    return null;
  }
  const account = parsed?.account;
  if (!account || typeof account !== "object") return null;
  return {
    ...(typeof account.current_plan === "string" ? { plan: account.current_plan } : {}),
    ...(typeof account.plan_usage === "number" ? { used: account.plan_usage } : {}),
    ...(typeof account.plan_limit === "number" ? { limit: account.plan_limit } : {}),
  };
}

// ── Exa：POST /search 空体 ────────────────────────────────────────────
// 空体在认证之后被拒（缺 query），所以 400 是正面回答。坏 key 到不了这里：
// 带坏 key 是 401 INVALID_API_KEY，完全不带 key 是 402。
const EXA_ENDPOINT = "https://api.exa.ai";
const EXA_UNDETECTABLE: readonly UndetectableClass[] = ["quota"];

export async function probeExa(input: ProbeInput): Promise<ProbeOutcome> {
  const base = (input.endpoint ?? EXA_ENDPOINT).replace(/\/+$/, "");
  let resp: Response;
  let body: string;
  try {
    resp = await probeFetch(base + "/search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": input.apiKey },
      body: "{}",
    });
    body = await resp.text();
  } catch (error) {
    return networkOutcome(error, EXA_UNDETECTABLE);
  }
  if (resp.status === 400 && !AUTH_REJECTED_TEXT.test(body)) {
    return { auth: "ok", undetectable: EXA_UNDETECTABLE };
  }
  return httpOutcome(resp.status, body, EXA_UNDETECTABLE);
}

// ── AnySearch：initialize + tools/list + 空参数 tools/call ────────────
// 空参数 tools/call 才分得开 key：好 key 回 isError「query is required」，坏 key 回
// isError「invalid_api_key」。顺手补一次 tools/list：这只工具改名或改入参是真出过的事。
const ANYSEARCH_DEFAULT_ENDPOINT = "https://api.anysearch.com/mcp";
// 与适配器发的版本一致；客户端支持的那个版本由我们决定，不跟服务端协商。
const ANYSEARCH_PROTOCOL_VERSION = "2025-11-25";
const ANYSEARCH_UNDETECTABLE: readonly UndetectableClass[] = ["quota"];
const LEGACY_REST_SUFFIX = "/v1/search";

/**
 * 适配器的 normalizeEndpoint 把 `/v1/search` 尾巴改写成 `/mcp`（env 兼容垫片）。
 * 探针问的必须是适配器真会问的那个地址，否则一个老 env 值就能让 --live 报假红。
 */
function normalizeAnySearchEndpoint(raw: string): string {
  const trimmed = raw.replace(/\/+$/, "");
  return trimmed.endsWith(LEGACY_REST_SUFFIX)
    ? trimmed.slice(0, -LEGACY_REST_SUFFIX.length) + "/mcp"
    : raw;
}

/** 探针在第一步就说不下去时，用它把结论一路抛到 catch。 */
class ProbeFault extends Error {
  constructor(readonly outcome: ProbeOutcome) {
    super("probe fault");
  }
}

/** 回包形状对不上（不是 key 的事，是入口变了）。 */
class ProbeProtocolFault extends Error {}

interface JsonRpcMessage {
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string };
}

export async function probeAnySearch(input: ProbeInput): Promise<ProbeOutcome> {
  const undetectable = ANYSEARCH_UNDETECTABLE;
  const endpoint = normalizeAnySearchEndpoint(input.endpoint ?? ANYSEARCH_DEFAULT_ENDPOINT);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // spec MUST：两种媒体类型都要在 Accept 里。
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": ANYSEARCH_PROTOCOL_VERSION,
  };
  if (input.apiKey) headers.Authorization = "Bearer " + input.apiKey;

  const post = (payload: Record<string, unknown>) =>
    probeFetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });

  try {
    const handshake = await readRpcReply(await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: ANYSEARCH_PROTOCOL_VERSION,
        capabilities: {},
        // 跟适配器发的 clientInfo 一致（那边也是写死的 0.2.0）：探针要量的就是产品那条路。
        clientInfo: { name: "anysearch-cli-doctor", version: "0.2.0" },
      },
    }), 1, undetectable);
    const protocolVersion = typeof handshake.protocolVersion === "string" ? handshake.protocolVersion : undefined;

    // 特性通知，产品也发；回 202 空体是正常的。这一步失败不该让整条探针变红，
    // 真正的判据在后两步。
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => undefined);

    const listed = await readRpcReply(await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }), 2, undetectable);
    const tools = readTools(listed, protocolVersion);
    // 工具改名或入参换掉，auth 好着也照样算失败：入口已经不在这儿了。
    if (!tools.searchTool || !tools.queryArg) {
      return { auth: "ok", undetectable, tools, problem: { class: "permanent-protocol" } };
    }

    const call = await readRpcReply(await post({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "search", arguments: {} },
    }), 3, undetectable);

    const callText = textOfToolsCall(call);
    if (call.isError === true) {
      if (AUTH_REJECTED_TEXT.test(callText)) {
        return { auth: "rejected", undetectable, tools, problem: { class: "permanent-auth" } };
      }
      // 「query is required」这类参数校验错：请求已经过了认证，这就是 key 有效的证据。
      return { auth: "ok", undetectable, tools };
    }
    // 空参数却回了结果 —— 上游没校验入参，形状变了。
    return { auth: "ok", undetectable, tools, problem: { class: "permanent-protocol" } };
  } catch (error) {
    if (error instanceof ProbeFault) return error.outcome;
    if (error instanceof ProbeProtocolFault) {
      return { auth: "unverified", undetectable, problem: { class: "permanent-protocol" } };
    }
    return networkOutcome(error, undetectable);
  }
}

/** 一次带 id 的 JSON-RPC 请求：HTTP 失败翻成结论，形状不对抛协议错。 */
async function readRpcReply(
  resp: Response,
  id: number,
  undetectable: readonly UndetectableClass[],
): Promise<Record<string, unknown>> {
  const body = await resp.text();
  if (!resp.ok) throw new ProbeFault(httpOutcome(resp.status, body, undetectable));
  const message = await parseRpcMessage(resp, body, id);
  if (message.error) {
    const text = String(message.error.message ?? "");
    if (AUTH_REJECTED_TEXT.test(text)) {
      throw new ProbeFault({ auth: "rejected", undetectable, problem: { class: "permanent-auth" } });
    }
    throw new ProbeProtocolFault("JSON-RPC error " + (message.error.code ?? "?"));
  }
  if (!message.result || typeof message.result !== "object") {
    throw new ProbeProtocolFault("no result object");
  }
  return message.result as Record<string, unknown>;
}

/** SSE 是这条传输的合法回法，JSON 是现在的常态；两种都认。 */
async function parseRpcMessage(resp: Response, body: string, id: number): Promise<JsonRpcMessage> {
  const contentType = (resp.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("text/event-stream")) {
    const events: EventSourceMessage[] = [];
    const parser = createParser({ onEvent: (event) => events.push(event) });
    parser.feed(body);
    for (const event of events) {
      if (!event.data) continue;
      const message = parseJsonMessage(event.data);
      if (String(message.id) === String(id)) return message;
    }
    throw new ProbeProtocolFault("SSE 里没有回 id " + id + " 的那条");
  }
  if (!contentType.includes("application/json")) {
    throw new ProbeProtocolFault("Content-Type 不是 JSON：" + (contentType || "(none)"));
  }
  const message = parseJsonMessage(body);
  if (String(message.id) !== String(id)) throw new ProbeProtocolFault("回包 id 对不上");
  return message;
}

/** 回包不是 JSON 也是入口变了（协议错），不该落到「连不上」那一栏。 */
function parseJsonMessage(text: string): JsonRpcMessage {
  try {
    return JSON.parse(text) as JsonRpcMessage;
  } catch {
    throw new ProbeProtocolFault("回包不是 JSON");
  }
}

/** tools/list 里 search 还在不在、入参还有没有 query。 */
function readTools(
  result: Record<string, unknown>,
  protocolVersion: string | undefined,
): NonNullable<ProbeOutcome["tools"]> {
  const list = Array.isArray(result.tools) ? (result.tools as Array<Record<string, unknown>>) : [];
  const search = list.find((tool) => tool?.name === "search");
  const schema = search?.inputSchema as { properties?: Record<string, unknown> } | undefined;
  const queryArg = Boolean(schema?.properties && "query" in schema.properties);
  return {
    count: list.length,
    searchTool: Boolean(search),
    queryArg,
    ...(protocolVersion ? { protocolVersion } : {}),
  };
}

function textOfToolsCall(result: Record<string, unknown>): string {
  const content = Array.isArray(result.content) ? (result.content as Array<{ text?: unknown }>) : [];
  return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join(" ");
}

const PROBES: Record<ProbeProviderId, (input: ProbeInput) => Promise<ProbeOutcome>> = {
  tavily: probeTavily,
  exa: probeExa,
  anysearch: probeAnySearch,
};

/** 这家有没有免费面探针。没登记的 provider 不猜，让调用方说清楚「还没接」。 */
export function isProbeProviderId(id: string): id is ProbeProviderId {
  return Object.prototype.hasOwnProperty.call(PROBES, id);
}

/** 按 provider id 取那一条免费面探针。id 必须先过 isProbeProviderId。 */
export function probeProviderAuth(provider: ProbeProviderId, input: ProbeInput): Promise<ProbeOutcome> {
  return PROBES[provider](input);
}
