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

## Package manager pinning (ADR-0026)

Pinned pnpm version: **11.24.0**, declared twice and kept in sync:
- `packageManager: "pnpm@11.24.0"` (top-level, read by corepack)
- `devEngines.packageManager: { name: "pnpm", version: "11.24.0" }` (object form, enforced by pnpm itself)

`pnpm-workspace.yaml` sets `pmOnFail: error`: any pnpm whose version does not match fails immediately with `ERR_PNPM_BAD_PM_VERSION` instead of auto-downloading and rewriting the lockfile. Local developers may override once via `pnpm_config_pm_on_fail=download` (precedence CLI > env > workspace yaml).

ship-gate no longer needs PATH front-loading of a global pnpm; any conforming install (corepack, pnpm/setup, or global 11.24.0) works. Bump both pinned fields in one commit when upgrading pnpm.

CI uses `pnpm/setup@v2` (the v11+ successor of `pnpm/action-setup`), which reads the pinned version automatically.
## Scope discipline (ADR-0029)

One grill round = one themed topic. Cohesive engineering items in the same subsystem may land in the ADR as formal Decision entries; due chores ship as separate refactor commits + CHANGELOG Removed entries; rejections stay explicit in the ADR. The anti-pattern is undocumented while-you're-at-it edits — audit-checklist.md enforces diff-size thresholds and the found/fixed/deferred triplet.

## Deliverable path discipline

Deliverable documents (task books, handoffs, decision ledgers, plans, evidence manifests) must be written with **absolute paths**, and must be *referenced by absolute path* in reports and handoffs — both inside the document body and when pointing a user or the next agent at the file. Repo-relative paths (`docs/x.md`, `.scratch/...`) are not acceptable for deliverables. Applies from grill-round-67 onward.
