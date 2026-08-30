// ADR-0027 D3/D5: golden dataset — deterministic lifecycle cases (was 20 in 6 groups).
// ADR-0028 D2/D3/D4: rank-of-relevant assertions, seed-op secret negative slices, difficulty tiers.
// Cases are typed TS data (compiler-forced sync with store API); JSON fixtures rejected (ADR-0027 D11).
// Runner materializes each case on a fresh temp SQLite DB: adjudicate stubs -> store -> retrieve.
import type { AdjudicationAction, KeyMemoryInput } from "../session-store";

export type EvalGroup =
  | "supersession"
  | "temporal"
  | "secret"
  | "cprime"
  | "quarantine"
  | "stale_topk"
  | "secret_bypass"
  | "unanswerable"
  | "paraphrase"
  | "entity"
  | "semantic"
  | "relations"
  | "consolidate"
  | "forget";

export type EvalStage = "extract" | "adjudicate" | "store" | "retrieve";

export type CaseOp =
  | { op: "adjudicate"; stage: "adjudicate"; items: KeyMemoryInput[
]; expect: AdjudicationAction[]; newSession?: boolean /* ADR-0031 step1: cross-session entity aggregation */ }
  | { op: "search"; stage: "retrieve"; query: string; limit?: number; expectIncludesTitle?: string; expectExcludesTitle?: string; expectMaxCount?: number; expectRankOf?: { title: string; maxRank: number }; expectEmpty?: true; expectAllWeak?: true /* ADR-0033 D8: unanswerable slice asserts weak-only evidence, not zero retrieval */; expectHopTitle?: string; relevanceGrades?: Record<string, 0 | 1 | 2 | 3> /* ADR-0038 D7: graded labels drive report-only nDCG@5/10/20; sem cases double as judge-calibration label rows */ }
  | { op: "seed"; stage: "store"; items: KeyMemoryInput[]; agedDays?: number } /* ADR-0028 D3: direct DB insert, bypasses the write guard on purpose; ADR-0037 D5: agedDays backdates created_at/last_accessed for archive-candidate cases */
  | { op: "rawValidUntil"; stage: "store"; fromOp: number; expectSet: boolean }
  | { op: "promote"; stage: "store"; key: string; value: string; scope?: string; source: "explicit" | "correction"; expectAction: "promoted" | "rejected" }
  | { op: "correct"; stage: "adjudicate"; key: string; scope: string; times: number; expectCount: number }
  | { op: "listPrefs"; stage: "retrieve"; scope?: string; expectKeyValue?: { key: string; value: string }; expectKeyAbsent?: string }
  | { op: "listQuarantined"; stage: "retrieve"; expectCount: number }
  | { op: "entities"; stage: "store"; expectNames?: string[]; expectCount?: number } /* ADR-0031 step1 */
  | { op: "resolveQuarantined"; stage: "adjudicate"; fromOp: number; item: number; action: "keep" | "drop"; expectOk: boolean }
  // ADR-0035 D5: edge assertions — edge/supersede fail-closed, no_edge observational (paired strong negative).
  | { op: "edge"; stage: "store"; subject: string; relation: string; object: string; assert: "edge" | "no_edge" | "supersede"; fromOp?: number }
  // ADR-0037 D4/D6: consolidation run against golden stubs (D7-2: ops decisions never touch a live LLM).
  | { op: "consolidate"; stage: "store"; expectAdd?: number; expectNoop?: number; expectRejected?: number; expectLlmUnavailable?: number }
  // ADR-0037 D5/D6: archive apply + exact dry-run prediction (D7-6) + reversible undo (D7-4) go golden.
  | { op: "archive"; stage: "store"; expectArchived: number }
  | { op: "undoArchive"; stage: "store"; fromOp: number; expectOk: boolean };

export interface CaseSpec {
  id: string;
  group: EvalGroup;
  // ADR-0028 D4: report-only tier; omitted defaults to "core" in the runner report.
  difficulty?: "core" | "hard" | "adversarial";
  description: string;
  ops: CaseOp[];
  // ADR-0037 D4: inject the bounded summarize + fidelity-gate stubs for consolidate cases
  // (ops decisions stay deterministic / LLM-free; D7-1 negative via classify "unsupported").
  consolidateStub?: { summary: string; classify: "supported" | "uncertain" | "unsupported" };
}

const km = (url: string, title: string, snippet: string, evidence: number, entity?: string, source = "exa"): KeyMemoryInput =>
  entity ? { url, title, snippet, source, evidence, entity } : { url, title, snippet, source, evidence };

export const GOLDEN_CASES: CaseSpec[] = [
  // --- Group 1: supersession (preference-contradiction, 4) ---
  {
    id: "ss_pref_change", group: "supersession",
    description: "preference theme flips darkmode -> lightmode; stale preference invisible",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/theme1", "prefer darkmode theme", "user prefers darkmode ui theme", 0.9, "ui-theme")], expect: ["accept"] },
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/theme2", "prefer lightmode theme", "user prefers lightmode ui theme", 0.9, "ui-theme")], expect: ["supersede"] },
      { op: "search", stage: "retrieve", query: "prefer darkmode theme", expectExcludesTitle: "prefer darkmode theme" },
      { op: "search", stage: "retrieve", query: "prefer lightmode theme", expectIncludesTitle: "prefer lightmode theme" },
    ],
  },
  {
    id: "ss_api_docs_version", group: "supersession",
    description: "apidocs v1 -> v2 same entity; v1 closed",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/apiv1", "apidocs v1 reference", "apidocs v1 is the current reference", 0.9, "apidocs")], expect: ["accept"] },
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/apiv2", "apidocs v2 reference", "apidocs v2 is the current reference", 0.95, "apidocs")], expect: ["supersede"] },
      { op: "search", stage: "retrieve", query: "apidocs v1 reference", expectExcludesTitle: "apidocs v1 reference" },
      { op: "search", stage: "retrieve", query: "apidocs v2 reference", expectIncludesTitle: "apidocs v2 reference" },
    ],
  },
  {
    id: "ss_three_hop_chain", group: "supersession",
    description: "three successive deploytarget facts; only newest retrievable",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/dt1", "deploytarget ususeast", "deploytarget is ususeast", 0.9, "deploytarget")], expect: ["accept"] },
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/dt2", "deploytarget euwest", "deploytarget is euwest", 0.9, "deploytarget")], expect: ["supersede"] },
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/dt3", "deploytarget apsouth", "deploytarget is apsouth", 0.9, "deploytarget")], expect: ["supersede"] },
      { op: "search", stage: "retrieve", query: "deploytarget", expectMaxCount: 1, expectIncludesTitle: "deploytarget apsouth" },
    ],
  },
  {
    id: "ss_user_then_provider", group: "supersession",
    description: "user-trust write then high-evidence provider write supersedes it",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/zone0", "buildzone locally built", "buildzone is locally built", 0, "buildzone", "user")], expect: ["accept"] },
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/zone1", "buildzone ci built", "buildzone is ci built", 0.95, "buildzone")], expect: ["supersede"] },
      { op: "search", stage: "retrieve", query: "buildzone locally built", expectExcludesTitle: "buildzone locally built" },
      { op: "search", stage: "retrieve", query: "buildzone ci built", expectIncludesTitle: "buildzone ci built" },
    ],
  },
  // --- Group 2: temporal expiry (valid_until bi-temporal closing, 2) ---
  // NOTE: this group covers bi-temporal close-out only, NOT decay scoring — decay (G019) is P2
  // and currently has NO gate coverage (round63 atomcode audit finding 6).
  {
    id: "te_valid_until_set", group: "temporal",
    description: "supersede closes old record via valid_until (bi-temporal)",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/reg1", "pkgname registry alpha", "pkgname default registry is alpha", 0.9, "pkgname-registry")], expect: ["accept"] },
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/reg2", "pkgname registry beta", "pkgname default registry is beta", 0.9, "pkgname-registry")], expect: ["supersede"] },
      { op: "rawValidUntil", stage: "store", fromOp: 1, expectSet: true },
    ],
  },
  {
    id: "te_sibling_untouched", group: "temporal",
    description: "superseding entity A never disturbs sibling entity B",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/py1", "pylts three point twelve", "pylts is three point twelve", 0.9, "pylts")], expect: ["accept"] },
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/node1", "nodemaj twentytwo", "nodemaj is twentytwo", 0.9, "nodemaj")], expect: ["accept"] },
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/node2", "nodemaj twentyfour", "nodemaj is twentyfour", 0.95, "nodemaj")], expect: ["supersede"] },
      { op: "search", stage: "retrieve", query: "pylts", expectIncludesTitle: "pylts three point twelve" },
      { op: "search", stage: "retrieve", query: "nodemaj", expectMaxCount: 1, expectIncludesTitle: "nodemaj twentyfour" },
    ],
  },
  // --- Group 3: secret rejection (3) ---
  {
    id: "sc_token_literal", group: "secret",
    description: "sk- prefixed token in snippet is rejected, never stored, never searchable, never quarantined",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/leak1", "leakcfg shared creds", "leakcfg file contains sk-testDEADBEEFcafebabe1234abcd1234 verbatim", 0.95, "leakcfg")], expect: ["reject"] },
      { op: "search", stage: "retrieve", query: "leakcfg", expectMaxCount: 0 },
      { op: "listQuarantined", stage: "retrieve", expectCount: 0 },
    ],
  },
  {
    id: "sc_aws_access_key", group: "secret",
    description: "AKIA access-key id pattern rejected even at evidence 1.0",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/leak2", "cloudcfg posted keyid", "cloudcfg keyid AKIAIOSFODNN7EXAMPLE posted publicly", 1.0, "cloudcfg")], expect: ["reject"] },
      { op: "search", stage: "retrieve", query: "cloudcfg", expectMaxCount: 0 },
    ],
  },
  {
    id: "sc_pem_header", group: "secret",
    description: "PEM private-key header rejected from user source too",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/leak3", "certdump pasted material", "certdump pasted material -----BEGIN RSA PRIVATE KEY----- inline", 0, "certdump", "user")], expect: ["reject"] },
      { op: "search", stage: "retrieve", query: "certdump", expectMaxCount: 0 },
    ],
  },
  // --- Group 4: C-prime evidence accumulation (4) ---
  {
    id: "cp_correction_count_two", group: "cprime",
    description: "two cross-session corrections accumulate to count 2",
    ops: [
      { op: "correct", stage: "adjudicate", key: "tone", scope: "global", times: 1, expectCount: 1 },
      { op: "correct", stage: "adjudicate", key: "tone", scope: "global", times: 1, expectCount: 2 },
    ],
  },
  {
    id: "cp_correction_promote", group: "cprime",
    description: "correction channel promote after count>=2 lands in preference list",
    ops: [
      { op: "correct", stage: "adjudicate", key: "brevity", scope: "global", times: 2, expectCount: 2 },
      { op: "promote", stage: "store", key: "brevity", value: "terse", source: "correction", expectAction: "promoted" },
      { op: "listPrefs", stage: "retrieve", expectKeyValue: { key: "brevity", value: "terse" } },
    ],
  },
  {
    id: "cp_explicit_remember", group: "cprime",
    description: "explicit /remember promote round-trips through listPreferences",
    ops: [
      { op: "promote", stage: "store", key: "editordef", value: "zeded", source: "explicit", expectAction: "promoted" },
      { op: "listPrefs", stage: "retrieve", expectKeyValue: { key: "editordef", value: "zeded" } },
    ],
  },
  {
    id: "cp_conflict_inplace", group: "cprime",
    description: "same-key promote twice = in-place supersede, newest value wins",
    ops: [
      { op: "promote", stage: "store", key: "outfmt", value: "karkdown", source: "explicit", expectAction: "promoted" },
      { op: "promote", stage: "store", key: "outfmt", value: "jason", source: "explicit", expectAction: "promoted" },
      { op: "listPrefs", stage: "retrieve", expectKeyValue: { key: "outfmt", value: "jason" } },
    ],
  },
  // --- Group 5: quarantine boundary (4) ---
  {
    id: "qz_evidence_059", group: "quarantine",
    description: "evidence 0.59 just under threshold -> quarantine + hidden from search",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/qa1", "uncclaim alphaclaim wording", "uncclaim alphaclaim wording uncertain", 0.59, "uncclaim-alpha")], expect: ["quarantine"] },
      { op: "search", stage: "retrieve", query: "uncclaim alphaclaim", expectMaxCount: 0 },
      { op: "listQuarantined", stage: "retrieve", expectCount: 1 },
    ],
  },
  {
    id: "qz_evidence_060", group: "quarantine",
    description: "evidence 0.60 exactly at threshold -> accept + searchable",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/qa2", "edgeclaim accepted fact", "edgeclaim accepted fact wording", 0.6, "edgeclaim")], expect: ["accept"] },
      { op: "search", stage: "retrieve", query: "edgeclaim", expectIncludesTitle: "edgeclaim accepted fact" },
      { op: "listQuarantined", stage: "retrieve", expectCount: 0 },
    ],
  },
  {
    id: "qz_user_bypass", group: "quarantine",
    description: "source=user bypasses evidence gate (MemTX authority channel)",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/qa3", "userstated locale pref", "userstated locale pref direct", 0, "userstated", "user")], expect: ["accept"] },
      { op: "search", stage: "retrieve", query: "userstated", expectIncludesTitle: "userstated locale pref" },
    ],
  },
  {
    id: "qz_review_keep_drop", group: "quarantine",
    description: "review channel keeps one, drops the other; list drains",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [
        km("https://ex.com/qb1", "qkclaim one variant", "qkclaim one variant uncertain", 0.4, "qkclaim-one"),
        km("https://ex.com/qb2", "qkclaim two variant", "qkclaim two variant uncertain", 0.3, "qkclaim-two"),
      ], expect: ["quarantine", "quarantine"] },
      { op: "listQuarantined", stage: "retrieve", expectCount: 2 },
      { op: "resolveQuarantined", stage: "adjudicate", fromOp: 0, item: 0, action: "keep", expectOk: true },
      { op: "resolveQuarantined", stage: "adjudicate", fromOp: 0, item: 1, action: "drop", expectOk: true },
      { op: "listQuarantined", stage: "retrieve", expectCount: 0 },
      { op: "search", stage: "retrieve", query: "qkclaim one", expectIncludesTitle: "qkclaim one variant" },
    ],
  },
  // --- Group 6: topk stale truncation (3) ---
  {
    id: "tk_top1_after_supersede", group: "stale_topk",
    description: "3 seeds + 1 supersede; top-1 never returns the stale row",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [
        km("https://ex.com/pf1", "profmark first entry", "profmark first entry wording", 0.9, "profmark-1"),
        km("https://ex.com/pf2", "profmark second entry", "profmark second entry wording", 0.9, "profmark-2"),
        km("https://ex.com/pf3", "profmark third entry", "profmark third entry wording", 0.9, "profmark-3"),
      ], expect: ["accept", "accept", "accept"] },
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/pf2b", "profmark second revised", "profmark second revised wording", 0.9, "profmark-2")], expect: ["supersede"] },
      { op: "search", stage: "retrieve", query: "profmark", limit: 1, expectExcludesTitle: "profmark second entry" },
    ],
  },
  {
    id: "tk_chain_topk_one", group: "stale_topk",
    description: "4-version same-entity chain; top-5 collapses to single live row",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/rc1", "relcycle version one", "relcycle is version one", 0.9, "relcycle")], expect: ["accept"] },
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/rc2", "relcycle version two", "relcycle is version two", 0.9, "relcycle")], expect: ["supersede"] },
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/rc3", "relcycle version three", "relcycle is version three", 0.9, "relcycle")], expect: ["supersede"] },
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/rc4", "relcycle version four", "relcycle is version four", 0.9, "relcycle")], expect: ["supersede"] },
      { op: "search", stage: "retrieve", query: "relcycle", limit: 5, expectMaxCount: 1, expectRankOf: { title: "relcycle version four", maxRank: 1 } }, /* ADR-0028 D2 */
    ],
  },
  {
    id: "tk_quarantined_not_in_topk", group: "stale_topk",
    description: "low-evidence row never occupies a topk slot among live rows",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [
        km("https://ex.com/tw1", "timewindow one live", "timewindow one live wording", 0.9, "timewindow-1"),
        km("https://ex.com/tw2", "timewindow two uncertain", "timewindow two uncertain wording", 0.4, "timewindow-2"),
        km("https://ex.com/tw3", "timewindow three live", "timewindow three live wording", 0.9, "timewindow-3"),
      ], expect: ["accept", "quarantine", "accept"] },
      { op: "search", stage: "retrieve", query: "timewindow", limit: 5, expectMaxCount: 2, expectExcludesTitle: "timewindow two uncertain", expectRankOf: { title: "timewindow one live", maxRank: 2 } }, /* ADR-0028 D2 */
    ],
  },

  // --- ADR-0028 D3: seed-bypassed secret slices (8, adversarial) ---
  // seed op writes straight into retrieval_results, bypassing the write guard; the
  // read-side exit filter (containsSecret on searchMemory) must hide every variant.
  {
    id: "sb_seed_literal_sk", group: "secret_bypass", difficulty: "adversarial",
    description: "seeded literal sk- token hidden at read side",
    ops: [
      { op: "seed", stage: "store", items: [km("https://ex.com/sb1", "stealthxa seed row", 'stealthxa holds sk-testDEADBEEFcafebabe1234abcd1234 verbatim', 0.9, "stealthx-a")] },
      { op: "search", stage: "retrieve", query: "stealthxa", expectEmpty: true },
    ],
  },
  {
    id: "sb_seed_case_mixed_akia", group: "secret_bypass", difficulty: "adversarial",
    description: "seeded lowercase akia variant hidden",
    ops: [
      { op: "seed", stage: "store", items: [km("https://ex.com/sb2", "stealthxb seed row", 'stealthxb key id akiaiosfodnn7example lowercase', 0.9, "stealthx-b")] },
      { op: "search", stage: "retrieve", query: "stealthxb", expectEmpty: true },
    ],
  },
  {
    id: "sb_seed_pem_lowercase", group: "secret_bypass", difficulty: "adversarial",
    description: "seeded lowercase PEM header hidden",
    ops: [
      { op: "seed", stage: "store", items: [km("https://ex.com/sb3", "stealthxc seed row", 'stealthxc embeds -----begin rsa private key----- lowercase', 0.9, "stealthx-c")] },
      { op: "search", stage: "retrieve", query: "stealthxc", expectEmpty: true },
    ],
  },
  {
    id: "sb_seed_base64_sk", group: "secret_bypass", difficulty: "adversarial",
    description: "seeded base64-wrapped sk token decoded then hidden",
    ops: [
      { op: "seed", stage: "store", items: [km("https://ex.com/sb4", "stealthxd seed row", 'stealthxd blob c2stdGVzdERFQURCRUVGY2FmZWJhYmUxMjM0YWJjZDEyMzQ= inline', 0.9, "stealthx-d")] },
      { op: "search", stage: "retrieve", query: "stealthxd", expectEmpty: true },
    ],
  },
  {
    id: "sb_seed_base64_akia", group: "secret_bypass", difficulty: "adversarial",
    description: "seeded base64-wrapped AKIA id hidden",
    ops: [
      { op: "seed", stage: "store", items: [km("https://ex.com/sb5", "stealthxe seed row", 'stealthxe blob QUtJQUlPU0ZPRE5ON0VYQU1QTEU= inline', 0.9, "stealthx-e")] },
      { op: "search", stage: "retrieve", query: "stealthxe", expectEmpty: true },
    ],
  },
  {
    id: "sb_seed_json_escaped", group: "secret_bypass", difficulty: "adversarial",
    description: "seeded JSON-escaped sk string hidden after unescape pass",
    ops: [
      { op: "seed", stage: "store", items: [km("https://ex.com/sb6", "stealthxf seed row", 'stealthxf json {\"k\": \"sk-testDEADBEEFcafebabe1234abcd1234\"} tail', 0.9, "stealthx-f")] },
      { op: "search", stage: "retrieve", query: "stealthxf", expectEmpty: true },
    ],
  },
  {
    id: "sb_seed_whitespace_split", group: "secret_bypass", difficulty: "adversarial",
    description: "seeded whitespace-split sk token hidden after squash pass",
    ops: [
      { op: "seed", stage: "store", items: [km("https://ex.com/sb7", "stealthxg seed row", 'stealthxg split sk-testDEADBEEF cafebabe1234 abcd1234 pieces', 0.9, "stealthx-g")] },
      { op: "search", stage: "retrieve", query: "stealthxg", expectEmpty: true },
    ],
  },
  {
    id: "sb_seed_fullwidth_akia", group: "secret_bypass", difficulty: "adversarial",
    description: "seeded fullwidth AKIA NFKC-folded then hidden",
    ops: [
      { op: "seed", stage: "store", items: [km("https://ex.com/sb8", "stealthxh seed row", 'stealthxh fullwidth ＡＫＩＡＩＯＳＦＯＤＮＮ７ＥＸＡＭＰＬＥ mixed', 0.9, "stealthx-h")] },
      { op: "search", stage: "retrieve", query: "stealthxh", expectEmpty: true },
    ],
  },
  // --- ADR-0028 D4 / ADR-0033 D8: unanswerable slice (4, adversarial) — near-answer distractor stored;
  // retrieval-layer zero-hit assertion migrated to evidence semantics: expectAllWeak asserts the
  // vector arm may recall near-answer distractors ONLY as weak (non-FTS-armed) evidence.
  {
    id: "un_cacheflush_schedule", group: "unanswerable", difficulty: "adversarial",
    description: "distractor about cacheflush interval; schedule question must refuse",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/un1", "cacheflush interval config", "cacheflush interval is ten minutes default", 0.9, "cacheflush-cfg")], expect: ["accept"] },
      { op: "search", stage: "retrieve", query: "cacheflush release timetable", expectAllWeak: true },
    ],
  },
  {
    id: "un_deployregion_pricing", group: "unanswerable", difficulty: "adversarial",
    description: "distractor about deployregion capacity; pricing question must refuse",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/un2", "deployregion capacity notes", "deployregion default useast capacity eighty nodes", 0.9, "deployregion-cap")], expect: ["accept"] },
      { op: "search", stage: "retrieve", query: "deployregion pricing cost", expectAllWeak: true },
    ],
  },
  {
    id: "un_toggleflag_rollback", group: "unanswerable", difficulty: "adversarial",
    description: "distractor about toggleflag enable; disable-doc question must refuse",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/un3", "toggleflag enable guide", "toggleflag enables dark sidebar layout", 0.9, "toggleflag-en")], expect: ["accept"] },
      { op: "search", stage: "retrieve", query: "toggleflag disable revert", expectAllWeak: true },
    ],
  },
  {
    id: "un_metricspipe_dashboard", group: "unanswerable", difficulty: "adversarial",
    description: "distractor about metricspipe counters; dashboard credentials must refuse",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/un4", "metricspipe emit config", "metricspipe emits counters once per minute", 0.9, "metricspipe-cfg")], expect: ["accept"] },
      { op: "search", stage: "retrieve", query: "metricspipe dashboard credentials", expectAllWeak: true },
    ],
  },
  // --- ADR-0028 D4: paraphrase positive variants (3, hard) — answerable queries must still hit.
  {
    id: "pv_pref_change", group: "paraphrase", difficulty: "hard",
    description: "paraphrase of ss_pref_change: lightmode query still returns live preference",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/pt1", "prefer darkmode skin", "user prefers darkmode skin theme", 0.9, "ui-skin")], expect: ["accept"] },
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/pt2", "prefer lightmode skin", "user prefers lightmode skin theme", 0.9, "ui-skin")], expect: ["supersede"] },
      { op: "search", stage: "retrieve", query: "lightmode skin", expectIncludesTitle: "prefer lightmode skin" },
    ],
  },
  {
    id: "pv_api_docs_version", group: "paraphrase", difficulty: "hard",
    description: "paraphrase of ss_api_docs_version: rephrased query returns new revision doc",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/pa1", "refdocs old revision", "refdocs old revision is deprecated", 0.9, "refdocs")], expect: ["accept"] },
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/pa2", "refdocs new revision", "refdocs new revision is canonical", 0.95, "refdocs")], expect: ["supersede"] },
      { op: "search", stage: "retrieve", query: "refdocs new revision", expectIncludesTitle: "refdocs new revision" },
    ],
  },
  {
    id: "pv_user_then_provider", group: "paraphrase", difficulty: "hard",
    description: "paraphrase of ss_user_then_provider: short query still returns pipeline-built zone",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/pu1", "packzone manual built", "packzone is manually built", 0, "packzone", "user")], expect: ["accept"] },
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/pu2", "packzone pipeline built", "packzone is pipeline built", 0.95, "packzone")], expect: ["supersede"] },
      { op: "search", stage: "retrieve", query: "packzone pipeline", expectIncludesTitle: "packzone pipeline built" },
    ],
  },
  // --- ADR-0031 step1: entity group (4) — entity link layer assertions (red until steps 2-6 land) ---
  {
    id: "ent_centric", group: "entity",
    description: "one entity key groups both rows; superseded row invisible",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/ent1", "buildzone deployment runbook", "buildzone deployment runbook documented", 0.9, "buildzone")], expect: ["accept"] },
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/ent2", "buildzone rollback playbook", "buildzone rollback playbook documented", 0.95, "buildzone")], expect: ["supersede"] },
      { op: "entities", stage: "store", expectNames: ["buildzone"], expectCount: 1 },
      { op: "search", stage: "retrieve", query: "buildzone runbook details", expectIncludesTitle: "rollback playbook", expectExcludesTitle: "deployment runbook" },
    ],
  },
  {
    id: "ent_cross_session", group: "entity", difficulty: "hard",
    description: "entity arm aggregates across sessions; non-FTS-matching row surfaces via containment match",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/ent3", "atlascorp funding pitch", "atlascorp funding pitch notes", 0.9, "atlascorp")], expect: ["accept"] },
      { op: "adjudicate", stage: "adjudicate", newSession: true, items: [km("https://ex.com/ent4", "series b hiring radar", "series b hiring radar notes", 0.9, "atlascorp-rd")], expect: ["accept"] },
      { op: "entities", stage: "store", expectNames: ["atlascorp", "atlascorp-rd"], expectCount: 2 },
      { op: "search", stage: "retrieve", query: "atlascorp", expectIncludesTitle: "series b hiring radar" },
      { op: "search", stage: "retrieve", query: "atlascorp", expectIncludesTitle: "funding pitch" },
    ],
  },
  {
    id: "ent_same_name_diff_type", group: "entity", difficulty: "adversarial",
    description: "type gate: @handle and quoted-phrase \\u0022mercury\\u0022 never merge (Mem0 #5438 lesson)",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/ent5", "wire sent to @mercury yesterday", "wire sent to @mercury yesterday confirmed", 0.9, "mercury-pay")], expect: ["accept"] },
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/ent6", "opened account at \"Mercury\" bank", "opened account at \"Mercury\" bank today", 0.9, "mercury-bank")], expect: ["accept"] },
      { op: "entities", stage: "store", expectNames: ["mercury", "mercury", "mercury-bank", "mercury-pay"], expectCount: 4 },
    ],
  },
  {
    id: "ent_variant_same", group: "entity",
    description: "case/pascal variant BuildKit unifies with declared buildkit; second row links via dictionary pass",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/ent7", "BuildKit caching enabled", "BuildKit caching enabled for builds", 0.9, "buildkit")], expect: ["accept"] },
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/ent8", "buildkit registry prune shipped", "buildkit registry prune shipped notes", 0.9, "buildkit-v2")], expect: ["accept"] },
      { op: "entities", stage: "store", expectNames: ["buildkit", "buildkit-v2"], expectCount: 2 },
      { op: "search", stage: "retrieve", query: "BuildKit", expectIncludesTitle: "registry prune shipped" },
    ],
  },
  // --- Group: semantic (ADR-0033 vector arm) ---
  {
    id: "sem_cross_lingual", group: "semantic", difficulty: "hard",
    description: "Chinese paraphrase query recalls an English-only memory via the vector arm (FTS matches nothing)",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/pnpm-pin", "pnpm version pinning guide", "pmOnFail error gate plus corepack packageManager pinning prevents lockfile drift across agents", 0.9, "PnpmPinningGuide")], expect: ["accept"] },
      { op: "search", stage: "retrieve", query: "锁定 pnpm 版本防止 lockfile 漂移", expectRankOf: { title: "pnpm version pinning guide", maxRank: 1 } },
    ],
  },
  {
    id: "sem_paraphrase_rank", group: "semantic",
    description: "english paraphrase of an outage fact outranks an unrelated runbook via the vector arm",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/deployomega", "deployment omega outage cause", "the deployment outage was caused by an expired TLS certificate on the ingress", 0.9, "DeployOmegaOutage")], expect: ["accept"] },
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/warmup", "marketing cache warmup runbook", "cache warmup runbook for the marketing site homepage", 0.9, "CacheWarmupRunbook")], expect: ["accept"] },
      {
        op: "search", stage: "retrieve", query: "why did the release stop serving traffic",
        expectRankOf: { title: "deployment omega outage cause", maxRank: 2 },
        // ADR-0038 D7: two-label graded row — paraphrase target grade 3, unrelated runbook grade 1.
        relevanceGrades: { "deployment omega outage cause": 3, "marketing cache warmup runbook": 1 },
      },
    ],
  },
  // --- Group: relations (ADR-0035 D5, kg-lite arm; 12 cases: 8 predicate positives + CN,
  //   supersede fail-closed, paired strong negatives observational, 1-hop observational) ---
  {
    id: "rel_works_on_en", group: "relations",
    description: "EN works_on rule edge extracted and stored (fail-closed assert_edge)",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/rel01", "AriSz works on PipeFlow", "AriSz works on PipeFlow stream layer", 0.9, "ari-side")], expect: ["accept"] },
      { op: "edge", stage: "store", subject: "AriSz", relation: "works_on", object: "PipeFlow", assert: "edge", fromOp: 0 },
    ],
  },
  {
    id: "rel_works_on_cn", group: "relations", difficulty: "hard",
    description: "CN quoted-phrase works_on edge (CJK rule + alias channel, ADR-0035 D7)",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/rel02", "\"\u738B\u6587\u535A\" \u8D1F\u8D23 \"\u7075\u96C0\u7F51\u5173\"", "\"\u738B\u6587\u535A\" \u8D1F\u8D23 \"\u7075\u96C0\u7F51\u5173\" \u7684\u5F00\u53D1\u6392\u671F", 0.9, "cn-lingque")], expect: ["accept"] },
      { op: "edge", stage: "store", subject: "\u738B\u6587\u535A", relation: "works_on", object: "\u7075\u96C0\u7F51\u5173", assert: "edge", fromOp: 0 },
    ],
  },
  {
    id: "rel_depends_on_en", group: "relations",
    description: "depends_on positive",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/rel03", "OrbitQL depends on CacheLine", "OrbitQL depends on CacheLine for row caching", 0.9, "orbitql-edge")], expect: ["accept"] },
      { op: "edge", stage: "store", subject: "OrbitQL", relation: "depends_on", object: "CacheLine", assert: "edge", fromOp: 0 },
    ],
  },
  {
    id: "rel_uses_en", group: "relations",
    description: "uses positive",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/rel04", "TraceHub uses SnapStore", "TraceHub uses SnapStore for span ingestion", 0.9, "tracehub-edge")], expect: ["accept"] },
      { op: "edge", stage: "store", subject: "TraceHub", relation: "uses", object: "SnapStore", assert: "edge", fromOp: 0 },
    ],
  },
  {
    id: "rel_part_of_en", group: "relations",
    description: "part_of positive via is-part-of frame",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/rel05", "AuditPane is part of CoreBoard", "AuditPane is part of CoreBoard console shell", 0.9, "auditpane-edge")], expect: ["accept"] },
      { op: "edge", stage: "store", subject: "AuditPane", relation: "part_of", object: "CoreBoard", assert: "edge", fromOp: 0 },
    ],
  },
  {
    id: "rel_member_of_en", group: "relations",
    description: "member_of positive via is-a-member-of frame",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/rel06", "DevAmp is a member of CoreCircle", "DevAmp is a member of CoreCircle since march", 0.9, "devamp-edge")], expect: ["accept"] },
      { op: "edge", stage: "store", subject: "DevAmp", relation: "member_of", object: "CoreCircle", assert: "edge", fromOp: 0 },
    ],
  },
  {
    id: "rel_located_at_en", group: "relations",
    description: "located_at positive via is-located-in frame",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/rel07", "EdgeRelay is located in ZoneEastRack", "EdgeRelay is located in ZoneEastRack aisle two", 0.9, "edgerelay-edge")], expect: ["accept"] },
      { op: "edge", stage: "store", subject: "EdgeRelay", relation: "located_at", object: "ZoneEastRack", assert: "edge", fromOp: 0 },
    ],
  },
  {
    id: "rel_authored_by_url_handle", group: "relations",
    description: "url<->handle bridge edge authored_by (deduced, confidence 0.7)",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/rel08", "patch mirror note", "patch at https://ex.com/p92 was merged by @quinnro", 0.9, "patch-note")], expect: ["accept"] },
      { op: "edge", stage: "store", subject: "https://ex.com/p92", relation: "authored_by", object: "quinnro", assert: "edge", fromOp: 0 },
    ],
  },
  {
    id: "rel_supersede_same_triple", group: "relations",
    description: "re-asserting the same triple in a newer memory supersedes: one live row, episode moves (fail-closed)",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/rel09a", "PulseMon uses DuctTape", "PulseMon uses DuctTape for rack mounts", 0.9, "pulsemon-edge")], expect: ["accept"] },
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/rel09b", "PulseMon uses DuctTape extra", "PulseMon uses DuctTape for chassis rails", 0.9, "pulsemon-edge")], expect: ["supersede"] },
      { op: "edge", stage: "store", subject: "PulseMon", relation: "uses", object: "DuctTape", assert: "supersede", fromOp: 1 },
    ],
  },
  {
    id: "rel_no_edge_two_nouns_en", group: "relations",
    description: "paired strong negative EN: two fresh entities, no predicate frame -> no uses/no related_to (observational)",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/rel10", "VexTile grid and UmbraLake bench", "VexTile grid layout and UmbraLake bench numbers logged", 0.9, "vextile-note")], expect: ["accept"] },
      { op: "edge", stage: "store", subject: "VexTile", relation: "uses", object: "UmbraLake", assert: "no_edge" },
      { op: "edge", stage: "store", subject: "VexTile", relation: "related_to", object: "UmbraLake", assert: "no_edge" },
    ],
  },
  {
    id: "rel_no_edge_cn", group: "relations", difficulty: "adversarial",
    description: "paired strong negative CN: two quoted entities mentioned without a verb frame (observational)",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/rel11", "\"\u9E92\u9E9F\u82AF\" \u4E0E \"\u76D8\u53E4\u7B97\"", "\u770B\u677F\u91CC\u8BB0\u5F55\u4E86 \"\u9E92\u9E9F\u82AF\" \u4E0E \"\u76D8\u53E4\u7B97\" \u7684\u6392\u671F", 0.9, "qilinxin-note")], expect: ["accept"] },
      { op: "edge", stage: "store", subject: "\u9E92\u9E9F\u82AF", relation: "works_on", object: "\u76D8\u53E4\u7B97", assert: "no_edge" },
      { op: "edge", stage: "store", subject: "\u9E92\u9E9F\u82AF", relation: "depends_on", object: "\u76D8\u53E4\u7B97", assert: "no_edge" },
    ],
  },
  {
    id: "rel_hop_recall_observational", group: "relations",
    description: "1-hop recall observation: query on the neighbor entity may surface the edge-episode memory via the relation arm (never gated)",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/rel12", "rack mount setup note", "SteelFer uses BoltGrid for rack mounts", 0.9, "steel-fer")], expect: ["accept"] },
      { op: "edge", stage: "store", subject: "SteelFer", relation: "uses", object: "BoltGrid", assert: "edge", fromOp: 0 },
      { op: "search", stage: "retrieve", query: "BoltGrid", expectHopTitle: "rack mount setup note" },
    ],
  },
  ...buildRelationExpansionR33(),
  // --- Group: consolidate (ADR-0037 D4/D6, Phase-1 golden; ops decisions stay LLM-free stubs) ---
  {
    id: "con_add_then_noop", group: "consolidate",
    consolidateStub: { summary: "pnpm pins prevent lockfile drift; corepack enforces packageManager", classify: "supported" },
    description: "3-episode cluster consolidates once (ADD), a rerun is a NOOP (theta boundary covered by unit tests)",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/pn1", "kikis-delivery theme note", "kiki delivery cohort picks teal oceanic palette", 0.9, "PnpmPinning")], expect: ["accept"] },
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/pn2", "vector arm telemetry plan", "shadow-mode arm counters land report only", 0.9, "PnpmPinning")], expect: ["supersede"] },
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/pn3", "archive undo drill", "reversible archive drills never lose rows", 0.9, "PnpmPinning")], expect: ["supersede"] },
      { op: "consolidate", stage: "store", expectAdd: 1 },
      { op: "consolidate", stage: "store", expectNoop: 1 },
    ],
  },
  {
    id: "con_gate_reject", group: "consolidate", difficulty: "adversarial",
    consolidateStub: { summary: "hallucinated claim with no episode support", classify: "unsupported" },
    description: "fidelity gate rejects an unsupported LLM summary — nothing is written (D7-1)",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/cg1", "harvest moon schedule", "harvest festival lands on first tuesday", 0.9, "GateProbe")], expect: ["accept"] },
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/cg2", "turbo task topology", "turbo fans out check tasks across workspaces", 0.9, "GateProbe")], expect: ["supersede"] },
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/cg3", "quarantine belt review", "candidate belt requires manual review", 0.9, "GateProbe")], expect: ["supersede"] },
      { op: "consolidate", stage: "store", expectRejected: 1, expectAdd: 0 },
    ],
  },
  {
    id: "con_llm_unavailable", group: "consolidate",
    description: "no summarize seam wired -> consolidate fails open and writes nothing (D4)",
    ops: [
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/cu1", "habit tracker cadence", "weekly habit review every sunday", 0.9, "UnavailProbe")], expect: ["accept"] },
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/cu2", "reading list migration", "move reading list into bookmarks db", 0.9, "UnavailProbe")], expect: ["supersede"] },
      { op: "adjudicate", stage: "adjudicate", items: [km("https://ex.com/cu3", "office plant watering", "water the monstera on wednesdays", 0.9, "UnavailProbe")], expect: ["supersede"] },
      { op: "consolidate", stage: "store", expectLlmUnavailable: 1, expectAdd: 0 },
    ],
  },
  // --- Group: forget (ADR-0037 D5/D6, Phase-1 golden) ---
  {
    id: "for_archive_undo", group: "forget", difficulty: "adversarial",
    description: "aged + never-accessed row archives (dry-run predicts apply exactly, D7-6), undo restores bit-exact (D7-4)",
    ops: [
      { op: "seed", stage: "store", agedDays: 400, items: [km("https://ex.com/oldnote", "obsolete cron runbook", "legacy cron runbook replaced by kanban pipeline", 0.9, "ObsoleteCron")] },
      { op: "archive", stage: "store", expectArchived: 1 },
      { op: "search", stage: "retrieve", query: "obsolete cron runbook", expectEmpty: true },
      { op: "undoArchive", stage: "store", fromOp: 1, expectOk: true },
      { op: "search", stage: "retrieve", query: "obsolete cron runbook", expectIncludesTitle: "obsolete cron runbook" },
    ],
  },

];

// --- Group: relations (ADR-0036 Phase-1 expansion, r33) — Sakai-locked n = 80 for the group;
// the pilot (12-case group) was degenerate (all-zero RoR deltas), so n locks at the cap per D2
// (no mid-course top-ups). RoR cases carry expectRankOf on the neighbor memory so the single-run
// counterfactual ablation (runner drop-relation recompute) has a nonzero paired sample.
function buildRelationExpansionR33(): CaseSpec[] {
  const out: CaseSpec[] = [];
  const cnDisNames = ["盔杉", "麸衣", "簪锣", "硅砺", "雀笼", "蓑篾", "铎泅", "膘峦", "颍舵", "缢筝", "铗辔", "舭桅", "钨锲", "簸箕"];
  // Closed-table predicates usable between arbitrary entity pairs (authored_by is url<->handle only).
  const preds: ReadonlyArray<readonly [PredicateName: string, surface: string]> = [
    ["works_on", "works on"], ["depends_on", "depends on"], ["uses", "uses"],
    ["part_of", "is part of"], ["member_of", "is a member of"], ["located_at", "based in"],
  ];
  const head = ["North", "Quartz", "Iron", "Solar", "Nimbus", "Pixel", "Amber", "Ridge", "Cobalt", "Ember", "Halo", "Atlas"];
  const tail = ["Forge", "Span", "Deck", "Vault", "Ring", "Bay", "Lane", "Nest", "Well", "Gate", "Hub", "Mill"];
  const nm = (i: number): string => head[i % head.length]! + tail[(Math.floor(i / head.length) + i) % tail.length]!;
  // subject/object pools stay disjoint so the FTS lane can never hit the RoR target directly.
  const subOf = (i: number) => nm(i) + "Subj";
  const objOf = (i: number) => nm(i + 47) + "Desk";
  // 14 distractor memories per RoR case (ADR-0036 D5): with a 2-memory corpus the vector arm alone
  // lands the neighbor at fused rank 2 by tie, making the paired delta degenerate. Distractors push
  // the vector-only rank mid-corpus so the relation arm's causal lift registers as a positive delta.
  const r33distractors = (i: number, cn: boolean): KeyMemoryInput[] =>
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((k) => {
      if (cn) {
        const names = cnDisNames;
        return km(`https://ex.com/r33dc/${i}/${k}`, `"${names[k]}" 运维记录`, `"${names[k]}" 的巡检与发布记录`, 0.7, `cn-dis-${i}-${k}`);
      }
      const dn = nm(i + 300 + k * 13) + "Hill";
      return km(`https://ex.com/r33d/${i}/${k}`, `${dn} runbook notes`, `runbook notes for ${dn} uptime drills`, 0.7, `dis-${i}-${k}`);
    });

  // 30 EN RoR hop pairs (counterfactual sample carries the signal).
  for (let i = 0; i < 30; i++) {
    const sub = subOf(i), obj = objOf(i);
    const dis = r33distractors(i, false);
    const [pred, surface] = preds[i % preds.length]!;
    out.push({
      id: `rel33_ror_${pred}_${String(i).padStart(2, "0")}`, group: "relations",
      description: `RoR pair EN: query on ${sub} must surface the ${obj} memory via the relation arm`,
      ops: [
        { op: "adjudicate", stage: "adjudicate", items: [km(`https://ex.com/r33/${sub.toLowerCase()}`, `${sub} ${surface} ${obj} plan`, `${sub} ${surface} ${obj} for the rollout window`, 0.9, sub + "-lane")], expect: ["accept"] },
        { op: "edge", stage: "store", subject: sub, relation: pred, object: obj, assert: "edge", fromOp: 0 },
        { op: "adjudicate", stage: "adjudicate", items: [km(`https://ex.com/r33/${obj.toLowerCase()}`, `${obj} runbook notes`, `runbook notes for ${obj} uptime drills`, 0.9, obj + "-lane")], expect: ["accept"] },
        { op: "adjudicate", stage: "adjudicate", items: dis, expect: dis.map(() => "accept" as const) },
        {
          op: "search", stage: "retrieve", query: sub,
          expectRankOf: { title: `${obj} runbook`, maxRank: 20 }, expectHopTitle: `${obj} runbook`,
          // ADR-0038 D7: hop target grade 3; own-subject relation sentence grade 2; distractors grade 1.
          relevanceGrades: {
            [`${obj} runbook`]: 3,
            [`${sub} ${surface} ${obj} plan`]: 2,
            ...Object.fromEntries(dis.map((_, k) => [`${nm(i + 300 + k * 13)}Hill runbook notes`, 1] as const)),
          },
        },
      ],
    });
  }

  // 8 CN RoR hop pairs (quoted-phase CN extraction + CJK-bigram FTS path).
  const cnSub = ["玄枢", "渒闾", "梦鳸", "切镜", "手冤", "蔚鸣", "点泰", "飼芸"];
  const cnObj = ["星栈", "云架", "荧塔", "策船", "雾仓", "穿新", "竩闸", "睁塘"];
  const cnVerb = ["负责", "依赖", "使用", "维护"];
  for (let i = 0; i < 8; i++) {
    const sub = cnSub[i]!, obj = cnObj[i]!, verb = cnVerb[i % cnVerb.length]!;
    const disCn = r33distractors(i, true);
    // covered verbs -> predicate: works_on (负责/维护), depends_on (依赖), uses (使用)
    const pred = verb === "负责" || verb === "维护" ? "works_on" : verb === "依赖" ? "depends_on" : "uses";
    out.push({
      id: `rel33_ror_cn_${i}`, group: "relations", difficulty: "hard",
      description: `RoR pair CN: query ${sub} surfaces the ${obj} memory via the relation arm (quoted CN entities)`,
      ops: [
        { op: "adjudicate", stage: "adjudicate", items: [km(`https://ex.com/r33/cn${i}a`, `"${sub}" ${verb} "${obj}"`, `"${sub}" ${verb} "${obj}" 的排期`, 0.9, `cn-r33-${i}`)], expect: ["accept"] },
        { op: "edge", stage: "store", subject: sub, relation: pred, object: obj, assert: "edge", fromOp: 0 },
        { op: "adjudicate", stage: "adjudicate", items: [km(`https://ex.com/r33/cn${i}b`, `"${obj}" 运维记录"`, `"${obj}" 的巡检与发布记录`, 0.9, `cn-r33-${i}-b`)], expect: ["accept"] },
        { op: "adjudicate", stage: "adjudicate", items: disCn, expect: disCn.map(() => "accept" as const) },
        {
          op: "search", stage: "retrieve", query: `"${sub}"`,
          expectRankOf: { title: `"${obj}" 运维`, maxRank: 20 }, expectHopTitle: `"${obj}" 运维`,
          // ADR-0038 D7: quoted hop target grade 3; quoted relation sentence grade 2; CN distractors grade 1.
          relevanceGrades: {
            [`"${obj}" 运维`]: 3,
            [`"${sub}" ${verb} "${obj}"`]: 2,
            ...Object.fromEntries(cnDisNames.map((n) => [`"${n}" 运维记录`, 1] as const)),
          },
        },
      ],
    });
  }

  // 14 EN alias-surface plain edge positives (covers the alias table breadth).
  const aliases: ReadonlyArray<readonly [string, string]> = [
    ["works_on", "is responsible for"], ["works_on", "maintains"], ["depends_on", "relies on"],
    ["depends_on", "requires"], ["uses", "built on"], ["part_of", "included in"],
    ["part_of", "ships with"], ["member_of", "joined"], ["uses", "built with"],
    ["works_on", "leads"], ["works_on", "owns"], ["located_at", "based in"],
    ["member_of", "is a member of"], ["depends_on", "depends on"],
  ];
  for (let i = 0; i < aliases.length; i++) {
    const sub = nm(i + 90) + "Valve", obj = nm(i + 130) + "Pier";
    const [pred, surface] = aliases[i]!;
    out.push({
      id: `rel33_alias_${String(i).padStart(2, "0")}`, group: "relations",
      description: `alias surface "${surface}" -> ${pred} (edge assert)`,
      ops: [
        { op: "adjudicate", stage: "adjudicate", items: [km(`https://ex.com/r33a/${i}`, `${sub} ${surface} ${obj}`, `${sub} ${surface} ${obj} this quarter`, 0.9, `alias-${i}`)], expect: ["accept"] },
        { op: "edge", stage: "store", subject: sub, relation: pred, object: obj, assert: "edge", fromOp: 0 },
      ],
    });
  }

  // 8 CN edge positives across alias verbs (维护 主导 依赖于 采用 包含 构成 写了 相关)
  const cnEdge: ReadonlyArray<readonly [string, string, string]> = [
    ["雪峨", "维护", "works_on"], ["基落", "主导", "works_on"],
    ["霞桥", "依赖于", "depends_on"], ["皾颤", "采用", "uses"],
    ["汇尖", "构成", "part_of"], ["朔阵", "加入", "member_of"],
    ["冬标", "依赖", "depends_on"], ["隐簣", "使用", "uses"],
  ];
  const cnObj2 = ["霞鼎", "熬冯", "求鱼", "朝鏍", "昩坛", "簱垤", "森羾", "温阱"];
  for (let i = 0; i < cnEdge.length; i++) {
    const [sub, verb, pred] = cnEdge[i]!;
    const obj = cnObj2[i]!;
    out.push({
      id: `rel33_cn_edge_${i}`, group: "relations",
      description: `CN alias "${verb}" -> ${pred} (edge assert)`,
      ops: [
        { op: "adjudicate", stage: "adjudicate", items: [km(`https://ex.com/r33c/${i}`, `"${sub}" ${verb} "${obj}"`, `"${sub}" ${verb} "${obj}" 的交付`, 0.9, `cn-edge-${i}`)], expect: ["accept"] },
        { op: "edge", stage: "store", subject: sub, relation: pred, object: obj, assert: "edge", fromOp: 0 },
      ],
    });
  }

  // 6 no_edge negatives (two bare noun pairs per case; EN first three, CN later three).
  for (let i = 0; i < 6; i++) {
    const isCn = i >= 3;
    const sub = isCn ? ["凉逝", "炀档", "鸌馤"][i - 3]! : nm(i + 180) + "Loom";
    const obj = isCn ? ["阅励", "凂筑", "穴营"][i - 3]! : nm(i + 210) + "Crate";
    const title = isCn ? `"${sub}" 与 "${obj}" 的看板记录` : `${sub} ${obj} schedule board`;
    const snip = isCn ? `看板里记录了 "${sub}" 与 "${obj}" 的排期` : `the board tracks ${sub} and ${obj} schedules`;
    out.push({
      id: `rel33_no_edge_${i}`, group: "relations", difficulty: isCn ? "adversarial" : "core",
      description: `paired strong negative (${isCn ? "CN" : "EN"}): two nouns, no verb frame`,
      ops: [
        { op: "adjudicate", stage: "adjudicate", items: [km(`https://ex.com/r33n/${i}`, title, snip, 0.9, `noedge-${i}`)], expect: ["accept"] },
        { op: "edge", stage: "store", subject: sub, relation: "works_on", object: obj, assert: "no_edge" },
        ],
    });
  }
  return out;
}
