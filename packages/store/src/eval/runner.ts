// ADR-0027 D1/D2: deterministic lifecycle runner — extract stub (fixed inputs) ->
// adjudicate -> store -> retrieve, per-case isolated temp SQLite DB.
// Pure/deterministic only; LLM judge lives in scripts/eval-judge.mjs and never gates (D2).
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "../session-store";
import type { AdjudicationResultItem } from "../session-store";
import type { CaseSpec, EvalStage } from "./golden-cases";

export interface OpRecord {
  op: number;
  kind: string;
  stage: EvalStage;
  ok: boolean;
  detail: string;
  samples?: Array<{ title: string | null; snippet: string | null }>;
  // ADR-0028 D2/D4: rank-of-relevant + hit count feed MRR and the answerable false-refusal rate.
  rank?: number;
  hitCount?: number;
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
}

export interface EvalCounts {
  cases: number;
  casesPassed: number;
  supExpected: number;
  supPassed: number;
  fpEligible: number;
  fpCount: number;
}

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
  entityArm?: { queries: number; candidates: number; activations: number; hits: number; hitRate: number };
}

export interface EvalReport {
  schema: "anysearch/eval-report@1";
  generatedAt: string;
  datasetFingerprint: string;
  totals: { cases: number; passed: number; failed: number };
  stageBreakdown: Record<EvalStage, number>;
  // ADR-0028 D4: per-difficulty tier pass rates (report-only, never gated).
  tierBreakdown: Record<string, { cases: number; passed: number; passRate: number }>;
  metrics: EvalMetrics;
  cases: CaseResult[];
}

export function datasetFingerprint(cases: CaseSpec[]): string {
  return createHash("sha256").update(JSON.stringify(cases)).digest("hex").slice(0, 16);
}

const hitText = (h: { role?: unknown; content?: unknown }): string =>
  String(h.role ?? "") + " " + String(h.content ?? "");

export type StoreFactory = (dbPath: string) => SqliteSessionStore;

export async function runCase(spec: CaseSpec, makeStore: StoreFactory = (p) => new SqliteSessionStore(p)): Promise<CaseResult> {
  const tmpDir = mkdtempSync(join(tmpdir(), "ans-eval-"));
  const dbPath = join(tmpDir, "eval.db");
  const store = makeStore(dbPath);
  const raw = new Database(dbPath, { readonly: true });
  const ops: OpRecord[] = [];
  let sessionId = "";
  let entityArmSnapshot: { queries: number; candidates: number; activations: number; hits: number } | undefined;
  const adjResults: AdjudicationResultItem[][] = []; // stashed per adjudicate opIndex
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
            const fails: string[] = [];
            if (op.expectIncludesTitle && !texts.some((t) => t.includes(op.expectIncludesTitle!))) fails.push(`missing "${op.expectIncludesTitle}"`);
            if (op.expectExcludesTitle && texts.some((t) => t.includes(op.expectExcludesTitle!))) fails.push(`stale "${op.expectExcludesTitle}" still returned`);
            if (op.expectMaxCount !== undefined && hits.length > op.expectMaxCount) fails.push(hits.length + " hits > max " + op.expectMaxCount);
            if (op.expectEmpty === true && hits.length !== 0) fails.push(hits.length + " hit(s) returned, want 0 (expectEmpty)");
            // ADR-0028 D2: rank-of-relevant — 1-based position of the first hit containing the title (0 = absent).
            let rank: number | undefined;
            if (op.expectRankOf) {
              rank = texts.findIndex((t) => t.includes(op.expectRankOf!.title)) + 1;
              if (rank === 0) fails.push(`rank-of-relevant absent: "${op.expectRankOf.title}"`);
              else if (rank > op.expectRankOf.maxRank) fails.push(`rank ${rank} > maxRank ${op.expectRankOf.maxRank} for "${op.expectRankOf.title}"`);
            }
            mark({
              op: opIndex, kind: op.op, stage: op.stage, ok: fails.length === 0,
              detail: fails.length ? fails.join("; ") : hits.length + " hit(s)",
              samples: hits.slice(0, 2).map((h) => ({ title: (h as { role?: string }).role ?? null, snippet: String((h as { content?: string }).content ?? "").slice(0, 200) })),
              rank, hitCount: hits.length,
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
    raw.close();
    store.close();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
  return { id: spec.id, group: spec.group, difficulty: spec.difficulty ?? "core", passed: failedStage === null, failedStage, ops, entityArm: entityArmSnapshot };
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
  // expectEmpty op are the unanswerable slice and excluded from the denominator.
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
    const unanswerable = cases[i]!.ops.some((o) => o.op === "search" && o.expectEmpty === true);
    if (unanswerable) continue;
    for (const [opIndex, op] of cases[i]!.ops.entries()) {
      if (op.op !== "search" || !(op.expectIncludesTitle || op.expectRankOf)) continue;
      const rec = results[i]!.ops.find((r) => r.op === opIndex);
      if (rec) { frEligible += 1; if (rec.hitCount === 0) frCount += 1; }
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
      return { queries: q, candidates: c, activations: a, hits: h, hitRate: q ? a / q : 0 };
    })(),
    mrr: rrN ? rrSum / rrN : 1,
    answerableFalseRefusalRate: frEligible ? frCount / frEligible : 0,
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
    totals: { cases: results.length, passed: results.filter((r) => r.passed).length, failed: results.filter((r) => !r.passed).length },
    stageBreakdown,
    tierBreakdown,
    metrics: computeMetrics(cases, results),
    cases: results,
  };
}
