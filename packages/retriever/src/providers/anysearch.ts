// AnySearch provider adapter (ADR-0005 decision 3; ADR-0082 branch b; R82 T1 fix-r82-anysearch-mcp-migration).
// Transport: hand-rolled thin JSON-RPC over POST /mcp (MCP Streamable HTTP — the
// endpoint is stateless: no GET stream, no protocol-level session, no
// Mcp-Session-Id observed; initialize/tools-list/tools-call verified live
// 2026-09-24, .scratch/grill-round-82/evidence/).
// Contract: tools/call search takes {query, max_results (max 10), domain,
// sub_domain, sub_domain_params}; result.content[].text is a markdown envelope
// (## Search Results (N results, Tms) + ### N. title + - **URL**: u +
// snippet lines); structuredContent absent as of 2026-09-24 (parsed first if a
// future server ships it). result.isError:true (e.g. invalid_api_key) fails
// the arm — fail-first, never a silent zero-result envelope.
// Endpoint: https://api.anysearch.com/mcp
// Auth: optional API key via Authorization: Bearer; anonymous access works.

import { createParser, type EventSourceMessage } from "eventsource-parser";
import type { SearchProvider, SearchRequest, NormalizedResult, ProviderEnvelope } from "../contract";

// ADR-0059 D7 (T-6.4) DEFERRED-WITH-DEADLINE: ownership of api.anysearch.com is an internal
// confirmation item (legal/ops), not a code decision. Round-58 verification surface was the
// infrastructure layer only (CloudFront CNAME + cert + status subdomain); R81 re-verified
// (ADR-0082): cert rotated 2026-09-22, valid to 2027-04-07 (Amazon RSA 2048 M04,
// SAN *.anysearch.com+anysearch.com); /health 200, apex/status 200 — infrastructure alive.
// GET /v1/search = 404 route-level dead (R81 T2 P-A, dual-column); POST /mcp = live MCP
// Streamable HTTP endpoint — this adapter speaks MCP only.
// Fail-open: an unreachable endpoint or malformed reply degrades the anysearch arm,
// never the fused envelope.
// Owner: anysearch-retriever (docs/deferred-registry.json: defer-anysearch-domain-ownership).
// Review: quarterly cadence (ADR-0010 precedent); CT/expiry monitoring tracks the cert renewal.
const ANYSEARCH_ENDPOINT = "https://api.anysearch.com/mcp";

// Client-supported protocol version, sent on every POST per spec MUST. The
// endpoint negotiates down: requesting 2026-07-28 returns 2025-11-25
// (R82 T1 probe) — we still forward whatever initialize negotiated.
const MCP_PROTOCOL_VERSION = "2025-11-25";

const LEGACY_REST_SUFFIX = "/v1/search";
let endpointRewriteWarned = false;

// ADR-0082 / D-002 §3: env-compat — an ANYSEARCH_ENDPOINT (or explicit arg)
// ending in the retired REST suffix is normalized to base+/mcp with a
// once-per-process warning; any other value is used verbatim (dead-port
// injection for install-smoke stays as-given).
function normalizeEndpoint(raw: string): string {
  const trimmed = raw.replace(/\/+$/, "");
  if (!trimmed.endsWith(LEGACY_REST_SUFFIX)) return raw;
  const rewritten = trimmed.slice(0, -LEGACY_REST_SUFFIX.length) + "/mcp";
  if (!endpointRewriteWarned) {
    endpointRewriteWarned = true;
    process.stderr.write(
      "[anysearch] endpoint ends with " + LEGACY_REST_SUFFIX +
      " — REST route is retired (ADR-0082); rewritten to " + rewritten + "\n",
    );
  }
  return rewritten;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

interface McpToolResult {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: { results?: Array<{ title?: string; url?: string; snippet?: string; content?: string }> };
  isError?: boolean;
}

// HTTP 404 on a session-id'd request = the server terminated the session —
// spec MUST: start a new session (re-initialize) before retrying.
class SessionExpiredError extends Error { }

// SSE replies are legal on this transport (spec MUST support both media types)
// even though the live endpoint answers application/json today — parse frames
// via eventsource-parser (the SDK's own ~2KB parser; no hand-rolled state
// machine) and pick the JSON-RPC message matching our request id.
async function readSseJsonRpc(resp: Response, id: number, method: string): Promise<JsonRpcMessage> {
  const events: EventSourceMessage[] = [];
  const parser = createParser({ onEvent: (e) => events.push(e) });
  parser.feed(await resp.text());
  let match: JsonRpcMessage | undefined;
  for (const ev of events) {
    if (!ev.data) continue;
    const m = JSON.parse(ev.data) as JsonRpcMessage;
    if (m.id === id) match = m;
  }
  if (!match) throw new Error("AnySearch MCP " + method + " SSE stream carried no reply for id " + id);
  return match;
}

function toResult(url: string, title: string, snippet: string): NormalizedResult {
  return { url, title: title || url, snippet: snippet.slice(0, 500), source: "anysearch" };
}

function mapStructuredResults(list: Array<{ title?: string; url?: string; snippet?: string; content?: string }>): NormalizedResult[] {
  return list
    .filter((r) => typeof r?.url === "string" && r.url.length > 0)
    .map((r) => toResult(r.url!, r.title ?? "", r.snippet ?? r.content ?? ""));
}

// ## Search Results (N results, Tms) envelope → blocks of ### N. title +
// - **URL**: u + free-text snippet lines. Tolerant: a block with no title
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

// Fail-first mapping (D-002 §2): isError / wrong-shape 200 / unexpected
// Content-Type all throw — the engine degrades the arm, never a silent zero.
function mapToolsCallResult(result: Record<string, unknown>): { results: NormalizedResult[]; elapsedMs?: number } {
  const r = result as McpToolResult;
  if (r.isError === true) {
    const t = (r.content ?? []).map((c) => c?.text ?? "").join(" ").slice(0, 200);
    throw new Error("AnySearch MCP tools/call isError: " + (t || "(no text)"));
  }
  const sc = r.structuredContent;
  if (sc && Array.isArray(sc.results)) {
    return { results: mapStructuredResults(sc.results) };
  }
  const texts = (r.content ?? [])
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string);
  const md = texts.join("\n");
  if (!md.trim()) throw new Error("AnySearch MCP tools/call returned no text content");
  if (!/##\s+Search Results/.test(md)) {
    // Alive-but-wrong-shape (the OmniRoute enumeration family is one) — fail.
    throw new Error("AnySearch MCP tools/call malformed text (no '## Search Results' header)");
  }
  return parseSearchMarkdown(md);
}

export class AnySearchProvider implements SearchProvider {
  readonly id = "anysearch";
  // R82 T1 eval leg: the MCP domain param is a vertical-routing enum
  // (academic..travel, 17 values) — NOT a hostname allowlist, so it cannot
  // carry SearchRequest.includeDomains. This arm stays post-filter-only;
  // vertical passthrough is a contract-surface change tracked for R83.
  readonly domainFilterSupported = false;
  readonly modes: readonly ("fast" | "index" | "deep" | "answer")[] = ["fast", "index", "deep"];
  // ponytail: AnySearch has no answer mode like Tavily/Exa; the wire schema
  // has no mode param at all (additionalProperties risk), so req.mode is never
  // sent — an answer intent degrades to a plain search (mapping documented in
  // .scratch/grill-round-82/issues/01-fix-r82-anysearch-mcp-migration.md).
  private apiKey?: string;
  private endpoint: string;
  private protocolVersion = MCP_PROTOCOL_VERSION;
  private sessionId?: string;
  private handshake?: Promise<void>;
  private nextId = 1;

  constructor(apiKey?: string, endpoint?: string) {
    this.apiKey = apiKey ?? process.env.ANYSEARCH_API_KEY;
    // ADR-0063 (R62 T2) + R82 D-002 §3: ANYSEARCH_ENDPOINT env override —
    // dead-port fault injection keeps the install-smoke offline leg hermetic;
    // a retired /v1/search tail is normalized to base+/mcp. Explicit arg wins.
    this.endpoint = normalizeEndpoint(endpoint ?? process.env.ANYSEARCH_ENDPOINT ?? ANYSEARCH_ENDPOINT);
  }

  async search(req: SearchRequest, signal: AbortSignal): Promise<ProviderEnvelope> {
    const start = Date.now();
    let result: Record<string, unknown>;
    try {
      result = await this.callSearch(req, signal);
    } catch (e) {
      if (!(e instanceof SessionExpiredError)) throw e;
      // 404 on a session-id'd request: spec MUST re-initialize, one clean retry.
      this.sessionId = undefined;
      this.handshake = undefined;
      result = await this.callSearch(req, signal);
    }
    const mapped = mapToolsCallResult(result);
    return {
      provider: "anysearch",
      results: mapped.results,
      answers: [],
      elapsedMs: mapped.elapsedMs ?? (Date.now() - start),
      usage: undefined,
    };
  }

  private async callSearch(req: SearchRequest, signal: AbortSignal): Promise<Record<string, unknown>> {
    await this.ensureInitialized(signal);
    return this.rpc("tools/call", {
      name: "search",
      arguments: {
        query: req.query,
        // MCP schema: max_results maximum 10 — silent clamp (D-002 §4).
        max_results: Math.min(Math.max(req.maxResults ?? 10, 1), 10),
      },
    }, signal);
  }

  private ensureInitialized(signal: AbortSignal): Promise<void> {
    // initialize -> notifications/initialized, once per provider instance
    // (endpoint is stateless — there is no session to preserve). A failed
    // handshake resets so the next call retries cleanly.
    this.handshake ??= (async () => {
      const res = await this.rpc("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "anysearch-cli", version: "0.0.8" },
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
      // spec MUST: both media types on Accept.
      "Accept": "application/json, text/event-stream",
      // spec MUST (post-2026-07-28): every POST carries the protocol version.
      "MCP-Protocol-Version": this.protocolVersion,
    };
    if (this.apiKey) headers["Authorization"] = "Bearer " + this.apiKey;
    // spec MUST: when the server assigns one at initialize, echo it onwards.
    if (this.sessionId) headers["MCP-Session-Id"] = this.sessionId;
    const resp = await fetch(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal,
    });
    const assigned = resp.headers.get("mcp-session-id");
    if (assigned) this.sessionId = assigned;
    if (resp.status === 404 && this.sessionId) {
      throw new SessionExpiredError("AnySearch MCP " + String(payload.method) + " HTTP 404 (session terminated)");
    }
    const id = payload.id as number | undefined;
    if (id === undefined) {
      // notification — 202 with an empty body is the normal answer.
      if (!resp.ok) throw new Error("AnySearch MCP " + String(payload.method) + " HTTP " + resp.status);
      return undefined;
    }
    if (!resp.ok) {
      throw new Error("AnySearch MCP " + String(payload.method) + " HTTP " + resp.status + " " + resp.statusText);
    }
    const ct = (resp.headers.get("content-type") ?? "").toLowerCase();
    let msg: JsonRpcMessage;
    if (ct.includes("text/event-stream")) {
      msg = await readSseJsonRpc(resp, id, String(payload.method));
    } else if (ct.includes("application/json")) {
      msg = JSON.parse(await resp.text()) as JsonRpcMessage;
      // spec MUST: the response id echoes the request id — a mismatched
      // JSON reply is as malformed as a missing one.
      if (msg.id !== undefined && msg.id !== null && String(msg.id) !== String(id)) {
        throw new Error("AnySearch MCP " + String(payload.method) + " reply id mismatch (expected " + id + ", got " + String(msg.id) + ")");
      }
    } else {
      throw new Error("AnySearch MCP " + String(payload.method) + " unexpected Content-Type: " + (ct || "(none)"));
    }
    if (msg.error) {
      throw new Error("AnySearch MCP " + String(payload.method) + " JSON-RPC error " + (msg.error.code ?? "?") + ": " + (msg.error.message ?? "?"));
    }
    return msg;
  }

  async usage(): Promise<{ remaining?: number; limit?: number; resetAt?: string } | undefined> {
    // ponytail: AnySearch usage not exposed via a standalone API.
    return undefined;
  }
}
