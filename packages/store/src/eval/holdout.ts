// ADR-0038 D3: frozen baseline holdout (one-time stratified split, never re-optimized).
// Strata = group x difficulty x CN/EN; RoR pairs over-represented per power: 19 of 38 pairs
// (every even EN index + every even CN index), ~20% of the remaining strata by sha256(id)[0] < 51.
// The selection RULE is documented for reproducibility; the LIST below is frozen and any change
// to it is a golden change = fingerprint flip + forced recalibration (ADR-0027 D9).
// ADR-0038 D5: backflow (production reflow) forms a separate slice family, physically separate
// from the baseline holdout; inputHash dedup forbids a case ever sitting in both tracks.
import { createHash } from "node:crypto";
import type { CaseSpec } from "./golden-cases";

export const HOLDOUT_VERSION = "baseline-v1" as const;

export const HOLDOUT_IDS: readonly string[] = [
  "con_add_then_noop",
  "con_gate_reject",
  "con_llm_unavailable",
  "ent_cross_session",
  "pv_api_docs_version",
  "qz_evidence_060",
  "rel33_alias_06",
  "rel33_cn_edge_0",
  "rel33_cn_edge_1",
  "rel33_cn_edge_3",
  "rel33_cn_edge_5",
  "rel33_cn_edge_7",
  "rel33_ror_cn_0",
  "rel33_ror_cn_2",
  "rel33_ror_cn_4",
  "rel33_ror_cn_6",
  "rel33_ror_member_of_04",
  "rel33_ror_member_of_10",
  "rel33_ror_member_of_16",
  "rel33_ror_member_of_22",
  "rel33_ror_member_of_28",
  "rel33_ror_uses_02",
  "rel33_ror_uses_08",
  "rel33_ror_uses_14",
  "rel33_ror_uses_20",
  "rel33_ror_uses_26",
  "rel33_ror_works_on_00",
  "rel33_ror_works_on_06",
  "rel33_ror_works_on_12",
  "rel33_ror_works_on_18",
  "rel33_ror_works_on_24",
  "rel_authored_by_url_handle",
  "rel_located_at_en",
  "rel_member_of_en",
  "rel_supersede_same_triple",
  "rel_uses_en",
  "sb_seed_case_mixed_akia",
  "sc_aws_access_key",
  "ss_user_then_provider",
  "un_metricspipe_dashboard",
];

const HOLDOUT_SET = new Set(HOLDOUT_IDS);
export const isHoldout = (caseId: string): boolean => HOLDOUT_SET.has(caseId);

// ADR-0038 D5: backflow slice family (schema anysearch/holdout-slice@1).
// Reflow cases land ONLY in new versioned slices; a slice never mutates after commit.
export interface BackflowItem {
  inputHash: string;
  sourceTraceId: string;
  payload: CaseSpec;
}
export interface BackflowSlice {
  schema: "anysearch/holdout-slice@1";
  sliceId: string;
  backflowRound: string;
  addedAt: string;
  items: readonly BackflowItem[];
}

// Empty at r97 landing; slices land as data here when production reflow starts.
export const BACKFLOW_SLICES: readonly BackflowSlice[] = [];

// Canonical case identity for dual-track dedup: hash of the full case material.
export function caseInputHash(spec: CaseSpec): string {
  return createHash("sha256").update(JSON.stringify(spec)).digest("hex").slice(0, 16);
}

// Second (holdout-family) fingerprint: covers BOTH tracks (baseline ids + slice ids/hashes).
// Dual-fingerprint discipline: datasetFingerprint covers golden, holdoutFingerprint covers this file.
export function holdoutFingerprint(): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: HOLDOUT_VERSION,
        holdoutIds: HOLDOUT_IDS,
        backflow: BACKFLOW_SLICES.map((s) => ({ sliceId: s.sliceId, items: s.items.map((i) => i.inputHash) })),
      })
    )
    .digest("hex")
    .slice(0, 16);
}

// Fail-fast integrity gate: an overlapping or mislabeled backflow item is thrown AT LOAD,
// never silently merged (independence is the premise of the FWER bound).
export function assertBackflowNoOverlap(goldenCases: readonly CaseSpec[]): void {
  const baselineHashes = new Set(goldenCases.map(caseInputHash));
  const seen = new Set<string>();
  for (const slice of BACKFLOW_SLICES) {
    if (slice.schema !== "anysearch/holdout-slice@1") throw new Error("backflow slice " + slice.sliceId + ": bad schema tag");
    for (const item of slice.items) {
      if (item.inputHash !== caseInputHash(item.payload)) throw new Error("backflow item " + item.inputHash + ": inputHash does not match payload (provenance corruption)");
      if (baselineHashes.has(item.inputHash)) throw new Error("backflow item " + item.inputHash + " duplicates a baseline-golden input — a case may never sit in both tracks (ADR-0038 D5)");
      if (seen.has(item.inputHash)) throw new Error("backflow item " + item.inputHash + " duplicated across slices (" + slice.sliceId + ")");
      seen.add(item.inputHash);
    }
  }
}
