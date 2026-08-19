# AGENTS.md — anysearch plugin

## Tool whitelist

The following tools are registered by the anysearch plugin. All use the `ans_*` prefix (platform may add additional prefixes like `mcp__anysearch__search_web`).

- `ans_search_web` — Real-time web search
- `ans_research_web` — Deep research
- `ans_recall_memory` — FTS5 session memory recall
- `ans_query_knowledge` — Enterprise RAG
- `ans_ans_chat` — Agent loop for complex research

## Fail-open behavior

If the anysearch server (127.0.0.1:33333) is unreachable, all tools degrade gracefully:
- search_web / research_web: pass through to underlying retriever (no preheat/distill)
- recall_memory: returns empty results (no crash)
- query_knowledge: pass through to RAG adapter
- ans_chat: runs without memory injection

The plugin never blocks host agent execution. Hook failures exit 0 (fail-open).

## Namespace conventions

- Tool names: `ans_*` prefix, matched by regex `/(?:^|_|__)(?:search_web|research_web|recall_memory|query_knowledge|ans_chat)$/`
- Hook names: `anysearch-*` prefix (e.g., anysearch-preheat, anysearch-distill, anysearch-session-start)
- Config env vars: `ANS_SERVER_URL`, `ANS_SERVER_TOKEN`, `ANS_SERVER_PORT`, `ANS_PROJECT_DB`
- IPC: HTTP 127.0.0.1 + Bearer token auth, 5s timeout
