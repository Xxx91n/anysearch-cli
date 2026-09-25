// Tool Schema Registry: canonical TypeBox schemas for the 5 ans_* MCP tools.
// ADR-0019 D1: kernel holds the single source of truth for tool input schemas;
// apps/mcp wraps them via fromJsonSchema() (SDK v2 requires Standard Schema).
// ADR-0019 D3: all business validation lives here as JSON Schema keywords
// (minLength / enum via Union of Literals); handlers contain zero hand-written validation.
// D6: rejected codemod kernel to zod; schema source-of-truth stays TypeBox.

import { Type } from "@sinclair/typebox";

export const SearchWebInput = Type.Object({
  query: Type.String({ minLength: 1, description: "The search query" }),
  mode: Type.Optional(
    Type.Union([
      Type.Literal("fast"),
      Type.Literal("index"),
      Type.Literal("deep"),
      Type.Literal("answer"),
    ], { description: "Search mode: fast (default), index, deep (more sources), answer (provider-generated answer, available only when provider supports it; not synthesized locally per ADR-0022 D4)" })
  ),
  // R83 T1 / ADR-0084 D-003: query-level vertical — when verticalDomain is
  // present the three args form a complete spec that REPLACES the repo-level
  // sources.vertical default wholesale (no deep-merge). Shape check only —
  // the domain/sub_domain vocabulary is upstream truth (no enum embedded).
  verticalDomain: Type.Optional(
    Type.String({ minLength: 1, description: "Vertical domain id routed provider-side (e.g. academic, finance, it_tech); replaces the domain TOML sources.vertical default wholesale" })
  ),
  verticalSubDomain: Type.Optional(
    Type.String({ minLength: 1, description: "Vertical sub-domain within verticalDomain (requires verticalDomain)" })
  ),
  verticalParams: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), { description: "Vertical sub_domain_params key/value map (requires verticalDomain)" })
  ),
}, { additionalProperties: false });
export type SearchWebInput = {
  query: string;
  mode?: "fast" | "index" | "deep" | "answer";
  verticalDomain?: string;
  verticalSubDomain?: string;
  verticalParams?: Record<string, unknown>;
};

export const ResearchWebInput = Type.Object({
  question: Type.String({ minLength: 1, description: "The research question to investigate" }),
  depth: Type.Optional(
    Type.Union([
      Type.Literal("brief"),
      Type.Literal("standard"),
      Type.Literal("deep"),
    ], { description: "Research depth: brief (1 round), standard (2 rounds), deep (3 rounds)" })
  ),
  // R83 T1 / ADR-0084 D-003: query-level vertical — when verticalDomain is
  // present the three args form a complete spec that REPLACES the repo-level
  // sources.vertical default wholesale (no deep-merge). Shape check only —
  // the domain/sub_domain vocabulary is upstream truth (no enum embedded).
  verticalDomain: Type.Optional(
    Type.String({ minLength: 1, description: "Vertical domain id routed provider-side (e.g. academic, finance, it_tech); replaces the domain TOML sources.vertical default wholesale" })
  ),
  verticalSubDomain: Type.Optional(
    Type.String({ minLength: 1, description: "Vertical sub-domain within verticalDomain (requires verticalDomain)" })
  ),
  verticalParams: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), { description: "Vertical sub_domain_params key/value map (requires verticalDomain)" })
  ),
}, { additionalProperties: false });
export type ResearchWebInput = {
  question: string;
  depth?: "brief" | "standard" | "deep";
  verticalDomain?: string;
  verticalSubDomain?: string;
  verticalParams?: Record<string, unknown>;
};

export const RecallMemoryInput = Type.Object({
  query: Type.String({ minLength: 1, description: "The memory recall query" }),
  limit: Type.Optional(
    Type.Integer({ minimum: 1, description: "Max results to return (default 5)" })
  ),
}, { additionalProperties: false });
export type RecallMemoryInput = {
  query: string;
  limit?: number;
};

export const QueryKnowledgeInput = Type.Object({
  query: Type.String({ minLength: 1, description: "The knowledge base query" }),
}, { additionalProperties: false });
export type QueryKnowledgeInput = {
  query: string;
};

export const AnsChatInput = Type.Object({
  message: Type.String({ minLength: 1, description: "The user message to send to the agent" }),
}, { additionalProperties: false });
export type AnsChatInput = {
  message: string;
};

// KernelToolSchemas: registry consulted by apps/mcp barrel assembly (Per-tool Barrel).
// Keys match the MCP tool names exactly.
export const KernelToolSchemas = {
  search_web: SearchWebInput,
  research_web: ResearchWebInput,
  recall_memory: RecallMemoryInput,
  query_knowledge: QueryKnowledgeInput,
  ans_chat: AnsChatInput,
} as const;

export type KernelToolName = keyof typeof KernelToolSchemas;
