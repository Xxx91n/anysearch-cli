// Domain Recommender engine — powers `ans recommend` (#110; parent #31; T6 decision #92).
// Design: user free text → BM25 (FTS5) over domain metadata (name+description) → top-3 + confidence →
// high confidence suggests `ans domain <id>`, low confidence lists candidates for manual selection —
// NEVER auto-switches (the CLI only prints the suggestion; persistence stays with `ans domain <name>`,
// homomorphic with First-Class Abstain). The embedding arm is peer-optional: package absent or
// vector null degrades to FTS-only, never a throw (fail-open, same contract as embedding-arm.ts).
//
// Confidence model — coverage × margin, NOT an absolute bm25 floor:
// with a 3-row corpus bm25 magnitudes run ~1e-6..3 and scale with corpus size, so an absolute
// threshold is uncalibratable. Instead: coverage = share of query content words prefix-matched in
// the top candidate's name+description (substring-matched for CJK terms, #125); margin = 1 −
// (runner-up score / top score), 1.0 for a single candidate. confidence = coverage × margin ∈
// [0,1]; high ⇔ confidence ≥ HIGH_CONFIDENCE_THRESHOLD.
// Scale-free, and every factor is printable in the structured "why no recommendation" line.
//
// Relaxed rung deviation from fts5.ts: memory evidence requires a strict majority of content words
// (coversMajority) to keep near-miss distractors out; a recommender is a suggestion, not evidence,
// so the relaxed OR rung fires at ≥2 content words and ambiguity is handled by the margin instead.

import Database from "better-sqlite3";
import { RELAX_STOPWORDS } from "./fts5";
import { embedText, cosineSimilarity, armTelemetry } from "./embedding-arm";

// Unicode-aware query handling, LOCAL to the recommender. The shared fts5.ts
// helpers sanitize to [A-Za-z0-9] only, so a pure-CJK query collapses to the
// empty phrase '""' and can never match — yet FTS5's default unicode61
// tokenizer DOES index Unicode letters. User-facing free text in this repo is
// bilingual, so the recommender keeps \p{L}\p{N} terms. The shared helpers stay
// ASCII-strict for memory evidence; for pure-ASCII queries these produce
// byte-identical expressions to fts5EscapeQuery/relaxedTerms.
const UNICODE_SANITIZE_RE = /[^\p{L}\p{N}]+/gu;
const PHRASE_QUOTE_RE = /"/g; // CWE-20 escape: double-quote doubling for FTS5

function escapeQueryUnicode(query: string, maxTerms = 8): string {
  const sanitized = query.replace(UNICODE_SANITIZE_RE, " ").trim();
  if (!sanitized) return '""';
  const words = sanitized.split(/\s+/).slice(0, maxTerms);
  const prefixClause = words.map((w) => w + "*").join(" AND ");
  const phrase = query.replace(PHRASE_QUOTE_RE, '""');
  return "(" + prefixClause + ') OR "' + phrase + '"';
}

// #125 — within-run CJK recall. unicode61 keeps an unbroken CJK run as ONE token and MATCH is
// whole-token equality, so "中文研究" cannot hit the description "深度中文研究与学术检索" even
// though it is a substring of it. The indexed `cjk` column holds each run as its single chars
// followed by its character bigrams; chaining a query run's consecutive bigrams into a phrase
// restores exact-substring semantics (sqlite.org/fts5.html §4.3.1, fts5-cjk recall measurements
// on a 47k-row legal corpus). Chosen over the trigram tokenizer because trigram returns nothing
// for a full-text query shorter than 3 characters — two-character words are the commonest word
// length in Chinese — and because trigram flattens tf to 1, which degrades BM25 ordering.
// Index side and query side call THESE functions and no others: two split functions drifting
// apart is the documented silent-recall-loss failure mode for bigram indexes.
const CJK_RUN_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
const CJK_CHAR_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function cjkRuns(text: string): string[] {
  return text.match(CJK_RUN_RE) ?? [];
}

// Indexed token stream for a text: per run the single chars first (a one-character query has to
// resolve), then the bigram block. The block stays contiguous inside a run, which is what makes
// a bigram phrase match a substring rather than a bag of characters.
export function cjkIndexTokens(text: string): string[] {
  const out: string[] = [];
  for (const run of cjkRuns(text)) {
    const chars = [...run];
    out.push(...chars);
    for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i]! + chars[i + 1]!);
  }
  return out;
}

export interface CjkClause {
  strict: string | null; // every run matched: bigram phrase per run, AND-ed across runs
  relaxed: string | null; // the runs' bigrams OR-ed — partial within-run recall
}

// Query-side counterpart of cjkIndexTokens. Null on both fields for a CJK-free query, so the
// pure-ASCII MATCH expressions stay byte-identical to the pre-#125 shape (and a bm25 column with
// no query term contributes nothing to the score).
// Truncation mirrors escapeQueryUnicode's maxTerms: at most maxTerms runs, each phrase built from
// its first maxTerms bigrams — a long query then matches its leading substring. Only the query is
// truncated, never the index, so the split itself stays one function on both sides.
export function cjkClauses(query: string, maxTerms = 8): CjkClause {
  const strict: string[] = [];
  const bigrams = new Set<string>();
  for (const run of cjkRuns(query).slice(0, maxTerms)) {
    const chars = [...run];
    if (chars.length === 1) {
      strict.push('"' + chars[0]! + '"'); // quoted so the column filter parses as a token match
      continue;
    }
    const phrase: string[] = [];
    for (let i = 0; i + 1 < chars.length && phrase.length < maxTerms; i++) {
      const bg = chars[i]! + chars[i + 1]!;
      phrase.push(bg);
      bigrams.add(bg);
    }
    strict.push('"' + phrase.join(" ") + '"');
  }
  if (strict.length === 0) return { strict: null, relaxed: null };
  return { strict: strict.join(" AND "), relaxed: bigrams.size > 0 ? [...bigrams].join(" OR ") : null };
}

// Content words of a query with Unicode letters preserved (same stopword list
// and ≤ maxTerms truncation as fts5.ts relaxedTerms).
export function unicodeTerms(query: string, maxTerms = 8): string[] {
  const words = query
    .replace(UNICODE_SANITIZE_RE, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  return [...new Set(words.filter((w) => !RELAX_STOPWORDS.has(w)))].slice(0, maxTerms);
}

export interface DomainMeta {
  id: string; // toml file stem, e.g. "docs"
  name: string;
  description: string;
}

export interface RecommendCandidate {
  id: string;
  name: string;
  description: string;
  rank: number; // 1-based position in the fused list
  score: number; // fused score, higher = better
  relative: number; // score / top score ∈ (0, 1]
  coverage: number; // share of query content words matched in this candidate's name+description
  arms: string[]; // ["fts"] FTS-only, ["fts", "embedding"] hybrid
}

export type RecommendDecision = "high" | "low" | "none";

export interface RecommendWhy {
  code: "no_match" | "low_confidence";
  detail: string; // one-line human explanation
  confidence?: number;
  margin?: number;
  coverage?: number;
  threshold?: number;
}

export interface RecommendResult {
  query: string;
  decision: RecommendDecision; // high = single confident suggestion; low = candidate list; none = no match
  candidates: RecommendCandidate[]; // ≤ topK, sorted best-first
  recommendation: { id: string; name: string; confidence: number } | null; // non-null only when high
  confidence: number | null; // top candidate confidence
  why: RecommendWhy | null; // structured "why no recommendation" whenever decision != "high"
  arms: { embedding: "present" | "absent" | "unavailable" };
  topK: number;
}

export const RECOMMEND_TOP_K = 3;
export const HIGH_CONFIDENCE_THRESHOLD = 0.5;
// Hybrid fusion weights: FTS stays the anchor arm, embedding only nudges (peer-optional).
const FTS_WEIGHT = 0.6;
const EMBEDDING_WEIGHT = 0.4;

// Share of the query's content words (relaxedTerms tokenization, same convention as fts5.ts)
// that prefix-match a token of `text`. 0 when the query has no content words.
export function termCoverage(query: string, text: string): number {
  const terms = unicodeTerms(query);
  if (terms.length === 0) return 0;
  // Unicode-aware token split so CJK runs in the text stay matchable tokens.
  const toks = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const hay = text.toLowerCase();
  let matched = 0;
  for (const t of terms) {
    if (toks.some((k) => k.startsWith(t))) {
      matched++;
    } else if (CJK_CHAR_RE.test(t) && hay.includes(t)) {
      // #125: a CJK term buried inside a longer unbroken run is a substring, never a token
      // prefix — prefix matching alone would report coverage 0 for a term that did match.
      matched++;
    }
  }
  return matched / terms.length;
}

interface FtsRow {
  rowid: number;
  name: string;
  description: string;
  match: number; // -bm25(): higher = better (bm25() itself is negative)
}

// BM25 over an in-memory FTS5 index of domain metadata. Strict rung first (all-terms AND +
// phrase fallback via escapeQueryUnicode, plus the #125 bigram phrase over the `cjk` column),
// then a relaxed OR rung over content words when the strict rung under-fills — same two-rung
// shape as searchMemoryMultiQuery, minus the evidence-majority filter (see header comment).
export function bm25SearchDomainMeta(db: Database.Database, query: string, limit = RECOMMEND_TOP_K): FtsRow[] {
  const sql =
    "SELECT rowid, name, description, bm25(domain_fts) AS bm25score " +
    "FROM domain_fts WHERE domain_fts MATCH ? ORDER BY bm25score LIMIT ?";
  interface RawRow { rowid: number; name: string; description: string; bm25score: number; }
  const toRow = (r: RawRow): FtsRow => ({
    rowid: r.rowid,
    name: r.name,
    description: r.description,
    match: -r.bm25score,
  });
  const q = query.trim();
  const cjk = cjkClauses(q);
  const strict = escapeQueryUnicode(q);
  // Column-filtered so the bigram phrase only reads the `cjk` column it was written for.
  const strictExpr = cjk.strict ? "(" + strict + ") OR cjk:(" + cjk.strict + ")" : strict;
  const rows = db.prepare<unknown[], RawRow>(sql).all(strictExpr, limit * 4).map(toRow);
  if (rows.length < limit) {
    const terms = unicodeTerms(q);
    // relaxed OR rung at ≥1 content word: a query like "research for me" has a single
    // content term and the strict AND rung requires the stopwords too, so without the
    // one-term relaxed rung it would report no match. (Memory evidence needs ≥3 +
    // majority; a suggestion does not — the confidence margin prices the ambiguity.)
    const relaxedExprs: string[] = [];
    if (terms.length >= 1) relaxedExprs.push(terms.map((t) => t + "*").join(" OR "));
    // #125: a CJK substring that is not an exact run match still deserves the partial rung,
    // priced the same way — a suggestion, not evidence.
    if (cjk.relaxed) relaxedExprs.push("cjk:(" + cjk.relaxed + ")");
    const seen = new Set(rows.map((r) => r.rowid));
    for (const expr of relaxedExprs) {
      for (const r of db.prepare<unknown[], RawRow>(sql).all(expr, limit * 8).map(toRow)) {
        if (!seen.has(r.rowid)) {
          seen.add(r.rowid);
          rows.push(r);
        }
      }
    }
  }
  return rows.sort((a, b) => b.match - a.match).slice(0, limit);
}

// Full recommend pipeline. Pure with respect to the outside world except the peer-optional
// embedding arm (embedText returns null when the package is absent — fail-open).
export async function recommendDomains(query: string, metas: DomainMeta[], opts?: { topK?: number }): Promise<RecommendResult> {
  const topK = opts?.topK ?? RECOMMEND_TOP_K;
  const q = query.trim();
  const db = new Database(":memory:");
  try {
    // Auxiliary `cjk` column: FTS5 has no HIDDEN column keyword (only UNINDEXED, which would
    // drop it out of the index entirely), so it is a plain third column that no SELECT lists —
    // rows are read back by name/description only. It carries CJK characters only, so an ASCII
    // query never touches it and bm25 scores for those queries are unchanged.
    db.exec("CREATE VIRTUAL TABLE domain_fts USING fts5(name, description, cjk)");
    const ins = db.prepare("INSERT INTO domain_fts(rowid, name, description, cjk) VALUES (?, ?, ?, ?)");
    metas.forEach((m, i) => ins.run(i + 1, m.name, m.description, cjkIndexTokens(m.name + " " + m.description).join(" ")));
    const rows = bm25SearchDomainMeta(db, q, topK);

    // Peer-optional embedding arm: query vector + per-candidate passage vectors, cosine-fused
    // with relative bm25. Absent package or ANY null vector ⇒ FTS-only for the whole request
    // (legal state, never a throw): a zero-filled cosine for one candidate would silently
    // reorder against the FTS-only result, so partial vectors disable fusion entirely.
    let embedding: RecommendResult["arms"]["embedding"] = "absent";
    let cos: number[] | null = null;
    const qv = await embedText(q, "query");
    if (qv) {
      const vecs: Float32Array[] = [];
      let complete = true;
      for (const row of rows) {
        const dv = await embedText(row.name + " " + row.description, "passage");
        if (!dv) {
          complete = false;
          break;
        }
        vecs.push(dv);
      }
      if (complete) {
        embedding = "present";
        cos = vecs.map((dv) => cosineSimilarity(qv, dv));
      } else {
        embedding = "unavailable";
      }
    } else {
      const tel = await armTelemetry();
      embedding = tel.absent ? "absent" : "unavailable";
    }

    const empty = (why: RecommendWhy): RecommendResult => ({
      query: q,
      decision: "none",
      candidates: [],
      recommendation: null,
      confidence: null,
      why,
      arms: { embedding },
      topK,
    });
    if (rows.length === 0) {
      return empty({ code: "no_match", detail: "no domain metadata matched any query term" });
    }

    const topMatch = rows[0]!.match;
    const scores = rows.map((r, i) => {
      const rel = topMatch > 0 ? r.match / topMatch : 1;
      if (!cos) return rel; // FTS-only: score ≡ relative bm25 (top = 1)
      const c = (cos[i]! + 1) / 2; // cosine [-1,1] → [0,1]
      return FTS_WEIGHT * rel + EMBEDDING_WEIGHT * c;
    });
    const order = rows.map((_, i) => i).sort((a, b) => scores[b]! - scores[a]!);
    const topScore = scores[order[0]! ]!;
    const candidates: RecommendCandidate[] = order.slice(0, topK).map((oi, rank) => {
      const row = rows[oi]!;
      const score = scores[oi]!;
      return {
        id: metas[row.rowid - 1]?.id ?? String(row.rowid),
        name: row.name,
        description: row.description,
        rank: rank + 1,
        score,
        relative: topScore > 0 ? score / topScore : 1,
        coverage: termCoverage(q, row.name + " " + row.description),
        arms: cos ? ["fts", "embedding"] : ["fts"],
      };
    });

    const top = candidates[0]!;
    const margin = candidates.length >= 2 && top.score > 0 ? Math.max(0, 1 - candidates[1]!.score / top.score) : 1;
    const confidence = top.coverage * margin;
    const decision: RecommendDecision = confidence >= HIGH_CONFIDENCE_THRESHOLD ? "high" : "low";
    return {
      query: q,
      decision,
      candidates,
      recommendation:
        decision === "high" ? { id: top.id, name: top.name, confidence } : null,
      confidence,
      why:
        decision === "high"
          ? null
          : {
              code: "low_confidence",
              detail:
                "low confidence " + confidence.toFixed(2) + " < " + HIGH_CONFIDENCE_THRESHOLD.toFixed(2) +
                " (coverage " + top.coverage.toFixed(2) + ", margin " + margin.toFixed(2) + ")",
              confidence,
              margin,
              coverage: top.coverage,
              threshold: HIGH_CONFIDENCE_THRESHOLD,
            },
      arms: { embedding },
      topK,
    };
  } finally {
    db.close();
  }
}
