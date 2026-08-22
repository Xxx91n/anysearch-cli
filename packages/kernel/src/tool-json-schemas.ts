// Plain JSON Schema registry (JsonSchemaType shape) — the canonical source for
// apps/mcp fromJsonSchema() calls. Mirrors tool-schemas.ts (TypeBox) 1:1 in keys/keywords.
// ADR-0019 D1: TypeBox TString's contentEncoding union literal breaks TSC against
// SDK's JsonSchemaType — emit plain-object JSON Schema instead of TypeBox objects here
// so we don't drift TypeBox types against a private SDK type level.
// ADR-0019 D3: keywords (minLength / enum) must mirror the TypeBox counterparts.

import type { KernelToolName } from "./tool-schemas";

type JsonSchemaType = Record<string, unknown>;

const searchWebJsonSchema: JsonSchemaType = {
  type: "object",
  properties: {
    query: { type: "string", minLength: 1, description: "The search query" },
    mode: {
      anyOf: [
        { const: "fast", description: "Search mode: fast (default), deep (more sources), answer (with synthesis)" },
        { const: "deep" },
        { const: "answer" },
      ],
    },
  },
  required: ["query"],
  additionalProperties: false,
};

const researchWebJsonSchema: JsonSchemaType = {
  type: "object",
  properties: {
    question: { type: "string", minLength: 1, description: "The research question to investigate" },
    depth: {
      anyOf: [
        { const: "brief", description: "Research depth: brief (1 round), standard (2 rounds), deep (3 rounds)" },
        { const: "standard" },
        { const: "deep" },
      ],
    },
  },
  required: ["question"],
  additionalProperties: false,
};

const recallMemoryJsonSchema: JsonSchemaType = {
  type: "object",
  properties: {
    query: { type: "string", minLength: 1, description: "The memory recall query" },
    limit: { type: "integer", minimum: 1, description: "Max results to return (default 5)" },
  },
  required: ["query"],
  additionalProperties: false,
};

const queryKnowledgeJsonSchema: JsonSchemaType = {
  type: "object",
  properties: {
    query: { type: "string", minLength: 1, description: "The knowledge base query" },
  },
  required: ["query"],
  additionalProperties: false,
};

const ansChatJsonSchema: JsonSchemaType = {
  type: "object",
  properties: {
    message: { type: "string", minLength: 1, description: "The user message to send to the agent" },
  },
  required: ["message"],
  additionalProperties: false,
};

export const KernelJsonSchemas: Record<KernelToolName, JsonSchemaType> = {
  search_web: searchWebJsonSchema,
  research_web: researchWebJsonSchema,
  recall_memory: recallMemoryJsonSchema,
  query_knowledge: queryKnowledgeJsonSchema,
  ans_chat: ansChatJsonSchema,
};
