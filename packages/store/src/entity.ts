// ADR-0031 D2/D5: Entity link layer — rule-first extraction, name normalization, trigram similarity.
// Rule-first = zero network, deterministic (Neo4j "LLM as fallback" / Mem0 v3 degrade-to-spaCy pattern).
// LLM backfill seam lives in session-store (optional, fail-open): only called when rules find nothing.
// Templates (atomcode r31): Mem0 utils/entity_extraction.py (channels + priority + overlap),
//   membox entities.py (3-tier funnel), context-mode (trigram substring matching).

export type EntityType = "url" | "handle" | "phrase" | "ident" | "declared";

export interface EntityCandidate {
  name: string;         // as written in text (display form)
  type: EntityType;
}

// Fellegi-Sunter two-threshold three-state (ADR-0031 D5). Initial values, pending eval error-budget calibration:
//   >= ALIAS  -> auto-merge as alias (reversible via entity_merge_log kind="alias")
//   >= REVIEW -> create new entity + entity_merge_log kind="candidate" (review band)
//   <  REVIEW -> create new entity, no log
export const ENTITY_ALIAS_THRESHOLD = 0.9;
export const ENTITY_REVIEW_THRESHOLD = 0.6;

// r74 audit E5: exported so the store uses one source of truth for the extraction cap.
export const MAX_ENTITY_CANDIDATES = 5; // per-memory extraction cap (bounded cost, Mem0 channel cap pattern)

// Normalization: lowercase, collapse whitespace, strip edge punctuation/quotes.
// Hyphens and underscores INSIDE a name survive (buildzone-rd != buildzone, but BuildKit==buildkit).
export function normalizeEntityName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[\s._:\@#'"()\[\]{}]+/, "")
    .replace(/[\s.,;:!?'"()\[\]{}]+$/, "")
    .replace(/\s+/g, " ");
}

// Jaccard over character trigram sets. Short strings (<3 chars) degrade to 2-gram/1-gram.
export function trigramSimilarity(a: string, b: string): number {
  const ngrams = (s: string, n: number): Set<string> => {
    const set = new Set<string>();
    if (s.length <= n) { if (s.length) set.add(s); return set; }
    for (let i = 0; i + n <= s.length; i++) set.add(s.slice(i, i + n));
    return set;
  };
  const n = (s: string) => (s.length >= 3 ? 3 : s.length >= 2 ? 2 : 1);
  const na = n(a);
  const nb = n(b);
  const A = ngrams(a, na);
  const B = ngrams(b, nb);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter += 1;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Overlap-resolved channel extraction. Channels in priority order:
// url > handle > phrase > ident > dictionary(recognize existing entity tokens).
// dedup key = normalized name; first channel wins (Mem0 priority pattern).
const URL_RE = /https?:\/\/[^\s"'<>()\[\]{}]+/g;
const HANDLE_RE = /(?:^|[\s(,])@([A-Za-z0-9][A-Za-z0-9._-]{1,63})/g;
const PHRASE_RE = /"([^"\n=]{2,80})"|\u201c([^\u201d\n]{2,80})\u201d|\u300c([^\u300d\n]{2,80})\u300d/g;
const IDENT_RE = /[A-Za-z][A-Za-z0-9_]{2,63}/g;
const CAMEL_OK = /[A-Z]/; // internal uppercase beyond position 0 checked at runtime

export function extractEntityCandidates(text: string, knownNorms?: ReadonlySet<string>, cap: number = MAX_ENTITY_CANDIDATES): EntityCandidate[] {
  const out: EntityCandidate[] = [];
  const seen = new Set<string>();
  const push = (name: string, type: EntityType): void => {
    const norm = normalizeEntityName(name);
    if (norm.length < 2 || seen.has(norm)) return;
    seen.add(norm);
    out.push({ name: name.trim(), type });
  };
  // 1) url channel
  for (const m of text.matchAll(URL_RE)) push(m[0], "url");
  // 2) handle channel (@mention)
  for (const m of text.matchAll(HANDLE_RE)) push(m[1], "handle");
  // 3) quoted-phrase channel
  for (const m of text.matchAll(PHRASE_RE)) push(m[1] ?? m[2] ?? m[3] ?? "", "phrase");
  // 4) identifier channel: camelCase/PascalCase internal uppercase, or snake underscore, len>=3
  for (const m of text.matchAll(IDENT_RE)) {
    const w = m[0];
    const internalUpper = CAMEL_OK.test(w.slice(1));
    if (internalUpper || w.includes("_")) push(w, "ident");
  }
  // 5) dictionary channel: known entity names re-recognized in new text (variant recall)
  if (knownNorms && knownNorms.size > 0) {
    for (const m of text.matchAll(IDENT_RE)) {
      const norm = normalizeEntityName(m[0]);
      if (norm.length >= 3 && knownNorms.has(norm) && !seen.has(norm)) {
        seen.add(norm);
        out.push({ name: m[0], type: "ident" });
      }
    }
  }
  // ADR-0032 D3: cap is a parameter so the store can observe + log the overflow tail (bounded at 2x).
  return out.slice(0, cap);
}
