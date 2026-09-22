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

Pinned pnpm version: **11.24.0**, declared once: `packageManager: "pnpm@11.24.0"` (top-level). Corepack uses it to select the binary; pnpm itself validates the running version against it under `pmOnFail: error` (empirically: `npx pnpm@11.7.0` in-repo fails with ERR_PNPM_BAD_PM_VERSION). `devEngines` was removed in R71 (ADR-0072): it is redundant for pinning and makes npm emit EBADDEVENGINES warnings on every in-repo command; published tarballs never carried it.

`pnpm-workspace.yaml` sets `pmOnFail: error`: any pnpm whose version does not match fails immediately with `ERR_PNPM_BAD_PM_VERSION` instead of auto-downloading and rewriting the lockfile. Local developers may override once via `pnpm_config_pm_on_fail=download` (precedence CLI > env > workspace yaml).

ship-gate no longer needs PATH front-loading of a global pnpm; any conforming install (corepack, pnpm/setup, or global 11.24.0) works. Bump both pinned fields in one commit when upgrading pnpm.

CI uses `pnpm/setup@v2` (the v11+ successor of `pnpm/action-setup`), which reads the pinned version automatically.
## Scope discipline (ADR-0029)

One grill round = one themed topic. Cohesive engineering items in the same subsystem may land in the ADR as formal Decision entries; due chores ship as separate refactor commits + CHANGELOG Removed entries; rejections stay explicit in the ADR. The anti-pattern is undocumented while-you're-at-it edits — audit-checklist.md enforces diff-size thresholds and the found/fixed/deferred triplet.

## Deliverable path discipline (ADR-0072)

Machine-local paths in committed markdown are linted **by usage class** — ship-gate step 1i (`scripts/ship-gate.mjs`; sweep registration in `scripts/ship-gate-pathlint.config.json`) enforces this section fail-closed. A blanket ban is wrong on purpose: a locator's job is machine precision, so absolute paths survive in exactly one class.

- **Locators / Stack lines** — a line whose role is locating (the `Stack:` header field) may keep an absolute path bare. This is the only bare-absolute class.
- **In-repo target references** — a path resolving inside this repo (e.g. an absolute path to `scripts/...`, `docs/...`, `.scratch/...` on the author's machine) must be **repo-relative**. Machine-local absolute paths to in-repo targets are violations; markers do not exempt them.
- **Out-of-repo targets** — Temp dirs, sibling checkouts, user-level config, CI runner workspaces, other hosts' paths: keep the absolute path AND declare it with a governed marker on the same line: `<!-- machine-local: <reason> @ <YYYY-MM-DD> -->`. A marker missing reason or date is itself a violation. A valid marker on the line directly before a `````` fence covers the whole fenced block (transcript excerpts). Open declarations are audited quarterly.

Sweep scope (registered in the config — a new document type lands only by editing it): `*.md`, `docs/**/*.md`, and every tracked markdown file under `.scratch/` in a registered doc dir. Applies from grill-round-67 onward (locator class) and grill-round-71 onward (three-class refinement + fail-closed leg).

## Codex host notes (ADR-0068)

- Hooks config = official schema `{ "<Event>": [{ matcher, hooks: [{type:"command", command, timeout}] }] }`; `{name,command,args}` registers zero hooks. Matchers are FULL-MATCH regexes.
- Hook stdout contract = `hookSpecificOutput` envelope only: bare top-level `additionalContext` is ~80%-dropped, bare `permissionDecision` never blocks, exit 2 doesn't block. Adapter + session-start (`--envelope`) emit the envelope.
- `codex -c` cannot inject hooks (values are strings, not TOML) — wire via `config.toml` `[[hooks.*]]` or project `.codex/hooks.json`.
- `required = true` MCP servers hard-exit codex on startup failure.

## Antigravity (agy) host notes (ADR-0069)

- Hooks config = named-hook map `{ "<name>": { "<Event>": [{matcher, hooks:[{type:"command", command, timeout}]}] } }`; the Gemini-legacy `{hooks:{...}}` wrapper fails to parse (`command hook must specify 'command'`). Non-tool events take flat handlers; tool events take matcher-groups. Read from `~/.gemini/config/hooks.json` AND `~/.gemini/antigravity-cli/hooks.json` (same name deduped). <!-- machine-local: 用户级 ~ 路径引用（存量合规化） @ 2026-09-22 -->
- stdin is camelCase: `conversationId`/`toolCall{name,args}`/`workspacePaths`/`transcriptPath`/`artifactDirectoryPath`/`stepIdx`. No `hook_event_name` — event travels via argv (`ans-hook-antigravity <Event>`). PostToolUse carries `toolCall`+`error`, NO tool output.
- stdout is strict protojson: PreToolUse `{}` = DENY (decision required), empty stdout = allow, `{decision:allow|deny|ask|force_ask|deny_unless_prior_grant, reason?, permissionOverrides?}`; PostToolUse = `{}` only; context injection = `Pre/PostInvocation injectSteps[].ephemeralMessage`; non-zero exit = tool-level ERROR (blocks).
- `agy -p` headless hangs if a configured MCP server never finishes connecting (observed: `1mcp`) — sandbox `HOME` or fix the server; OAuth token lives in Windows Credential Manager, survives a sandboxed HOME.
- Antigravity IDE does NOT execute hooks — `.antigravity/rules/anysearch.mdc` is the supported surface there.
