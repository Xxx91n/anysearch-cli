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
// the top candidate's name+description; margin = 1 − (runner-up score / top score), 1.0 for a single
// candidate. confidence = coverage × margin ∈ [0,1]; high ⇔ confidence ≥ HIGH_CONFIDENCE_THRESHOLD.
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
  let matched = 0;
  for (const t of terms) if (toks.some((k) => k.startsWith(t))) matched++;
  return matched / terms.length;
}

interface FtsRow {
  rowid: number;
  name: string;
  description: string;
  match: number; // -bm25(): higher = better (bm25() itself is negative)
}

// BM25 over an in-memory FTS5 index of domain metadata. Strict rung first (all-terms AND +
// phrase fallback via escapeQueryUnicode), then a relaxed OR rung over content words when the
// strict rung under-fills — same two-rung shape as searchMemoryMultiQuery, minus the
// evidence-majority filter (see header comment).
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
  const strict = escapeQueryUnicode(query.trim());
  const rows = db.prepare<unknown[], RawRow>(sql).all(strict, limit * 4).map(toRow);
  if (rows.length < limit) {
    const terms = unicodeTerms(query.trim());
    // relaxed OR rung at ≥2 content words (memory evidence needs ≥3 + majority; a
    // suggestion does not — the confidence margin prices the ambiguity instead).
    if (terms.length >= 2) {
      const relaxed = terms.map((t) => t + "*").join(" OR ");
      const seen = new Set(rows.map((r) => r.rowid));
      for (const r of db.prepare<unknown[], RawRow>(sql).all(relaxed, limit * 8).map(toRow)) {
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
    db.exec("CREATE VIRTUAL TABLE domain_fts USING fts5(name, description)");
    const ins = db.prepare("INSERT INTO domain_fts(rowid, name, description) VALUES (?, ?, ?)");
    metas.forEach((m, i) => ins.run(i + 1, m.name, m.description));
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
