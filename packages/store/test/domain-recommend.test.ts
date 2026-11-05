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
// arm with its own provenance label, and a CJK-free query leaves the BM25 arm answering exactly as
// before — which is what the ASCII cases above, unchanged from #110, demonstrate.
// The #125 遗留第 1 项 follow-up adds the crowding case: when BM25 already fills topK with positive
// hits, the stage keeps candidate presence via a reserved LAST slot (presence, not rank). The
// #173 review round pins the reproduced findings against that reservation: FTS-reachable rows
// never enter the stage, the reservation appends instead of swapping (topK=1 keeps the anchor,
// topK=2 keeps the baseline decision), confidence reads the pre-reservation pair, and a
// fusion-boosted reserved row is clamped out of rank 0.

import {
  recommendDomains,
  termCoverage,
  cjkRunFraction,
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
    assert(sub.candidates[0]!.arms[0] === "cjk", "the substring stage, not BM25, answered '中文研究' (arms " + sub.candidates[0]!.arms.join("+") + ")");
    assert(termCoverage("中文研究", "深度中文研究与学术检索") === 1, "CJK coverage matches a mid-run substring");

    // Two-character Chinese words — the case that rules the trigram tokenizer out (it needs ≥3
    // characters per full-text query). Tail and single-character queries resolve the same way.
    for (const short of ["检索", "学术", "中文", "学术检索", "术"]) {
      const r = await recommendDomains(short, CJK_METAS);
      expectRankOf(r, "zh-research", 1, "CJK substring '" + short + "'");
      assert(r.decision === "high", "CJK substring '" + short + "' reaches high confidence (got " + r.decision + ")");
    }

    // Contiguity is required within a run — reordering characters breaks the substring, so the
    // engine abstains instead of surfacing a candidate. (Runs separated by whitespace or
    // punctuation are matched independently, which is why "文献 检索" below still lands.) This is
    // the assertion that would pass vacuously if it only checked "not confident".
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
    const cjkPartial = await recommendDomains("文献 检索", CJK_METAS);
    expectRankOf(cjkPartial, "zh-research", 1, "mixed CJK runs '文献 检索' (only 检索 is present)");
    assert(cjkPartial.candidates[0]!.coverage === 0.5, "partial CJK coverage 0.5 (got " + cjkPartial.candidates[0]!.coverage + ")");
    // A whole sentence is not a substring of a description, so it abstains — First-Class
    // Abstain is preserved rather than traded away for recall.
    const sentence = await recommendDomains("我想找深度中文研究相关的文献资料推荐一下", CJK_METAS);
    assert(sentence.decision === "none", "long CJK sentence with no contiguous substring => abstain (got " + sentence.decision + ")");

    // The substring stage is appended below the BM25 arm, not fused into it (GLOSSARY
    // "Dual DB / Two-Stage Recall"), and it never ties the weakest hit (a tie would zero the
    // margin). "研究 provider" is the query that actually reaches the stage: 研究 is not an
    // indexed token prefix, so zh-research can only come from the substring stage, while
    // `provider` gives the BM25 arm a hit.
    const bothArms = await recommendDomains("研究 provider", CJK_METAS);
    assert(bothArms.candidates[0]!.id === "default", "BM25 hit ranks above the appended CJK stage (got " + bothArms.candidates[0]!.id + ")");
    assert(bothArms.candidates[0]!.arms[0] === "fts", "BM25 rows keep the fts label");
    expectRankOf(bothArms, "zh-research", 2, "CJK stage lands behind the BM25 hit");
    const stageRow = bothArms.candidates.find((c) => c.id === "zh-research");
    assert(!!stageRow && stageRow.arms[0] === "cjk", "stage row carries its own provenance label (got " + stageRow?.arms.join("+") + ")");
    assert(!!stageRow && bothArms.candidates[0]!.score > stageRow.score && stageRow.score > 0, "stage score is discounted below, never tied with, and never zero");

    // --- #125 遗留第 1 项: the stage must survive BM25 filling topK (topK crowding) ---
    // Four ASCII research domains give BM25 four positive hits on "research*"; only the substring
    // stage can reach the CJK domain on 中文研究. Before the reservation, the final slice dropped
    // every stage row, so the domain that answered a query term never appeared — the ticket's own
    // crowding example, the same no-show it opened for in its mixed-query form. The reserved row
    // takes the LAST slot: presence, not rank — the BM25 anchor keeps every rank it held, the
    // candidate count stays at topK, and the kept list stays non-increasing in score.
    const CROWD_METAS: DomainMeta[] = [
      { id: "r1", name: "research", description: "web research one" },
      { id: "r2", name: "research", description: "web research two" },
      { id: "r3", name: "research", description: "web research three" },
      { id: "r4", name: "research", description: "web research four" },
      { id: "zh-research", name: "zh", description: "深度中文研究与学术检索" },
    ];
    const crowd = await recommendDomains("research 中文研究", CROWD_METAS);
    const zhRank = rankOf(crowd, "zh-research");
    assert(zhRank !== 0, "a crowded topK still lists the CJK domain the stage answered (rank " + zhRank + ")");
    assert(zhRank === 3, "the reserved slot is the LAST candidate — BM25 anchor order kept (rank " + zhRank + ")");
    assert(crowd.candidates.length === 3, "the reservation swaps the last slot, it does not grow the list (got " + crowd.candidates.length + ")");
    const reservedRow = crowd.candidates[zhRank - 1]!;
    assert(reservedRow.arms[0] === "cjk", "the reserved row carries its stage provenance (arms " + reservedRow.arms.join("+") + ")");
    assert(reservedRow.score > 0 && reservedRow.score < crowd.candidates[0]!.score, "the reserved row is priced below the BM25 anchor, never zero");
    const crowdNoCjk = await recommendDomains("research docs web", CROWD_METAS);
    assert(rankOf(crowdNoCjk, "zh-research") === 0, "a CJK-free query on the same corpus reserves nothing");

    // --- #173 review round: the three reproduced findings, pinned ---
    // Finding 2 (Major): at topK=2 the reservation used to swap the displayed runner-up, and
    // margin — read from the displayed pair — moved with it: two equal full-coverage FTS rows had
    // margin 0 (decision low), the reserved row at half their score raised margin to 0.5 and the
    // decision to high. Confidence now reads the pre-reservation pair, so the decision stays low
    // while the reserved row still shows in the last slot.
    const S1: DomainMeta[] = [
      { id: "full-one", name: "research", description: "中文研究 research one" },
      { id: "full-two", name: "research", description: "中文研究 research two" },
      { id: "substr", name: "zh", description: "深度中文研究与学术检索" },
    ];
    const s1 = await recommendDomains("research 中文研究", S1, { topK: 2 });
    assert(s1.decision === "low" && s1.confidence === 0, "topK=2: the reservation cannot raise margin/confidence (got " + s1.decision + ", conf " + s1.confidence + ")");
    assert(s1.recommendation === null, "topK=2: no suggestion for a query that was baseline-low (got " + (s1.recommendation?.id ?? "null") + ")");
    assert(rankOf(s1, "substr") === 2, "topK=2: the reserved row still occupies the last display slot (rank " + rankOf(s1, "substr") + ")");
    // Finding 1 (Major): 13 rows match 中文研究*, so the strict fetch bound (limit*4) leaves the
    // 13th unfetched; it used to enter the stage at fraction 1, win the reserved slot on the
    // rowid tiebreak, and keep the substring-only row absent. Rows the FTS query can reach are
    // stage-excluded now, so the reserved slot goes to a row FTS truly cannot reach.
    const S2: DomainMeta[] = [];
    const ordinal = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "甲", "乙", "丙"];
    for (let i = 0; i < 13; i++) S2.push({ id: "match" + i, name: "m" + i, description: "中文研究" + ordinal[i] });
    S2.push({ id: "substr", name: "zh", description: "深度中文研究与学术检索" });
    const s2 = await recommendDomains("中文研究", S2, { topK: 3 });
    assert(rankOf(s2, "substr") === 3, "the reserved slot goes to the substring-only row, not an unfetched FTS match (rank " + rankOf(s2, "substr") + ")");
    assert(s2.candidates.every((c) => c.id.startsWith("match") === (c.arms[0] === "fts")), "no FTS-reachable row carries the cjk stage label (arms " + s2.candidates.map((c) => c.arms.join("+")).join(",") + ")");
    // Finding 3 (Minor): topK=1 has no separate slot, so nothing is reserved and the single
    // candidate stays the BM25 anchor — the swap used to replace it and re-point the suggestion.
    const S3: DomainMeta[] = [
      { id: "r1", name: "research", description: "web research one" },
      { id: "zh", name: "zh", description: "深度中文研究与学术检索" },
    ];
    const s3 = await recommendDomains("research 中文研究", S3, { topK: 1 });
    assert(s3.candidates.length === 1 && s3.candidates[0]!.id === "r1", "topK=1 keeps the BM25 winner as the only candidate (got " + s3.candidates.map((c) => c.id).join(",") + ")");
    // Review-round extension: even when the embedding arm boosts the reserved row ABOVE the
    // anchor (deterministic stub: the query and the zh passage share one axis, the research rows
    // are anti-parallel — 0.6×0.5 + 0.4×1 = 0.7 beats 0.6×1 + 0.4×0 = 0.6), the reserved row must
    // not become the suggestion: it is clamped into the last display slot and confidence stays
    // anchored to the pre-reservation pair.
    __setEmbeddingModuleForTest({
      embedText: async (text: string) => {
        const v = new Float32Array(384);
        v[1] = text.includes("深度中文") || text === "research 中文研究" ? -1 : 1;
        return v;
      },
      embeddingTelemetry: () => ({ loads: 1, embeds: 1, failures: 0, circuitOpen: false }),
      EMBEDDING_MODEL_ID: "test-model",
    } as never);
    const boosted = await recommendDomains("research 中文研究", [
      { id: "b1", name: "research", description: "web research uno" },
      { id: "b2", name: "research", description: "web research dos" },
      { id: "b3", name: "research", description: "web research tres" },
      { id: "zh-research", name: "zh", description: "深度中文研究与学术检索" },
    ]);
    assert(boosted.candidates[0]!.id === "b1" && boosted.candidates[0]!.arms[0] === "fts", "an embedding-boosted reserved row never takes rank 0 (got " + boosted.candidates[0]!.id + ")");
    assert(rankOf(boosted, "zh-research") === 3, "the boosted reserved row is clamped into the last display slot (rank " + rankOf(boosted, "zh-research") + ")");
    assert(boosted.candidates[2]!.arms.join("+") === "cjk+embedding", "the reserved row keeps both provenance labels under fusion (arms " + boosted.candidates[2]?.arms.join("+") + ")");
    assert(boosted.decision === "low" && boosted.confidence === 0, "fusion-boosting the reserved row cannot move the anchored decision (got " + boosted.decision + ", conf " + boosted.confidence + ")");
    __setEmbeddingModuleForTest(null);

    // Han, Hiragana, Katakana and Hangul all reach the stage (the run class is CJK-wide, not
    // Han-only). These descriptions carry no spaces, so a mid-run substring can never be a
    // unicode61 token prefix: the "cjk" provenance label is what proves the stage answered.
    const JA_KO_METAS: DomainMeta[] = [
      { id: "ja", name: "nihongo", description: "日本語文献検索資料" },
      { id: "ja2", name: "gakujutsu", description: "日本語の学術資料" },
      { id: "ja3", name: "social", description: "ソーシャルニュース話題" },
      { id: "ko", name: "hangugeo", description: "한국어논문검색서비스" },
    ];
    for (const [q, expected] of [
      ["文献検索", "ja"], // Han, mid-run
      ["語文献", "ja"], // Han, mid-run
      ["の学術", "ja2"], // Hiragana inside the run
      ["ルニュース", "ja3"], // Katakana with the prolonged sound mark U+30FC inside the run
      ["논문검", "ko"], // Hangul, mid-run
      ["문검색", "ko"], // Hangul, mid-run
    ] as [string, string][]) {
      const r = await recommendDomains(q, JA_KO_METAS);
      expectRankOf(r, expected, 1, "mid-run CJK substring '" + q + "'");
      assert(r.candidates[0]!.arms[0] === "cjk", "'" + q + "' answered by the substring stage, not BM25 (arms " + r.candidates[0]!.arms.join("+") + ")");
    }
    // A query that is also a whole-token prefix stays on the BM25 arm — the stage is the fallback,
    // not a replacement, and the two are labelled differently for that reason.
    const onPrefix = await recommendDomains("ソーシャル", JA_KO_METAS);
    assert(onPrefix.candidates[0]?.id === "ja3" && onPrefix.candidates[0]!.arms[0] === "fts", "'ソーシャル' is a token prefix, so the BM25 arm answers it (arms " + onPrefix.candidates[0]?.arms.join("+") + ")");
    // The prolonged mark is word-internal: a query that drops it is not a substring of the marked
    // spelling, so it abstains instead of scoring a partial match. (With U+30FC outside the class,
    // this query split into ソ + シャル and both pieces matched — the agreement between coverage and
    // the stage for exactly this input is asserted below.)
    const noTie = await recommendDomains("ソシャル", JA_KO_METAS);
    assert(noTie.decision === "none", "prolonged mark is word-internal: 'ソシャル' must not match 'ソーシャル…' (got " + noTie.decision + ")");
    // Half-width katakana stays inside a run but is not folded to full-width, so this is a
    // documented boundary rather than a silent miss.
    assert((await recommendDomains("ﾌﾗﾝｽ", [{ id: "fr", name: "fr", description: "フランス文化情報" }])).decision === "none", "half-width katakana is not folded to full-width (documented boundary)");
    // A mark alone must not carry a match. Widening the class to keep the prolonged mark
    // word-internal also makes a bare U+30FC a run, and one candidate is enough for the margin rule
    // to print confidence 1 - a confident recommendation built out of punctuation. The marks sit
    // INSIDE the corpus below, so only the letter-bearing guard can be what abstains here.
    const MARK_METAS: DomainMeta[] = [
      { id: "srv", name: "srv", description: "サーバー運用資料〱ﾞ" },
      { id: "zh2", name: "zh2", description: "深度中文研究" },
    ];
    for (const q of ["ー", "〱", "ﾞ"]) {
      const r = await recommendDomains(q, MARK_METAS);
      assert(r.decision === "none", "mark-only query must not recommend (got " + r.decision + ", " + r.candidates.length + " candidates)");
    }
    // The same marks embedded in a real run still match: this is the guard rejecting a mark-only
    // run, not the corpus lacking the character.
    assert(cjkRunFraction("ー", "サーバー運用資料〱ﾞ") === 0, "a bare prolonged mark is dropped by the guard although the text contains it");
    assert(cjkRunFraction("ﾞ", "サーバー運用資料〱ﾞ") === 0, "a bare half-width voice mark is dropped by the guard although the text contains it");
    assert(cjkRunFraction("サーバ", "サーバー運用資料〱ﾞ") === 1, "the same mark inside a word stays one run");
    assert(cjkRunFraction("ソーシャル", "ソーシャルニュース") === 1, "a marked word matches its marked spelling");
    assert(cjkRunFraction("ソシャル", "ソーシャルニュース") === 0, "dropping the mark breaks contiguity instead of scoring half a match");
    // Recall and confidence must not disagree about a mark-only term: before it was dropped from
    // the denominator, coverage read 0.5 here while the stage read 1.
    const ZH_T = "zh 深度中文研究与学术检索 Deep academic research";
    assert(termCoverage("中文 ー", ZH_T) === 1, "a stray mark-only term is not counted as a miss");
    assert(cjkRunFraction("中文 ー", ZH_T) === 1, "the stage drops the same mark-only run");
    assert(termCoverage("ソシャル", "ソーシャルニュース") === cjkRunFraction("ソシャル", "ソーシャルニュース"),
      "a mark-less query scores 0 in both factors, not 1 in one and 0 in the other");
    // CodeRabbit on #134: a mixed-script term must not be credited coverage by its CJK half alone.
    // Before the gate, "中文billing" scored coverage 1 against a description that mentions 中文 and
    // says nothing about billing, and one candidate made that print a confident suggestion.
    assert(termCoverage("中文billing", "深度中文研究与学术检索") === 0, "mixed-script term is not covered by the CJK half alone");
    assert(termCoverage("中文billing", "深度中文研究与 billing 核对") === 1, "mixed-script term is covered when both halves match");
    const mixed = await recommendDomains("中文billing", CJK_METAS);
    assert(mixed.decision !== "high", "an unmatched Latin segment blocks a confident suggestion (got " + mixed.decision + ")");
    assert(mixed.recommendation === null, "no suggestion printed for a half-matched mixed-script query (got " + (mixed.recommendation?.id ?? "null") + ")");
    assert(mixed.candidates.length > 0, "the CJK half still earns candidate listing, priced by coverage 0");
    assert(mixed.candidates.every((c) => c.coverage === 0), "every mixed-script candidate reports coverage 0 (got " + mixed.candidates.map((c) => c.coverage).join(",") + ")");
    // CodeRabbit follow-up on #134: that Latin gate must not reject a mixed-script term that
    // occurs verbatim. Inside a description that glues scripts together (深度中文billing研究 is ONE
    // unicode61 token), the Latin half is never a token prefix, so the gated path alone rejected a
    // term that is literally present — a false negative the gate itself created.
    const GLUED = [{ id: "glued", name: "glued", description: "深度中文billing研究" }];
    assert(termCoverage("中文billing", "深度中文billing研究") === 1, "a verbatim mixed-script term is covered even when its Latin half is not a token prefix");
    assert(termCoverage("中文billing", "深度中文研究与学术检索") === 0, "a description without the Latin half still scores 0 — the first finding stays fixed");
    const gluedRun = await recommendDomains("中文billing", GLUED);
    assert(gluedRun.decision === "high" && gluedRun.recommendation?.id === "glued", "the verbatim case recommends (got " + gluedRun.decision + ", conf " + gluedRun.confidence + ")");
    const halfRun = await recommendDomains("中文billing", [{ id: "zhonly", name: "zh", description: "深度中文研究与学术检索" }]);
    assert(halfRun.recommendation === null, "the half-matched case prints no suggestion (got " + (halfRun.recommendation?.id ?? "null") + ")");
    // CodeRabbit round 3 on #134: matching a mixed-script term verbatim must not drop the Latin
    // word boundary — otherwise "art中文" is credited against "cart中文购物", where the user asked
    // about art and the text says cart. A Latin segment has to start at a script boundary.
    assert(termCoverage("art中文", "cart中文购物") === 0, "a Latin segment inside a longer Latin word is not a match");
    assert(termCoverage("art中文", "art中文购物") === 1, "the same segment at a real boundary is covered");
    // CodeRabbit round 4 on #134: the boundary split was written as a lookaround regex inside a
    // template literal, where `\s` collapses to the letter `s` — so the class excluded the letter s
    // instead of whitespace, and every Latin segment starting with s failed to split off. A test
    // with `billing` and `art` could never catch that; `search` can. Asserted as 1: the bot's
    // embedded suggestion said to assert 0, which contradicts its own finding text — 0 is the bug.
    assert(termCoverage("中文search", "深度中文search研究") === 1, "an s-initial Latin segment splits at a script boundary");
    const searchRun = await recommendDomains("中文search", [{ id: "zh", name: "zh", description: "深度中文search研究" }]);
    assert(searchRun.decision === "high" && searchRun.recommendation?.id === "zh", "the s-boundary case recommends (got " + searchRun.decision + ", " + (searchRun.recommendation?.id ?? "null") + ")");
    const edgeRun = await recommendDomains("art中文", [{ id: "cart", name: "cart", description: "cart中文购物" }]);
    assert(edgeRun.recommendation === null, "no suggestion from a mid-word Latin fragment (got " + (edgeRun.recommendation?.id ?? "null") + ")");

    // The stage is inert for a CJK-free query: nothing is added to the MATCH expression and no
    // row is scanned, so #110's pure-ASCII behaviour is preserved by construction.
    assert(cjkRunFraction("deep web research", "深度中文研究与学术检索") === 0, "CJK-free query has no substring stage");
    assert(cjkRunFraction("中文研究", "深度中文研究与学术检索") === 1, "every run present => fraction 1");
    assert(cjkRunFraction("研究中文", "深度中文研究与学术检索") === 0, "reordered run is not a contiguous substring");
    assert(cjkRunFraction("文献 检索", "深度中文研究与学术检索") === 0.5, "one of two runs => half the run characters");

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
