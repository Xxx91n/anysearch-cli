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
}

export interface CaseResult {
  id: string;
  group: CaseSpec["group"];
  passed: boolean;
  failedStage: EvalStage | null;
  ops: OpRecord[];
}

export interface EvalMetrics {
  passRate: number;
  supersessionSuccess: number;
  quarantineFalsePositiveRate: number;
}

export interface EvalReport {
  schema: "anysearch/eval-report@1";
  generatedAt: string;
  datasetFingerprint: string;
  totals: { cases: number; passed: number; failed: number };
  stageBreakdown: Record<EvalStage, number>;
  metrics: EvalMetrics;
  cases: CaseResult[];
}

export function datasetFingerprint(cases: CaseSpec[]): string {
  return createHash("sha256").update(JSON.stringify(cases)).digest("hex").slice(0, 16);
}

const hitText = (h: { role?: unknown; content?: unknown }): string =>
  String(h.role ?? "") + " " + String(h.content ?? "");

export async function runCase(spec: CaseSpec): Promise<CaseResult> {
  const tmpDir = mkdtempSync(join(tmpdir(), "ans-eval-"));
  const dbPath = join(tmpDir, "eval.db");
  const store = new SqliteSessionStore(dbPath);
  const raw = new Database(dbPath, { readonly: true });
  const ops: OpRecord[] = [];
  const adjResults: AdjudicationResultItem[][] = []; // stashed per adjudicate opIndex
  let failedStage: EvalStage | null = null;
  const mark = (rec: OpRecord) => {
    ops.push(rec);
    if (!rec.ok && failedStage === null) failedStage = rec.stage;
  };
  try {
    const session = await store.createSession("eval");
    for (const [opIndex, op] of spec.ops.entries()) {
      try {
        switch (op.op) {
          case "adjudicate": {
            const res = await store.adjudicateMemory(session.id, op.items);
            adjResults[opIndex] = res;
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
            mark({
              op: opIndex, kind: op.op, stage: op.stage, ok: fails.length === 0,
              detail: fails.length ? fails.join("; ") : hits.length + " hit(s)",
              samples: hits.slice(0, 2).map((h) => ({ title: (h as { role?: string }).role ?? null, snippet: String((h as { content?: string }).content ?? "").slice(0, 200) })),
            });
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
    raw.close();
    store.close();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
  return { id: spec.id, group: spec.group, passed: failedStage === null, failedStage, ops };
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
  return {
    passRate: results.length ? passed / results.length : 0,
    supersessionSuccess: supExpected ? supPassed / supExpected : 1,
    quarantineFalsePositiveRate: fpEligible ? fpCount / fpEligible : 0,
  };
}

export async function runAll(cases: CaseSpec[]): Promise<EvalReport> {
  const results: CaseResult[] = [];
  for (const c of cases) results.push(await runCase(c));
  const stageBreakdown: Record<EvalStage, number> = { extract: 0, adjudicate: 0, store: 0, retrieve: 0 };
  for (const r of results) if (r.failedStage) stageBreakdown[r.failedStage] += 1;
  return {
    schema: "anysearch/eval-report@1",
    generatedAt: new Date().toISOString(),
    datasetFingerprint: datasetFingerprint(cases),
    totals: { cases: results.length, passed: results.filter((r) => r.passed).length, failed: results.filter((r) => !r.passed).length },
    stageBreakdown,
    metrics: computeMetrics(cases, results),
    cases: results,
  };
}
