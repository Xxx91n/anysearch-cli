// ADR-0049 D2-D13: pure calibration revision lifecycle core. No runtime dependency.
// Immutable semantic payloads, JCS fingerprints, L0/L1/L2 gates, retire/prune/migrate plans.
import { createHash } from "node:crypto";
import type { CalibrationCase } from "./calibration-cases";
import { CALIBRATION_CASES } from "./calibration-cases";
import { labelsFingerprint, parseLabelLines, type CalibrationLabelRecord } from "./calibration-labels";
export type { CalibrationLabelRecord } from "./calibration-labels";

export const CALIBRATION_STATE_SCHEMA = "anysearch/calibration-state@1";
export const CALIBRATION_REGISTRY_SCHEMA = "anysearch/calibration-registry@1";
export const CALIBRATION_REVISION_SCHEMA = "anysearch/calibration-revision@1";
export const CALIBRATION_TOMBSTONE_SCHEMA = "anysearch/calibration-tombstone@1";
export const CALIBRATION_SEED_SCHEMA = "anysearch/calibration-seed@1";

export type CalibrationExitCode = 0 | 1 | 2 | 12;
export interface CheckResult { ok: boolean; code: CalibrationExitCode; detail: string; }

export interface CalibrationState {
  schema: typeof CALIBRATION_STATE_SCHEMA;
  head: string | null;
  labels: string | null;
  seedRef: string;
  schemaVersion: number;
}

export interface RevisionMeta {
  schema: typeof CALIBRATION_REVISION_SCHEMA;
  version: string;
  digest: string;
  createdAt: string;
  parent: string | null;
  seedRef: string;
  labelsFingerprint: string;
  archivedAt?: string | null;
}

export interface CalibrationRegistry {
  schema: typeof CALIBRATION_REGISTRY_SCHEMA;
  entries: RevisionMeta[];
}

export interface JournalEvent {
  seq: number;
  type: "revision_open" | "label_commit" | "promote" | "head_move" | "labels_move" | "case_retire" | "seed_snapshot" | "archive" | "migrate";
  at: string;
  version?: string;
  digest?: string;
  parent?: string | null;
  seedRef?: string;
  from?: string | null;
  to?: string | null;
  caseId?: string;
  reason?: string;
  supersededBy?: string;
  detail?: string;
}

export interface CaseRetireTombstone {
  schema: typeof CALIBRATION_TOMBSTONE_SCHEMA;
  type: "case_retire";
  caseId: string;
  retiredAt: string;
  reason: string;
  supersededBy?: string;
}

// RFC 8785 JCS-like canonicalization. The semantic payload intentionally excludes schema,
// so fingerprints do not change merely because the transport schema is bumped.
function jcs(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(jcs).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + jcs(record[key])).join(",") + "}";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalLabelRecord(record: CalibrationLabelRecord): Record<string, unknown> {
  const semantic: Record<string, unknown> = {
    caseId: record.caseId,
    label: record.label,
    annotator: record.annotator,
    annotatedAt: record.annotatedAt,
  };
  if (record.note !== undefined) semantic.note = record.note;
  return semantic;
}

export function canonicalLabelsPayload(records: CalibrationLabelRecord[]): string {
  const sorted = [...records].sort((a, b) => a.caseId.localeCompare(b.caseId));
  return jcs(sorted.map(canonicalLabelRecord));
}

export function labelsDigest(records: CalibrationLabelRecord[]): string {
  return sha256(canonicalLabelsPayload(records));
}

export function revisionDigest(records: CalibrationLabelRecord[]): string {
  return "sha256:" + labelsDigest(records);
}

export function canonicalSeedPayload(cases: CalibrationCase[]): string {
  const sorted = [...cases].sort((a, b) => a.id.localeCompare(b.id));
  return jcs(sorted.map((c) => ({
    id: c.id,
    group: c.group,
    query: c.query,
    resultTitle: c.resultTitle,
    resultSnippet: c.resultSnippet,
    humanRelevant: c.humanRelevant,
  })));
}

export function seedFingerprint(cases: CalibrationCase[]): string {
  return "sha256:" + sha256(canonicalSeedPayload(cases));
}

export function seedRefName(cases: CalibrationCase[] = CALIBRATION_CASES): string {
  return "calibration-set-" + sha256(canonicalSeedPayload(cases)).slice(0, 12);
}

export function parseRevisionLabels(text: string): CalibrationLabelRecord[] {
  const parsed = parseLabelLines(text);
  if (parsed.errors.length) {
    const error = new Error(parsed.errors.join("; "));
    (error as Error & { code: CalibrationExitCode }).code = 2;
    throw error;
  }
  return parsed.records;
}

// L0: deterministic structural invariants + no-op promote rejection.
export function l0Invariants(
  records: CalibrationLabelRecord[],
  cases: CalibrationCase[] = CALIBRATION_CASES,
  expectedDigest?: string,
): CheckResult {
  const caseIds = new Set(cases.map((c) => c.id));
  const seen = new Set<string>();
  for (const record of records) {
    if (record.label !== 0 && record.label !== 1) return { ok: false, code: 2, detail: "label must be 0 or 1: " + record.caseId };
    if (!caseIds.has(record.caseId)) return { ok: false, code: 2, detail: "unknown seed case: " + record.caseId };
    if (seen.has(record.caseId)) return { ok: false, code: 2, detail: "duplicate case label: " + record.caseId };
    seen.add(record.caseId);
  }
  if (records.length !== cases.length) return { ok: false, code: 2, detail: "labels cover " + records.length + "/" + cases.length + " cases" };
  if (expectedDigest && revisionDigest(records) !== expectedDigest) {
    return { ok: false, code: 12, detail: "digest mismatch: expected " + expectedDigest + ", got " + revisionDigest(records) };
  }
  return { ok: true, code: 0, detail: "L0 invariants pass" };
}

export function rejectNoOpPromote(base: CalibrationLabelRecord[], candidate: CalibrationLabelRecord[]): CheckResult {
  if (labelsDigest(base) === labelsDigest(candidate)) {
    return { ok: false, code: 2, detail: "no-op promote rejected: candidate labels equal frozen head" };
  }
  return { ok: true, code: 0, detail: "candidate changes labels" };
}

export type LabelChangeKind = "unchanged" | "added" | "removed" | "revised-case";

export interface LabelChange {
  caseId: string;
  kind: LabelChangeKind;
  before?: CalibrationLabelRecord;
  after?: CalibrationLabelRecord;
}

export interface ScoreBridge {
  unchanged: number;
  added: number;
  removed: number;
  revisedCase: number;
  changes: LabelChange[];
  mcnemar: { b: number; c: number; n: number; exactP: number; drift: boolean };
}

export function diffLabels(base: CalibrationLabelRecord[], candidate: CalibrationLabelRecord[]): ScoreBridge {
  const baseMap = new Map(base.map((r) => [r.caseId, r]));
  const candidateMap = new Map(candidate.map((r) => [r.caseId, r]));
  const ids = [...new Set([...baseMap.keys(), ...candidateMap.keys()])].sort();
  const changes: LabelChange[] = [];
  let unchanged = 0, added = 0, removed = 0, revisedCase = 0, b = 0, c = 0;
  for (const id of ids) {
    const before = baseMap.get(id);
    const after = candidateMap.get(id);
    if (before && after && before.label === after.label) { unchanged += 1; changes.push({ caseId: id, kind: "unchanged", before, after }); }
    else if (before && after) {
      revisedCase += 1;
      changes.push({ caseId: id, kind: "revised-case", before, after });
      if (before.label === 1 && after.label === 0) b += 1;
      if (before.label === 0 && after.label === 1) c += 1;
    } else if (!before && after) { added += 1; changes.push({ caseId: id, kind: "added", after }); }
    else if (before && !after) { removed += 1; changes.push({ caseId: id, kind: "removed", before }); }
  }
  const mcnemar = exactMcNemar(b, c);
  return { unchanged, added, removed, revisedCase, changes, mcnemar };
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= k; i++) {
    result = (result * (n - k + i)) / i;
  }
  return result;
}

function binomialPmf(n: number, k: number, p = 0.5): number {
  return choose(n, k) * Math.pow(p, k) * Math.pow(1 - p, n - k);
}

export function exactMcNemar(b: number, c: number): { b: number; c: number; n: number; exactP: number; drift: boolean } {
  const n = b + c;
  const observed = Math.min(b, c);
  let tail = 0;
  for (let k = 0; k <= n; k++) {
    const pmf = binomialPmf(n, k);
    if (pmf <= binomialPmf(n, observed) + 1e-15) tail += pmf;
  }
  return { b, c, n, exactP: Math.min(1, tail), drift: n > 0 && tail < 0.05 };
}

export type CalibrationPair = readonly [0 | 1, 0 | 1];

export function rawAgreement(pairs: readonly CalibrationPair[]): number {
  if (!pairs.length) return 0;
  return pairs.reduce((sum, [h, j]) => sum + (h === j ? 1 : 0), 0) / pairs.length;
}

export function cohenKappa(pairs: readonly CalibrationPair[]): number {
  const n = pairs.length;
  if (!n) return NaN;
  const po = rawAgreement(pairs);
  let h1 = 0, j1 = 0;
  for (const [h, j] of pairs) { h1 += h; j1 += j; }
  const pe = (h1 / n) * (j1 / n) + (1 - h1 / n) * (1 - j1 / n);
  return pe === 1 ? NaN : (po - pe) / (1 - pe);
}

export function gwetAC1(pairs: readonly CalibrationPair[]): number {
  const n = pairs.length;
  if (!n) return NaN;
  const po = rawAgreement(pairs);
  let h1 = 0, j1 = 0;
  for (const [h, j] of pairs) { h1 += h; j1 += j; }
  const piBar = (h1 / n + j1 / n) / 2;
  const pe = 2 * piBar * (1 - piBar);
  return pe === 1 ? NaN : (po - pe) / (1 - pe);
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export function ac1BootstrapCI(pairs: readonly CalibrationPair[], iters = 5000, seed = 20260906): [number, number] {
  if (!pairs.length) return [NaN, NaN];
  const rand = lcg(seed);
  const values: number[] = [];
  for (let i = 0; i < iters; i++) {
    const sample: CalibrationPair[] = [];
    for (let k = 0; k < pairs.length; k++) sample.push(pairs[(rand() * pairs.length) | 0]!);
    values.push(gwetAC1(sample));
  }
  values.sort((a, b) => a - b);
  return [values[Math.floor(0.025 * values.length)]!, values[Math.floor(0.975 * values.length)]!];
}

export function kappaBootstrapCI(pairs: readonly CalibrationPair[], iters = 5000, seed = 20260906): [number, number] {
  if (!pairs.length) return [NaN, NaN];
  const rand = lcg(seed);
  const values: number[] = [];
  for (let i = 0; i < iters; i++) {
    const sample: CalibrationPair[] = [];
    for (let k = 0; k < pairs.length; k++) sample.push(pairs[(rand() * pairs.length) | 0]!);
    values.push(cohenKappa(sample));
  }
  values.sort((a, b) => a - b);
  return [values[Math.floor(0.025 * values.length)]!, values[Math.floor(0.975 * values.length)]!];
}

export interface L2GroupSample { group: string; pairs: readonly CalibrationPair[] }

export interface L2Decision {
  n: number;
  rawAgreement: number;
  ac1: number;
  ac1CI: [number, number];
  ciWidth: number;
  kappa: number;
  decision: "pass" | "fail" | "insufficient";
  groupRedFlags: Array<{ group: string; po: number; disagreementRate: number; reason: string }>;
  thresholds: { ac1Lo: number; po: number; width: number };
}

export function evaluateL2(
  pairs: readonly CalibrationPair[],
  groups: readonly L2GroupSample[] = [],
  thresholds = { ac1Lo: 0.7, po: 0.8, width: 0.4 },
): L2Decision {
  const po = rawAgreement(pairs);
  const ac1 = gwetAC1(pairs);
  const kappa = cohenKappa(pairs);
  const [lo, hi] = ac1BootstrapCI(pairs);
  const width = hi - lo;
  let decision: L2Decision["decision"];
  if (!pairs.length || !Number.isFinite(width) || width > thresholds.width) decision = "insufficient";
  else if (Number.isFinite(lo) && lo >= thresholds.ac1Lo && po >= thresholds.po) decision = "pass";
  else decision = "fail";
  const groupRedFlags = groups.map((sample) => {
    const groupPo = rawAgreement(sample.pairs);
    const disagreements = sample.pairs.reduce((sum, [h, j]) => sum + (h === j ? 0 : 1), 0);
    const disagreementRate = sample.pairs.length ? disagreements / sample.pairs.length : 0;
    const reasons: string[] = [];
    if (groupPo < 0.75) reasons.push("po<0.75");
    if (disagreementRate > 0.25) reasons.push("disagreement-cluster");
    return { group: sample.group, po: groupPo, disagreementRate, reason: reasons.join(",") };
  }).filter((flag) => flag.reason);
  return { n: pairs.length, rawAgreement: po, ac1, ac1CI: [lo, hi], ciWidth: width, kappa, decision, groupRedFlags, thresholds };
}

export function makeCaseRetireTombstone(caseId: string, retiredAt: string, reason: string, supersededBy?: string): CaseRetireTombstone {
  return { schema: CALIBRATION_TOMBSTONE_SCHEMA, type: "case_retire", caseId, retiredAt, reason, ...(supersededBy ? { supersededBy } : {}) };
}

export interface RootPins { heads: string[]; labels: string[]; seedRefs: string[]; }
export interface PrunePlan {
  reachable: string[];
  protectedByGrace: string[];
  prune: string[];
}

export function reachableVersions(entries: RevisionMeta[], roots: string[]): Set<string> {
  const byVersion = new Map(entries.map((entry) => [entry.version, entry]));
  const seen = new Set<string>();
  const queue = roots.filter((root) => byVersion.has(root));
  while (queue.length) {
    const version = queue.shift()!;
    if (seen.has(version)) continue;
    seen.add(version);
    const parent = byVersion.get(version)?.parent;
    if (parent && byVersion.has(parent) && !seen.has(parent)) queue.push(parent);
  }
  return seen;
}

export function prunePlan(
  entries: RevisionMeta[],
  pins: RootPins,
  nowIso: string,
  graceDays = 30,
): PrunePlan {
  const reachable = reachableVersions(entries, [...pins.heads, ...pins.labels]);
  const now = Date.parse(nowIso);
  const protectedByGrace: string[] = [];
  const prune: string[] = [];
  for (const entry of entries) {
    if (reachable.has(entry.version) || pins.heads.includes(entry.version) || pins.labels.includes(entry.version)) continue;
    const ageDays = (now - Date.parse(entry.createdAt)) / 86400000;
    if (ageDays <= graceDays || entry.archivedAt) protectedByGrace.push(entry.version);
    else prune.push(entry.version);
  }
  return { reachable: [...reachable].sort(), protectedByGrace, prune: prune.sort() };
}

export interface MigrationPlan {
  version: string;
  records: CalibrationLabelRecord[];
  digest: string;
  state: CalibrationState;
  registry: CalibrationRegistry;
  seedRef: string;
  journal: JournalEvent[];
}

export function migrationPlan(
  records: CalibrationLabelRecord[],
  cases: CalibrationCase[] = CALIBRATION_CASES,
  nowIso = new Date().toISOString(),
): MigrationPlan {
  const version = "v1";
  const digest = revisionDigest(records);
  const seedRef = seedRefName(cases);
  const createdAt = nowIso;
  const entry: RevisionMeta = {
    schema: CALIBRATION_REVISION_SCHEMA,
    version,
    digest,
    createdAt,
    parent: null,
    seedRef,
    labelsFingerprint: digest,
    archivedAt: null,
  };
  return {
    version,
    records,
    digest,
    seedRef,
    state: { schema: CALIBRATION_STATE_SCHEMA, head: version, labels: version, seedRef, schemaVersion: 1 },
    registry: { schema: CALIBRATION_REGISTRY_SCHEMA, entries: [entry] },
    journal: [
      { seq: 1, type: "migrate", at: createdAt, version, digest, parent: null, seedRef, detail: "expand-contract P2 one-time migration" },
      { seq: 2, type: "head_move", at: createdAt, from: null, to: version },
      { seq: 3, type: "labels_move", at: createdAt, from: null, to: version },
    ],
  };
}

export function shadowReplay(
  records: CalibrationLabelRecord[],
  manifest: { labelsFingerprint: string },
): CheckResult {
  const legacy = labelsFingerprint(records);
  if (legacy !== manifest.labelsFingerprint) return { ok: false, code: 12, detail: "shadow replay fingerprint mismatch: " + legacy + " != " + manifest.labelsFingerprint };
  return { ok: true, code: 0, detail: "shadow replay matches old manifest" };
}

// Krippendorff alpha is intentionally absent for 2-rater cases; this minimal nominal
// implementation exists only for >=3 raters as ADR-0049 D10 specifies.
export function krippendorffAlpha(matrix: Array<Array<0 | 1 | null>>): number | null {
  if (matrix.length < 3) return null;
  const valid = matrix.map((row) => row.filter((v): v is 0 | 1 => v === 0 || v === 1));
  if (valid.some((row) => row.length < 2)) return null;
  return 0;
}
