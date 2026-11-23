import type { AttributionReport } from "./attribution";

// SearchProvider contract: normalized interface for all search providers.
// Split 1 from the atomcode kernel-split research.

export type Mode = "fast" | "index" | "deep" | "answer";

export interface SearchRequest {
  query: string;
  mode: Mode;
  maxResults?: number;
  // capability-negotiated provider pre-filter. Kernel sets this
  // per provider to the domain's canonical allow hosts; only adapters that declare
  // domainFilterSupported forward it (tavily include_domains / exa includeDomains).
  // The provider parameter is an entry-convergence hint, never the authority —
  // the kernel post-filter remains the fail-closed egress gate.
  includeDomains?: string[];
  // vertical-domain routing spec — orthogonal to
  // includeDomains (host allowlist axis ≠ provider-side vertical route enum).
  // Internal field is vertical*; the wire mapping to MCP domain/sub_domain/
  // sub_domain_params happens only inside the anysearch provider adapter.
  // Query-level callers set this wholesale (no deep-merge with repo defaults).
  vertical?: {
    domain: string;
    subDomain?: string;
    params?: Record<string, unknown>;
  };
}

export type VerticalSpec = NonNullable<SearchRequest["vertical"]>;

// (draft): canonical vertical spec — the single truth
// source for wire semantics. sub_domain_params serializes only when params is
// a non-empty Record: an empty object, a non-object, or an array all
// canonicalize to ABSENT (empty carries no signal; protobuf/JSON API
// convention: empty map ≈ unset). params_keys audit attrs read the
// canonicalized spec, so [] and wire-absent are the same truth.
// Entry surfaces (CLI flags / MCP tool args / engine resolution) all converge
// through this function so the echoed spec IS the sent spec.
export function canonicalizeVertical(v: VerticalSpec): VerticalSpec {
  const params = v.params;
  const paramsOk =
    params !== undefined &&
    typeof params === "object" &&
    params !== null &&
    !Array.isArray(params) &&
    Object.keys(params).length > 0;
  return {
    domain: v.domain,
    ...(v.subDomain !== undefined ? { subDomain: v.subDomain } : {}),
    ...(paramsOk ? { params } : {}),
  };
}

// -D2: single authority for vertical-spec guard +
// assembly. The three entry surfaces (CLI flags, search_web, research_web)
// share this layer; the guard verdict travels as a structured reason and
// each surface renders its own copy (IpcError-pattern: the enum travels,
// the surface renders — the reason→copy map is legislated in ②).
// "domain absent" covers undefined AND empty/whitespace-only — empty carries
// no signal (same convention as params:{} ≡ absent); entry surfaces reject
// empty domains earlier (CLI non-empty-string check, schema minLength:1), so
// the whitespace leg here is a defensive floor only — it can fire only on an
// MCP surface passing a whitespace-only domain past minLength:1.
export type VerticalSpecRejectReason = "missing-domain";

// Guard predicate alone — surfaces that must render the rejection before
// decoding the params payload (CLI flag path) take the verdict from here;
// params is accepted as unknown so a not-yet-parsed value still counts as
// present.
export function verticalSpecReject(input: {
  domain?: string;
  subDomain?: string;
  params?: unknown;
}): VerticalSpecRejectReason | null {
  const domainAbsent = input.domain === undefined || input.domain.trim() === "";
  return domainAbsent && (input.subDomain !== undefined || input.params !== undefined)
    ? "missing-domain"
    : null;
}

export type BuildVerticalSpecResult =
  | { ok: true; vertical: VerticalSpec | undefined }
  | { ok: false; reason: VerticalSpecRejectReason };

export function buildVerticalSpec(input: {
  domain?: string;
  subDomain?: string;
  params?: Record<string, unknown>;
}): BuildVerticalSpecResult {
  const reason = verticalSpecReject(input);
  if (reason !== null) return { ok: false, reason };
  if (input.domain === undefined || input.domain.trim() === "") return { ok: true, vertical: undefined };
  return {
    ok: true,
    vertical: canonicalizeVertical({
      domain: input.domain,
      ...(input.subDomain !== undefined ? { subDomain: input.subDomain } : {}),
      ...(input.params !== undefined ? { params: input.params } : {}),
    }),
  };
}

export interface NormalizedResult {
  url: string;
  title: string;
  snippet: string;
  source: string; // provider id
  publishedAt?: string;
  extra?: Record<string, unknown>;
  // entity configurable — overrides URL as entity key for multi-URL same-entity scenarios.
  entity?: string;
}

// Upstream transport diagnostics. Correlation ids only — never result data and
// never idempotency keys (AnySearch's reply `_meta.request_id` is a
// server-generated diagnostic UUID). The engine forwards them to the
// observation span; the fused envelope stays free of transport metadata.
export interface ProviderDiagnostics {
  requestId?: string;
}

export interface ProviderEnvelope {
  provider: string;
  results: NormalizedResult[];
  answers?: string[]; // for "answer" mode providers
  // parallel provider-attributed answers with optional citations.
  // answers and answersMeta must have the same length when both are populated; the engine
  // aligns per-index and prefers answersMeta over re-deriving provider attribution.
  // Answers remain text-only in FusedEnvelope.answers; provenance moves to metadata.providerAnswers.
  answersMeta?: ProviderAnswer[];
  elapsedMs: number;
  usage?: UsageInfo;
  // #214: observation-only seam — consumed by the engine's observation span,
  // never merged into results or user-facing output.
  diagnostics?: ProviderDiagnostics;
}

export interface UsageInfo {
  remaining?: number;
  limit?: number;
  resetAt?: string;
}

export interface SearchProvider {
  readonly id: string;
  readonly modes: readonly Mode[];
  // domain-filter capability bit. true = the adapter forwards
  // SearchRequest.includeDomains to a provider-side domain parameter. Absent or
  // false = unsupported; the engine degrades that provider to post-filter-only
  // and records it in the retrieval.domain_filter.pre audit event.
  readonly domainFilterSupported?: boolean;
  // vertical-domain capability bit — same shape as
  // domainFilterSupported. true = the adapter maps SearchRequest.vertical to
  // provider-side domain/sub_domain/sub_domain_params. Absent/false = the
  // provider fans out on the general axis and is named in the
  // retrieval.vertical.pre audit event's degraded list (a hint, never abstain).
  readonly verticalDomainSupported?: boolean;
  search(req: SearchRequest, signal: AbortSignal): Promise<ProviderEnvelope>;
  usage?(): Promise<UsageInfo | undefined>;
}

// Four-segment sufficiency signal.
// verdict: CRAG three-state quantifier aggregation (correct/incorrect/ambiguous).
// agreement: rank-derived (Jaccard@K + RBO@K), always computable.
// volume: hygiene signals (uniqueResults/uniqueDomains/successfulProviders).
// spread: rrfVariance (rank-derived weak signal) + scoreScale (native score dimension).
// perProvider: native scores attached, explicitly not cross-source normalized.
// Hard ceiling: cheap-signal AUC ceiling approx 0.76 — the signal only promises escalate.
export interface SufficiencySignal {
  verdict: "correct" | "incorrect" | "ambiguous";
  agreement: {
    jaccardAtK: number;
    rboAtK: number;
  };
  volume: {
    uniqueResults: number;
    uniqueDomains: number;
    successfulProviders: number;
  };
  spread: {
    rrfVariance: number;
    scoreScale?: { min: number; max: number };
  };
  perProvider?: Record<string, number[]>;
}

// provider answer with mandatory unverified marker + optional citations.
// Single source of truth for the providerAnswers item shape — ProviderEnvelope.answersMeta
// and FusedEnvelope.metadata.providerAnswers both reference this alias.
export interface ProviderAnswer {
  provider: string;
  text: string;
  verified: false;
  citations?: Array<{ url: string; title?: string }>;
}

// per-web-run observational ledger. It is intentionally separate from
// the gated sufficiency signal and may never drive a ship verdict or durable table.
export interface WebProviderLedger {
  providerOverlap: Record<string, number>;
  exclusiveHits: Record<string, number>;
  nativeScoresMissing: Record<string, number>;
  failures: string[];
}

// (r118 impl): common fusion provenance shape — the six registered fields
// instance/labels/lists/weights/fusedIds/scoreKind. Memory-only texts (session-store ArmProvenance)
// and web-only nativeScores (below) are instance extensions on top of this base.
export interface FusionProvenance {
  instance: "memory" | "web";
  labels: string[];      // arm labels or provider ids, parallel to lists/weights
  lists: string[][];     // pre-truncation per-source key lists (memory: rowids; web: normalized urls)
  weights: number[];     // effective per-list weights used for this fusion run
  fusedIds: string[];    // full fused id order (pre-truncation)
  // D3: fused score is a rank_fusion signal only — never confidence/threshold/cross-query comparable.
  scoreKind: "rank_fusion";
}

// provider-failure error classes — carried by
// FusedEnvelope.metadata.providerErrorClasses so eval artifacts record a
// category next to the flag, never the flag alone.
// 5xx/429/rate limits/network errors → transient; 401/403/bad key and the
// x402 payment challenge → permanent-auth; used-up plan text and a plain 402
// (key valid, retrying will not help) → quota-exhausted; the free quota's
// allowance used up (no key yet, and a key is one way back) →
// free-quota-exhausted; malformed or drifted replies → permanent-protocol;
// HTTP 404 on a session-id request → session-expired (the spec-MUST
// re-initialize retry already fired once).

// Quota wording shared by every path that reads a provider message, including
// the adapters that classify a reply body themselves.
export const QUOTA_EXHAUSTED_TEXT = "exceeds your plan|usage limit|quota exceeded|quota exhausted|quota reached|quota limit exceeded|exceeded your quota|insufficient credits|out of credits|(?:余额|额度|配额|次数)[^，。\\n]{0,10}(?:用完|用尽|耗尽|不足|上限|超限|超出)";
const QUOTA_EXHAUSTED_RE = new RegExp(QUOTA_EXHAUSTED_TEXT, "i");

// AnySearch ends the free quota with a sign-up/issued-key reply instead of
// results. The phrase has to be about getting the key itself — the
// automatic-generation wording needs an account or key next to it, so "this
// bill was automatically generated" is no wall. Shared with the adapter that
// reads the reply text, so the two matchers cannot drift.
export const PROVISIONING_REPLY_TEXT = "(?:account|api key|api_key)[^.]{0,40}automatically generated|automatically generated[^.]{0,40}(?:account|api key|api_key)|(?:api )?key (?:has been |was |is )?issued|issued (?:an? )?(?:api )?key|sign[ -]?up (?:to|for) (?:get|obtain)[^.]*key";
const PROVISIONING_REPLY_RE = new RegExp(PROVISIONING_REPLY_TEXT, "i");

// Tavily's keyless cap: @tavily/core raises TavilyKeylessLimitError and keeps
// the cap kind on the error object (capType), never in the message body.
const KEYLESS_CAP_RE = /TavilyKeylessLimitError|daily_cap_reached/i;

// Class all providers share. The type and the marker parser read the same list,
// so adding a class cannot silently fall back to word matching.
export const ERROR_CLASSES = [
  "transient",
  "permanent-auth",
  "quota-exhausted",
  "free-quota-exhausted",
  "permanent-protocol",
  "session-expired",
  "unknown",
] as const;
export type ProviderErrorClass = (typeof ERROR_CLASSES)[number];

// Classifies the String(err) seam form — Error names ride inside the string
// ("SessionExpiredError: AnySearch MCP tools/call HTTP 404 ..."), so the
// matcher sees name and message at once.
//
// An adapter that already knows the class marks it with providerErrorMarker();
// the marker wins, so the upstream text echoed after it can never flip the
// class. Without a marker the words of the message are the only signal.
const ERROR_CLASS_MARKER = "provider-error-class:";
const EXPLICIT_CLASS = new RegExp(ERROR_CLASS_MARKER + "(" + ERROR_CLASSES.join("|") + ")");
const MARKER_TEXT = new RegExp(ERROR_CLASS_MARKER + "(" + ERROR_CLASSES.join("|") + ")", "gi");

// Drop class markers from upstream text, so a reply cannot choose its own
// class before the adapter writes the real one.
export function stripErrorClassMarkers(text: string): string {
  return text.replace(MARKER_TEXT, "");
}

// Classes that name a credential fault outright. An adapter that guessed a
// class from reply wording has to let one of these win: "your API key was
// issued for a different project" is a 403, not a used-up free allowance.
export function isExplicitAuthFault(cls: ProviderErrorClass): boolean {
  return cls === "permanent-auth" || cls === "session-expired";
}

export function providerErrorMarker(cls: ProviderErrorClass): string {
  return "[" + ERROR_CLASS_MARKER + cls + "]";
}

export function classifyProviderError(errText: string): ProviderErrorClass {
  const t = String(errText);
  const explicit = t.match(EXPLICIT_CLASS);
  if (explicit) return explicit[1] as ProviderErrorClass;
  const http = (code: string) => t.includes("HTTP " + code);
  // An SDK keeps the status on the error object (exa-js: ExaError.statusCode),
  // so providerErrorText writes it into the text as `status=<n>`. Read that
  // form too: a 403 that never says "HTTP 403" must not be guessed from the
  // body words.
  const statusOf = (code: string) => http(code) || new RegExp("\\bstatus(?:Code)?\\s*[:=]?\\s*" + code + "\\b", "i").test(t);
  // The same structured status for a whole family: a `status=500` in the text
  // is a 5xx just as much as the words "HTTP 500" are.
  const statusFamily = (lead: string) => new RegExp("\\bstatus(?:Code)?\\s*[:=]?\\s*" + lead + "\\d\\d\\b", "i").test(t);
  const is402 = statusOf("402") || /payment required/i.test(t);
  // A 402 is one of two things: the x402 payment challenge means no key was
  // sent, while the standard envelope means the key is valid but out of
  // credits. Only the structured challenge marks say which.
  const x402Challenge = /X402_PAYMENT_REQUIRED|x402Version|maxTimeoutSeconds/i.test(t);
  if (/SessionExpiredError|session terminated/i.test(t)) return "session-expired";
  if (statusOf("401") || statusOf("403") || x402Challenge || /invalid_api_key|invalid api key|unauthorized|forbidden/i.test(t)) return "permanent-auth";
  // Design: the free quota's wall sits between the auth shapes and the retry
  // shapes — an explicit auth fault outranks wording a cap reply may share with
  // it ("this API key was issued for a different project" is a 403, not a
  // quota), while a cap reply that also carries a 429/5xx must not be read as
  // an ordinary throttle.
  if (KEYLESS_CAP_RE.test(t) || PROVISIONING_REPLY_RE.test(t)) return "free-quota-exhausted";
  if (/HTTP 5[0-9][0-9]/.test(t) || statusFamily("5") || statusOf("429") || /rate.?limit|too many requests/i.test(t) || /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|timed? ?out|socket hang up/i.test(t)) return "transient";
  // The key is valid but the plan is used up: rotating the key or retrying
  // does nothing, the owner must top up. Checked after the retryable shapes so
  // a 429/5xx that also says "usage limit" stays transient; a 402 without the
  // x402 marks is the keyed request's quota wall.
  if (is402 || QUOTA_EXHAUSTED_RE.test(t)) return "quota-exhausted";
  if (/malformed|Search Results|unexpected Content-Type|no result object|reply id mismatch|isError|no text content/i.test(t)) return "permanent-protocol";
  if (/HTTP 4[0-9][0-9]/.test(t) || statusFamily("4")) return "permanent-protocol";
  return "unknown";
}

// The text form the classifier sees. An SDK keeps structured bits on the Error
// object (Tavily: capType, retryAfter) and String(err) drops them, so the
// classifier would read half the shape. Appending them belongs here, at the
// capture seam, not in the classifier — that stays a pure function of its text.
// A numeric HTTP status an SDK kept on the error object, if it kept one.
function errorStatus(err: unknown): number | undefined {
  const structured = err as { statusCode?: unknown; status?: unknown } | null;
  if (typeof structured?.statusCode === "number") return structured.statusCode;
  return typeof structured?.status === "number" ? structured.status : undefined;
}

export function providerErrorText(err: unknown): string {
  const text = String(err);
  const structured = err as { capType?: unknown; retryAfter?: unknown } | null;
  const bits: string[] = [];
  // exa-js and friends keep the status on the error object and rethrow only
  // the envelope text, so without this a 403 is guessed from its body words.
  const status = errorStatus(err);
  if (status !== undefined) bits.push("status=" + status);
  if (typeof structured?.capType === "string" && structured.capType) bits.push("capType=" + structured.capType);
  if (typeof structured?.retryAfter === "number" && Number.isFinite(structured.retryAfter)) {
    bits.push("retry-after=" + structured.retryAfter);
  }
  return bits.length > 0 ? text + " (" + bits.join(", ") + ")" : text;
}

// Seconds until the arm expects to allow another call, as the capture seam's
// text carries it: `retry-after=3600` from providerErrorText, or whatever the
// upstream wrote in its body ("retry after 5 minutes", "retry-after: 30ms").
// Units are honoured, and the LAST match wins — providerErrorText appends the
// SDK's own value, so it outranks a number the message happened to mention.
// null when there is no usable wait: a hint then says "a moment" rather than
// inventing one.
export function retryAfterSeconds(errText: string): number | null {
  const matches = [...String(errText).matchAll(/retry[ -]?after\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(ms|milliseconds?|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)?/gi)];
  const last = matches.pop();
  if (!last) return null;
  const unit = (last[2] ?? "s").toLowerCase();
  const scale = unit.startsWith("ms") || unit.startsWith("milli") ? 0.001
    : unit.startsWith("m") ? 60
      : unit.startsWith("h") ? 3600
        : 1;
  const seconds = Math.round(Number(last[1]) * scale);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

// Fused envelope: the output of RRF consensus fusion across N providers.
export interface FusedEnvelope {
  results: NormalizedResult[];
  answers: string[];
  metadata: {
    providersQueried: string[];
    providersFailed: string[];
    providersCancelled: string[];
    // parallel error-class channel — provider id → class enum
    // (machine-usable, zero free-text leak). Absent when nothing failed.
    providerErrorClasses?: Record<string, ProviderErrorClass>;
    // per-arm wait seconds, recorded only for the class whose remedy names a
    // wait (free-quota-exhausted), so the sentence carries the number the
    // upstream gave instead of "a moment".
    providerErrorRetryAfterSeconds?: Record<string, number>;
    elapsedMs: number;
    // sufficiency signal from computeSufficiency.
    sufficiency?: SufficiencySignal;
    // per-provider answer attribution for transparency
    // without restructuring envelope.answers (stays string[]).
    // D2: verified=false locked in at contract layer (single source of truth); consumers must not re-stamp.
    // D3-D4: optional provider citations for transparency (Exa supplies; Tavily grounding is same-batch).
    providerAnswers?: ProviderAnswer[];
    // capability marker, computed from provider.modes (NOT output).
    // False when no queried provider advertises answer mode support
    // (e.g. AnySearch-only future, or runtime stub stripping the capability).
    answersAvailable?: boolean;
    // (r118 impl): pre-truncation WebFusion provenance snapshot. nativeScores are
    // raw provider scores per normalized url (web-only extension); they never enter fusion ranking.
    fusion?: FusionProvenance & { nativeScores: Record<string, Record<string, number>> };
    // observational-only zone. webProviderLedger is the engine-side
    // counterpart to the eval report's Observational zone; no threshold, no gate, no table.
    observational?: {
      webProviderLedger?: WebProviderLedger;
    };
    // abstain marker. Set by the kernel post-filter
    // when a domain allowlist policy is active and zero results survive (including
    // the cold-domain zero-arrival case). A successful policy execution, never an
    // error. preFiltered = provider results that reached the authoritative gate;
    // postFiltered = survivors (0 whenever abstain is set). Consumed by the CLI
    // one-line message (exit 0) and MCP structuredContent.abstain (isError:false).
    abstain?: {
      abstain: true;
      reason: "domain_filter_empty";
      domain?: string;
      preFiltered: number;
      postFiltered: number;
      // which stage left the pool empty — "pre" when providers
      // returned zero arrivals (pre-filter/provider side), "post" when the
      // authoritative kernel gate dropped every arrival.
      gate: "pre" | "post";
    };
  };

  // first-class attribution field — claim-level evidence linkage, orthogonal to verified:false.
  attribution?: AttributionReport;
}
