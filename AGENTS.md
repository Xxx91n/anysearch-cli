# AGENTS.md — anysearch-cli

This file gives agent skills (set up via `/setup-matt-pocock-skills`) the metadata they need to operate in this repo.

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Tool whitelist

The following tools are whitelisted for the anysearch plugin hooks layer:

- search_web
- research_web
- recall_memory
- query_knowledge
- ans_chat

Tools are matched by the ans_* prefix pattern. Any tool name containing `ans_` followed by a known tool name triggers the hooks layer.

## Fail-open

All anysearch hooks and tools degrade gracefully on failure. If the anysearch server is unreachable, tool calls return empty results and the host agent continues uninterrupted. No hook blocks the agent on server failure.

## Namespace conventions

All anysearch tools use the `ans_*` prefix. Host agents may prepend their own namespace (e.g., `mcp__anysearch__search_web`). The hooks layer identifies anysearch tools by matching the `ans_` pattern regardless of the host agent's namespace prefix.
