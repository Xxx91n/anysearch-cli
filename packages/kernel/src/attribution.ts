// ADR-0034 D3/D6: claim-level attribution — deterministic multi-signal fusion.
// Pure functions only. No LLM, no I/O. Every function testable in node:test.
//
// Architecture:
//   L0 segment      — Intl.Segmenter(sentence) + abbreviation whitelist merge
//   L1 fragments    — deterministic signal classification (connector/enum/density/entity)
//   classifyClaim   — BM25-lite overlap + cosine hook + arms + entity -> 3-state label
//   gap/abstain     — unsupported -> GapRequest; all-unsupported+no-evidence+suff-low -> abstain
//
// ADR-0034 D4: unsupported = deterministic contradiction (negation keywords AND high overlap);
// missing evidence always lands in uncertain (honest, not fabricated).

import type {
  AttributionClaim,
  AttributionEvidence,
  AttributionReport,
  ClaimLabel,
  FusedEnvelope,
  GapRequest,
  NormalizedResult,
} from "@anysearch/retriever";

// ---------------------------------------------------------------------------
// tokenize / jaccard / cosine — small math helpers used by classifyClaim
// ---------------------------------------------------------------------------

const WORD_RE = /[\p{L}\p{N}]+/gu;

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(WORD_RE) ?? [];
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const aS = new Set(a);
  const bS = new Set(b);
  let inter = 0;
  for (const t of aS) if (bS.has(t)) inter++;
  return inter / (aS.size + bS.size - inter);
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    dot += x * y; na += x * x; nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---------------------------------------------------------------------------
// L0 segmenter — sentence extraction from answer text (D6 C-prime)
// ---------------------------------------------------------------------------

export interface SentenceSpan { text: string; start: number; end: number; }

// Explicit whitelist of abbreviations that commonly end a sentence segment
// per Intl.Segmenter but are NOT true sentence boundaries.
const ABBREV_ENDINGS = /\b(?:e\.g|i\.e|Mr|Mrs|Dr|Prof|Sr|Jr|St|vs|etc|Ph\.D|U\.S|U\.K)\.$/;

let segInstance: Intl.Segmenter | null = null;
function getSegmenter(): Intl.Segmenter | null {
  if (typeof Intl === "undefined" || !("Segmenter" in Intl)) return null;
  if (!segInstance) {
    segInstance = new Intl.Segmenter("und", { granularity: "sentence" });
  }
  return segInstance;
}

export function splitSentences(text: string): SentenceSpan[] {
  const seger = getSegmenter();
  const spans: SentenceSpan[] = [];
  if (!seger) {
    // Last-resort fallback when Intl.Segmenter is unavailable: naive regex split.
    const re = /[^。.!?…\n]+[。.!?…]*\s*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const t = m[0].trim();
      if (t) spans.push({ text: t, start: m.index, end: m.index + m[0].length });
    }
    return spans;
  }
  for (const seg of seger.segment(text)) {
    const raw = seg.segment;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const offset = raw.indexOf(trimmed);
    spans.push({ text: trimmed, start: seg.index + offset, end: seg.index + offset + trimmed.length });
  }
  // Whitelist merge: if segment ends with a known abbreviation, merge with the next segment
  // (e.g. "Dr." followed by "Smith").
  const merged: SentenceSpan[] = [];
  for (const s of spans) {
    const prev = merged[merged.length - 1];
    if (prev && ABBREV_ENDINGS.test(prev.text) && /^[A-Z\u4e00-\u9fff]/.test(s.text)) {
      merged[merged.length - 1] = { text: prev.text + " " + s.text, start: prev.start, end: s.end };
    } else {
      merged.push(s);
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// L1 fragment signals — deterministic flags on whether a sentence is multi-claim
// ---------------------------------------------------------------------------

const CONNECTOR_RE = /(?:并且|而且|以及|同时|但(?:是)?|然而|并且|\bbut\b|\bhowever\b|\band\b|\balso\b|\bmoreover\b|\bfurthermore\b)/;
const ENUMERATION_RE = /[、;]/;
const LONG_SENTENCE_CHARS = 200;
const ENTITY_CANDIDATE_RE = /\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)+\b/g;

export interface FragmentFlags {
  isFragment: boolean;
  reasons: string[];
  isLongSentence: boolean;
  hasConnector: boolean;
  hasEnumeration: boolean;
  commaDensity: number;
  entityCount: number;
}

export function detectFragments(sentence: string): FragmentFlags {
  const commas = (sentence.match(/[，,]/g) ?? []).length;
  const entityCount = (sentence.match(ENTITY_CANDIDATE_RE) ?? []).length;
  const commaDensity = sentence.length > 0 ? commas / sentence.length : 0;

  const reasons: string[] = [];
  const isLongSentence = sentence.length > LONG_SENTENCE_CHARS;
  const hasConnector = CONNECTOR_RE.test(sentence);
  const hasEnumeration = ENUMERATION_RE.test(sentence);

  if (isLongSentence) reasons.push("long_sentence");
  if (hasConnector) reasons.push("connector");
  if (hasEnumeration) reasons.push("enumeration");
  if (commaDensity > 0.04) reasons.push("comma_density");
  if (entityCount >= 2) reasons.push("entity_density");

  return { isFragment: reasons.length > 0, reasons, isLongSentence, hasConnector, hasEnumeration, commaDensity, entityCount };
}

// ---------------------------------------------------------------------------
// classifyClaim — deterministic signal fusion (D3)
// ---------------------------------------------------------------------------

export interface ClassifyContext {
  retrievalResults: NormalizedResult[];
  // Optional cosine hook: caller computes claim-to-memory cosine similarity (0..1).
  cosineFn?: (claimText: string) => number | undefined;
  // Entity hits from ADR-0031 entity link (lowercased token strings).
  entityHits?: string[];
}

export interface ClaimClassification {
  label: ClaimLabel;
  confidence: number;
  evidence: AttributionEvidence[];
  rationale: string;
}

// Contradiction detection: a snippet that contains negation language AND has high
// token overlap with the claim is treated as counter-evidence (D4: "unsupported" must be
// a deterministic contradiction, not "we could not find support").
const CONTRADICTION_RE = /\b(?:not|never|no longer)\b|(?:并非|不是|沒有|没有|不含|未)/i;

export function classifyClaim(claimText: string, ctx: ClassifyContext): ClaimClassification {
  const claimTokens = tokenize(claimText);
  const results = ctx.retrievalResults ?? [];

  const ranked = results
    .map((r, i) => {
      const snip = (r.snippet ?? "") + " " + r.title;
      const overlap = jaccard(claimTokens, tokenize(snip));
      return { r, i, overlap, contradiction: overlap > 0.4 && CONTRADICTION_RE.test(snip) };
    })
    .filter((e) => e.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap);

  const top = ranked.slice(0, 3); // D4: max 3 evidence per claim

  // Fused score across 4 signals; matches D3 weight distribution.
  const bm25Score = top.length > 0 ? top[0].overlap : 0;
  const cosScore = ctx.cosineFn ? (ctx.cosineFn(claimText) ?? 0) : 0;
  const armScore = top.length > 0 ? 1 : 0; // arms provenance: existence of retrieval arms
  const claimToks = claimTokens.join(" ");
  const entityHits = ctx.entityHits ?? [];
  const entityScore =
    entityHits.length > 0
      ? entityHits.filter((e) => claimToks.includes(e.toLowerCase())).length / entityHits.length
      : 0;

  const fused = 0.35 * bm25Score + 0.35 * cosScore + 0.15 * armScore + 0.15 * entityScore;
  const confidence = Math.min(1, Math.max(0, fused));

  const evidence: AttributionEvidence[] = top.map((e) => ({
    url: e.r.url,
    title: e.r.title,
    provider: e.r.source,
    sourceKey: "retrieval_results[" + e.i + "]",
    entity: e.r.entity,
    span: (e.r.snippet ?? "").slice(0, 240),
  }));

  // D4: unsupported requires explicit contradiction; absence of evidence lands in uncertain.
  // Contradiction already requires overlap > 0.4 on the same tokens, so once
  // detected it is decisive — do not re-gate on fused confidence.
  const hasContradiction = top.some((e) => e.contradiction);
  let label: ClaimLabel;
  if (hasContradiction) {
    label = "unsupported";
  } else if (top.length === 0) {
    label = "uncertain"; // no evidence — honest, not fabricated
  } else if (confidence >= 0.6) {
    label = "supported";
  } else {
    label = "uncertain";
  }

  const rationale =
    label === "unsupported"
      ? "contradiction-detected: snippet contains negation keywords with high term overlap"
      : label === "supported"
      ? "fused=" + confidence.toFixed(2) + " (bm25=" + bm25Score.toFixed(2) + " cos=" + cosScore.toFixed(2) + " arm=" + armScore + " entity=" + entityScore.toFixed(2) + ")"
      : "fused=" + confidence.toFixed(2) + " below supported threshold or no evidence overlap; deterministic ambiguity";

  return { label, confidence, evidence, rationale };
}

// ---------------------------------------------------------------------------
// buildAttributionReport — fuse all claims for a FusedEnvelope
// ---------------------------------------------------------------------------

export interface BuildAttributionOptions {
  cosineFn?: (claimText: string) => number | undefined;
  entityHits?: string[];
  // Max claims produced per envelope (bounded loop, D2).
  maxClaims?: number;
  // ISO date to stamp the report (injectable for determinism in tests).
  now?: string;
}

export function buildAttributionReport(
  envelope: FusedEnvelope,
  opts: BuildAttributionOptions = {},
): AttributionReport {
  const now = opts.now ?? new Date().toISOString();
  const maxClaims = opts.maxClaims ?? 20;
  const sourceTexts: string[] =
    envelope.answers.length > 0
      ? envelope.answers
      : (envelope.metadata.providerAnswers ?? []).map((a) => a.text);

  if (sourceTexts.length === 0) {
    return {
      schema: "anysearch/attribution-report@1",
      generatedAt: now,
      claims: [],
      gaps: [],
      supportedCount: 0,
      uncertainCount: 0,
      unsupportedCount: 0,
      judgeEnhanced: false,
    };
  }

  const claims: AttributionClaim[] = [];
  let cid = 0;
  for (let ai = 0; ai < sourceTexts.length && claims.length < maxClaims; ai++) {
    for (const s of splitSentences(sourceTexts[ai])) {
      if (claims.length >= maxClaims) break;
      const frag = detectFragments(s.text);
      const cls = classifyClaim(s.text, {
        retrievalResults: envelope.results,
        cosineFn: opts.cosineFn,
        entityHits: opts.entityHits,
      });
      claims.push({
        id: "c" + ++cid,
        text: s.text,
        label: cls.label,
        confidence: Math.round(cls.confidence * 1000) / 1000,
        evidence: cls.evidence,
        rationale: frag.isFragment ? cls.rationale + " [fragment:" + frag.reasons.join(",") + "]" : cls.rationale,
        answerIndex: ai,
        spanStart: s.start,
        spanEnd: s.end,
      });
    }
  }

  const gaps = deriveGapRequests(claims);
  const supportedCount = claims.filter((c) => c.label === "supported").length;
  const uncertainCount = claims.filter((c) => c.label === "uncertain").length;
  const unsupportedCount = claims.filter((c) => c.label === "unsupported").length;

  return {
    schema: "anysearch/attribution-report@1",
    generatedAt: now,
    claims,
    gaps,
    supportedCount,
    uncertainCount,
    unsupportedCount,
    judgeEnhanced: false,
  };
}

// ---------------------------------------------------------------------------
// Gap / abstain bridges (D7)
// ---------------------------------------------------------------------------

export function deriveGapRequests(claims: AttributionClaim[]): GapRequest[] {
  return claims
    .filter((c) => c.label === "unsupported" || (c.label === "uncertain" && c.evidence.length === 0))
    .map((c) => ({
      assertion: c.text,
      evidenceState:
        c.label === "unsupported"
          ? ("conflicting_evidence" as const)
          : c.evidence.length === 0
            ? ("no_evidence" as const)
            : ("partial_evidence" as const),
      gapQuery: "Find sources to verify: " + c.text.slice(0, 120),
    }));
}

// D7: when every claim is unsupported AND there is no evidence AND sufficiency says "incorrect",
// bridge to a full abstain rather than emitting a misleading verified answer.
export function shouldBridgeToAbstain(report: AttributionReport, sufficiencyVerdict?: string): boolean {
  if (report.claims.length === 0) return false;
  return (
    report.claims.every((c) => c.label === "unsupported") &&
    report.claims.every((c) => c.evidence.length === 0) &&
    sufficiencyVerdict === "incorrect"
  );
}

// ---------------------------------------------------------------------------
// Judge escalation gate (D3 + ADR-0029 budget gate)
// ---------------------------------------------------------------------------

export function shouldEscalateToJudge(claim: AttributionClaim): boolean {
  return claim.label === "uncertain" && claim.evidence.length > 0;
}

// ---------------------------------------------------------------------------
// CLI renderer — thin string builder for TTY / --json surfaces (D4)
// ---------------------------------------------------------------------------

export function renderAttributionText(report: AttributionReport): string {
  if (report.claims.length === 0) return "";
  let out =
    "Attribution: " +
    report.supportedCount + " ✓  " +
    report.uncertainCount + " ~  " +
    report.unsupportedCount + " ✗\n";
  report.claims.forEach((c, i) => {
    const mark = c.label === "supported" ? "✓" : c.label === "unsupported" ? "✗" : "~";
    out += mark + "  [" + (i + 1) + "]  " + c.text + "\n";
  });
  const seen = new Set<string>();
  report.claims.forEach((c) => c.evidence.forEach((e) => seen.add(e.url)));
  if (seen.size > 0) {
    out += "Sources:\n";
    [...seen].forEach((u, i) => (out += "  [" + (i + 1) + "]  " + u + "\n"));
  }
  return out;
}

// Attach report onto envelope. Mutates envelope.attribution — caller owns the object.
export function attachAttribution(envelope: FusedEnvelope, opts?: BuildAttributionOptions): AttributionReport {
  const report = buildAttributionReport(envelope, opts);
  envelope.attribution = report;
  return report;
}
