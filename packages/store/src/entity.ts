// Entity link layer — rule-first extraction, name normalization, trigram similarity.
// Rule-first = zero network, deterministic (Neo4j "LLM as fallback" / Mem0 v3 degrade-to-spaCy pattern).
// LLM backfill seam lives in session-store (optional, fail-open): only called when rules find nothing.
// Templates (atomcode r31): Mem0 utils/entity_extraction.py (channels + priority + overlap),
// membox entities.py (3-tier funnel), context-mode (trigram substring matching).

export type EntityType = "url" | "handle" | "phrase" | "ident" | "declared";

export interface EntityCandidate {
  name: string;         // as written in text (display form)
  type: EntityType;
}

// Fellegi-Sunter two-threshold three-state. Initial values, pending eval error-budget calibration:
// >= ALIAS -> auto-merge as alias (reversible via entity_merge_log kind="alias")
// >= REVIEW -> create new entity + entity_merge_log kind="candidate" (review band)
// < REVIEW -> create new entity, no log
export const ENTITY_ALIAS_THRESHOLD = 0.9;
export const ENTITY_REVIEW_THRESHOLD = 0.6;

// exported so the store uses one source of truth for the extraction cap.
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

// Which writing system a name is in. The character-level similarity above is
// blind across scripts: `acme` vs `甲公司` scores 0, and no threshold can fix
// that. So cross-script sameness is decided by evidence (a declared mapping or
// a model check), never by this module's similarity score (#277).
export type TextScript = "han" | "latin" | "other";

const HAN_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const LATIN_LETTER_RE = /[A-Za-z]/;

export function scriptOf(name: string): TextScript {
  const hasHan = HAN_RE.test(name);
  const hasLatin = LATIN_LETTER_RE.test(name);
  if (hasHan && hasLatin) return "other";
  if (hasHan) return "han";
  if (hasLatin) return "latin";
  return "other";
}

// Two names that can never be matched by the trigram tiers: one Han-only, one
// Latin-only. This is the pair the alias layer has to decide, not the score.
export function isCrossScriptPair(a: string, b: string): boolean {
  const sa = scriptOf(a);
  const sb = scriptOf(b);
  return (sa === "han" && sb === "latin") || (sa === "latin" && sb === "han");
}

export interface CrossScriptPair {
  latin: string;
  han: string;
}

// Surface forms written side by side in one text — `Acme（甲公司）` or
// `甲公司 (Acme)` — are the one place a material states "these two names are the
// same object" without a model call. Only the parenthesis form is read: a bare
// sentence that happens to mention both names does not claim they are equal.
const HAN_RUN = "[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]";
// A Latin name may be several words (`Acme Corp`, `Acme Software Ltd`). Matching
// one word only would turn `Acme Corp（甲公司）` into the pair `Corp/甲公司`, which
// then binds 甲公司 to whatever object happens to be called "Corp" — a wrong
// mapping the caller applies immediately. So up to four words are taken, and the
// leading sentence words are trimmed afterwards.
const LATIN_NAME = "[A-Za-z][A-Za-z0-9._-]{0,39}(?:[ ][A-Za-z][A-Za-z0-9._-]{0,39}){0,3}";
const PAIR_RES = [
  // Latin then parenthesised Han: Acme（甲公司）
  new RegExp("(" + LATIN_NAME + ")\\s*[（(]\\s*(" + HAN_RUN + "{2,8})\\s*[)）]", "g"),
  // Han then parenthesised Latin: 甲公司（Acme）
  new RegExp("(" + HAN_RUN + "{2,8})\\s*[（(]\\s*(" + LATIN_NAME + ")\\s*[)）]", "g"),
];

// Words that start a sentence rather than name an object. A multi-word match can
// pick one up from the text in front of the name (`see Acme Corp`), and carrying
// it into the alias would store a phrase nobody would look up.
const LEADING_NOISE = new Set([
  "a", "an", "the", "and", "or", "of", "in", "on", "at", "to", "for", "from", "by", "with",
  "see", "per", "via", "vs", "our", "your", "their", "its", "this", "that", "these", "those",
  // Verbs that commonly sit right before a company name. A word list can never be
  // complete (`Contact Acme` needed this one), which is why the parser also
  // returns shorter candidates below instead of trusting the list.
  "contact", "call", "email", "ask", "visit", "join", "meet", "try", "use", "check", "read",
  "about", "from", "per", "re", "regarding", "thanks", "please", "hello", "hi", "dear",
]);

function trimLeadingNoise(name: string): string {
  const words = name.trim().split(/\s+/);
  let start = 0;
  while (start < words.length - 1 && LEADING_NOISE.has(words[start]!.toLowerCase())) start += 1;
  return words.slice(start).join(" ");
}

/**
 * A multi-word match and the shorter names it could be.
 *
 * `latin` is the full match; `latinSuffixes` are the names to try, longest
 * first — starting with the UNCLEANED match and then every trailing sub-phrase
 * of the cleaned one (`Hello Labs` → `Hello Labs`, `Labs`; `Contact Acme` →
 * `Contact Acme`, `Acme`).
 *
 * Why uncleaned first: a company can legitimately start with a word that also
 * opens sentences, and trimming before looking it up would turn `Hello Labs
 * （甲公司）` into `Labs/甲公司` — binding 甲公司 to whatever object happens to be
 * called "Labs". Trying the full match first means a real `Hello Labs` entity
 * wins; the trimmed suffix is only reached when the full name is not a known
 * object. The caller picks the longest known candidate.
 */
export interface StatedPair {
  latin: string;
  han: string;
  /** Candidate Latin names, longest first. `latin` is the first entry. */
  latinSuffixes: string[];
}

function latinNameLadder(rawMatch: string): { primary: string; ladder: string[] } {
  const untrimmed = rawMatch.trim().replace(/\s+/g, " ");
  const cleaned = trimLeadingNoise(untrimmed);
  const ladder: string[] = [];
  const push = (n: string): void => {
    const v = n.trim();
    if (v && !ladder.includes(v)) ladder.push(v);
  };
  // Longest first: the full match, then the cleaned form, then every trailing
  // sub-phrase of the cleaned form. A real multi-word name is tried before any
  // trimmed variant, so `Hello Labs` is never mistaken for the prose prefix
  // `Hello` plus an object called `Labs`.
  push(untrimmed);
  push(cleaned);
  const words = cleaned.split(/\s+/);
  for (let i = 1; i < words.length; i++) push(words.slice(i).join(" "));
  return { primary: untrimmed, ladder };
}

export function extractCrossScriptPairs(text: string): StatedPair[] {
  const out: StatedPair[] = [];
  const seen = new Set<string>();
  for (const re of PAIR_RES) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const rawA = (m[1] ?? "").trim();
      const rawB = (m[2] ?? "").trim();
      const latinRaw = scriptOf(rawA) === "latin" ? rawA : rawB;
      const han = scriptOf(rawA) === "han" ? rawA : rawB;
      const { primary, ladder } = latinNameLadder(latinRaw);
      if (!primary || !han) continue;
      const key = normalizeEntityName(primary) + "\u0000" + normalizeEntityName(han);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ latin: primary, han, latinSuffixes: ladder });
    }
  }
  return out;
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
  // cap is a parameter so the store can observe + log the overflow tail (bounded at 2x).
  return out.slice(0, cap);
}
