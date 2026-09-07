// ADR-0050 D3/D4: independent attribution-gold binary claim label line.
// The AIS semantic label is collected first; uncertain records are excluded
// from beta fitting and only enter the coverage denominator.

import { createHash } from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const ATTRIBUTION_GOLD_LINE = "attribution-gold";
export const ATTRIBUTION_GOLD_LABEL_SCHEMA = "anysearch/attribution-gold-label@1";
export const ATTRIBUTION_GOLD_MANIFEST_SCHEMA = "anysearch/attribution-gold-manifest@1";
export const ATTRIBUTION_GOLD_SAMPLE_SCHEMA = "anysearch/attribution-gold-sample@1";

const isoDateTime = () => Type.String({ minLength: 20 });

export const AttributionGoldSampleSchema = Type.Object(
  {
    schema: Type.Literal(ATTRIBUTION_GOLD_SAMPLE_SCHEMA),
    claimId: Type.String({ minLength: 1 }),
    claimText: Type.String({ minLength: 1 }),
    fusedScore: Type.Number({ minimum: 0, maximum: 1 }),
  },
  { additionalProperties: false },
);

export type AttributionGoldSample = Static<typeof AttributionGoldSampleSchema>;

export const AttributionGoldLabelSchema = Type.Object(
  {
    schema: Type.Literal(ATTRIBUTION_GOLD_LABEL_SCHEMA),
    claimId: Type.String({ minLength: 1 }),
    aisLabel: Type.Union([
      Type.Literal("supported"),
      Type.Literal("uncertain"),
      Type.Literal("unsupported"),
    ]),
    annotator: Type.String({ minLength: 1 }),
    annotatedAt: isoDateTime(),
    batchId: Type.String({ minLength: 1 }),
    note: Type.Optional(Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);

export type AttributionGoldLabel = Static<typeof AttributionGoldLabelSchema>;

export const AttributionGoldManifestSchema = Type.Object(
  {
    schema: Type.Literal(ATTRIBUTION_GOLD_MANIFEST_SCHEMA),
    line: Type.Literal(ATTRIBUTION_GOLD_LINE),
    sampleFingerprint: Type.String({ minLength: 16, maxLength: 16 }),
    labelsFingerprint: Type.String({ minLength: 16, maxLength: 16 }),
    rubricHash: Type.String({ minLength: 16, maxLength: 16 }),
    annotators: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
    annotatedAt: Type.Union([isoDateTime(), Type.Null()]),
    promotedVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    promotedAt: Type.Union([isoDateTime(), Type.Null()]),
    promotedFingerprint: Type.Union([Type.String({ minLength: 16, maxLength: 16 }), Type.Null()]),
    note: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type AttributionGoldManifest = Static<typeof AttributionGoldManifestSchema>;

function sha1(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function jcs(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(jcs).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + jcs(record[key])).join(",") + "}";
}

function canonicalSample(sample: AttributionGoldSample): Record<string, unknown> {
  return { claimId: sample.claimId, claimText: sample.claimText, fusedScore: sample.fusedScore };
}

function canonicalLabel(label: AttributionGoldLabel): Record<string, unknown> {
  const semantic: Record<string, unknown> = {
    claimId: label.claimId,
    aisLabel: label.aisLabel,
    annotator: label.annotator,
    annotatedAt: label.annotatedAt,
    batchId: label.batchId,
  };
  if (label.note !== undefined) semantic.note = label.note;
  return semantic;
}

export function sampleFingerprint(samples: AttributionGoldSample[]): string {
  return sha1(jcs([...samples].sort((a, b) => a.claimId.localeCompare(b.claimId)).map(canonicalSample)));
}

export function labelsFingerprint(labels: AttributionGoldLabel[]): string {
  return sha1(jcs([...labels].sort((a, b) => a.claimId.localeCompare(b.claimId)).map(canonicalLabel)));
}

export function attributionGoldDigest(labels: AttributionGoldLabel[]): string {
  return "sha256:" + sha256(jcs([...labels].sort((a, b) => a.claimId.localeCompare(b.claimId)).map(canonicalLabel)));
}

export function parseSampleLine(line: string, lineNumber: number): { sample: AttributionGoldSample | null; error: string | null } {
  if (line.trim() === "") return { sample: null, error: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    return { sample: null, error: "line " + lineNumber + ": invalid JSON: " + String(error && (error as Error).message) };
  }
  if (!Value.Check(AttributionGoldSampleSchema, parsed)) {
    return { sample: null, error: "line " + lineNumber + ": schema mismatch: " + JSON.stringify(parsed) };
  }
  return { sample: parsed as AttributionGoldSample, error: null };
}

export function parseSampleLines(text: string): { samples: AttributionGoldSample[]; errors: string[] } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const samples: AttributionGoldSample[] = [];
  const errors: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const result = parseSampleLine(lines[i]!, i + 1);
    if (result.sample) samples.push(result.sample);
    if (result.error) errors.push(result.error);
  }
  return { samples, errors };
}

export function parseLabelLine(line: string, lineNumber: number): { label: AttributionGoldLabel | null; error: string | null } {
  if (line.trim() === "") return { label: null, error: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    return { label: null, error: "line " + lineNumber + ": invalid JSON: " + String(error && (error as Error).message) };
  }
  if (!Value.Check(AttributionGoldLabelSchema, parsed)) {
    return { label: null, error: "line " + lineNumber + ": schema mismatch: " + JSON.stringify(parsed) };
  }
  return { label: parsed as AttributionGoldLabel, error: null };
}

export function parseLabelLines(text: string): { labels: AttributionGoldLabel[]; errors: string[] } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const labels: AttributionGoldLabel[] = [];
  const errors: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const result = parseLabelLine(lines[i]!, i + 1);
    if (result.label) labels.push(result.label);
    if (result.error) errors.push(result.error);
  }
  return { labels, errors };
}

export function parseManifest(text: string): { manifest: AttributionGoldManifest | null; error: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { manifest: null, error: "manifest is invalid JSON: " + String(error && (error as Error).message) };
  }
  if (!Value.Check(AttributionGoldManifestSchema, parsed)) {
    return { manifest: null, error: "manifest schema mismatch: " + JSON.stringify(parsed) };
  }
  return { manifest: parsed as AttributionGoldManifest, error: null };
}

export interface ValidationResult {
  ok: boolean;
  code: 0 | 2 | 12;
  detail: string;
}

export function validateState(
  samples: AttributionGoldSample[],
  labels: AttributionGoldLabel[],
  manifest: AttributionGoldManifest,
  rubricHash: string,
): ValidationResult {
  const sampleIds = new Set(samples.map((sample) => sample.claimId));
  const seen = new Set<string>();
  const annotators = new Set<string>();
  let latestAnnotatedAt: string | null = null;

  if (samples.length !== sampleIds.size) return { ok: false, code: 2, detail: "duplicate sample claimId" };
  for (const sample of samples) {
    if (!Value.Check(AttributionGoldSampleSchema, sample)) {
      return { ok: false, code: 2, detail: "sample schema mismatch: " + JSON.stringify(sample) };
    }
  }

  for (const label of labels) {
    if (!Value.Check(AttributionGoldLabelSchema, label)) {
      return { ok: false, code: 2, detail: "label schema mismatch: " + JSON.stringify(label) };
    }
    if (!sampleIds.has(label.claimId)) return { ok: false, code: 2, detail: "label references unknown sample " + label.claimId };
    if (seen.has(label.claimId)) return { ok: false, code: 2, detail: "duplicate label for " + label.claimId };
    seen.add(label.claimId);
    annotators.add(label.annotator);
    if (!latestAnnotatedAt || label.annotatedAt > latestAnnotatedAt) latestAnnotatedAt = label.annotatedAt;
  }

  if (manifest.sampleFingerprint !== sampleFingerprint(samples)) {
    return { ok: false, code: 12, detail: "manifest sampleFingerprint mismatch" };
  }
  if (manifest.labelsFingerprint !== labelsFingerprint(labels)) {
    return { ok: false, code: 12, detail: "manifest labelsFingerprint mismatch" };
  }
  if (manifest.rubricHash !== rubricHash) return { ok: false, code: 12, detail: "rubric hash mismatch" };
  if ([...annotators].sort().join("\n") !== [...manifest.annotators].sort().join("\n")) {
    return { ok: false, code: 2, detail: "manifest annotators do not match labels" };
  }
  if (manifest.annotatedAt !== latestAnnotatedAt) {
    return { ok: false, code: 2, detail: "manifest annotatedAt does not match labels" };
  }

  const promoted = manifest.promotedVersion !== null || manifest.promotedAt !== null || manifest.promotedFingerprint !== null;
  if (promoted && (manifest.promotedVersion === null || manifest.promotedAt === null || manifest.promotedFingerprint === null)) {
    return { ok: false, code: 2, detail: "partial promote state" };
  }
  if (manifest.promotedFingerprint !== null && manifest.promotedFingerprint !== labelsFingerprint(labels)) {
    return { ok: false, code: 12, detail: "promoted fingerprint does not match labels" };
  }
  return { ok: true, code: 0, detail: "attribution-gold labels and manifest are consistent" };
}

export function buildManifest(
  samples: AttributionGoldSample[],
  labels: AttributionGoldLabel[],
  rubricHash: string,
  note?: string,
): AttributionGoldManifest {
  const annotators = [...new Set(labels.map((label) => label.annotator))].sort();
  const annotatedAt = labels.length
    ? labels.reduce((latest, label) => (label.annotatedAt > latest ? label.annotatedAt : latest), labels[0]!.annotatedAt)
    : null;
  return {
    schema: ATTRIBUTION_GOLD_MANIFEST_SCHEMA,
    line: ATTRIBUTION_GOLD_LINE,
    sampleFingerprint: sampleFingerprint(samples),
    labelsFingerprint: labelsFingerprint(labels),
    rubricHash,
    annotators,
    annotatedAt,
    promotedVersion: null,
    promotedAt: null,
    promotedFingerprint: null,
    ...(note ? { note } : {}),
  };
}

export function addLabel(
  labels: AttributionGoldLabel[],
  next: AttributionGoldLabel,
  samples: AttributionGoldSample[],
): { ok: boolean; code: 0 | 2; detail: string; labels?: AttributionGoldLabel[] } {
  if (!samples.some((sample) => sample.claimId === next.claimId)) {
    return { ok: false, code: 2, detail: "label references unknown sample " + next.claimId };
  }
  if (labels.some((label) => label.claimId === next.claimId)) {
    return { ok: false, code: 2, detail: "sample already has a label: " + next.claimId };
  }
  return { ok: true, code: 0, detail: "added label for " + next.claimId, labels: [...labels, next] };
}

export function setLabel(
  labels: AttributionGoldLabel[],
  next: AttributionGoldLabel,
  samples: AttributionGoldSample[],
): { ok: boolean; code: 0 | 2; detail: string; labels?: AttributionGoldLabel[] } {
  if (!samples.some((sample) => sample.claimId === next.claimId)) {
    return { ok: false, code: 2, detail: "label references unknown sample " + next.claimId };
  }
  const index = labels.findIndex((label) => label.claimId === next.claimId);
  return {
    ok: true,
    code: 0,
    detail: "set label for " + next.claimId,
    labels: index < 0 ? [...labels, next] : labels.map((label, i) => (i === index ? next : label)),
  };
}

export function removeLabel(
  labels: AttributionGoldLabel[],
  claimId: string,
  samples: AttributionGoldSample[],
): { ok: boolean; code: 0 | 2; detail: string; labels?: AttributionGoldLabel[] } {
  if (!samples.some((sample) => sample.claimId === claimId)) {
    return { ok: false, code: 2, detail: "label references unknown sample " + claimId };
  }
  if (!labels.some((label) => label.claimId === claimId)) {
    return { ok: false, code: 2, detail: "no label for " + claimId };
  }
  return { ok: true, code: 0, detail: "removed label for " + claimId, labels: labels.filter((label) => label.claimId !== claimId) };
}

export function binaryFitSamples(samples: AttributionGoldSample[], labels: AttributionGoldLabel[]): {
  fit: Array<{ claimId: string; score: number; label: 0 | 1 }>;
  uncertain: number;
  coverage: number;
} {
  const byId = new Map(samples.map((sample) => [sample.claimId, sample]));
  const labelById = new Map(labels.map((label) => [label.claimId, label]));
  const fit: Array<{ claimId: string; score: number; label: 0 | 1 }> = [];
  let uncertain = 0;
  for (const sample of samples) {
    const label = labelById.get(sample.claimId);
    if (!label) continue;
    if (label.aisLabel === "supported") fit.push({ claimId: sample.claimId, score: sample.fusedScore, label: 1 });
    else if (label.aisLabel === "unsupported") fit.push({ claimId: sample.claimId, score: sample.fusedScore, label: 0 });
    else uncertain += 1;
  }
  return { fit, uncertain, coverage: labels.length ? fit.length / labels.length : 0 };
}

export function aisToBinary(aisLabel: AttributionGoldLabel["aisLabel"]): 0 | 1 | null {
  return aisLabel === "supported" ? 1 : aisLabel === "unsupported" ? 0 : null;
}
