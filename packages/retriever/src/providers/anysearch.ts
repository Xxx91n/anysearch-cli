// AnySearch provider adapter (decision 3; branch b; fix-r82-anysearch-mcp-migration).
// Transport: hand-rolled thin JSON-RPC over POST /mcp (MCP Streamable HTTP — the
// endpoint is stateless: no GET stream, no protocol-level session, no
// Mcp-Session-Id observed; initialize/tools-list/tools-call verified live
// 2026-09-24, .scratch/grill-round-82/evidence/).
// Contract: tools/call search takes {query, max_results (max 10), domain,
// sub_domain, sub_domain_params}; result.content[].text is a markdown envelope
// (## Search Results (N results, Tms) + ### N. title + - **URL** u +
// snippet lines); structuredContent absent as of 2026-09-24 (parsed first if a
// future server ships it). result.isError:true (e.g. invalid_api_key) fails
// the arm — fail-first, never a silent zero-result envelope.
// Endpoint: https://api.anysearch.com/mcp
// Auth: optional API key via Authorization: Bearer; anonymous access works.

import { createParser, type EventSourceMessage } from "eventsource-parser";
import type { Mode, SearchProvider, SearchRequest, NormalizedResult, ProviderEnvelope, ProviderErrorClass } from "../contract";
import { canonicalizeVertical, classifyProviderError, isExplicitAuthFault, providerErrorMarker, QUOTA_EXHAUSTED_TEXT, PROVISIONING_REPLY_TEXT, stripErrorClassMarkers } from "../contract";
import { redactSecrets } from "../redact";
import { PROVIDER_FACTS } from "./provider-facts";

// CONFIRMED (2026-11-04, closes #15): api.anysearch.com is the official vendor
// endpoint — the deferred legal/ops ownership item is settled. Official evidence:
// github.com/anysearch-ai/anysearch-mcp-server README names this exact endpoint
// ("The production endpoint is: https://api.anysearch.com/mcp", Streamable HTTP);
// the key console lives on the apex domain (anysearch.com/console/api-keys) and the
// official register route (POST /v1/auth/email/register) is served from this same
// host; the wildcard cert (rotated 2026-09-22, valid to 2027-04-07, Amazon RSA 2048
// M04, SAN *.anysearch.com+anysearch.com) covers apex + api as one operator;
// /health 200 re-verified 2026-11-04 (code:0 envelope, request_id present).
// History: deferred round 58 as an internal legal/ops confirmation, not a code
// decision (ADR-0059 D7 / T-6.4; then-registry entry defer-anysearch-domain-ownership,
// owner anysearch-retriever); the registry was removed with the governance layer
// (5593fe05) and GitHub issue #15 carried the open item — this block is its live
// record now.
// REST facts (live probe 2026-11-07): GET /v1/search = 404; POST /v1/search = 200
// with a code:0 envelope — the official REST route is live, so GET-dead is not
// REST-dead. This adapter speaks MCP only (POST /mcp = live MCP Streamable HTTP);
// a /v1/search endpoint is rewritten to /mcp as a compatibility shim, not because
// REST was retired. The reply's request_id is a server-generated diagnostic UUID
// (also X-Request-ID), never an idempotency key.
// Fail-open: an unreachable endpoint or malformed reply degrades the anysearch arm,
// never the fused envelope.
// Review: CT/expiry watch remains (cert valid to 2027-04-07) — re-confirm on the
// next rotation.
// 默认地址和协议版本本身在 provider-facts 的 PROVIDER_FACTS.anysearch 那一格：这个适配器、
// 免费面探针、provider 探针都从那里取，这里不再留字面量。

const LEGACY_REST_SUFFIX = "/v1/search";
let endpointRewriteWarned = false;

// §3: env-compat — an ANYSEARCH_ENDPOINT (or explicit arg)
// ending in the REST search suffix is normalized to base+/mcp with a
// once-per-process warning (this adapter speaks MCP only; the rewrite is a
// compatibility shim, not a retirement claim); any other value is used verbatim
// (dead-port injection for install-smoke stays as-given).
function normalizeEndpoint(raw: string): string {
  const trimmed = raw.replace(/\/+$/, "");
  if (!trimmed.endsWith(LEGACY_REST_SUFFIX)) return raw;
  const rewritten = trimmed.slice(0, -LEGACY_REST_SUFFIX.length) + "/mcp";
  if (!endpointRewriteWarned) {
    endpointRewriteWarned = true;
    process.stderr.write(
      "[anysearch] endpoint ends with " + LEGACY_REST_SUFFIX +
      " — this adapter speaks MCP only; rewritten to " + rewritten + "\n",
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

// Name a reply failure by its text; providerErrorMarker carries the class.
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
  const classifier = classifyProviderError(stripErrorClassMarkers(md));
  const guessed = replyFailurePrefix(md);
  if (!guessed) return { classifier };
  if (isExplicitAuthFault(classifier)) {
    return { classifier, failure: { cls: classifier, prefix: "auth fault: upstream rejected the credential" } };
  }
  return { classifier, failure: guessed };
}

// #214: result._meta.request_id is a server-generated diagnostic correlation id
// (live probe 2026-11-07). It is captured for the observation trace only — never
// merged into results and never treated as an idempotency key. The 128-char cap
// is generous for a UUID (36 chars) and bounds the span attribute a misbehaving
// upstream could otherwise inflate.
const MAX_REQUEST_ID_LENGTH = 128;

function requestIdOf(result: Record<string, unknown>): string | undefined {
  const meta = result._meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
  const requestId = (meta as { request_id?: unknown }).request_id;
  return typeof requestId === "string" && requestId.length > 0
    ? requestId.slice(0, MAX_REQUEST_ID_LENGTH)
    : undefined;
}

// Fail-first mapping (§2): isError / wrong-shape 200 / unexpected
// Content-Type all throw — the engine degrades the arm, never a silent zero.
function mapToolsCallResult(result: Record<string, unknown>): { results: NormalizedResult[]; elapsedMs?: number } {
  const r = result as McpToolResult;
  if (r.isError === true) {
    const full = (r.content ?? []).map((c) => c?.text ?? "").join(" ");
    const { failure, classifier } = readReply(full);
    // Fix the class here (reply marker, else the shared classifier); the
    // marker goes before the displayed copy.
    const cls = failure?.cls ?? (classifier === "unknown" ? "permanent-protocol" : classifier);
    const shown = redactSecrets(full, { keepPaths: false })
      .replace(KEY_FIELD_GLOBAL, "api_key=[redacted]")
      .slice(0, 200);
    const head = (failure ? failure.prefix : "isError") + " " + providerErrorMarker(cls);
    throw new Error("AnySearch MCP tools/call " + head + " [upstream text: " + (shown || "(no text)") + "]");
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
    // Not a results envelope: name it by the reply text (provisioning boundary,
    // exhausted plan, throttle) before calling it malformed. A provisioning
    // payload ("account ... automatically generated ... api_key=...") is the
    // free quota ending, not protocol drift → free-quota-exhausted; a used-up
    // plan is quota-exhausted even when the wording is Chinese 额度.
    const { failure } = readReply(md);
    if (failure) throw new Error("AnySearch MCP tools/call " + failure.prefix + " " + providerErrorMarker(failure.cls));
    // Alive-but-wrong-shape (the OmniRoute enumeration family is one) — fail.
    throw new Error("AnySearch MCP tools/call malformed text (no '## Search Results' header)");
  }
  return parseSearchMarkdown(md);
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
  // ponytail: AnySearch has no answer mode like Tavily/Exa; the wire schema
  // has no mode param at all (additionalProperties risk), so req.mode is never
  // sent — an answer intent degrades to a plain search (mapping documented in
  // .scratch/grill-round-82/issues/01-fix-r82-anysearch-mcp-migration.md).
  private apiKey?: string;
  private endpoint: string;
  private protocolVersion: string = PROVIDER_FACTS.anysearch.mcpProtocolVersion;
  private sessionId?: string;
  private handshake?: Promise<void>;
  private nextId = 1;

  constructor(apiKey?: string, endpoint?: string) {
    // same empty-string treatment for the key — "" would send a
    // bare "Authorization: Bearer " header, worse than anonymous.
    this.apiKey = apiKey ?? (process.env.ANYSEARCH_API_KEY || undefined);
    // + §3: ANYSEARCH_ENDPOINT env override —
    // dead-port fault injection keeps the install-smoke offline leg hermetic;
    // a /v1/search tail is normalized to base+/mcp (this adapter speaks
    // MCP only, so the rewrite is a compatibility shim). Explicit arg wins.
    // defer-r84 closure: POSIX empty-string env == unset — ""
    // is a value for ?? (not nullish), so the chain used to fall to an
    // empty endpoint and every call failed into providersFailed.
    this.endpoint = normalizeEndpoint(endpoint ?? (process.env.ANYSEARCH_ENDPOINT || undefined) ?? PROVIDER_FACTS.anysearch.freeProbe.endpoint);
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
      provider: "anysearch",
      results: mapped.results,
      answers: [],
      elapsedMs: mapped.elapsedMs ?? (Date.now() - start),
      usage: undefined,
      ...(requestId ? { diagnostics: { requestId } } : {}),
    };
  }

  private async callSearch(req: SearchRequest, signal: AbortSignal): Promise<Record<string, unknown>> {
    await this.ensureInitialized(signal);
    return this.rpc("tools/call", {
      name: "search",
      arguments: {
        query: req.query,
        // MCP schema: max_results maximum 10 — silent clamp (§4).
        max_results: Math.min(Math.max(req.maxResults ?? 10, 1), 10),
        // wire layer — internal vertical* fields map to
        // the MCP domain/sub_domain/sub_domain_params argument names. Absent
        // vertical → all three keys stay absent (no empty-string defaults).
        // canonicalized at the wire edge too — params:{} ≡ absent
        // (single truth source: canonicalizeVertical in contract.ts).
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
      },
    }, signal);
  }

  private ensureInitialized(signal: AbortSignal): Promise<void> {
    // initialize -> notifications/initialized, once per provider instance
    // (endpoint is stateless — there is no session to preserve). A failed
    // handshake resets so the next call retries cleanly.
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
      // spec MUST: the response id echoes the request id — nit fix:
      // symmetric with the SSE path, a missing id is as malformed as a
      // mismatched one.
      if (msg.id === undefined || msg.id === null || String(msg.id) !== String(id)) {
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
    // ponytail: the MCP surface (tools/list) has no usage tool, so there is nothing to map.
    return undefined;
  }
}
