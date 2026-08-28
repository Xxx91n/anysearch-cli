// ADR-0034 D5 L0: TypeBox contract for AttributionReport.
// This schema mirrors the AttributionReport interface in packages/retriever/src/attribution.ts
// and must stay in sync. The ship-gate L0 assertion (scripts/ship-gate.mjs step 1) checks
// that this file exists, has additionalProperties:false at every level, and that
// both enums are present — drift between the two files is a ship-blocking error.
//
// ADR-0034 D3/D4: supported / uncertain / unsupported labels; evidence maxItems=3.

import { Type } from "@sinclair/typebox";

export const AttributionLabel = Type.Union(
  [Type.Literal("supported"), Type.Literal("uncertain"), Type.Literal("unsupported")],
  { description: "ADR-0034 D3: three-state claim label" },
);

export const AttributionEvidenceSchema = Type.Object(
  {
    url: Type.String({ minLength: 1 }),
    title: Type.Optional(Type.String()),
    provider: Type.String({ minLength: 1, description: "provider id e.g. exa|tavily|anysearch" }),
    sourceKey: Type.String({ minLength: 1, description: "e.g. retrieval_results[0]" }),
    entity: Type.Optional(Type.String()),
    span: Type.Optional(Type.String({ description: "truncated snippet; max 240 chars" })),
  },
  { additionalProperties: false },
);

export const ClaimSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    text: Type.String({ minLength: 1 }),
    label: AttributionLabel,
    confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    evidence: Type.Array(AttributionEvidenceSchema, { maxItems: 3 }),
    rationale: Type.Optional(Type.String()),
    answerIndex: Type.Optional(Type.Number({ minimum: 0 })),
    spanStart: Type.Optional(Type.Number({ minimum: 0 })),
    spanEnd: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const GapRequestSchema = Type.Object(
  {
    assertion: Type.String({ minLength: 1 }),
    evidenceState: Type.Union([
      Type.Literal("no_evidence"),
      Type.Literal("partial_evidence"),
      Type.Literal("conflicting_evidence"),
    ]),
    gapQuery: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const AttributionReportSchema = Type.Object(
  {
    schema: Type.Literal("anysearch/attribution-report@1"),
    generatedAt: Type.String({ format: "date-time" }),
    claims: Type.Array(ClaimSchema),
    gaps: Type.Array(GapRequestSchema),
    supportedCount: Type.Number({ minimum: 0 }),
    uncertainCount: Type.Number({ minimum: 0 }),
    unsupportedCount: Type.Number({ minimum: 0 }),
    judgeEnhanced: Type.Boolean({ description: "true iff at least one uncertain claim was escalated to judge LLM" }),
  },
  { additionalProperties: false },
);

export type AttributionReportType = typeof AttributionReportSchema extends undefined ? never : undefined;
