// Domain Recommender acceptance test (#110; parent #31; T6 decision #92).
// AC1: relevant-description queries hit the most relevant domain (expectRankOf-style:
// rank of the expected candidate in the fused list must be ≤ maxRank — same assertion
// shape as packages/store/src/eval/runner.ts expectRankOf).
// AC2: low-confidence path lists candidates + structured "why no recommendation" instead
// of guessing a single domain.
// AC3: without the embedding package the engine degrades to FTS-only and still ranks
// correctly (regression); with a stub embedding module the hybrid arm fuses and still
// ranks correctly.
// #125 extends the CJK block: within-run substring queries (including two-character words and
// single characters), reordered runs must abstain, the substring stage must stay below the BM25
// arm, and a CJK-free query must not touch the lexical arm at all.

import {
  recommendDomains,
  termCoverage,
  cjkRunMatch,
  HIGH_CONFIDENCE_THRESHOLD,
  type DomainMeta,
  type RecommendResult,
} from "../src/domain-recommend";
import { __setEmbeddingModuleForTest } from "../src/embedding-arm";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

// Mirrors the builtin domains/ tomls (name+description are the only indexed fields).
const METAS: DomainMeta[] = [
  { id: "default", name: "default", description: "Default domain with all search providers" },
  { id: "docs", name: "docs", description: "Technical-docs retrieval: MCP spec / TypeScript tsconfig / pnpm settings (first-party corpus)" },
  { id: "research", name: "research", description: "Deep web research with Exa + Tavily" },
];

// expectRankOf-style assertion: the expected domain must appear within maxRank of the
// candidate list (maxRank 1 = top hit). Returns the 1-based rank, 0 when absent.
function rankOf(r: RecommendResult, id: string): number {
  return r.candidates.findIndex((c) => c.id === id) + 1;
}
function expectRankOf(r: RecommendResult, id: string, maxRank: number, label: string) {
  const rank = rankOf(r, id);
  assert(rank !== 0, label + ": expected candidate '" + id + "' absent from list");
  assert(rank <= maxRank, label + ": rank " + rank + " > maxRank " + maxRank + " for '" + id + "'");
}

async function main() {
  // Deterministic FTS-only baseline: force the peer-optional embedding arm absent.
  __setEmbeddingModuleForTest(null);
  try {
    // --- AC3 (degradation) + AC1 (ranking) under FTS-only ---
    const cases: [string, string][] = [
      ["deep web research with exa and tavily", "research"],
      ["typescript tsconfig technical documentation", "docs"],
      ["mcp spec model context protocol", "docs"],
      ["pnpm workspace settings", "docs"],
      ["default providers for general search", "default"],
    ];
    for (const [q, expected] of cases) {
      const r = await recommendDomains(q, METAS);
      assert(r.arms.embedding === "absent", "FTS-only: embedding arm reported absent for '" + q + "'");
      expectRankOf(r, expected, 1, "FTS-only '" + q + "'");
      assert(r.candidates.every((c) => c.arms.length === 1 && c.arms[0] === "fts"), "FTS-only: candidates carry only the fts arm");
    }

    // Clear single-domain queries are high-confidence suggestions.
    const strong = await recommendDomains("deep web research with exa and tavily", METAS);
    assert(strong.decision === "high", "clear query => high confidence (got " + strong.decision + ", conf " + strong.confidence + ")");
    assert(strong.recommendation?.id === "research", "high-confidence recommendation is research");
    assert(strong.confidence !== null && strong.confidence >= HIGH_CONFIDENCE_THRESHOLD, "confidence >= threshold");
    assert(strong.why === null, "high confidence has no 'why'");

    // --- AC2: low-confidence path lists candidates, never guesses ---
    const ambiguous = await recommendDomains("research docs", METAS);
    assert(ambiguous.decision === "low", "ambiguous 'research docs' => low (got " + ambiguous.decision + ", conf " + ambiguous.confidence + ")");
    assert(ambiguous.recommendation === null, "low confidence => recommendation null (no guessing)");
    assert(ambiguous.candidates.length >= 2, "low confidence => candidate list with >=2 entries");
    expectRankOf(ambiguous, "research", 2, "low-conf 'research docs' research in top-2");
    expectRankOf(ambiguous, "docs", 2, "low-conf 'research docs' docs in top-2");
    assert(ambiguous.why?.code === "low_confidence", "why.code = low_confidence");
    assert(
      !!ambiguous.why && /coverage/.test(ambiguous.why.detail) && /margin/.test(ambiguous.why.detail),
      "why detail carries coverage + margin factors: " + ambiguous.why?.detail,
    );
    assert(
      ambiguous.why?.threshold === HIGH_CONFIDENCE_THRESHOLD && typeof ambiguous.why?.confidence === "number",
      "why carries structured threshold + confidence",
    );

    // Weak-coverage single hit is low confidence, not a confident guess.
    const weak = await recommendDomains("mcp spec model context protocol", METAS);
    // docs matches only 2/5 content words → coverage 0.4 → below threshold → low, docs still rank 1
    expectRankOf(weak, "docs", 1, "weak-coverage 'mcp spec...' still ranks docs first");
    assert(weak.decision === "low", "weak coverage => low confidence (got " + weak.decision + ")");

    // --- no match at all ---
    const none = await recommendDomains("xyzzy gibberishplugh", METAS);
    assert(none.decision === "none" && none.candidates.length === 0, "no match => decision none");
    assert(none.why?.code === "no_match", "no match => why.code no_match");
    assert(none.recommendation === null && none.confidence === null, "no match => no recommendation/confidence");

    // top-K cap respected
    const capped = await recommendDomains("search research docs providers web", METAS);
    assert(capped.candidates.length <= 3, "candidates capped at top-3 (got " + capped.candidates.length + ")");

    // termCoverage unit checks
    assert(termCoverage("deep web research", "Deep web research with Exa") === 1, "coverage 1 when all terms match");
    assert(termCoverage("alpha beta", "alpha only") === 0.5, "coverage 0.5 on half match");
    assert(termCoverage("the and of", "anything") === 0, "stopword-only query => coverage 0");

    // --- CodeRabbit #2: Unicode (CJK) query terms must not collapse to no-match ---
    const CJK_METAS: DomainMeta[] = [
      ...METAS,
      { id: "zh-research", name: "zh", description: "深度中文研究与学术检索 Deep academic research" },
    ];
    const cjk = await recommendDomains("深度中文研究", CJK_METAS);
    assert(cjk.decision !== "none", "pure-CJK query no longer collapses to no_match (got " + cjk.decision + ")");
    expectRankOf(cjk, "zh-research", 1, "CJK '深度中文研究'");
    const cjkMixed = await recommendDomains("web 深度中文研究", CJK_METAS);
    expectRankOf(cjkMixed, "zh-research", 1, "mixed ASCII+CJK 'web 深度中文研究'");
    assert(termCoverage("深度中文研究", "深度中文研究与学术检索") === 1, "CJK coverage matches CJK text");

    // --- #125: CJK within-run substring recall (unicode61 keeps a run as ONE token) ---
    // The exact gap from the ticket: a substring of the description, not a prefix of its token.
    const sub = await recommendDomains("中文研究", CJK_METAS);
    assert(sub.decision !== "none", "'中文研究' is a substring of the indexed run, no longer no_match (got " + sub.decision + ")");
    expectRankOf(sub, "zh-research", 1, "CJK substring '中文研究'");
    assert(sub.decision === "high" && sub.recommendation?.id === "zh-research", "substring hit is a confident suggestion (conf " + sub.confidence + ")");
    assert(sub.candidates[0]!.coverage === 1, "coverage counts a CJK substring, not only a token prefix");
    assert(termCoverage("中文研究", "深度中文研究与学术检索") === 1, "CJK coverage matches a mid-run substring");

    // Two-character Chinese words — the case that rules the trigram tokenizer out (it needs ≥3
    // characters per full-text query). Tail and single-character queries resolve the same way.
    for (const short of ["检索", "学术", "中文", "学术检索", "术"]) {
      const r = await recommendDomains(short, CJK_METAS);
      expectRankOf(r, "zh-research", 1, "CJK substring '" + short + "'");
      assert(r.decision === "high", "CJK substring '" + short + "' reaches high confidence (got " + r.decision + ")");
    }

    // Exact-substring semantics, not a bag of characters: reordering the query breaks the
    // substring, so the engine abstains instead of surfacing a candidate. This is the assertion
    // that would pass vacuously if it only checked "not confident".
    for (const wrong of ["研究学术", "检索学术", "深文中文研究"]) {
      const r = await recommendDomains(wrong, CJK_METAS);
      assert(r.decision === "none" && r.candidates.length === 0, "reordered CJK '" + wrong + "' is not a substring => no_match (got " + r.decision + ", " + r.candidates.length + " candidates)");
      assert(r.why?.code === "no_match", "reordered CJK '" + wrong + "' reports why.code no_match");
    }
    // Absent characters match nothing either.
    const absent = await recommendDomains("机器翻译", CJK_METAS);
    assert(absent.decision === "none" && absent.candidates.length === 0, "CJK query with no substring in common => no_match (got " + absent.decision + ")");

    // Partial coverage stays a priced suggestion, never a silent 0: one of two runs matching
    // lands the candidate with coverage 0.5.
    const partial = await recommendDomains("文献 检索", CJK_METAS);
    expectRankOf(partial, "zh-research", 1, "mixed CJK runs '文献 检索' (only 检索 is present)");
    assert(partial.candidates[0]!.coverage === 0.5, "partial CJK coverage 0.5 (got " + partial.candidates[0]!.coverage + ")");
    // A whole sentence is not a substring of a description, so it abstains — First-Class
    // Abstain is preserved rather than traded away for recall.
    const sentence = await recommendDomains("我想找深度中文研究相关的文献资料推荐一下", CJK_METAS);
    assert(sentence.decision === "none", "long CJK sentence with no contiguous substring => abstain (got " + sentence.decision + ")");

    // The substring stage is appended below the BM25 arm, not fused into it (GLOSSARY
    // "Dual DB / Two-Stage Recall"): a query the lexical arm can serve still ranks first.
    const bothArms = await recommendDomains("检索 research", CJK_METAS);
    assert(bothArms.candidates[0]!.id === "research", "BM25 hit outranks the appended CJK stage (got " + bothArms.candidates[0]!.id + ")");

    // Hiragana and Hangul runs resolve the same way (the run class is CJK-wide, not Han-only).
    const JA_KO_METAS: DomainMeta[] = [
      { id: "ja", name: "ja", description: "日本語の文献検索" },
      { id: "ko", name: "ko", description: "한국어 논문 검색" },
    ];
    expectRankOf(await recommendDomains("文献検索", JA_KO_METAS), "ja", 1, "Japanese substring '文献検索'");
    expectRankOf(await recommendDomains("논문", JA_KO_METAS), "ko", 1, "Korean substring '논문'");
    expectRankOf(await recommendDomains("검색", JA_KO_METAS), "ko", 1, "Hangul substring '검색'");

    // The stage is inert for a CJK-free query: nothing is added to the MATCH expression and no
    // row is scanned, so #110's pure-ASCII behaviour is preserved by construction.
    const inert = cjkRunMatch("deep web research", "深度中文研究与学术检索");
    assert(inert.all === false && inert.any === false && inert.fraction === 0, "CJK-free query has no substring stage");
    assert(cjkRunMatch("中文研究", "深度中文研究与学术检索").all === true, "cjkRunMatch reports a contiguous run");
    assert(cjkRunMatch("研究中文", "深度中文研究与学术检索").fraction === 0, "cjkRunMatch rejects a reordered run");

    // --- CodeRabbit #2 (round 2): one content word + stopwords still gets the relaxed rung ---
    const oneTerm = await recommendDomains("research for me", METAS);
    assert(oneTerm.decision !== "none", "'research for me' no longer no-match (got " + oneTerm.decision + ")");
    expectRankOf(oneTerm, "research", 1, "'research for me'");

    // --- AC3 (hybrid): stub embedding module present → arm fuses, ranking preserved ---
    __setEmbeddingModuleForTest({
      embedText: async (text: string) => {
        // deterministic toy vector: bag-of-chars hash so similar texts get similar vectors
        const v = new Float32Array(384);
        for (const ch of text.toLowerCase()) v[ch.charCodeAt(0) % 384] += 1;
        const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
        for (let i = 0; i < v.length; i++) v[i] /= n;
        return v;
      },
      embeddingTelemetry: () => ({ loads: 1, embeds: 1, failures: 0, circuitOpen: false }),
      EMBEDDING_MODEL_ID: "test-model",
    } as never);
    const hybrid = await recommendDomains("deep web research with exa and tavily", METAS);
    assert(hybrid.arms.embedding === "present", "stub arm => embedding present");
    assert(hybrid.candidates.every((c) => c.arms.includes("embedding")), "hybrid: candidates carry the embedding arm");
    expectRankOf(hybrid, "research", 1, "hybrid 'deep web research...'");
    const hybridDocs = await recommendDomains("typescript tsconfig technical documentation", METAS);
    expectRankOf(hybridDocs, "docs", 1, "hybrid 'typescript tsconfig...'");

    // --- CodeRabbit #3: a null PASSAGE vector disables fusion for the whole request ---
    __setEmbeddingModuleForTest({
      embedText: async (_text: string, role: string) => {
        if (role === "passage") return null; // query vector ok, passage vectors fail
        return new Float32Array(384).fill(0.5);
      },
      embeddingTelemetry: () => ({ loads: 1, embeds: 1, failures: 1, circuitOpen: false }),
      EMBEDDING_MODEL_ID: "test-model",
    } as never);
    const partial = await recommendDomains("deep web research with exa and tavily", METAS);
    assert(partial.arms.embedding === "unavailable", "null passage vector => arm 'unavailable' (got " + partial.arms.embedding + ")");
    assert(partial.candidates.every((c) => c.arms.length === 1 && c.arms[0] === "fts"), "partial vectors => FTS-only candidates, no zero-cosine fusion");
    expectRankOf(partial, "research", 1, "partial-vector degradation keeps FTS-only ranking");
  } finally {
    __setEmbeddingModuleForTest("auto");
  }

  console.log("--- domain-recommend tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FAIL: unexpected error", e);
  process.exit(1);
});
