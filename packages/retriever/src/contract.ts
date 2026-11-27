import type { AttributionReport } from "./attribution";
import type { SearchOutcome } from "./outcome";

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

// Class all providers share. The type and the declaration check in
// providerErrorClassOf read the same list, so a declared class can only be one
// of these.
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

const ERROR_CLASS_MARKER = "provider-error-class:";
const CLASS_SET: ReadonlySet<string> = new Set(ERROR_CLASSES);

// Display only: nothing parses this back into a class, so a reply that happens
// to spell it changes no decision.
export function providerErrorMarker(cls: ProviderErrorClass): string {
  return "[" + ERROR_CLASS_MARKER + cls + "]";
}

// The declared class rides a symbol key, so a parsed upstream payload spread
// onto an error object cannot bring one along. It is same-process only: a
// cloned or serialized error drops it, and the words decide again.
const PROVIDER_ERROR_CLASS = Symbol("anysearch.providerErrorClass");

// Declare the class an adapter settled on, beside its message. The engine reads
// it back with providerErrorClassOf instead of parsing the message again.
export function withProviderErrorClass<T extends Error>(err: T, providerErrorClass: ProviderErrorClass): T {
  return Object.assign(err, { [PROVIDER_ERROR_CLASS]: providerErrorClass });
}

// The class an adapter declared on its error object, if it declared one. The
// value is checked against the class list, so a typo reads as "nothing
// declared" instead of inventing a class.
export function providerErrorClassOf(err: unknown): ProviderErrorClass | undefined {
  const declared = (err as { [PROVIDER_ERROR_CLASS]?: unknown } | null)?.[PROVIDER_ERROR_CLASS];
  return typeof declared === "string" && CLASS_SET.has(declared)
    ? (declared as ProviderErrorClass)
    : undefined;
}

// Classes that name a credential fault outright. An adapter that guessed a
// class from reply wording has to let one of these win: "your API key was
// issued for a different project" is a 403, not a used-up free allowance.
export function isExplicitAuthFault(cls: ProviderErrorClass): boolean {
  return cls === "permanent-auth" || cls === "session-expired";
}

// Classifies the String(err) seam form — Error names ride inside the string
// ("SessionExpiredError: AnySearch MCP tools/call HTTP 404 ..."), so the
// matcher sees name and message at once.
//
// A declared class wins; with none, or a declared "unknown", the words in the
// message decide. Upstream reply text is part of those words, so word matching
// stays a guess rather than a boundary.
export function classifyProviderError(errText: string, providerErrorClass?: ProviderErrorClass): ProviderErrorClass {
  if (providerErrorClass && providerErrorClass !== "unknown") return providerErrorClass;
  const t = String(errText);
  const http = (code: string) => t.includes("HTTP " + code);
  // An SDK keeps the status on the error object, so providerErrorText writes it
  // into the text as `status=<n>`; read that form too, not just "HTTP 403".
  const statusOf = (code: string) => http(code) || new RegExp("\\bstatus(?:Code)?\\s*[:=]?\\s*" + code + "\\b", "i").test(t);
  // The structured status for a whole family (`status=500` is a 5xx).
  const statusFamily = (lead: string) => new RegExp("\\bstatus(?:Code)?\\s*[:=]?\\s*" + lead + "\\d\\d\\b", "i").test(t);
  const is402 = statusOf("402") || /payment required/i.test(t);
  // A 402 is one of two things: the x402 payment challenge means no key was
  // sent, while the standard envelope means the key is valid but out of
  // credits. Only the structured challenge marks say which.
  const x402Challenge = /X402_PAYMENT_REQUIRED|x402Version|maxTimeoutSeconds/i.test(t);
  if (/SessionExpiredError|session terminated/i.test(t)) return "session-expired";
  if (statusOf("401") || statusOf("403") || x402Challenge || /invalid_api_key|invalid api key|unauthorized|forbidden/i.test(t)) return "permanent-auth";
  // Design: an explicit auth fault outranks the free-quota wall, which in turn
  // outranks the retry shapes.
  if (KEYLESS_CAP_RE.test(t) || PROVISIONING_REPLY_RE.test(t)) return "free-quota-exhausted";
  if (/HTTP 5[0-9][0-9]/.test(t) || statusFamily("5") || statusOf("429") || /rate.?limit|too many requests/i.test(t) || /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|timed? ?out|socket hang up/i.test(t)) return "transient";
  // The key is valid but the plan is used up: rotating the key or retrying
  // does nothing, the owner must top up. Checked after the retryable shapes so
  // a 429/5xx that also says "usage limit" stays transient; a 402 without the
  // x402 marks is the keyed request's quota wall.
  if (is402 || QUOTA_EXHAUSTED_RE.test(t)) return "quota-exhausted";
  if (/malformed|Search Results|unexpected Content-Type|no result object|reply id mismatch|carried no reply|isError|no text content/i.test(t)) return "permanent-protocol";
  if (/HTTP 4[0-9][0-9]/.test(t) || statusFamily("4")) return "permanent-protocol";
  return "unknown";
}

// A numeric HTTP status an SDK kept on the error object, if it kept one.
function errorStatus(err: unknown): number | undefined {
  const structured = err as { statusCode?: unknown; status?: unknown } | null;
  if (typeof structured?.statusCode === "number") return structured.statusCode;
  return typeof structured?.status === "number" ? structured.status : undefined;
}

// The text form the classifier sees: an SDK keeps structured bits on the Error
// object and String(err) drops them, so the capture seam writes them back in.
export function providerErrorText(err: unknown): string {
  const text = String(err);
  const structured = err as { capType?: unknown; retryAfter?: unknown } | null;
  const bits: string[] = [];
  const status = errorStatus(err);
  if (status !== undefined) bits.push("status=" + status);
  if (typeof structured?.capType === "string" && structured.capType) bits.push("capType=" + structured.capType);
  if (typeof structured?.retryAfter === "number" && Number.isFinite(structured.retryAfter)) {
    bits.push("retry-after=" + structured.retryAfter);
  }
  return bits.length > 0 ? text + " (" + bits.join(", ") + ")" : text;
}

// Seconds per unit; the unit-less form (the header's own) is seconds. "ms"
// is checked before "m" so milliseconds never read as minutes.
function unitSeconds(unit: string): number {
  if (unit.startsWith("ms") || unit.startsWith("milli")) return 0.001;
  if (unit.startsWith("h")) return 3600;
  if (unit.startsWith("m")) return 60;
  return 1;
}

// Seconds until the arm expects another call. The last match wins: the SDK's
// own value is appended by providerErrorText, after anything the body said.
export function retryAfterSeconds(errText: string): number | null {
  const matches = [...String(errText).matchAll(/retry[ -]?after\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(ms|milliseconds?|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)?/gi)];
  const last = matches.pop();
  if (!last) return null;
  const seconds = Math.round(Number(last[1]) * unitSeconds((last[2] ?? "s").toLowerCase()));
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
    // per-arm wall time the provider itself reported (ProviderEnvelope.elapsedMs),
    // keyed by provider id. Only arms that answered have a real number: a cut or
    // failed arm has none, and its state already rides providersCancelled /
    // providersFailed. The engine writes this on every search, {} included.
    providerElapsedMs?: Record<string, number>;
    // parallel error-class channel — provider id → class enum
    // (machine-usable, zero free-text leak). Absent when nothing failed.
    providerErrorClasses?: Record<string, ProviderErrorClass>;
    // per-arm wait seconds, recorded whenever a failing arm gave one; the
    // hint table decides which remedy sentences quote it, so the sentence
    // carries the number the upstream gave instead of "a moment".
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
    // five-value search outcome, written by the kernel on every search it
    // assembles; how each value is decided lives in outcome.ts and nowhere else
    // (research_web maps it once at its exit — that is the tool's call verdict,
    // not a second classifier). The audit attribute anysearch.outcome carries
    // the same value.
    outcome: SearchOutcome;
    // abstain marker. The kernel writes it only when the domain policy is the
    // evidence-backed reason — that rule is shouldAbstain in outcome.ts and
    // nowhere else. Present iff outcome === "abstain": an all-failed or
    // all-cancelled search writes none. A successful policy execution, never an
    // error. preFiltered = provider results that
    // reached the authoritative gate; postFiltered = survivors (0 whenever
    // abstain is set). gate: "post" = the gate dropped arrivals; "pre" = every
    // queried arm answered with nothing, none failed. Consumed by the CLI
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
