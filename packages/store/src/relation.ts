// Relation extraction: KG-lite closed-predicate edge layer (ADR-0035).
// Seam from atomcode-adr0035-impl research: SQLite edge table over a dedicated graph engine
// (Kuzu archived 2025-10; sqlite-graph/ctxgraph edge-table pattern), Graphiti-style
// json_schema -> json_object degrade for the LLM seam, RRF arm fusion at weight 0.5 (fts5.ts).

import { normalizeEntityName } from "./entity.js";
import type { EntityType } from "./entity.js";

// Bumped whenever VERB_RULES or coercion semantics change; backfill --reprocess replays old versions.
export const RELATION_RULES_VERSION = 1;

// Closed predicate set. The schema CHECK constraint must match this list exactly.
export const PREDICATES = [
  "works_on",
  "depends_on",
  "uses",
  "part_of",
  "member_of",
  "located_at",
  "authored_by",
  "related_to",
] as const;
export type Predicate = (typeof PREDICATES)[number];
const PREDICATE_SET: ReadonlySet<string> = new Set(PREDICATES);
export function isPredicate(v: string): v is Predicate {
  return PREDICATE_SET.has(v);
}

// Surface-form aliases (EN + CN) normalized onto the closed set (LLM seam output goes through this).
export const PREDICATE_ALIASES: Record<string, Predicate> = {
  "works on": "works_on", owns: "works_on", maintains: "works_on", leads: "works_on",
  "is responsible for": "works_on",
  "\u8D1F\u8D23": "works_on", "\u4E3B\u5BFC": "works_on", "\u7EF4\u62A4": "works_on",
  "depends on": "depends_on", requires: "depends_on", "relies on": "depends_on",
  "\u4F9D\u8D56": "depends_on", "\u4F9D\u8D56\u4E8E": "depends_on",
  uses: "uses", "built on": "uses", "built with": "uses",
  "\u4F7F\u7528": "uses", "\u91C7\u7528": "uses", "\u57FA\u4E8E": "uses",
  "part of": "part_of", "included in": "part_of", "ships with": "part_of",
  "\u5305\u542B": "part_of", "\u6784\u6210": "part_of",
  "member of": "member_of", joined: "member_of",
  "\u52A0\u5165": "member_of",
  "located in": "located_at", "based in": "located_at", "hosted on": "located_at",
  "\u4F4D\u4E8E": "located_at", "\u90E8\u7F72\u5728": "located_at",
  "authored by": "authored_by", "written by": "authored_by", "created by": "authored_by",
  "\u5199\u4E86": "authored_by", "\u521B\u5EFA": "authored_by",
  "related to": "related_to", "linked to": "related_to",
  "\u76F8\u5173": "related_to",
};

export function normalizePredicate(surface: string): Predicate | null {
  const key = surface.trim().toLowerCase();
  if (isPredicate(key)) return key;
  return PREDICATE_ALIASES[key] ?? null;
}

// Edge-pattern constraint table (LlamaIndex edge_pattern style): allowed (head_type, relation,
// tail_type) over syntactic EntityTypes; "*" is a wildcard. authorship is restricted to
// url<->handle pairs; the other predicates are open across types for the lite layer.
export type EdgePatternRow = readonly [head: EntityType | "*", relation: Predicate, tail: EntityType | "*"];
export const EDGE_PATTERN_ROWS: EdgePatternRow[] = [
  ["url", "authored_by", "handle"],
  ["handle", "authored_by", "url"],
  ["*", "works_on", "*"],
  ["*", "depends_on", "*"],
  ["*", "uses", "*"],
  ["*", "part_of", "*"],
  ["*", "member_of", "*"],
  ["*", "located_at", "*"],
  ["*", "related_to", "*"],
];

export function patternAllows(
  headType: string,
  relation: string,
  tailType: string,
  rows: readonly EdgePatternRow[] = EDGE_PATTERN_ROWS,
): boolean {
  return rows.some(
    ([h, r, t]) => r === relation && (h === "*" || h === headType) && (t === "*" || t === tailType),
  );
}

export type TripleSource = "rule" | "llm" | "url_handle";
export interface ExtractedTriple {
  subject: string; // raw surface form; the store normalizes and resolves to entity ids
  relation: Predicate;
  object: string;
  confidence: number; // 0..1
  sourceKind: TripleSource;
}

// Clause-bounded side capture: 1-40 chars, lazy, closed by punctuation or end-of-line.
const SIDE = "[\\p{L}\\p{N}_\"'“”‘’][\\p{L}\\p{N}_ .\\-\"'“”‘’]{0,38}?";
const CLOSER_CHARS = [",", ".", ";", ":", "!", "?", "，", "。", "；", "：", "！", "？", "、", "\"", "'", "“", "”", "‘", "’", ")", "]", "}"];

interface VerbRule {
  relation: Predicate;
  confidence: number;
  verbs: string[];
}

// EN + CN verb frames; longest-first so multi-word verbs win the alternation.
const VERB_RULES: VerbRule[] = [
  {
    relation: "works_on",
    confidence: 0.85,
    verbs: ["is responsible for", "works on", "maintains", "owns", "leads", "\u8D1F\u8D23", "\u4E3B\u5BFC", "\u7EF4\u62A4"],
  },
  {
    relation: "depends_on",
    confidence: 0.85,
    verbs: ["depends on", "relies on", "requires", "\u4F9D\u8D56\u4E8E", "\u4F9D\u8D56"],
  },
  {
    relation: "uses",
    confidence: 0.8,
    verbs: ["is built on", "built with", "built on", "uses", "using", "\u4F7F\u7528", "\u91C7\u7528", "\u57FA\u4E8E"],
  },
  {
    relation: "part_of",
    confidence: 0.8,
    verbs: ["is part of", "ships with", "included in", "part of", "\u5305\u542B", "\u6784\u6210"],
  },
  {
    relation: "member_of",
    confidence: 0.8,
    verbs: ["is a member of", "member of", "joined", "\u52A0\u5165"],
  },
  {
    relation: "located_at",
    confidence: 0.8,
    verbs: ["is located in", "located in", "based in", "hosted on", "\u4F4D\u4E8E", "\u90E8\u7F72\u5728"],
  },
  {
    relation: "authored_by",
    confidence: 0.75,
    verbs: ["authored by", "written by", "created by", "\u5199\u4E86", "\u521B\u5EFA"],
  },
  {
    relation: "related_to",
    confidence: 0.6,
    verbs: ["is related to", "related to", "linked to", "\u76F8\u5173"],
  },
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^()|[\]\\]/g, "\\$&");
}

function buildRuleRegex(verbs: string[]): RegExp {
  const alt = verbs.map(escapeRe).join("|");
  const closers = CLOSER_CHARS.map(escapeRe).join("");
  return new RegExp(
    "(" + SIDE + ")\\s*(?:" + alt + ")\\s*(" + SIDE + ")(?=\\s*[" + closers + "]|\\s*$)",
    "giu",
  );
}

const RULE_RES: Array<{ relation: Predicate; confidence: number; re: RegExp }> = VERB_RULES.map(
  (r) => ({ relation: r.relation, confidence: r.confidence, re: buildRuleRegex(r.verbs) }),
);

const MIN_SIDE = 2;
const MAX_SIDE = 40;

export function extractRuleTriples(text: string): ExtractedTriple[] {
  const out: ExtractedTriple[] = [];
  // Sentence-split first: a side must never span a sentence boundary (the shared space/period
  // character class otherwise lets a lazy subject backtrack across "." into the next clause).
  const sentences = text.split(/[.。!！?？\n]+/).map((s) => s.trim()).filter(Boolean);
  for (const sentence of sentences) {
  for (const { relation, confidence, re } of RULE_RES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while (sentence.length <= 400 && (m = re.exec(sentence)) !== null) {
      const subject = m[1].trim().replace(/^[\"'“”‘’]+|[\"'“”‘’]+$/g, "");
      const object = m[2].trim().replace(/^[\"'“”‘’]+|[\"'“”‘’]+$/g, "");
      if (subject.length < MIN_SIDE || object.length < MIN_SIDE) continue;
      if (subject.length > MAX_SIDE || object.length > MAX_SIDE) continue;
      if (subject === object) continue;
      out.push({ subject, relation, object, confidence, sourceKind: "rule" });
    }
  }
  }
  return out;
}

// Entities already linked to the current memory, as seen by the store layer.
export interface LinkedEntityRef {
  id: number;
  name: string;
  nameNorm: string;
  entityType: EntityType;
  preKnown: boolean; // existed before this write (vs. created by this write)
}

// Graphiti-lite co-occurrence: two pre-known entities co-occurring -> weak related_to edge.
export function coOccurrenceTriples(linked: LinkedEntityRef[]): ExtractedTriple[] {
  const pre = linked.filter((e) => e.preKnown);
  const out: ExtractedTriple[] = [];
  for (let i = 0; i < pre.length; i++) {
    for (let j = i + 1; j < pre.length; j++) {
      out.push({
        subject: pre[i].nameNorm,
        relation: "related_to",
        object: pre[j].nameNorm,
        confidence: 0.4,
        sourceKind: "rule",
      });
    }
  }
  return out;
}

// URL <-> handle co-occurrence bridge: url authored_by handle at 0.7.
export function urlHandleTriples(linked: LinkedEntityRef[]): ExtractedTriple[] {
  const urls = linked.filter((e) => e.entityType === "url");
  const handles = linked.filter((e) => e.entityType === "handle");
  const out: ExtractedTriple[] = [];
  for (const u of urls) {
    for (const h of handles) {
      out.push({
        subject: u.nameNorm,
        relation: "authored_by",
        object: h.nameNorm,
        confidence: 0.7,
        sourceKind: "url_handle",
      });
    }
  }
  return out;
}

// LLM seam parser (Graphiti degrade): tolerate prose around the JSON array; a parse failure is
// a telemetry event for the caller, never a thrown error.
export function parseLlmTriples(raw: string): ExtractedTriple[] | null {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const out: ExtractedTriple[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const subject = typeof rec.subject === "string" ? rec.subject.trim() : "";
    const object = typeof rec.object === "string" ? rec.object.trim() : "";
    const relRaw = typeof rec.relation === "string" ? rec.relation : "";
    const relation = normalizePredicate(relRaw);
    if (!subject || !object || !relation) continue;
    const conf =
      typeof rec.confidence === "number" ? Math.min(1, Math.max(0, rec.confidence)) : 0.6;
    out.push({ subject, relation, object, confidence: conf, sourceKind: "llm" });
  }
  return out;
}

export function dedupeTriples(triples: ExtractedTriple[]): ExtractedTriple[] {
  const seen = new Set<string>();
  const out: ExtractedTriple[] = [];
  for (const t of triples) {
    const key = normalizeEntityName(t.subject) + "|" + t.relation + "|" + normalizeEntityName(t.object);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

// Single entry point for the write path: syntax rules first, then the two derived bridge kinds.
export function extractRelations(text: string, linked: LinkedEntityRef[]): ExtractedTriple[] {
  return dedupeTriples([
    ...extractRuleTriples(text),
    ...coOccurrenceTriples(linked),
    ...urlHandleTriples(linked),
  ]);
}
