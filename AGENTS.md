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

## Platform install note (better-sqlite3)

better-sqlite3@13 ships prebuilds for win32/darwin/linux (x64 + arm64 + musl). Repo pins `allowBuilds: better-sqlite3: false` in pnpm-workspace.yaml so node-gyp stays off (load-time dlopen of the prebuilt .node). If you ever override allowBuilds you will need MSBuild + ClangCL on Windows (Studio 2022 BuildTools MSVC v143 + ClangCL toolset). Don\'t flip this flag without a reason; the prebuilt path IS the supported production path.
