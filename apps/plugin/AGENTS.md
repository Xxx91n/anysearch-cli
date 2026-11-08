# AGENTS.md — anysearch plugin

## Tool whitelist

These are the tools the anysearch plugin handles. All use the `ans_*` prefix. A host may add its own prefix, for example `mcp__anysearch__search_web`.

- `ans_search_web` — search the web now, across several sources at once.
- `ans_research_web` — deep research. Runs for minutes and follows several steps.
- `ans_recall_memory` — look through earlier research results stored in local memory (FTS5 keyword search).
- `ans_query_knowledge` — search the organization's own knowledge base.
- `ans_ans_chat` — an agent loop for research that needs several tool calls.

## Fail-open behavior

If the anysearch server at 127.0.0.1:33333 cannot be reached, every tool still works, just with fewer features:

- search_web / research_web go straight to the search code, with no warm-up lookup and no summary step.
- recall_memory returns an empty list instead of crashing.
- query_knowledge passes straight through to the domain retrieval adapter (RagAdapterPort).
- ans_chat runs without memory injection.

A broken hook exits 0. The shared hook code is the same on every host, but URL policy enforcement is not. When a call carries a URL and the URL policy cannot be read, the shared hook returns `ask`. Claude Code, Codex, CodeBuddy and the dsh plugin give that decision to the host: the call waits for approval, and the call is denied when there is no approval channel. Cursor does not give that decision to the host, and Antigravity always allows, so on those two hosts the call can go ahead without approval (0055).

## Namespace conventions

- Tool names start with `ans_` and are matched by the regex `/(?:^|_|__)(?:search_web|research_web|recall_memory|query_knowledge|ans_chat)$/`
- Hook names start with the `anysearch-*` prefix (for example anysearch-preheat, anysearch-distill, anysearch-session-start).
- Config environment variables: `ANS_SERVER_URL`, `ANS_SERVER_TOKEN`, `ANS_SERVER_PORT`, `ANS_PROJECT_DB`.
- IPC uses HTTP on 127.0.0.1 with a Bearer token, and times out after 5 seconds.
