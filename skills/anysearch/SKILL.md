# Anysearch Plugin Skill

## Tools

- search_web: search the web now, across several sources at once.
- research_web: deep research. Runs for minutes and follows several steps.
- recall_memory: look through earlier research results stored in local memory (FTS5 keyword search). Older results slowly lose weight.
- query_knowledge: search the organization's own knowledge base.
- ans_chat: an agent loop (PiAgentRuntime) for questions that need several tools.

## Decision tree

1. Current events or a fact to look up -> search_web
2. Research that needs several steps and a written answer -> research_web
3. Recall earlier research results from memory -> recall_memory
4. Organization's own knowledge base -> query_knowledge
5. Research that needs several tools in a row -> ans_chat
6. If recall_memory already has relevant results, skip the extra search

## Anti-patterns

- Do NOT call search_web when recall_memory already has results for the same question
- Do NOT call ans_chat for a simple fact lookup (use search_web instead)
- Do NOT call research_web for a one-step question (use search_web instead)
- Do NOT ignore recall_memory results when they exist

## Namespace conventions

All anysearch tools use the ans_* prefix. Host agents may add their own namespace
prefix (for example mcp__anysearch__search_web). The hook code matches any tool
name that contains ans_ followed by a known tool name.

## Fail-open

If the anysearch server is down, every tool still works, just with fewer features.
No tool call blocks the host agent. Errors are written to stderr, and the tool
returns an empty result.
