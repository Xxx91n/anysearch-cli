// ADR-0048 D2/D3: pure calibration-label lifecycle core. It owns the JSONL
// record model, the case/labels fingerprints, and promote preconditions.
// It never reads the golden gate baseline and never mutates golden cases.
import { createHash } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import { CALIBRATION_CASES, calibrationHash, type CalibrationCase } from "./calibration-cases";
import {
  CalibrationLabelRecordSchema,
  CalibrationManifestSchema,
  type CalibrationLabelRecord,
  type CalibrationManifest,
} from "./calibration-labels-schema";

export type { CalibrationLabelRecord, CalibrationManifest } from "./calibration-labels-schema";

function sha1(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

export function caseFingerprint(cases: CalibrationCase[] = CALIBRATION_CASES): string {
  return calibrationHash(cases);
}

function canonicalLabels(records: CalibrationLabelRecord[]): string {
  const sorted = [...records].sort((a, b) => a.caseId.localeCompare(b.caseId));
  return sorted
    .map((record) =>
      [record.caseId, String(record.label), record.annotator, record.annotatedAt, record.note ?? ""].join("\t"),
    )
    .join("\n");
}

export function labelsFingerprint(records: CalibrationLabelRecord[]): string {
  return sha1(canonicalLabels(records));
}

export interface LabelParseResult {
  records: CalibrationLabelRecord[];
  errors: string[];
}

export function parseLabelLine(line: string, lineNumber: number): LabelParseResult {
  if (line.trim() === "") return { records: [], errors: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    return { records: [], errors: ["line " + lineNumber + ": invalid JSON: " + String(error && (error as Error).message)] };
  }
  if (!Value.Check(CalibrationLabelRecordSchema, parsed)) {
    return { records: [], errors: ["line " + lineNumber + ": schema mismatch: " + JSON.stringify(parsed)] };
  }
  return { records: [parsed as CalibrationLabelRecord], errors: [] };
}

export function parseLabelLines(text: string): LabelParseResult {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const records: CalibrationLabelRecord[] = [];
  const errors: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const result = parseLabelLine(lines[i]!, i + 1);
    records.push(...result.records);
    errors.push(...result.errors);
  }
  return { records, errors };
}

export function parseManifest(text: string): { manifest: CalibrationManifest | null; error: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { manifest: null, error: "manifest is invalid JSON: " + String(error && (error as Error).message) };
  }
  if (!Value.Check(CalibrationManifestSchema, parsed)) {
    return { manifest: null, error: "manifest schema mismatch: " + JSON.stringify(parsed) };
  }
  return { manifest: parsed as CalibrationManifest, error: null };
}

export interface ValidationResult {
  ok: boolean;
  code: 0 | 2 | 12;
  detail: string;
}

export interface MutationResult {
  ok: boolean;
  code: 0 | 2 | 12;
  detail: string;
  records?: CalibrationLabelRecord[];
}

export function validateCalibrationState(
  records: CalibrationLabelRecord[],
  manifest: CalibrationManifest,
  cases: CalibrationCase[] = CALIBRATION_CASES,
): ValidationResult {
  const seen = new Set<string>();
  const caseIds = new Set(cases.map((item) => item.id));
  const annotators = new Set<string>();
  let latestAnnotatedAt: string | null = null;

  for (const record of records) {
    if (!Value.Check(CalibrationLabelRecordSchema, record)) {
      return { ok: false, code: 2, detail: "label record failed schema validation: " + JSON.stringify(record) };
    }
    if (seen.has(record.caseId)) {
      return { ok: false, code: 2, detail: "duplicate label for case " + record.caseId };
    }
    if (!caseIds.has(record.caseId)) {
      return { ok: false, code: 2, detail: "label references unknown seed case " + record.caseId };
    }
    seen.add(record.caseId);
    annotators.add(record.annotator);
    if (!latestAnnotatedAt || record.annotatedAt > latestAnnotatedAt) latestAnnotatedAt = record.annotatedAt;
  }

  if (manifest.caseFingerprint !== caseFingerprint(cases)) {
    return {
      ok: false,
      code: 12,
      detail: "manifest caseFingerprint " + manifest.caseFingerprint + " != seed " + caseFingerprint(cases),
    };
  }

  const computedLabelsFingerprint = labelsFingerprint(records);
  if (manifest.labelsFingerprint !== computedLabelsFingerprint) {
    return {
      ok: false,
      code: 12,
      detail: "manifest labelsFingerprint " + manifest.labelsFingerprint + " != labels " + computedLabelsFingerprint,
    };
  }

  const manifestAnnotators = [...manifest.annotators].sort();
  const computedAnnotators = [...annotators].sort();
  if (manifestAnnotators.join("\n") !== computedAnnotators.join("\n")) {
    return { ok: false, code: 2, detail: "manifest annotators do not match label records" };
  }

  if (manifest.annotatedAt !== latestAnnotatedAt) {
    return { ok: false, code: 2, detail: "manifest annotatedAt does not match latest label record" };
  }

  const promoted = manifest.promotedVersion !== null || manifest.promotedAt !== null || manifest.promotedFingerprint !== null;
  if (promoted) {
    if (manifest.promotedVersion === null || manifest.promotedAt === null || manifest.promotedFingerprint === null) {
      return { ok: false, code: 2, detail: "partial promote state in manifest" };
    }
    if (manifest.promotedFingerprint !== computedLabelsFingerprint) {
      return { ok: false, code: 12, detail: "promoted fingerprint does not match current label set" };
    }
  }

  return { ok: true, code: 0, detail: "calibration labels and manifest are consistent" };
}

export function addLabel(
  records: CalibrationLabelRecord[],
  next: CalibrationLabelRecord,
  cases: CalibrationCase[] = CALIBRATION_CASES,
): MutationResult {
  if (!cases.some((item) => item.id === next.caseId)) {
    return { ok: false, code: 2, detail: "label references unknown seed case " + next.caseId };
  }
  if (records.some((record) => record.caseId === next.caseId)) {
    return { ok: false, code: 2, detail: "case already has a label: " + next.caseId };
  }
  return { ok: true, code: 0, detail: "added label for " + next.caseId, records: [...records, next] };
}

export function setLabel(
  records: CalibrationLabelRecord[],
  next: CalibrationLabelRecord,
  cases: CalibrationCase[] = CALIBRATION_CASES,
): MutationResult {
  if (!cases.some((item) => item.id === next.caseId)) {
    return { ok: false, code: 2, detail: "label references unknown seed case " + next.caseId };
  }
  const index = records.findIndex((record) => record.caseId === next.caseId);
  const nextRecords = index < 0 ? [...records, next] : records.map((record, i) => (i === index ? next : record));
  return { ok: true, code: 0, detail: "set label for " + next.caseId, records: nextRecords };
}

export function removeLabel(
  records: CalibrationLabelRecord[],
  caseId: string,
  cases: CalibrationCase[] = CALIBRATION_CASES,
): MutationResult {
  if (!cases.some((item) => item.id === caseId)) {
    return { ok: false, code: 2, detail: "label references unknown seed case " + caseId };
  }
  const index = records.findIndex((record) => record.caseId === caseId);
  if (index < 0) return { ok: false, code: 2, detail: "no label for case " + caseId };
  return {
    ok: true,
    code: 0,
    detail: "removed label for " + caseId,
    records: records.filter((_, i) => i !== index),
  };
}

export function buildManifest(
  records: CalibrationLabelRecord[],
  cases: CalibrationCase[] = CALIBRATION_CASES,
  note?: string,
): CalibrationManifest {
  const annotators = [...new Set(records.map((record) => record.annotator))].sort();
  const annotatedAt = records.length
    ? records.reduce((latest, record) => (record.annotatedAt > latest ? record.annotatedAt : latest), records[0]!.annotatedAt)
    : null;
  return {
    schema: "anysearch/calibration-manifest@1",
    caseFingerprint: caseFingerprint(cases),
    labelsFingerprint: labelsFingerprint(records),
    annotators,
    annotatedAt,
    promotedVersion: null,
    promotedAt: null,
    promotedFingerprint: null,
    ...(note ? { note } : {}),
  };
}

export function promoteLabels(
  records: CalibrationLabelRecord[],
  manifest: CalibrationManifest,
  promotedAt: string,
  cases: CalibrationCase[] = CALIBRATION_CASES,
): { ok: boolean; code: 0 | 2 | 12; detail: string; manifest?: CalibrationManifest } {
  const validated = validateCalibrationState(records, manifest, cases);
  if (!validated.ok) return validated;
  if (records.length !== cases.length) {
    return {
      ok: false,
      code: 2,
      detail: "cannot promote: labeled " + records.length + "/" + cases.length + " seed cases",
    };
  }
  const nextVersion = (manifest.promotedVersion ?? 0) + 1;
  const base = buildManifest(records, cases, manifest.note);
  const next: CalibrationManifest = {
    ...base,
    promotedVersion: nextVersion,
    promotedAt,
    promotedFingerprint: labelsFingerprint(records),
  };
  return { ok: true, code: 0, detail: "promoted calibration label set to version " + nextVersion, manifest: next };
}

export function labeledCalibrationCases(
  cases: CalibrationCase[],
  records: CalibrationLabelRecord[],
): CalibrationCase[] {
  const labels = new Map(records.map((record) => [record.caseId, record.label]));
  return cases.map((item) =>
    item.humanRelevant === 0 || item.humanRelevant === 1
      ? item
      : { ...item, humanRelevant: labels.get(item.id) ?? item.humanRelevant },
  );
}
