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
  | "semantic";

export type EvalStage = "extract" | "adjudicate" | "store" | "retrieve";

export type CaseOp =
  | { op: "adjudicate"; stage: "adjudicate"; items: KeyMemoryInput[]; expect: AdjudicationAction[]; newSession?: boolean /* ADR-0031 step1: cross-session entity aggregation */ }
  | { op: "search"; stage: "retrieve"; query: string; limit?: number; expectIncludesTitle?: string; expectExcludesTitle?: string; expectMaxCount?: number; expectRankOf?: { title: string; maxRank: number }; expectEmpty?: true; expectAllWeak?: true /* ADR-0033 D8: unanswerable slice asserts weak-only evidence, not zero retrieval */ }
  | { op: "seed"; stage: "store"; items: KeyMemoryInput[] } /* ADR-0028 D3: direct DB insert, bypasses the write guard on purpose */
  | { op: "rawValidUntil"; stage: "store"; fromOp: number; expectSet: boolean }
  | { op: "promote"; stage: "store"; key: string; value: string; scope?: string; source: "explicit" | "correction"; expectAction: "promoted" | "rejected" }
  | { op: "correct"; stage: "adjudicate"; key: string; scope: string; times: number; expectCount: number }
  | { op: "listPrefs"; stage: "retrieve"; scope?: string; expectKeyValue?: { key: string; value: string }; expectKeyAbsent?: string }
  | { op: "listQuarantined"; stage: "retrieve"; expectCount: number }
  | { op: "entities"; stage: "store"; expectNames?: string[]; expectCount?: number } /* ADR-0031 step1 */
  | { op: "resolveQuarantined"; stage: "adjudicate"; fromOp: number; item: number; action: "keep" | "drop"; expectOk: boolean };

export interface CaseSpec {
  id: string;
  group: EvalGroup;
  // ADR-0028 D4: report-only tier; omitted defaults to "core" in the runner report.
  difficulty?: "core" | "hard" | "adversarial";
  description: string;
  ops: CaseOp[];
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
      { op: "search", stage: "retrieve", query: "why did the release stop serving traffic", expectRankOf: { title: "deployment omega outage cause", maxRank: 2 } },
    ],
  },
];
