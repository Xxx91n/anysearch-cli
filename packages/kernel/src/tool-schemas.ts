// Canonical TypeBox schemas for the 5 ans_* MCP tools.
// kernel holds the single source of truth for tool input schemas;
// apps/mcp wraps them via fromJsonSchema() (SDK v2 requires Standard Schema).
// all business validation lives here as JSON Schema keywords
// (minLength / enum via Union of Literals); handlers contain zero hand-written validation.
// D6: rejected codemod kernel to zod; schema source-of-truth stays TypeBox.

import { Type } from "@sinclair/typebox";

// query-level vertical — when verticalDomain is
// present the three args form a complete spec that REPLACES the repo-level
// sources.vertical default wholesale (no deep-merge). Shape check only —
// the domain/sub_domain vocabulary is upstream truth (no enum embedded).
// shared prop fragment for both retrieval tools —
// the closed-shape closer stays on each consuming Type.Object (that is the
// tool's own contract; the fragment carries only the props).
const verticalSpecProps = {
  verticalDomain: Type.Optional(
    Type.String({ minLength: 1, description: "Vertical domain id routed provider-side (e.g. academic, finance, ip); replaces the domain TOML sources.vertical default wholesale" })
  ),
  verticalSubDomain: Type.Optional(
    Type.String({ minLength: 1, description: "Vertical sub-domain within verticalDomain (requires verticalDomain)" })
  ),
  verticalParams: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), { description: "Vertical sub_domain_params key/value map (requires verticalDomain)" })
  ),
};

export const SearchWebInput = Type.Object({
  query: Type.String({ minLength: 1, description: "The search query" }),
  mode: Type.Optional(
    Type.Union([
      Type.Literal("fast"),
      Type.Literal("index"),
      Type.Literal("deep"),
      Type.Literal("answer"),
    ], { description: "Search mode: fast (default), index, deep (more sources), answer (provider-generated answer, available only when provider supports it; not synthesized locally)" })
  ),
  // the vertical-spec arg block is the shared
  // verticalSpecProps fragment (legislated once, consumed by both tools).
  ...verticalSpecProps,
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
  // Same shared fragment as search_web ( / a06).
  ...verticalSpecProps,
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
  // #132: explicit, server-minted state handle (MCP 2026-07-28 / SEP-2567).
  // The first call omits it and gets one back in structuredContent.sessionId;
  // later calls thread it here so L1/L2 anchors resume in the same session.
  // Design: the wire schema deliberately does NOT constrain the value. A
  // malformed handle must fail open in the handler (no memory, call still
  // answers), so AJV cannot reject it first; apps/mcp validates the 1..128
  // visible-ASCII rule at the DB-key boundary instead.
  sessionId: Type.Optional(
    Type.String({
      description: "Opaque session handle returned as structuredContent.sessionId (and a trailing text block) by a previous ans_chat call; pass it back to continue L1/L2 memory across calls. Must be 1..128 visible ASCII characters; a malformed value is ignored (single-shot) rather than rejected. Omit for a single-shot call (fresh session, no cross-call continuity).",
    }),
  ),
}, { additionalProperties: false });
export type AnsChatInput = {
  message: string;
  sessionId?: string;
};

// KernelToolSchemas: registry consulted by apps/mcp per-tool module assembly.
// Keys match the MCP tool names exactly.
export const KernelToolSchemas = {
  search_web: SearchWebInput,
  research_web: ResearchWebInput,
  recall_memory: RecallMemoryInput,
  query_knowledge: QueryKnowledgeInput,
  ans_chat: AnsChatInput,
} as const;

export type KernelToolName = keyof typeof KernelToolSchemas;

// KernelToolDescriptions: model-facing tool copy — the second half of the tool
// identity single-source . Consumed verbatim by apps/mcp
// registerTool() descriptions AND by the dsh-plugin native ToolRuntime
// registrations, so the model sees one canonical surface on every host.
export const KernelToolDescriptions = {
  search_web: "Search the web through several providers at once. Returns results plus a signal saying whether the evidence is enough.",
  research_web: "Run a deep research query over several rounds; each round merges results with RRF and URLs are deduplicated across rounds. Returns an evidence-sufficiency signal and the top citations.",
  recall_memory: "Search the local research archive (FTS5) for results indexed earlier. Older results slowly lose weight, can be marked out of date, and time-sensitive questions are flagged for a closer look.",
  query_knowledge: "Query the knowledge base through the retrieval adapter chosen by the domain config. With `fts` it reads the store-wide research archive, not just the current domain's rows.",
  ans_chat: "Run the anysearch agent loop: retrieval-augmented chat with an LLM and domain-aware tool filtering. Returns a session handle (structuredContent.sessionId and a trailing text block); pass it back as sessionId to continue L1/L2 memory across calls.",
} as const satisfies Record<KernelToolName, string>;
