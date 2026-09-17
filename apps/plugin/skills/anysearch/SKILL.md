---
name: anysearch
description: Real-time web search, deep research, session-memory recall and knowledge retrieval via the anysearch ans_* tools.
---

# Anysearch — Information-Specialized Agent

Research and retrieve information across multiple sources with persistent memory.

## When to use

- User asks to search the web, research a topic, or look up current events
- User needs deep multi-hop research with synthesis
- User wants to recall prior search results from this session
- User needs enterprise knowledge base retrieval
- User has a complex research query needing multiple tool calls

## Tools

**search_web** — Real-time multi-source web search (Exa, Tavily, Anysearch). Returns fused, deduplicated results with RRF ranking. Use for factual lookup, current events, quick answers.

**research_web** — Deep research mode (minute-level). Multi-hop traversal, source validation, synthesis. Use for complex questions requiring thorough investigation.

**recall_memory** — FTS5 research memory recall with time edge effect. Searches prior results from this session. Always try this before redundant search_web calls.

**query_knowledge** — Enterprise RAG retrieval. Searches the organization's knowledge base. Use when the question is domain-specific and internal docs may have answers.

**ans_chat** — PiAgentRuntime agent loop for complex multi-tool research. Use when the query requires orchestrating multiple tools in sequence.

## Decision tree

1. Is this a factual lookup or current event? -> search_web
2. Does this need deep multi-hop research? -> research_web
3. Have we searched this topic before in this session? -> recall_memory first, then search_web only if results are missing
4. Is this about internal enterprise knowledge? -> query_knowledge
5. Does this need multiple tools orchestrated? -> ans_chat

## Anti-patterns

- Do NOT call search_web for a topic already covered by recall_memory results
- Do NOT call research_web for simple factual questions (use search_web)
- Do NOT call ans_chat when a single tool call suffices
- Do NOT ignore recall_memory — it prevents redundant API calls and token waste

## Mandatory rules

- Always check recall_memory before issuing a new search_web for a previously-discussed topic
- Fail-open: if anysearch server is unreachable, continue without memory features (do not block)
- Tool namespace: all anysearch tools use ans_* prefix (platform may add additional prefixes)
