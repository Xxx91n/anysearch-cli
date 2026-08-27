// ADR-0027 D3/D5: golden dataset — 20 deterministic lifecycle cases in 6 groups.
// Cases are typed TS data (compiler-forced sync with store API); JSON fixtures rejected (ADR-0027 D11).
// Runner materializes each case on a fresh temp SQLite DB: adjudicate stubs -> store -> retrieve.
import type { AdjudicationAction, KeyMemoryInput } from "../session-store";

export type EvalGroup =
  | "supersession"
  | "temporal"
  | "secret"
  | "cprime"
  | "quarantine"
  | "stale_topk";

export type EvalStage = "extract" | "adjudicate" | "store" | "retrieve";

export type CaseOp =
  | { op: "adjudicate"; stage: "adjudicate"; items: KeyMemoryInput[]; expect: AdjudicationAction[] }
  | { op: "search"; stage: "retrieve"; query: string; limit?: number; expectIncludesTitle?: string; expectExcludesTitle?: string; expectMaxCount?: number }
  | { op: "rawValidUntil"; stage: "store"; fromOp: number; expectSet: boolean }
  | { op: "promote"; stage: "store"; key: string; value: string; scope?: string; source: "explicit" | "correction"; expectAction: "promoted" | "rejected" }
  | { op: "correct"; stage: "adjudicate"; key: string; scope: string; times: number; expectCount: number }
  | { op: "listPrefs"; stage: "retrieve"; scope?: string; expectKeyValue?: { key: string; value: string }; expectKeyAbsent?: string }
  | { op: "listQuarantined"; stage: "retrieve"; expectCount: number }
  | { op: "resolveQuarantined"; stage: "adjudicate"; fromOp: number; item: number; action: "keep" | "drop"; expectOk: boolean };

export interface CaseSpec {
  id: string;
  group: EvalGroup;
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
      { op: "search", stage: "retrieve", query: "relcycle", limit: 5, expectMaxCount: 1, expectIncludesTitle: "relcycle version four" },
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
      { op: "search", stage: "retrieve", query: "timewindow", limit: 5, expectMaxCount: 2, expectIncludesTitle: "timewindow one live", expectExcludesTitle: "timewindow two uncertain" },
    ],
  },
];
