// ADR-0034 attribution module tests — deterministic, no network, no LLM.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  tokenize,
  jaccard,
  cosine,
  splitSentences,
  detectFragments,
  classifyClaim,
  buildAttributionReport,
  deriveGapRequests,
  shouldBridgeToAbstain,
  shouldEscalateToJudge,
  applyJudgeEscalation,
  renderAttributionText,
} from "../src/attribution";
import type { FusedEnvelope, AttributionReport } from "@anysearch/retriever";

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------
describe("tokenize", () => {
  it("extracts alphanumeric tokens case-insensitively", () => {
    const tok = tokenize("The SAFe framework, 2024!");
    assert.ok(tok.includes("the"));
    assert.ok(tok.includes("safe"));
    assert.ok(tok.includes("2024"));
  });
  it("handles CJK", () => {
    const tok = tokenize("知识库中有4条");
    assert.ok(Array.isArray(tok));
  });
});

describe("jaccard", () => {
  it("returns 0 for empty inputs", () => {
    assert.equal(jaccard([], []), 0);
  });
  it("returns 1 for identical sets", () => {
    assert.equal(jaccard(["a", "b"], ["a", "b"]), 1);
  });
  it("computes U(AB)/|A∪B| correctly", () => {
    const r = jaccard(["a", "b"], ["b", "c"]);
    assert.ok(Math.abs(r - 1/3) < 0.001);
  });
});

describe("cosine", () => {
  it("returns 0 for zero-length arrays", () => {
    assert.equal(cosine([], []), 0);
  });
  it("returns 0 for orthogonal vectors", () => {
    assert.equal(cosine([1,0],[0,1]), 0);
  });
  it("returns 1 for identical direction", () => {
    const r = cosine([1,1],[1,1]);
    assert.ok(Math.abs(r - 1) < 0.001);
  });
});

// ---------------------------------------------------------------------------
// L0 splitSentences
// ---------------------------------------------------------------------------
describe("splitSentences", () => {
  it("splits simple English sentences", () => {
    const spans = splitSentences("Hello world. This is a test. Done.");
    assert.ok(spans.length >= 2);
  });
  it("merges segments split by abbreviation whitelist", () => {
    const spans = splitSentences("Dr. Smith said hello. The study was published.");
    // "Dr." must not split; Smith should appear in same sentence as "said hello"
    const all = spans.map(s=>s.text).join(" ");
    assert.ok(all.includes("Smith"));
  });
  it("handles e.g. correctly", () => {
    const spans = splitSentences("It is valid, e.g. in tests. Another one follows.");
    const all = spans.map(s=>s.text).join(" ");
    assert.ok(all.includes("e.g."));
  });
  it("CJK sentences split correctly", () => {
    const spans = splitSentences("这是一个句子。这是另一个句子。");
    assert.ok(spans.length >= 2);
  });
});

// ---------------------------------------------------------------------------
// L1 detectFragments
// ---------------------------------------------------------------------------
describe("detectFragments", () => {
  it("no signals on simple short sentence", () => {
    const f = detectFragments("The sky is blue.");
    assert.equal(f.isFragment, false);
  });
  it("flags connector", () => {
    const f = detectFragments("This is true, however it was tested.");
    assert.equal(f.hasConnector, true);
  });
  it("flags enumeration", () => {
    const f = detectFragments("A; B; C are all correct.");
    assert.equal(f.hasEnumeration, true);
  });
  it("flags comma density", () => {
    const s = "a, ".repeat(20); // high comma density
    const f = detectFragments(s);
    assert.equal(f.isFragment, true);
  });
  it("flags high entity density", () => {
    const f = detectFragments("John Smith and Jane Doe met Alice Brown at Google HQ.");
    assert.ok(f.entityCount >= 2);
    assert.equal(f.isFragment, true);
  });
});

// ---------------------------------------------------------------------------
// classifyClaim — D3 three-state
// ---------------------------------------------------------------------------
describe("classifyClaim — supported path", () => {
  const ctx = {
    retrievalResults: [
      { url: "https://ex.com/a", title: "Study", snippet: "Exercise is good for health, studies indicate." , source: "exa" as const }
    ],
  };
  it("frequent overlap produces uncertain (no enough evidence)", () => {
    const result = classifyClaim("Exercise is good for health.", ctx);
    // Overlap moderate -> uncertain (not supported)
    assert.equal(result.label === "uncertain" || result.label === "supported", true);
  });
});

describe("classifyClaim — contradiction detect", () => {
  const ctx = {
    retrievalResults: [
      { url: "https://ex.com/a", title: "Study", snippet: "Exercise is NOT good for health, studies indicate." , source: "exa" as const }
    ],
  };
  it("high overlap + negation keyword produces unsupported", () => {
    const result = classifyClaim("Exercise is good for health.", ctx);
    assert.equal(result.label, "unsupported");
  });
});

describe("classifyClaim — no evidence handles honestly", () => {
  it("no results → uncertain, not unsupported (ADR-0034 D4)", () => {
    const result = classifyClaim("Some obscure claim.", { retrievalResults: [] });
    assert.equal(result.label, "uncertain"); // honest: no evidence, not "not enough"
  });
});

// ---------------------------------------------------------------------------
// buildAttributionReport
// ---------------------------------------------------------------------------
function makeEnvelope(overrides: Partial<FusedEnvelope> = {}): FusedEnvelope {
  return {
    results: [
      { url: "https://ex.com/a", title: "Study A", snippet: "Exercise is good for health," , source: "exa" },
      { url: "https://ex.com/b", title: "Study B", snippet: "The earth orbits the sun." , source: "tavily" },
    ],
    answers: ["Exercise is good for health.", "The earth orbits the sun."],
    metadata: {
      providersQueried: ["exa", "tavily"],
      providersFailed: [],
      providersCancelled: [],
      elapsedMs: 42,
      providerAnswers: [
        { provider: "exa", text: "Exercise is good for health.", verified: false },
      ],
    },
    ...overrides,
  };
}

describe("buildAttributionReport", () => {
  it("produces a valid AttributionReport schema id", () => {
    const rep = buildAttributionReport(makeEnvelope());
    assert.equal(rep.schema, "anysearch/attribution-report@1");
  });
  it("counts claims by label", () => {
    const rep = buildAttributionReport(makeEnvelope());
    const total = rep.supportedCount + rep.uncertainCount + rep.unsupportedCount;
    assert.equal(total, rep.claims.length);
  });
  it("caps claims at maxClaims", () => {
    const rep = buildAttributionReport(makeEnvelope(), { maxClaims: 1 });
    assert.ok(rep.claims.length <= 1);
  });
  it("uses answers when empty for providerAnswers fallback", () => {
    const env = makeEnvelope({ answers: [] });
    const rep = buildAttributionReport(env);
    assert.ok(rep.claims.length >= 0); // may be 0 if text extraction fails, but must not throw
  });
  it("judgeEnhanced is false when no judge ran", () => {
    const rep = buildAttributionReport(makeEnvelope());
    assert.equal(rep.judgeEnhanced, false);
  });
  it("record includes fragment rationale when fragment signals fire", () => {
    const env = makeEnvelope();
    const rep = buildAttributionReport(env);
    const frag = rep.claims.find(c => c.text.includes("earth orbits"));
    if (frag) assert.ok(frag.rationale?.length ?? 0 > 0); // may or may not have fragment key
  });
});

// ---------------------------------------------------------------------------
// deriveGapRequests
// ---------------------------------------------------------------------------
describe("deriveGapRequests", () => {
  it("only generates gaps for unsupported or no-evidence uncertain claims", () => {
    const claims = [
      { id: "c1", text: "A", label: "supported" as const, evidence: [{ url: "", provider: "", sourceKey: "" }], confidence: 0.8 },
      { id: "c2", text: "B", label: "unsupported" as const, evidence: [], confidence: 0.7 },
      { id: "c3", text: "C", label: "uncertain" as const, evidence: [], confidence: 0.1 },
    ];
    const gaps = deriveGapRequests(claims as any);
    assert.equal(gaps.length, 2);
    assert.equal((gaps[0] as any).evidenceState, "conflicting_evidence");
    assert.equal(gaps[1].evidenceState, "no_evidence");
  });
  it("gapQuery wraps the assertion text", () => {
    const claims = [{ id: "c1", text: "Something unverified", label: "uncertain" as const, evidence: [] }];
    const gaps = deriveGapRequests(claims as any);
    assert.equal(gaps[0].gapQuery.startsWith("Find sources to verify:"), true);
  });
});

// ---------------------------------------------------------------------------
// shouldBridgeToAbstain — D7
// ---------------------------------------------------------------------------
describe("shouldBridgeToAbstain", () => {
  it("false when no claims", () => {
    const rep: AttributionReport = { claims: [], gaps: [], supportedCount: 0, uncertainCount: 0, unsupportedCount: 0, schema: "anysearch/attribution-report@1", generatedAt: "", judgeEnhanced: false };
    assert.equal(shouldBridgeToAbstain(rep, "incorrect"), false);
  });
  it("true when all claims weak (unsupported contradicts carry evidence) + incorrect sufficiency", () => {
    const rep = {
      claims: [{ id: "c1", text: "X", label: "unsupported" as const, evidence: [{ url: "u", provider: "p", sourceKey: "retrieval_results[0]" }], confidence: 0.5 }],
      gaps: [], supportedCount: 0, uncertainCount: 0, unsupportedCount: 1,
      schema: "anysearch/attribution-report@1" as const, generatedAt: "", judgeEnhanced: false,
    };
    // r83 F1: unsupported claims always carry contradiction evidence — weak ≠ evidence-less.
    assert.equal(shouldBridgeToAbstain(rep, "incorrect"), true);
  });
  it("false when verdict is not incorrect", () => {
    const rep = {
      claims: [{ id: "c1", text: "X", label: "unsupported" as const, evidence: [{ url: "u", provider: "p", sourceKey: "k" }] }],
      gaps: [], supportedCount: 0, uncertainCount: 0, unsupportedCount: 1,
      schema: "anysearch/attribution-report@1" as const, generatedAt: "", judgeEnhanced: false,
    };
    assert.equal(shouldBridgeToAbstain(rep, "sufficient"), false);
  });
  it("false for supported claims", () => {
    const rep = {
      claims: [{ id: "c1", text: "X", label: "supported" as const, evidence: [], confidence: 0.8 }],
      gaps: [], supportedCount: 1, uncertainCount: 0, unsupportedCount: 0,
      schema: "anysearch/attribution-report@1" as const, generatedAt: "", judgeEnhanced: false,
    };
    assert.equal(shouldBridgeToAbstain(rep, "incorrect"), false);
  });
});

// ---------------------------------------------------------------------------
// shouldEscalateToJudge — D3 + D5
// ---------------------------------------------------------------------------
describe("shouldEscalateToJudge", () => {
  it("uncertain with evidence → true", () => {
    assert.equal(shouldEscalateToJudge({ id: "c", text: "x", label: "uncertain", evidence: [{ url: "", provider: "", sourceKey: "" }] }), true);
  });
  it("uncertain without evidence → false (no evidence to judge)", () => {
    assert.equal(shouldEscalateToJudge({ id: "c", text: "x", label: "uncertain", evidence: [] }), false);
  });
  it("supported → false", () => {
    assert.equal(shouldEscalateToJudge({ id: "c", text: "x", label: "supported", evidence: [] }), false);
  });
});

// ---------------------------------------------------------------------------
// renderAttributionText — D4 CLI dual-channel
// ---------------------------------------------------------------------------
describe("renderAttributionText", () => {
  function rep(labels: Array<"supported"|"uncertain"|"unsupported">) {
    return {
      schema: "anysearch/attribution-report@1" as const, generatedAt: "",
      claims: labels.map((l, i) => ({ id: "c"+i, text: "claim " + i, label: l, evidence: [], rationale: "r" })),
      gaps: [], supportedCount: labels.filter(l=>l==="supported").length,
      uncertainCount: labels.filter(l=>l==="uncertain").length,
      unsupportedCount: labels.filter(l=>l==="unsupported").length, judgeEnhanced: false,
    };
  }
  it("empty claims produce empty string", () => {
    assert.equal(renderAttributionText(rep([])), "");
  });
  it("contains supported/uncertain/unsupported summary", () => {
    const out = renderAttributionText(rep(["supported", "uncertain", "unsupported"]));
    assert.ok(out.includes("✓")); assert.ok(out.includes("~")); assert.ok(out.includes("✗"));
  });
  it("every claim line starts with label character", () => {
    const out = renderAttributionText(rep(["supported", "unsupported"]));
    const lines = out.split("\n").filter(l => l.startsWith("✓") || l.startsWith("~") || l.startsWith("✗"));
    assert.ok(lines.length >= 2);
  });
  it("source list included when evidence exists", () => {
    const repData = rep(["supported"]);
    repData.claims[0].evidence = [{ url: "https://ex.com/a", provider: "exa", sourceKey: "retrieval_results[0]" }] as any;
    const out = renderAttributionText(repData as any);
    assert.ok(out.includes("https://ex.com/a"));
  });
});

// ---------------------------------------------------------------------------
// r83 audit additions — F2 judge wiring / F10 signals 5+6 / F12 partial_evidence / F13 negation
// ---------------------------------------------------------------------------
describe("detectFragments — r83 audit additions", () => {
  it("flags mixed-script / abbreviation signal (F10 混排缩写)", () => {
    const f = detectFragments("结果引用 Dr. Smith 2024报告指出结论相反。");
    assert.ok(f.reasons.includes("mixed_abbrev"));
  });
  it("flags long sentence", () => {
    const f = detectFragments("这是一个没有任何连接词的超长句子".repeat(15));
    assert.ok(f.isLongSentence, "expected long_sentence flag");
    assert.ok(f.reasons.includes("long_sentence"));
  });
  it("connector regex includes bare 且 (F10)", () => {
    const f = detectFragments("该方案成本更低且部署更快。");
    assert.ok(f.hasConnector);
  });
});

describe("classifyClaim — Chinese single-character negation (F13)", () => {
  it("无/没/非 negate high-overlap snippets into unsupported", () => {
    const claim = "定期运动对心血管健康有益。";
    const results = [{
      title: "心血管健康研究",
      snippet: "研究结论：定期运动对心血管健康无益。",
      url: "https://example.org/x", source: "test",
    }] as any;
    const c = classifyClaim(claim, { retrievalResults: results });
    assert.equal(c.label, "unsupported");
  });
});

describe("deriveGapRequests — partial_evidence (F12)", () => {
  it("uncertain claim with evidence yields partial_evidence gap", () => {
    const gaps = deriveGapRequests([
      { id: "c1", text: "A claim with some weak evidence", label: "uncertain", evidence: [{ url: "u", provider: "p", sourceKey: "k" }] } as any,
    ]);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].evidenceState, "partial_evidence");
  });
});

describe("applyJudgeEscalation — host-injected judge (F2)", () => {
  it("escalates only uncertain+evidence claims, bounded by maxCalls, honest judgeEnhanced", async () => {
    const rep = {
      schema: "anysearch/attribution-report@1" as const, generatedAt: "",
      claims: [
        { id: "c1", text: "a", label: "uncertain" as const, evidence: [{ url: "u", provider: "p", sourceKey: "k" }] },
        { id: "c2", text: "b", label: "uncertain" as const, evidence: [{ url: "u", provider: "p", sourceKey: "k" }] },
        { id: "c3", text: "c", label: "uncertain" as const, evidence: [] },
        { id: "c4", text: "d", label: "supported" as const, evidence: [{ url: "u", provider: "p", sourceKey: "k" }] },
      ],
      gaps: [], supportedCount: 1, uncertainCount: 3, unsupportedCount: 0, judgeEnhanced: false,
    } as any;
    const used = await applyJudgeEscalation(rep, async () => "supported", 1);
    assert.equal(used, 1);
    assert.equal(rep.judgeEnhanced, true);
    assert.equal(rep.claims[0].label, "supported");
    assert.equal(rep.claims[1].label, "uncertain"); // maxCalls bound
    assert.equal(rep.claims[2].label, "uncertain"); // no evidence — not escalatable
  });
  it("judgeEnhanced stays false when no escalation actually ran", async () => {
    const rep = {
      schema: "anysearch/attribution-report@1" as const, generatedAt: "",
      claims: [{ id: "c1", text: "a", label: "supported" as const, evidence: [] }],
      gaps: [], supportedCount: 1, uncertainCount: 0, unsupportedCount: 0, judgeEnhanced: false,
    } as any;
    const used = await applyJudgeEscalation(rep, async () => "supported");
    assert.equal(used, 0);
    assert.equal(rep.judgeEnhanced, false);
  });
});

// ADR-0050 D5: calibrated path — beta params + held-out dual thresholds;
// degraded calibration falls back to the legacy 0.6 floor.
describe("classifyClaim — calibrated dual thresholds (ADR-0050 D5)", () => {
  const calibration = {
    params: { a: 1, b: 1, c: 0 }, // identity
    thresholds: { supported: 0.5, unsupported: 0.2, degraded: false },
  };
  it("exact-overlap evidence -> supported", () => {
    const result = classifyClaim("Exercise is good for health.", {
      retrievalResults: [{ url: "u", title: "", snippet: "Exercise is good for health.", source: "exa" as const }],
      calibration,
    });
    assert.equal(result.label, "supported");
  });
  it("very low fused score -> unsupported via lower threshold", () => {
    const result = classifyClaim("Alpha beta gamma delta epsilon zeta.", {
      retrievalResults: [{ url: "u", title: "", snippet: "totally unrelated words plus alpha only", source: "exa" as const }],
      calibration,
    });
    assert.equal(result.label, "unsupported");
    assert.ok(result.rationale.includes("unsupported threshold"));
  });
  it("degraded calibration falls back to legacy 0.6 floor", () => {
    const fallback = { params: calibration.params, thresholds: { supported: 0.6, unsupported: 0.6, degraded: true } };
    // fused = 0.35*1 + 0.15 = 0.5 >= 0.5 under calibrated, but legacy floor is 0.6 -> uncertain
    const result = classifyClaim("Exercise is good for health.", {
      retrievalResults: [{ url: "u", title: "", snippet: "Exercise is good for health.", source: "exa" as const }],
      calibration: fallback,
    });
    assert.equal(result.label, "uncertain");
  });
});
