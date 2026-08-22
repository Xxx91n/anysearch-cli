// Plain JSON Schema registry (JsonSchemaType-compatible object shape) —
// derived from kernel TypeBox schemas via JSON.stringify/parse (the official
// TypeBox serialization path; [Kind] symbols are automatically stripped by
// JSON serialization, per issue #786/#987). single-source-of-truth:
// ADR-0019 D1/D3 amendment — atomcode research (round 16 audit) establishes that
// maintaining a hand-written mirror alongside the TypeBox source is guaranteed
// drift (specmatic "MCP Servers Are Lying About Their Schemas", aident.ai MCP
// TS SDK v1→v2 inputSchema empty production incident). JSON round-trip is the
// one zero-rewrite channel TypeBox author KKonstantinov endorses in MCP SDK
// issue #825.
//
// The TypeBox schemas use `additionalProperties: false` explicitly so that the
// derived JSON Schema matches the strict-closed shape we want on the wire.

import {
  AnsChatInput,
  QueryKnowledgeInput,
  RecallMemoryInput,
  ResearchWebInput,
  SearchWebInput,
  type KernelToolName,
} from "./tool-schemas";

// ponytail: kernel must not depend on MCP SDK types. JsonSchemaType is
// structurally a JSON Schema object; a structural alias keeps kernel free of
// any cross-layer type dependency.
type JsonSchemaType = Record<string, unknown>;

// JSON round-trip to strip TypeBox [Kind] symbols and emit plain JSON Schema.
// Per TypeBox author in MCP SDK issue #825, TypeBox objects ARE Json Schema;
// stringify/parse is the official serialization path.
function toPlainJsonSchema(schema: unknown): JsonSchemaType {
  return JSON.parse(JSON.stringify(schema));
}

export const KernelJsonSchemas: Record<KernelToolName, JsonSchemaType> = {
  search_web: toPlainJsonSchema(SearchWebInput),
  research_web: toPlainJsonSchema(ResearchWebInput),
  recall_memory: toPlainJsonSchema(RecallMemoryInput),
  query_knowledge: toPlainJsonSchema(QueryKnowledgeInput),
  ans_chat: toPlainJsonSchema(AnsChatInput),
};
