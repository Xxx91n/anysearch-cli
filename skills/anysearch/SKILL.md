# Anysearch Plugin Skill

## Tools

- search_web: real-time multi-source web search
- research_web: deep research (minute-level, multi-hop)
- recall_memory: FTS5 research memory recall (time edge effect)
- query_knowledge: enterprise RAG retrieval
- ans_chat: PiAgentRuntime agent loop for complex queries

## Decision tree

1. Current events / factual lookup -> search_web
2. Multi-step research / synthesis -> research_web
3. Recall prior results from this session -> recall_memory
4. Enterprise knowledge base -> query_knowledge
5. Complex multi-tool research -> ans_chat
6. Skip redundant search if recall_memory already has relevant results

## Anti-patterns

- Do NOT call search_web for a query that recall_memory already has results for
- Do NOT call ans_chat for simple factual lookups (use search_web instead)
- Do NOT call research_web for single-hop questions (use search_web instead)
- Do NOT ignore recall_memory results when they exist

## Namespace conventions

All anysearch tools use the ans_* prefix. Host agents may add their own namespace
prefix (e.g., mcp__anysearch__search_web). The hooks layer matches any tool name
containing ans_ followed by a known tool name.

## Fail-open

If the anysearch server is down, all tools degrade gracefully. No tool call will
block the host agent. Errors are logged to stderr and the tool returns an empty
result.
