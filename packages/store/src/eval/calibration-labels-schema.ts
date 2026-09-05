// ADR-0048 D1: TypeBox is the single source of truth for calibration label
// records and their paired manifest. The JSON Schema views below are
// mechanically derived from these objects, never hand-maintained.
import { Type, type Static } from "@sinclair/typebox";

const isoDateTime = () => Type.String({ minLength: 20 });

export const CalibrationLabelRecordSchema = Type.Object(
  {
    schema: Type.Literal("anysearch/calibration-label@1"),
    caseId: Type.String({ minLength: 1 }),
    label: Type.Union([Type.Literal(0), Type.Literal(1)]),
    annotator: Type.String({ minLength: 1 }),
    annotatedAt: isoDateTime(),
    note: Type.Optional(Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);

export type CalibrationLabelRecord = Static<typeof CalibrationLabelRecordSchema>;

export const CalibrationManifestSchema = Type.Object(
  {
    schema: Type.Literal("anysearch/calibration-manifest@1"),
    caseFingerprint: Type.String({ minLength: 16, maxLength: 16 }),
    labelsFingerprint: Type.String({ minLength: 16, maxLength: 16 }),
    annotators: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
    annotatedAt: Type.Union([isoDateTime(), Type.Null()]),
    promotedVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    promotedAt: Type.Union([isoDateTime(), Type.Null()]),
    promotedFingerprint: Type.Union([Type.String({ minLength: 16, maxLength: 16 }), Type.Null()]),
    note: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type CalibrationManifest = Static<typeof CalibrationManifestSchema>;

function toPlainJsonSchema(schema: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema));
}

export const CalibrationLabelJsonSchema = toPlainJsonSchema(CalibrationLabelRecordSchema);
export const CalibrationManifestJsonSchema = toPlainJsonSchema(CalibrationManifestSchema);

export const CalibrationJsonSchemas = {
  label: CalibrationLabelJsonSchema,
  manifest: CalibrationManifestJsonSchema,
} as const;
