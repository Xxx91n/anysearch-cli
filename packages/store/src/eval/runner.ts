// ADR-0027 D1/D2: deterministic lifecycle runner — extract stub (fixed inputs) ->
// adjudicate -> store -> retrieve, per-case isolated temp SQLite DB.
// Pure/deterministic only; LLM judge lives in scripts/eval-judge.mjs and never gates (D2).
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "../session-store";
import { normalizeEntityName } from "../entity";
import type { AdjudicationResultItem } from "../session-store";
import { rrfRank } from "@anysearch/retriever";
import type { CaseSpec, EvalStage } from "./golden-cases";
import { holdoutFingerprint, isHoldout } from "./holdout";
import { bucketHistogram, dayBucketFingerprint } from "./day-buckets";
import { evaluateTauFitGate } from "./bgnbd";
import { skip, type SkipMarker } from "./explicit-skip";

export interface OpRecord {
  op: number;
  kind: string;
  stage: EvalStage;
  ok: boolean;
  detail: string;
  samples?: Array<{ title: string | null; snippet: string | null }>;
  // ADR-0028 D2/D4: rank-of-relevant + hit count feed MRR and the answerable false-refusal rate.
  // ADR-0038 D7: per-K nDCG over graded relevance labels (report-only, never gated).
  ndcg?: Record<string, number>;
  rank?: number;
  hitCount?: number;
  // ADR-0033 D8: count of non-weak (FTS-armed) hits, for weak-evidence semantics.
  strongCount?: number;
  // ADR-0035 D5: relation observational flags (never flip case pass/fail).
  hopHit?: boolean;
  noEdgeViolation?: boolean;
  dryRunExact?: boolean; // ADR-0037 D6: archive dry-run == apply (forget zone, report-only)
  undoOk?: boolean;      // ADR-0037 D5: undo succeeded (forget zone, report-only)
  // ADR-0036 D5: single-run counterfactual RoR ablation (capture only when expectRankOf set).
  // rank of the expected memory in the fused list with / without the relation arm; k+1 = clipped.
  rorRankOn?: number;
  rorRankOff?: number;
  rorExcluded?: boolean; // expected memory never identified in any arm list
  // ADR-0037 D6 Phase-2: semantic-arm counterfactual (six-arm list vs five-arm baseline).
  semRankOn?: number;
  semRankOff?: number;
}

export interface CaseResult {
  id: string;
  group: CaseSpec["group"];
  difficulty: NonNullable<CaseSpec["difficulty"]>;
  passed: boolean;
  failedStage: EvalStage | null;
  ops: OpRecord[];
  // ADR-0031 step7: per-case entity-arm telemetry snapshot (report-only).
  entityArm?: { queries: number; candidates: number; activations: number; hits: number };
  // ADR-0032 D5: per-case merge/review telemetry snapshot (report-only).
  entityMerge?: { auto_merged: number; unmerged: number; review_pending: number; confirmed: number; rejected: number; candidates_truncated: number };
  // ADR-0035 D4: per-case relation extraction telemetry snapshot (report-only).
  relationTel?: RelTel;
  // ADR-0037 D6: per-case semantic-arm shadow telemetry (served must stay 0 in Phase-1).
  semTel?: { queries: number; hits: number; served: number };
  // ADR-0039 D1/D5: access-age histogram snapshot from the append-only access_events log.
  accessEvents?: { total: number; histogram: Record<string, number> };
}

export interface EvalCounts {
  cases: number;
  casesPassed: number;
  supExpected: number;
  supPassed: number;
  fpEligible: number;
  fpCount: number;
}

export interface RelTel { ruleHits: number; llmActivations: number; llmFailures: number; triplesWritten: number; dedupSkipped: number; relatedToWriteOnce: number; schemaRejected: number; armQueries: number; armHits: number; pendingEdges: number }

export interface EvalMetrics {
  passRate: number;
  supersessionSuccess: number;
  quarantineFalsePositiveRate: number;
  // ADR-0028 D1: integer counts back the integer-allowance gate.
  counts: EvalCounts;
  // ADR-0028 D2: MRR over expectRankOf search ops (report-only).
  mrr: number;
  // ADR-0028 D4: answerable-case false-refusal rate (report-only).
  answerableFalseRefusalRate: number;
  // ADR-0031 step7: entity arm hit-rate telemetry (report-only, never gated).
  entityArm?: { queries: number; candidates: number; activations: number; hits: number; hitRate: number; activationRate: number; avgArmHits: number };
  // ADR-0032 D5: entity merge telemetry (report-only, never gated — Goodhart clause).
  entityMerge?: { auto_merged: number; unmerged: number; review_pending: number; confirmed: number; rejected: number; candidates_truncated: number };
  // ADR-0034 D5: attribution zone — report-only, missing zone = fail-closed in gate.
  attribution?: {
    supported: number;
    uncertain: number;
    unsupported: number;
    supportedPrecision: number;   // fraction of supported claims that have >=1 evidence (proxy)
    unsupportedRecall: number;  // fraction of truly unsupported claims caught (offline baseline, junction only)
    totalClaims: number;
    judgeEnhanced: boolean;
    // Confusion matrix over labelled verdicts — zero placeholders during the observation period.
    confusion: { tp: number; fp: number; fn: number; tn: number };
  };
  // ADR-0035 D5: relation zone — no_edge precision + 1-hop hit rate are OBSERVATIONAL-only
  // (budget formulas pre-registered with blank values); assert_edge / edge_supersede are fail-closed
  // and surface through the normal case-pass channel. Zero placeholders during observation period.
  relation?: {
    noEdgeChecks: number;
    noEdgeViolations: number;
    hopChecks: number;
    hopHits: number;
    hopHitRate: number;
    tel: RelTel;
  };
  // ADR-0036 D3/D5: paired RoR ablation sample — deltas = (rank_off - rank_on) / ROR_WINDOW,
  // positive = the relation arm pulled the expected memory earlier. The gate consumes `deltas`
  // (BCa lower bound + sign-flip + MEI floor); mean alone is report-only evidence.
  relationGain?: { n: number; excluded: number; meanDelta: number; deltas: number[] };
  // ADR-0038 D3: Track-A paired deltas restricted to the frozen baseline holdout (separate gate sample).
  relationGainHoldout?: { n: number; excluded: number; meanDelta: number; deltas: number[] };
  // ADR-0038 D7: graded-relevance nDCG aggregates (report-only, never gated).
  ndcg?: { n: number; at5: number; at10: number; at20: number };
  // ADR-0039 step 7: Observational zone — pre-registered, report-only, never read by the
  // gate (N1); ship-gate fails if the zone is missing entirely (E3, report-as-contract).
  observational?: ObservationalZone;
  // ADR-0037 D6: semantic-arm zone (Phase-2 serve; served counts live hits. The Phase-1
  // served-must-be-0 contract was retired when serve shipped — regression gate is fail-closed).
  // Forget lifecycle counters.
  // ADR-0037 D6 Phase-2: serve telemetry + fail-closed regression count + RoR gain (observation zone).
  semantic: { queries: number; hits: number; served: number; regressions: number; gain?: { n: number; meanDelta: number } };
  forget: { archiveChecks: number; archives: number; undoRestores: number; dryRunExact: number };
}

// ADR-0039 step 7: Observational zone — fixed 5-key shape; any value may be a SkipMarker.
export interface ObservationalZone {
  schema: "anysearch/observational@1";
  dayBucketDefinition: string; // D4 fingerprint linkage
  accessAge: { status: "ok"; events: number; histogram: Record<string, number> } | SkipMarker;
  tauScan: { status: "ok"; [k: string]: unknown } | SkipMarker;
  bgnbd: { status: "ok"; params: unknown; validation: unknown } | SkipMarker;
  revival: { status: "ok"; archives: number; undone: number; undoneRate: number } | SkipMarker;
  undoReentryEvents: { status: "ok"; count: number } | SkipMarker;
}

export interface EvalReport {
  schema: "anysearch/eval-report@1";
  generatedAt: string;
  datasetFingerprint: string;
  // ADR-0038 D2: frozen-baseline + backflow-slice family fingerprint (gate stores it on the baseline).
  holdoutFingerprint: string;
  totals: { cases: number; passed: number; failed: number };
  stageBreakdown: Record<EvalStage, number>;
  // ADR-0028 D4: per-difficulty tier pass rates (report-only, never gated).
  tierBreakdown: Record<string, { cases: number; passed: number; passRate: number }>;
  metrics: EvalMetrics;
  cases: CaseResult[];
}

// ADR-0038 D7: exponential-gain nDCG@k with log2(rank+1) discount; IDCG truncated to the same k
// (trec eval / scikit semantics). Report-only — feeding the judge-calibration label row.
export function ndcgAtK(rankedTexts: string[], grades: Record<string, number>, k: number): number {
  const disc = (rank: number): number => Math.log2(rank + 1);
  const gradeOf = (t: string): number => { let g = 0; for (const [key, gr] of Object.entries(grades)) if (t.includes(key) && gr > g) g = gr; return g; };
  const dcg = rankedTexts.slice(0, k).reduce((acc, t, i) => acc + (Math.pow(2, gradeOf(t)) - 1) / disc(i + 1), 0);
  const idcg = Object.values(grades).map((g) => Math.pow(2, g) - 1).sort((a, b) => b - a).slice(0, k)
    .reduce((acc, g, i) => acc + g / disc(i + 1), 0);
  return idcg > 0 ? dcg / idcg : 0;
}

export function datasetFingerprint(cases: CaseSpec[]): string {
  // ADR-0039 D4: the pre-registered day-bucket definition joins the fingerprint — changing
  // bucket boundaries flips the fingerprint and forces recalibration (no silent re-binning).
  return createHash("sha256").update(JSON.stringify(cases) + "|" + dayBucketFingerprint()).digest("hex").slice(0, 16);
}

const hitText = (h: { role?: unknown; content?: unknown }): string =>
  String(h.role ?? "") + " " + String(h.content ?? "");

// ADR-0036 D5: RRF window for the RoR ablation; target absent from a fused list clips to k+1 (61).
export const ROR_WINDOW = 60;
export const ROR_CLIP = ROR_WINDOW + 1;

export type StoreFactory = (dbPath: string, spec: CaseSpec) => SqliteSessionStore;

// ADR-0037 D4/D6: golden consolidate stubs — summarize/classify are deterministic
// (classify stub returns one fixed label for every claim; label confidence mirrors the role).
const defaultFactory: StoreFactory = (dbPath, spec) => {
  const stub = spec.consolidateStub;
  if (!stub) return new SqliteSessionStore(dbPath);
  return new SqliteSessionStore(dbPath, {
    consolidateSummarize: async () => stub.summary,
    consolidateClassify: () => ({ label: stub.classify, confidence: stub.classify === "supported" ? 0.95 : 0.1 }),
  });
};

export async function runCase(spec: CaseSpec, makeStore: StoreFactory = defaultFactory): Promise<CaseResult> {
  const tmpDir = mkdtempSync(join(tmpdir(), "ans-eval-"));
  const dbPath = join(tmpDir, "eval.db");
  const store = makeStore(dbPath, spec);
  const raw = new Database(dbPath, { readonly: true });
  const ops: OpRecord[] = [];
  let sessionId = "";
  let entityArmSnapshot: { queries: number; candidates: number; activations: number; hits: number } | undefined;
  let relationTelSnapshot: RelTel | undefined;
  let semTelSnapshot: { queries: number; hits: number; served: number } | undefined;
  let accessEventsSnapshot: { total: number; histogram: Record<string, number> } | undefined;
  let entityMergeSnapshot: { auto_merged: number; unmerged: number; review_pending: number; confirmed: number; rejected: number; candidates_truncated: number } | undefined;
  const adjResults: AdjudicationResultItem[][] = []; // stashed per adjudicate opIndex
  const archiveLogIdsByOp = new Map<number, number[]>(); // ADR-0037 D5: archive op -> archive_log ids for undo
  let failedStage: EvalStage | null = null;
  const mark = (rec: OpRecord) => {
    ops.push(rec);
    if (!rec.ok && failedStage === null) failedStage = rec.stage;
  };
  try {
    const session = await store.createSession("eval");
    sessionId = session.id;
    for (const [opIndex, op] of spec.ops.entries()) {
      try {
        switch (op.op) {
          case "adjudicate": {
            const adjudicateSid = op.newSession ? (await store.createSession("eval")).id : session.id; // ADR-0031 step1: cross-session entity aggregation
            const res = await store.adjudicateMemory(adjudicateSid, op.items);
            adjResults[opIndex] = res;
            // ponytail: wall-clock settle sleep, ceiling = flaky on heavily loaded CI hosts; upgrade path = injectable clock into store.
            await new Promise((r) => setTimeout(r, 12)); // mirror in-repo tests: let FTS/datetime('now') settle
            const mism = op.expect
              .map((e, i) => (res[i]?.action === e ? null : `item ${i}: got ${res[i]?.action ?? "<missing>"}, want ${e}`))
              .filter(Boolean);
            mark({ op: opIndex, kind: op.op, stage: op.stage, ok: mism.length === 0, detail: mism.length ? mism.join("; ") : "actions=" + op.expect.join(",") });
            break;
          }
          case "search": {
            const hits = await store.searchMemory(op.query, op.limit ?? 20);
            const texts = hits.map((h) => hitText(h));
            // ADR-0033 D8: weak = hit without the FTS arm (vector/entity-only recall). Weak hits are
            // answer-layer abstain evidence: they don't count toward precision budgets.
            const isWeak = (h: unknown): boolean => { const a = (h as { arms?: string[] }).arms; return Array.isArray(a) && a.length > 0 && !a.includes("fts"); };
            const strongHits = hits.filter((h) => !isWeak(h));
            const fails: string[] = [];
            if (op.expectIncludesTitle && !texts.some((t) => t.includes(op.expectIncludesTitle!))) fails.push(`missing "${op.expectIncludesTitle}"`);
            if (op.expectExcludesTitle && texts.some((t) => t.includes(op.expectExcludesTitle!))) fails.push(`stale "${op.expectExcludesTitle}" still returned`);
            if (op.expectMaxCount !== undefined && strongHits.length > op.expectMaxCount) fails.push(strongHits.length + " strong hit(s) > max " + op.expectMaxCount);
            if (op.expectEmpty === true && hits.length !== 0) fails.push(hits.length + " hit(s) returned, want 0 (expectEmpty)");
            if (op.expectAllWeak === true && strongHits.length !== 0) fails.push(strongHits.length + " strong hit(s) returned, want 0 (expectAllWeak — hits must all be weak-evidence)");
            // ADR-0028 D2: rank-of-relevant — 1-based position of the first hit containing the title (0 = absent).
            let rank: number | undefined;
            if (op.expectRankOf) {
              rank = texts.findIndex((t) => t.includes(op.expectRankOf!.title)) + 1;
              if (rank === 0) fails.push(`rank-of-relevant absent: "${op.expectRankOf.title}"`);
              else if (rank > op.expectRankOf.maxRank) fails.push(`rank ${rank} > maxRank ${op.expectRankOf.maxRank} for "${op.expectRankOf.title}"`);
            }
            // ADR-0036 D3/D5: single-run counterfactual — drop the relation list from the
            // captured arm inputs and recompute the fused rank of the expected memory.
            let rorRankOn: number | undefined;
            let rorRankOff: number | undefined;
            let rorExcluded: boolean | undefined;
            let semRankOn: number | undefined;
            let semRankOff: number | undefined;
            if (op.expectRankOf) {
              const prov = store.lastArmProvenance;
              let targetId: number | undefined;
              if (prov) for (const [id, text] of prov.texts) if (text.includes(op.expectRankOf.title)) { targetId = id; break; }
              if (prov && targetId !== undefined) {
                const onIdx = prov.fusedIds.indexOf(String(targetId));
                rorRankOn = onIdx >= 0 ? onIdx + 1 : ROR_CLIP;
                const offLists: string[][] = [];
                const offWeights: number[] = [];
                for (let i = 0; i < prov.labels.length; i++) {
                  if (prov.labels[i] === "relation") continue;
                  offLists.push(prov.lists[i]!);
                  offWeights.push(prov.weights[i]!);
                }
                rorRankOff = ROR_CLIP;
                if (offLists.length > 0) {
                  const offFused = offLists.length === 1 ? offLists[0]! : rrfRank(offLists, ROR_WINDOW, offWeights);
                  const offIdx = offFused.indexOf(String(targetId));
                  if (offIdx >= 0) rorRankOff = offIdx + 1;
                }
              } else {
                rorExcluded = true;
              }
              // ADR-0037 D6 Phase-2: semantic-arm counterfactual — rank with the semantic arm vs
              // the five-arm baseline (semantic lists dropped). Regression = on rank worse than off.
              if (prov && targetId !== undefined) {
                const onI = prov.fusedIds.indexOf(String(targetId));
                semRankOn = onI >= 0 ? onI + 1 : ROR_CLIP;
                const sLists: string[][] = [];
                const sWeights: number[] = [];
                for (let i = 0; i < prov.labels.length; i++) {
                  if (prov.labels[i] === "semantic") continue;
                  sLists.push(prov.lists[i]!);
                  sWeights.push(prov.weights[i]!);
                }
                semRankOff = ROR_CLIP;
                if (sLists.length > 0) {
                  const sFused = sLists.length === 1 ? sLists[0]! : rrfRank(sLists, ROR_WINDOW, sWeights);
                  const sIdx = sFused.indexOf(String(targetId));
                  if (sIdx >= 0) semRankOff = sIdx + 1;
                }
              }
            }
            mark({
              op: opIndex, kind: op.op, stage: op.stage, ok: fails.length === 0,
              detail: fails.length ? fails.join("; ") : hits.length + " hit(s)",
              samples: hits.slice(0, 2).map((h) => ({ title: (h as { role?: string }).role ?? null, snippet: String((h as { content?: string }).content ?? "").slice(0, 200) })),
              rank, hitCount: hits.length, strongCount: strongHits.length,
              ...(rorRankOn !== undefined ? { rorRankOn, rorRankOff } : {}),
              ...(rorExcluded !== undefined ? { rorExcluded } : {}),
              ...(semRankOn !== undefined ? { semRankOn, semRankOff } : {}),
              ...(op.expectHopTitle !== undefined ? { hopHit: texts.some((t) => t.includes(op.expectHopTitle!)) } : {}),
              ...(op.relevanceGrades ? { ndcg: { 5: ndcgAtK(texts, op.relevanceGrades, 5), 10: ndcgAtK(texts, op.relevanceGrades, 10), 20: ndcgAtK(texts, op.relevanceGrades, 20) } } : {}),
            });
            break;
          }
          case "seed": {
            // ADR-0028 D3: direct side-channel insert — bypasses SqliteSessionStore write guards on
            // purpose so search assertions test the READ-side exit filter ("write got bypassed" premise).
            const writer = new Database(dbPath);
            try {
              const ins = writer.prepare("INSERT INTO retrieval_results (session_id, url, title, snippet, source, rrf_score, entity) VALUES (?, ?, ?, ?, ?, NULL, ?)");
                            for (const it of op.items) ins.run(sessionId, it.url, it.title, it.snippet, it.source, it.entity ?? it.url);
              if (op.agedDays && op.agedDays > 0) {
                // ADR-0037 D5: backdate created_at so the archive scan sees an aged row (access_count stays 0).
                writer.prepare("UPDATE retrieval_results SET created_at = datetime(created_at, ?), last_accessed = NULL WHERE session_id = ?").run("-" + op.agedDays + " days", sessionId);
              }
              mark({ op: opIndex, kind: op.op, stage: op.stage, ok: true, detail: "seeded " + op.items.length + " row(s) (write guard bypassed)" });
            } catch (e) {
              mark({ op: opIndex, kind: op.op, stage: op.stage, ok: false, detail: "seed error: " + String((e as Error).message) });
            } finally { writer.close(); }
            break;
          }
          case "entities": {
            // ADR-0031 step1: entity-table assertions (read-side, same raw handle as seed checks).
            const rows = raw.prepare("SELECT name_norm AS name FROM entities WHERE valid_until IS NULL ORDER BY name_norm, entity_type").all() as Array<{ name: string }>;
            const fails: string[] = [];
            if (op.expectNames) {
              const want = [...op.expectNames].sort().join("|");
              const got = rows.map((r) => r.name).join("|");
              if (got !== [...op.expectNames].sort().join("|")) fails.push("names " + got + " != " + want);
            }
            if (op.expectCount !== undefined && rows.length !== op.expectCount) fails.push("count " + rows.length + " != " + op.expectCount);
            mark({ op: opIndex, kind: op.op, stage: op.stage, ok: fails.length === 0, detail: fails.length ? fails.join("; ") : rows.length + " entit(ies)" });
            break;
          }
          case "rawValidUntil": {
            const res = adjResults[op.fromOp];
            const supId = res?.[0]?.supersededId;
            if (supId === undefined) { mark({ op: opIndex, kind: op.op, stage: op.stage, ok: false, detail: "referenced op " + op.fromOp + " has no supersededId" }); break; }
            const row = raw.prepare("SELECT valid_until FROM retrieval_results WHERE id = ?").get(supId) as { valid_until: string | null } | undefined;
            const set = !!row && row.valid_until !== null;
            mark({ op: opIndex, kind: op.op, stage: op.stage, ok: set === op.expectSet, detail: "valid_until " + (set ? "set" : "null") });
            break;
          }
          case "promote": {
            const r = await store.promotePreference({ key: op.key, value: op.value, scope: op.scope, source: op.source });
            mark({ op: opIndex, kind: op.op, stage: op.stage, ok: r.action === op.expectAction, detail: "action=" + r.action });
            break;
          }
          case "correct": {
            let last = 0;
            for (let i = 0; i < op.times; i++) last = (await store.recordCorrectionOnPreference(op.key, op.scope)).correctionCount;
            mark({ op: opIndex, kind: op.op, stage: op.stage, ok: last === op.expectCount, detail: "count=" + last });
            break;
          }
          case "listPrefs": {
            const rows = await store.listPreferences(op.scope ?? "global");
            const fails: string[] = [];
            if (op.expectKeyValue) {
              const hit = rows.find((r) => r.key === op.expectKeyValue!.key);
              if (!hit) fails.push(`key "${op.expectKeyValue.key}" absent`);
              else if (hit.value !== op.expectKeyValue.value) fails.push(`value="${hit.value}"`);
            }
            if (op.expectKeyAbsent && rows.some((r) => r.key === op.expectKeyAbsent)) fails.push(`key "${op.expectKeyAbsent}" unexpectedly present`);
            mark({ op: opIndex, kind: op.op, stage: op.stage, ok: fails.length === 0, detail: fails.length ? fails.join("; ") : rows.length + " pref(s)" });
            break;
          }
          case "listQuarantined": {
            const rows = await store.listQuarantinedMemories();
            mark({ op: opIndex, kind: op.op, stage: op.stage, ok: rows.length === op.expectCount, detail: rows.length + " quarantined" });
            break;
          }
          case "edge": {
            // ADR-0035 D5: assert_edge / edge_supersede are fail-closed; no_edge is observational.
            const sn = normalizeEntityName(op.subject);
            const on = normalizeEntityName(op.object);
            const rows = raw.prepare(
              "SELECT e.id, e.valid_until, e.episode_memory_id FROM edges e"
              + " JOIN entities se ON se.id = e.source_entity_id JOIN entities te ON te.id = e.target_entity_id"
              + " WHERE se.name_norm = ? AND e.relation = ? AND te.name_norm = ?",
            ).all(sn, op.relation, on) as Array<{ id: number; valid_until: string | null; episode_memory_id: number }>;
            const live = rows.filter((r) => r.valid_until === null);
            const closed = rows.filter((r) => r.valid_until !== null);
            if (op.assert === "no_edge") {
              const violated = live.length > 0 || closed.length > 0;
              mark({ op: opIndex, kind: op.op, stage: op.stage, ok: true, detail: (violated ? "OBSERVED VIOLATION: " : "") + live.length + " live " + closed.length + " closed edge(s) " + sn + "->" + op.relation + "->" + on, noEdgeViolation: violated });
              break;
            }
            const fails: string[] = [];
            if (live.length !== 1) fails.push("live edge count " + live.length + " != 1");
            if (op.assert === "supersede") {
              if (closed.length < 1) fails.push("no closed (superseded) row found");
              const res = op.fromOp !== undefined ? adjResults[op.fromOp] : undefined;
              const ep = res?.[0]?.insertedId;
              if (ep === undefined) fails.push("fromOp " + op.fromOp + " has no insertedId to compare");
              else if (live.length >= 1 && live[0].episode_memory_id !== ep) fails.push("live row episode " + live[0].episode_memory_id + " != latest write " + ep);
            } else if (op.fromOp !== undefined) {
              const res = adjResults[op.fromOp];
              const ep = res?.[0]?.insertedId;
              if (ep !== undefined && live.length >= 1 && live[0].episode_memory_id !== ep) fails.push("live row episode " + live[0].episode_memory_id + " != write " + ep);
            }
            mark({ op: opIndex, kind: op.op, stage: op.stage, ok: fails.length === 0, detail: fails.length ? fails.join("; ") : "edge live " + sn + "->" + op.relation + "->" + on });
            break;
          }
          case "consolidate": {
            // ADR-0037 D4/D7-1/2: consolidation against golden stubs; report counters are asserted directly.
            const rep = await store.consolidateMemory();
            const fails: string[] = [];
            if (op.expectAdd !== undefined && rep.add !== op.expectAdd) fails.push("add " + rep.add + " != " + op.expectAdd);
            if (op.expectNoop !== undefined && rep.noop !== op.expectNoop) fails.push("noop " + rep.noop + " != " + op.expectNoop);
            if (op.expectRejected !== undefined && rep.gateRejected !== op.expectRejected) fails.push("gateRejected " + rep.gateRejected + " != " + op.expectRejected);
            if (op.expectLlmUnavailable !== undefined && rep.llmUnavailable !== op.expectLlmUnavailable) fails.push("llmUnavailable " + rep.llmUnavailable + " != " + op.expectLlmUnavailable);
            mark({ op: opIndex, kind: op.op, stage: op.stage, ok: fails.length === 0, detail: fails.length ? fails.join("; ") : "add=" + rep.add + " noop=" + rep.noop + " rejected=" + rep.gateRejected + " unavailable=" + rep.llmUnavailable });
            break;
          }
          case "archive": {
            // ADR-0037 D5/D7-6: dry-run (rolled-back transaction) must predict apply exactly;
            // applyArchive's internal dryRun==apply assertion is re-asserted at the golden layer.
            const candidates = store.scanArchive();
            const dry = store.applyArchive(undefined, { dryRun: true });
            const applied = store.applyArchive(candidates.map((c) => c.id));
            const fails: string[] = [];
            if (dry.archived !== candidates.length || applied.archived !== candidates.length) fails.push("dry-run!=apply (scan=" + candidates.length + " dry=" + dry.archived + " apply=" + applied.archived + ")");
            if (applied.archived !== op.expectArchived) fails.push("archived " + applied.archived + " != " + op.expectArchived);
            archiveLogIdsByOp.set(opIndex, applied.logIds);
            mark({ op: opIndex, kind: op.op, stage: op.stage, ok: fails.length === 0, detail: fails.length ? fails.join("; ") : "archived " + applied.archived, dryRunExact: fails.length === 0 });
            break;
          }
          case "undoArchive": {
            // ADR-0037 D5/D7-4: undo restores the archived rows from the archive_log snapshot.
            const logs = archiveLogIdsByOp.get(op.fromOp) ?? [];
            const fails: string[] = [];
            let anyOk = false;
            for (const id of logs) {
              const r = store.undoArchive(id);
              if (r.ok !== op.expectOk) fails.push("undo log " + id + " ok=" + r.ok + " != " + op.expectOk);
              anyOk = anyOk || r.ok;
            }
            if (logs.length === 0) fails.push("op " + op.fromOp + " recorded no archive log ids");
            mark({ op: opIndex, kind: op.op, stage: op.stage, ok: fails.length === 0, detail: fails.length ? fails.join("; ") : "undone " + logs.length, undoOk: anyOk });
            break;
          }
          case "resolveQuarantined": {
            const res = adjResults[op.fromOp];
            const id = res?.[op.item]?.insertedId;
            if (id === undefined) { mark({ op: opIndex, kind: op.op, stage: op.stage, ok: false, detail: "referenced op " + op.fromOp + " item " + op.item + " has no insertedId" }); break; }
            const r = await store.resolveQuarantinedMemory(id, op.action);
            mark({ op: opIndex, kind: op.op, stage: op.stage, ok: r.ok === op.expectOk, detail: op.action + " ok=" + r.ok });
            break;
          }
        }
      } catch (e) {
        mark({ op: opIndex, kind: op.op, stage: op.stage, ok: false, detail: "op error: " + String((e as Error).message) });
      }
    }
  } catch (e) {
    mark({ op: -1, kind: "setup", stage: "extract", ok: false, detail: "case setup: " + String((e as Error).message) });
  } finally {
    entityArmSnapshot = (store as unknown as { entityTelemetry?: () => { queries: number; candidates: number; activations: number; hits: number } }).entityTelemetry?.();
    entityMergeSnapshot = (store as unknown as { entityMergeTelemetry?: () => { auto_merged: number; unmerged: number; review_pending: number; confirmed: number; rejected: number; candidates_truncated: number } }).entityMergeTelemetry?.();
    relationTelSnapshot = (store as unknown as { relationTelemetry?: () => RelTel }).relationTelemetry?.();
    semTelSnapshot = store.semanticTelemetry();
    // ADR-0039 D1: access-age histogram (aggregation happens offline at report time — never
    // in the read path, ADR-0039 N2). Ages in days; unreadable timestamps clamp via NaN.
    try {
      const ev = raw.prepare("SELECT ae.accessed_at, rr.created_at FROM access_events ae JOIN retrieval_results rr ON rr.id = ae.memory_id").all() as Array<{ accessed_at: string; created_at: string }>;
      const ages: number[] = [];
      for (const e of ev) {
        const a = Date.parse(String(e.accessed_at).replace(" ", "T") + "Z");
        const c = Date.parse(String(e.created_at).replace(" ", "T") + "Z");
        ages.push(Number.isFinite(a) && Number.isFinite(c) ? (a - c) / 86_400_000 : NaN);
      }
      accessEventsSnapshot = { total: ev.length, histogram: bucketHistogram(ages) };
    } catch { accessEventsSnapshot = undefined; }
    raw.close();
    store.close();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
  return { id: spec.id, group: spec.group, difficulty: spec.difficulty ?? "core", passed: failedStage === null, failedStage, ops, entityArm: entityArmSnapshot, entityMerge: entityMergeSnapshot, relationTel: relationTelSnapshot, semTel: semTelSnapshot, accessEvents: accessEventsSnapshot };
}

// Metrics per ADR-0027 D4: ① case pass rate (gate: 100%), ② supersession success,
// ③ quarantine false-positive rate (high-evidence/user write quarantined anyway).
export function computeMetrics(cases: CaseSpec[], results: CaseResult[]): EvalMetrics {
  const passed = results.filter((r) => r.passed).length;
  let supExpected = 0;
  let supPassed = 0;
  let fpEligible = 0;
  let fpCount = 0;
  for (let i = 0; i < cases.length; i++) {
    const result = results[i]!;
    for (const [opIndex, op] of cases[i]!.ops.entries()) {
      if (op.op !== "adjudicate") continue;
      const rec = result.ops.find((r) => r.op === opIndex);
      if (op.expect.includes("supersede")) {
        supExpected += 1;
        if (rec?.ok) supPassed += 1;
      }
      const highTrust = op.items.every((it) => it.source === "user" || (typeof it.evidence === "number" && it.evidence >= 0.6));
      if (highTrust) {
        fpEligible += 1;
        // A case whose trusted write got quarantined shows up as the op failing on expect "accept"/"supersede".
        if (rec && !rec.ok && /quarantine/.test(rec.detail)) fpCount += 1;
      }
    }
  }
  // ADR-0028 D2: MRR over search ops with an expectRankOf assertion (report-only).
  let rrSum = 0;
  let rrN = 0;
  // ADR-0028 D4: answerable false-refusal rate — answerable case, positively-asserted
  // search op returning zero hits counts as a false refusal. Cases containing any
  // expectEmpty or expectAllWeak op (ADR-0033 D8) are the unanswerable slice and excluded from the denominator.
  for (let i = 0; i < cases.length; i++) {
    for (const [opIndex, op] of cases[i]!.ops.entries()) {
      if (op.op !== "search") continue;
      const rec = results[i]!.ops.find((r) => r.op === opIndex);
      if (op.expectRankOf) { rrN += 1; rrSum += rec?.rank ? 1 / rec.rank : 0; }
    }
  }
  let frEligible = 0;
  let frCount = 0;
  for (let i = 0; i < cases.length; i++) {
    const unanswerable = cases[i]!.ops.some((o) => o.op === "search" && (o.expectEmpty === true || o.expectAllWeak === true));
    if (unanswerable) continue;
    for (const [opIndex, op] of cases[i]!.ops.entries()) {
      if (op.op !== "search" || !(op.expectIncludesTitle || op.expectRankOf)) continue;
      const rec = results[i]!.ops.find((r) => r.op === opIndex);
      if (rec) { frEligible += 1; if (rec.hitCount === 0) frCount += 1; }
    }
  }
  // ADR-0036 D5: paired RoR deltas across every expectRankOf op (Track A causal sample).
  const rorDeltas: number[] = [];
  const semDeltas: number[] = [];
  let semRegressions = 0;
  let rorExcludedCount = 0;
  // ADR-0038 D2/D3: dual-track split — holdout ops come from the frozen baseline slice only and
  // feed a separate sample (independent grade; the full sample keeps the coarse zone verdict).
  const rorHoldoutDeltas: number[] = [];
  let rorHoldoutExcluded = 0;
  for (const [ci, r] of results.entries()) {
    const holdout = isHoldout(cases[ci]!.id);
    for (const rec of r.ops) {
      if (rec.rorExcluded) { if (holdout) rorHoldoutExcluded += 1; else rorExcludedCount += 1; continue; }
      if (rec.rorRankOn !== undefined && rec.rorRankOff !== undefined) (holdout ? rorHoldoutDeltas : rorDeltas).push((rec.rorRankOff - rec.rorRankOn) / ROR_WINDOW);
      // ADR-0037 D6: semantic regression = arm made fused rank strictly worse (negative delta).
      if (rec.semRankOn !== undefined && rec.semRankOff !== undefined) {
        const d = (rec.semRankOff - rec.semRankOn) / ROR_WINDOW;
        semDeltas.push(d);
        if (d < 0) semRegressions += 1;
      }
    }
  }
  return {
    passRate: results.length ? passed / results.length : 0,
    supersessionSuccess: supExpected ? supPassed / supExpected : 1,
    quarantineFalsePositiveRate: fpEligible ? fpCount / fpEligible : 0,
    counts: { cases: results.length, casesPassed: passed, supExpected, supPassed, fpEligible, fpCount },
    entityArm: (() => {
      let q = 0, c = 0, a = 0, h = 0;
      for (const r of results) if (r.entityArm) { q += r.entityArm.queries; c += r.entityArm.candidates; a += r.entityArm.activations; h += r.entityArm.hits; }
      // r74 audit E1: hitRate is the RULE-LAYER hit rate (candidates/queries) per ADR-0031 D2 (<0.5 -> fastCRW review, report-only).
      return { queries: q, candidates: c, activations: a, hits: h, hitRate: q ? c / q : 0, activationRate: q ? a / q : 0, avgArmHits: a ? h / a : 0 };
    })(),
    // ADR-0032 D5: six report-only merge metrics, aggregated over per-case stores (report-only, never gated).
    entityMerge: (() => {
      const acc = { auto_merged: 0, unmerged: 0, review_pending: 0, confirmed: 0, rejected: 0, candidates_truncated: 0 };
      for (const r of results) if (r.entityMerge) {
        acc.auto_merged += r.entityMerge.auto_merged; acc.unmerged += r.entityMerge.unmerged;
        acc.review_pending += r.entityMerge.review_pending; acc.confirmed += r.entityMerge.confirmed;
        acc.rejected += r.entityMerge.rejected; acc.candidates_truncated += r.entityMerge.candidates_truncated;
      }
      return acc;
    })(),
    mrr: rrN ? rrSum / rrN : 1,
    answerableFalseRefusalRate: frEligible ? frCount / frEligible : 0,
    // ADR-0034 D5: attribution zone — Zero state (observation period).
    // quality.threshold values will be filled after the three-gate observation period completes
    // (golden n>=80, kappa CI>=0.6, >=3 ship-gate cycles).
    attribution: {
      supported: 0,
      uncertain: 0,
      unsupported: 0,
      supportedPrecision: 0,
      unsupportedRecall: 0,
      totalClaims: 0,
      judgeEnhanced: false,
      confusion: { tp: 0, fp: 0, fn: 0, tn: 0 },
    },
    // ADR-0035 D5: relation zone (observational parts only — fail-closed edge assertions already
    // land in passRate via the normal case channel).
    relation: (() => {
      let noEdgeChecks = 0, noEdgeViolations = 0, hopChecks = 0, hopHits = 0;
      const tel: RelTel = { ruleHits: 0, llmActivations: 0, llmFailures: 0, triplesWritten: 0, dedupSkipped: 0, relatedToWriteOnce: 0, schemaRejected: 0, armQueries: 0, armHits: 0, pendingEdges: 0 };
      for (let i = 0; i < cases.length; i++) {
        const res = results[i]!;
        if (res.relationTel) {
          for (const k of Object.keys(tel) as Array<keyof RelTel>) {
            if (k === "pendingEdges") continue; // gauge, not a counter
            tel[k] += res.relationTel[k];
          }
          tel.pendingEdges += res.relationTel.pendingEdges;
        }
        for (const [opIndex, op] of cases[i]!.ops.entries()) {
          const rec = res.ops.find((r) => r.op === opIndex);
          if (!rec) continue;
          if (op.op === "edge" && op.assert === "no_edge") {
            noEdgeChecks += 1;
            if (rec.noEdgeViolation) noEdgeViolations += 1;
          }
          if (op.op === "search" && op.expectHopTitle !== undefined) {
            hopChecks += 1;
            if (rec.hopHit) hopHits += 1;
          }
        }
      }
      return { noEdgeChecks, noEdgeViolations, hopChecks, hopHits, hopHitRate: hopChecks ? hopHits / hopChecks : 0, tel };
    })(),
    relationGain: rorDeltas.length + rorExcludedCount > 0
      ? { n: rorDeltas.length, excluded: rorExcludedCount, meanDelta: rorDeltas.length ? rorDeltas.reduce((a, b) => a + b, 0) / rorDeltas.length : 0, deltas: rorDeltas }
      : undefined,
    relationGainHoldout: rorHoldoutDeltas.length + rorHoldoutExcluded > 0
      ? { n: rorHoldoutDeltas.length, excluded: rorHoldoutExcluded, meanDelta: rorHoldoutDeltas.length ? rorHoldoutDeltas.reduce((a, b) => a + b, 0) / rorHoldoutDeltas.length : 0, deltas: rorHoldoutDeltas }
      : undefined,
    ndcg: (() => {
      const buckets: Record<string, number[]> = { "5": [], "10": [], "20": [] };
      for (const r of results) for (const rec of r.ops) if (rec.ndcg) { buckets["5"]!.push(rec.ndcg["5"] ?? 0); buckets["10"]!.push(rec.ndcg["10"] ?? 0); buckets["20"]!.push(rec.ndcg["20"] ?? 0); }
      const n = buckets["5"]!.length;
      if (!n) return undefined;
      const avg = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
      return { n, at5: avg(buckets["5"]!), at10: avg(buckets["10"]!), at20: avg(buckets["20"]!) };
    })(),
    // ADR-0037 D6: Phase-1 shadow telemetry (served must stay 0; fail-closed in the gate) and
    // forget lifecycle counters (exact dry-run predictions, restores).
    semantic: (() => {
      let queries = 0, hits = 0, served = 0;
      for (const r of results) if (r.semTel) { queries += r.semTel.queries; hits += r.semTel.hits; served += r.semTel.served; }
      return {
        queries, hits, served,
        regressions: semRegressions,
        ...(semDeltas.length > 0 ? { gain: { n: semDeltas.length, meanDelta: semDeltas.reduce((x, y) => x + y, 0) / semDeltas.length } } : {}),
      };
    })(),
    forget: (() => {
      let archiveChecks = 0, archives = 0, undoRestores = 0, dryRunExact = 0;
      for (let i = 0; i < cases.length; i++) {
        for (const [opIndex, op] of cases[i]!.ops.entries()) {
          const rec = results[i]!.ops.find((r) => r.op === opIndex);
          if (!rec) continue;
          if (op.op === "archive") { archiveChecks += 1; if (rec.ok) archives += 1; if (rec.dryRunExact) dryRunExact += 1; }
          if (op.op === "undoArchive" && rec.undoOk) undoRestores += 1;
        }
      }
      return { archiveChecks, archives, undoRestores, dryRunExact };
    })(),
    // ADR-0039 D1/D6/D7 + Acceptance E3: Observational zone. Pre-registered fields; skip
    // markers carry verbatim trigger quotes; values NEVER feed the gate (N1).
    observational: (() => {
      let evTotal = 0;
      const hist: Record<string, number> = {};
      for (const r of results) if (r.accessEvents) {
        evTotal += r.accessEvents.total;
        for (const [b, n] of Object.entries(r.accessEvents.histogram)) hist[b] = (hist[b] ?? 0) + n;
      }
      let archives = 0, undone = 0;
      for (let i = 0; i < cases.length; i++) {
        for (const [opIndex, op] of cases[i]!.ops.entries()) {
          const rec = results[i]!.ops.find((x) => x.op === opIndex);
          if (!rec) continue;
          if (op.op === "archive" && rec.ok) archives += 1;
          if (op.op === "undoArchive" && rec.undoOk) undone += 1;
        }
      }
      // D6 AND-gate evaluated against the eval corpus itself (golden cases are far below T1;
      // the failure strings are quoted verbatim into the skip reason by contract).
      const gate = evaluateTauFitGate({ activeRows: 0, fittableUnits: 0, psi: null, windowDays: 0, daysSinceLastFit: null });
      return {
        schema: "anysearch/observational@1" as const,
        dayBucketDefinition: dayBucketFingerprint(),
        accessAge: evTotal > 0 ? { status: "ok" as const, events: evTotal, histogram: hist } : skip("no access events observed in the eval run (goldens may predate the touch path)", "gate-not-met"),
        tauScan: skip("tau scan is offline-only via scripts/tau/tau-scan.mjs — zero contact with the eval runner / OF look ledger (ADR-0039 D3)", "offline-deferred"),
        bgnbd: skip("BG/NBD fit: " + gate.failures.join("; "), "gate-not-met"),
        revival: archives > 0
          ? { status: "ok" as const, archives, undone, undoneRate: undone / archives }
          : skip("no archive ops present in this eval run — revival main ratio is inert", "gate-not-met"),
        undoReentryEvents: skip("undo_reentry needs a 30-day post-undo window — outside the single-run eval horizon (observational sub-metric)", "offline-deferred"),
      };
    })(),
  };
}

export async function runAll(cases: CaseSpec[]): Promise<EvalReport> {
  const results: CaseResult[] = [];
  for (const c of cases) results.push(await runCase(c));
  const stageBreakdown: Record<EvalStage, number> = { extract: 0, adjudicate: 0, store: 0, retrieve: 0 };
  for (const r of results) if (r.failedStage) stageBreakdown[r.failedStage] += 1;
  // ADR-0028 D4: difficulty tier breakdown (report-only — never part of the gate).
  const tierBreakdown: Record<string, { cases: number; passed: number; passRate: number }> = {};
  for (const r of results) {
    const t = (tierBreakdown[r.difficulty] ??= { cases: 0, passed: 0, passRate: 0 });
    t.cases += 1;
    if (r.passed) t.passed += 1;
  }
  for (const t of Object.values(tierBreakdown)) t.passRate = t.cases ? t.passed / t.cases : 0;
  return {
    schema: "anysearch/eval-report@1",
    generatedAt: new Date().toISOString(),
    datasetFingerprint: datasetFingerprint(cases),
    holdoutFingerprint: holdoutFingerprint(),
    totals: { cases: results.length, passed: results.filter((r) => r.passed).length, failed: results.filter((r) => !r.passed).length },
    stageBreakdown,
    tierBreakdown,
    metrics: computeMetrics(cases, results),
    cases: results,
  };
}
