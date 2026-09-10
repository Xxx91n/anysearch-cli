// ADR-0053 D2/D3/D4: Content Trust Boundary and Indirect Prompt Injection Defense.
// Owned by the RRF/retrieval boundary; kernel and eval consumers import from this package.
// Pure deterministic layer: source labels, fixed-point sanitization, schema gate,
// authorization predicates, and tool-result JSON wrapping.
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const CONTENT_TRUST_SCHEMA_VERSION = 1;
export const RETRIEVAL_CONTENT_SCHEMA_URL = "anysearch://schemas/retrieval-content/1";

export type SourceLabel = "system" | "user" | "retrieved" | "tool" | "memory";
export interface SourceTraceLabel {
  source: SourceLabel;
  traceId: string;
}

export interface RetrievalContentEnvelope {
  schema: typeof RETRIEVAL_CONTENT_SCHEMA_URL;
  version: typeof CONTENT_TRUST_SCHEMA_VERSION;
  url: string;
  title: string;
  snippet: string;
  entity?: string;
  source: string;
  label: SourceTraceLabel;
  disposal: "accepted" | "stripped" | "skipped";
  userViewedRaw?: boolean;
}

export const RetrievalContentSchema = Type.Object(
  {
    schema: Type.Literal(RETRIEVAL_CONTENT_SCHEMA_URL),
    version: Type.Literal(CONTENT_TRUST_SCHEMA_VERSION),
    url: Type.String({ minLength: 1, maxLength: 2048 }),
    title: Type.String({ maxLength: 500 }),
    snippet: Type.String({ maxLength: 4000 }),
    entity: Type.Optional(Type.String({ maxLength: 2048 })),
    source: Type.String({ minLength: 1, maxLength: 128 }),
    label: Type.Object(
      {
        source: Type.Union([
          Type.Literal("system"),
          Type.Literal("user"),
          Type.Literal("retrieved"),
          Type.Literal("tool"),
          Type.Literal("memory"),
        ]),
        traceId: Type.String({ minLength: 1, maxLength: 128 }),
      },
      { additionalProperties: false },
    ),
    disposal: Type.Union([Type.Literal("accepted"), Type.Literal("stripped"), Type.Literal("skipped")]),
    userViewedRaw: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export type RetrievalContent = Static<typeof RetrievalContentSchema>;

const TRUST_ORDER: Record<SourceLabel, number> = {
  system: 4,
  user: 3,
  memory: 2,
  tool: 1,
  retrieved: 0,
};

// Source labels carry trust; traceId is correlation only. Untrusted wins on merge.
export function combineLabels(...labels: SourceTraceLabel[]): SourceTraceLabel {
  const first = labels[0];
  if (!first) throw new Error("combine_labels requires at least one label");
  let label = first;
  for (const next of labels.slice(1)) {
    if (TRUST_ORDER[next.source] < TRUST_ORDER[label.source]) label = next;
  }
  return { source: label.source, traceId: first.traceId };
}

const ZERO_WIDTH_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
const BIDI_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

function stripTags(input: string): string {
  // charCodeAt sees surrogate halves and misses supplementary-plane tag chars;
  // code-point regex removes the whole U+E0000..E007F range.
  return input.replace(/[\u{E0000}-\u{E007F}]/gu, "");
}

// Fixed point: NFC normalize, zero-width family, Unicode tag decode-rescan, bidi strip.
export function sanitizeText(input: unknown): string {
  if (typeof input !== "string") return "";
  let current = input.normalize("NFC");
  for (;;) {
    let next = current.replace(ZERO_WIDTH_RE, "").replace(BIDI_RE, "");
    const strippedTags = stripTags(next);
    next = strippedTags.normalize("NFC").replace(ZERO_WIDTH_RE, "").replace(BIDI_RE, "");
    if (next === current) return current;
    current = next;
  }
}

export interface SanitizeRetrievedInput {
  url?: unknown;
  title?: unknown;
  snippet?: unknown;
  entity?: unknown;
  source?: unknown;
  label: SourceTraceLabel;
}

export interface SanitizeRetrievedResult {
  content: RetrievalContent;
  rawSanitized: {
    url: string;
    title: string;
    snippet: string;
    entity?: string;
  };
  suspicious: boolean;
}

// ponytail: structural policy, not semantic injection detection. It intentionally
// passes instruction-like prose because schema validity is the deterministic gate.
export function sanitizeRetrieved(input: SanitizeRetrievedInput): SanitizeRetrievedResult {
  const originalText = [input.url, input.title, input.snippet, input.entity]
    .map((v) => typeof v === "string" ? v : "")
    .join("");
  const hadInvisible = ZERO_WIDTH_RE.test(originalText) || BIDI_RE.test(originalText) || /[\u{E0000}-\u{E007F}]/u.test(originalText);
  const raw = {
    url: sanitizeText(input.url).slice(0, 2048),
    title: sanitizeText(input.title).slice(0, 500),
    snippet: sanitizeText(input.snippet).slice(0, 4000),
    ...(input.entity === undefined ? {} : { entity: sanitizeText(input.entity).slice(0, 2048) }),
  };

  const suspicious =
    hadInvisible ||
    (typeof input.url === "string" && input.url.length > 2048) ||
    (typeof input.title === "string" && input.title.length > 500) ||
    (typeof input.snippet === "string" && input.snippet.length > 4000);

  const content: RetrievalContent = {
    schema: RETRIEVAL_CONTENT_SCHEMA_URL,
    version: CONTENT_TRUST_SCHEMA_VERSION,
    url: raw.url,
    title: raw.title,
    snippet: raw.snippet,
    ...(raw.entity === undefined ? {} : { entity: raw.entity }),
    source: typeof input.source === "string" && input.source ? input.source.slice(0, 128) : "retrieved",
    label: input.label,
    disposal: suspicious ? "stripped" : "accepted",
    userViewedRaw: false,
  };

  if (Value.Check(RetrievalContentSchema, content)) return { content, rawSanitized: raw, suspicious };
  return {
    content: { ...(content as unknown as RetrievalContent), disposal: "skipped", snippet: "", title: raw.title ? "[untrusted content skipped by schema]" : "" },
    rawSanitized: raw,
    suspicious: true,
  };
}

export function wrapRetrieved(content: RetrievalContent): {
  type: "tool_result";
  name: "search";
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    type: "tool_result",
    name: "search",
    content: [{ type: "text", text: JSON.stringify(content) }],
  };
}

export function assertLlamaInput(content: unknown): asserts content is RetrievalContent {
  if (!content || typeof content !== "object") {
    throw new Error("LLM judgment input must be a tagged RetrievalContent object");
  }
  const c = content as Partial<RetrievalContent>;
  if (!c.label || typeof c.label.source !== "string" || typeof c.label.traceId !== "string") {
    throw new Error("LLM judgment input must carry {source, traceId}");
  }
  if (!Value.Check(RetrievalContentSchema, content)) {
    throw new Error("LLM judgment input must satisfy RetrievalContentSchema");
  }
}

export function isRetrievedOrMemoryLabel(label: SourceTraceLabel | undefined): boolean {
  return label?.source === "retrieved" || label?.source === "memory";
}

export function shouldAllowUrl(
  url: string,
  label: SourceTraceLabel,
  allowlistedHosts: readonly string[],
  denylistedHosts: readonly string[] = [],
): { allowed: boolean; requiresHitl: boolean } {
  if (!url) return { allowed: false, requiresHitl: false };
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\./, "");
  } catch {
    return { allowed: false, requiresHitl: false };
  }
  // ADR-0055 D2: deny is a first-class channel evaluated LAST — it overrides any allow,
  // including a hook-returned allow or a user-source label (Cedar forbid-overrides-permit).
  if (denylistedHosts.some((entry) => host === entry || host.endsWith("." + entry))) {
    return { allowed: false, requiresHitl: false };
  }
  if (label.source === "user") return { allowed: true, requiresHitl: false };
  if (allowlistedHosts.some((entry) => host === entry || host.endsWith("." + entry))) {
    return { allowed: true, requiresHitl: false };
  }
  return { allowed: false, requiresHitl: true };
}

// ADR-0054 D1: shared pre-LLM judgment assertion. Every LLM judgment boundary asserts
// through this one wrapper (fail-closed). Input is a tagged judgment payload: a
// TaggedGap-shaped object (text + source + traceId), optionally carrying items[]
// of RetrievalContent which are asserted individually via assertLlamaInput.
export interface JudgmentInput {
  text: string;
  source: SourceLabel;
  traceId: string;
  items?: RetrievalContent[];
}

export function assertJudgmentInput(
  input: unknown,
  site: string,
): asserts input is JudgmentInput {
  if (!input || typeof input !== "object") {
    throw new Error("LLM judgment input at " + site + " must be a tagged object");
  }
  const j = input as Partial<JudgmentInput>;
  if (typeof j.text !== "string" || j.text.length === 0) {
    throw new Error("LLM judgment input at " + site + " must carry non-empty text");
  }
  if (typeof j.source !== "string" || typeof j.traceId !== "string" || j.traceId.length === 0) {
    throw new Error("LLM judgment input at " + site + " must carry {source, traceId}");
  }
  if (Array.isArray(j.items)) {
    for (const item of j.items) assertLlamaInput(item);
  }
}

// ADR-0054 D1: unwrap a wrapRetrieved wire payload back to the engine envelope.
// Returns the parsed envelope when the payload is a tagged RetrievalContent whose
// schema matches, otherwise null (caller falls back to legacy parsing).
export function unwrapRetrieved(parsed: unknown): unknown | null {
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    (parsed as { schema?: unknown }).schema === RETRIEVAL_CONTENT_SCHEMA_URL
  ) {
    const snippet = (parsed as { snippet?: unknown }).snippet;
    if (typeof snippet !== "string") return null;
    try {
      return JSON.parse(snippet);
    } catch {
      return null;
    }
  }
  return null;
}
