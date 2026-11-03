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

// #125 — CJK within-run substring recall. unicode61 keeps an unbroken CJK run as ONE token and
// MATCH is whole-token equality, so "中文研究" cannot hit the description
// "深度中文研究与学术检索" although it is a substring of it.
// Design: match each query CJK run as a contiguous substring of name+description in JS, as a
// second lexical stage under the BM25 arm. Rejected: an auxiliary FTS column — a content-bearing
// extra column moves every row's bm25 length normalization even for queries that never touch it.
// Measured with the ticket's own option 1 (each character space-separated in a third column) on
// the acceptance corpus: "docs*" scored 0.99085996 shipped and 1.10026599 with that column (the
// round-1 unigram+bigram variant gave 1.17124992), and "deep academic research" went 1.00083506 ->
// 0.70620597. Explicit bm25 weights (1,1,0) return those same values, so silencing the column does
// not undo the drift. #110's confidence is coverage x margin and margin is a ratio of these
// numbers, so ASCII recommendations would have been re-priced silently. Also rejected: the trigram
// tokenizer — it returns nothing for a full-text query under 3 characters, and two-character words
// are the commonest word length in Chinese, besides flattening tf to 1. The corpus is a handful of
// domain rows, so the scan costs nothing and gives exact substring semantics.
// Stage combination follows GLOSSARY "Dual DB / Two-Stage Recall": the second stage keeps its own
// order, is tagged with its own provenance label, and is discounted below the first stage's
// weakest positive hit rather than fused into BM25 scoring — the FTS arm stays the anchor. No
// query text is concatenated into SQL here, so the stage adds no MATCH-expression surface.
// One character class for the run matcher and the coverage test: they must agree on what counts
// as CJK, or the two confidence factors disagree about the same match.
// The prolonged-sound mark U+30FC (the Japanese prosody mark), the iteration marks U+3031-U+3035
// and the half-width voiced marks U+FF9E-U+FF9F are Script=Common, so the script properties miss
// them although they are word-internal. Left out of the class they vanish from the query instead of
// breaking it into pieces, and a mark-less query then matches a marked spelling as a full-strength
// substring: "サーバー" against "サーバ運用", or "ソシャル" against "ソーシャルニュース", both score 1.
// With them in, contiguity is required and both score 0 — the two cases the tests pin. The
// half-width katakana LETTERS are already \p{Script=Katakana} and need no listing; nothing is
// folded to full-width, so a half-width query does not match its full-width spelling either.
// Some marks ARE claimed by a script and so count as letters: 々 (U+3005) and 〇 (U+3007) are Han,
// ゝ ゞ (U+309D-U+309E) are Hiragana. The guard below does not exclude them, so a bare 々 query
// matches a description containing it at confidence 1 — the same shape as #110's one-character Han
// query, which also has no length floor. Disclosed as a boundary rather than narrowed here.
// A run of marks only (a bare prosody mark or half-width voice mark) is not a query: every run has
// to carry at least one letter from a CJK script, otherwise the stage fires on punctuation, returns
// one candidate, and the margin rule hands that candidate confidence 1 — a confident recommendation
// built out of nothing.
const CJK_SCRIPT_CLASS = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}";
const CJK_CLASS = CJK_SCRIPT_CLASS + "\\u30FC\\u3031-\\u3035\\uff9E-\\uff9F";
const CJK_RUN_RE = new RegExp(`[${CJK_CLASS}]+`, "gu");
const CJK_CHAR_RE = new RegExp(`[${CJK_CLASS}]`, "u");
const CJK_LETTER_RE = new RegExp(`[${CJK_SCRIPT_CLASS}]`, "u");
// Inserted at every boundary between a CJK-class character and a neighbouring letter/digit, so a
// Latin segment can only be credited where unicode61 would not have swallowed it into one token.
const SCRIPT_EDGE_RE = new RegExp(
  `(?<=[${CJK_CLASS}])(?=[^\s${CJK_CLASS}])|(?<=[^\s${CJK_CLASS}])(?=[${CJK_CLASS}])`,
  "gu",
);

// The query's CJK runs, deduped and capped like escapeQueryUnicode's maxTerms; mark-only runs
// dropped (see the note above).
function cjkQueryRuns(query: string, maxTerms = 8): string[] {
  return [...new Set((query.match(CJK_RUN_RE) ?? []).filter((run) => CJK_LETTER_RE.test(run)))].slice(0, maxTerms);
}

// Share of a query's CJK run characters that occur contiguously in `text` — 1 when every run is
// present, 0 when the query has no CJK or nothing matched. The single number is the stage's whole
// ranking signal, so no flag struct is carried alongside it.
// Exported so the acceptance test can assert the stage rule directly (the same reason
// bm25SearchDomainMeta is exported); it therefore also reaches the package surface through
// index.ts's `export *` — a pure predicate with no engine state behind it.
export function cjkRunFraction(query: string, text: string, maxTerms = 8): number {
  const runs = cjkQueryRuns(query, maxTerms);
  if (runs.length === 0) return 0;
  const hay = text.toLowerCase();
  let hit = 0;
  let total = 0;
  for (const run of runs) {
    const len = [...run].length;
    total += len;
    if (hay.includes(run.toLowerCase())) hit += len;
  }
  return total > 0 ? hit / total : 0;
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
  score: number; // fused score, higher = better (relative bm25, or the discounted substring fraction for a #125 stage row)
  relative: number; // score / top score ∈ (0, 1]
  coverage: number; // share of query content words matched in this candidate's name+description
  arms: string[]; // lexical stage first: ["fts"] BM25, ["cjk"] #125 substring stage; +"embedding" when fused
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
// #125 substring stage: priced under the weakest positive BM25 hit, never on top of it and never
// at zero (a tie would zero the margin; a zero row would dilute the fused list).
const STAGE_DISCOUNT = 0.5;

// Share of the query's content words (relaxedTerms tokenization, same convention as fts5.ts)
// matched in `text`: an ASCII word counts when it prefix-matches a token, a CJK word when its runs
// occur as substrings — priced by cjkRunFraction, the same function the substring stage uses.
// A term made only of Script=Common marks (a stray ー) carries no lexical content and is dropped
// from the denominator, as the stage drops it from its own; before that it scored a hard 0 against
// a stage that ignored it entirely, worth 1 to recall and half that to confidence. What remains is
// definitional, not a bug: coverage averages per term, the stage weights by character, so a
// partially matched multi-term query can still read lower in coverage. The lower of the two drives
// confidence, which is the conservative direction.
export function termCoverage(query: string, text: string): number {
  const terms = unicodeTerms(query);
  if (terms.length === 0) return 0;
  // Unicode-aware token split so CJK runs in the text stay matchable tokens.
  const hay = text.toLowerCase();
  const toks = hay.split(UNICODE_SANITIZE_RE).filter(Boolean);
  // Script-boundary tokens: unicode61 glues an unbroken CJK+Latin run into ONE token
  // (深度中文billing研究 has no separator), so testing a Latin segment against `toks` alone would
  // reject a term that is literally present. Splitting at CJK↔Latin edges accepts `billing` there
  // while still refusing `art` inside `cart` — a Latin segment must start at a real boundary.
  const edgeToks = hay.replace(SCRIPT_EDGE_RE, " ").split(UNICODE_SANITIZE_RE).filter(Boolean);
  let matched = 0;
  let counted = 0;
  for (const t of terms) {
    if (CJK_CHAR_RE.test(t) && cjkQueryRuns(t).length === 0) continue; // mark-only term
    counted++;
    if (toks.some((k) => k.startsWith(t))) {
      matched++;
    } else if (CJK_CHAR_RE.test(t)) {
      // #125: a CJK term buried inside a longer unbroken run is not a token prefix, so the prefix
      // test alone would report coverage 0 for a term the stage just matched.
      // A mixed-script term is credited only when its non-CJK segments match as well. Without that
      // gate, "中文billing" scored full coverage against a description that mentions 中文 and says
      // nothing about billing — the CJK half alone vouches for nothing the Latin half asked for,
      // and with one candidate that reads as a confident out-of-domain recommendation.
      const latin = t.replace(CJK_RUN_RE, " ").split(UNICODE_SANITIZE_RE).filter(Boolean);
      const cjk = cjkRunFraction(t, text);
      if (cjk > 0 && latin.every((seg) => edgeToks.some((k) => k.startsWith(seg)))) matched += cjk;
    }
  }
  return counted > 0 ? matched / counted : 0;
}

interface FtsRow {
  rowid: number;
  name: string;
  description: string;
  match: number; // -bm25(): higher = better (bm25() itself is negative)
  stage: "fts" | "cjk"; // which lexical stage produced it (provenance label, GLOSSARY Two-Stage Recall)
}

// BM25 over an in-memory FTS5 index of domain metadata. Strict rung first (all-terms AND +
// phrase fallback via escapeQueryUnicode), then a relaxed OR rung over content words when the
// strict rung under-fills — same two-rung shape as searchMemoryMultiQuery, minus the
// evidence-majority filter (see header comment). Then the #125 CJK substring stage, appended
// below every BM25 hit.
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
    stage: "fts",
  });
  const q = query.trim();
  const strict = escapeQueryUnicode(q);
  const rows = db.prepare<unknown[], RawRow>(sql).all(strict, limit * 4).map(toRow);
  if (rows.length < limit) {
    const terms = unicodeTerms(q);
    // relaxed OR rung at ≥1 content word: a query like "research for me" has a single
    // content term and the strict AND rung requires the stopwords too, so without the
    // one-term relaxed rung it would report no match. (Memory evidence needs ≥3 +
    // majority; a suggestion does not — the confidence margin prices the ambiguity.)
    if (terms.length >= 1) {
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

  // #125 second lexical stage — substring recall for the CJK runs FTS5 cannot reach. Each row is
  // priced by the share of the query's CJK characters it contains; the rowid tiebreak states the
  // intent explicitly instead of relying on scan order. The discount puts a stage row under the
  // weakest positive BM25 hit, so the BM25 arm alone decides a query it can serve — including one
  // it already fills to topK, where the stage stays out by that rule. When the BM25 arm finds
  // nothing positive (a query whose runs are not token prefixes anywhere, e.g. "中文研究"), the
  // stage owns the ranking: a row carrying every run scores the full anchor unit, a partial row
  // its share. Queries that are also a
  // whole-token prefix ("深度中文研究") keep their BM25 hits and land here only as extras. The
  // embedding arm still fuses over both stages, so it can reorder the list — #110's hybrid
  // contract, unchanged.
  if (cjkQueryRuns(q).length > 0) {
    const positives = rows.map((r) => r.match).filter((m) => m > 0);
    const anchor = positives.length > 0 ? Math.min(...positives) * STAGE_DISCOUNT : 1;
    const seen = new Set(rows.map((r) => r.rowid));
    const scanned = db
      .prepare<unknown[], { rowid: number; name: string; description: string }>(
        "SELECT rowid, name, description FROM domain_fts",
      )
      .all();
    for (const r of scanned) {
      if (seen.has(r.rowid)) continue;
      const fraction = cjkRunFraction(q, r.name + " " + r.description);
      if (fraction === 0) continue;
      rows.push({ rowid: r.rowid, name: r.name, description: r.description, match: fraction * anchor, stage: "cjk" });
    }
  }
  return rows.sort((a, b) => b.match - a.match || a.rowid - b.rowid).slice(0, limit);
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
        arms: cos ? [row.stage, "embedding"] : [row.stage],
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
