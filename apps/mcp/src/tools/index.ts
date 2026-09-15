// Per-tool Barrel: every tool registers itself against the given McpServer.
// ADR-0019 D2: cyanheads/obsidian canonical pattern — one file per tool,
// tools/index.ts aggregates, server.ts forEaches in order. Handler logic unchanged.
import type { McpServer } from "@modelcontextprotocol/server";
import type { CompositionResult } from "@anysearch-cli/kernel";
import { registerSearchWeb } from "./search-web.tool.js";
import { registerResearchWeb } from "./research-web.tool.js";
import { registerRecallMemory } from "./recall-memory.tool.js";
import { registerQueryKnowledge } from "./query-knowledge.tool.js";
import { registerAnsChat } from "./ans-chat.tool.js";

export interface ToolRegistry {
  name: string;
  register: (server: McpServer, eng: CompositionResult) => void;
}

export const TOOL_REGISTRY: ToolRegistry[] = [
  { name: "search_web", register: registerSearchWeb },
  { name: "research_web", register: registerResearchWeb },
  { name: "recall_memory", register: registerRecallMemory },
  { name: "query_knowledge", register: registerQueryKnowledge },
  { name: "ans_chat", register: registerAnsChat },
];
