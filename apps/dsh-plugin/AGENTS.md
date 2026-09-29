# AGENTS.md — @anysearch-cli/dsh-plugin

Thin Cordis bundle adapting DeepSeek Harness (dsh) to the anysearch hooks
layer (ADR-0073) plus the native tool plane (R90: five `ans_*` tools
registered via `ctx.tools.register`). In-process surface is minimal BY
CONTRACT: this package mounts listeners + literal tool definitions only;
every anysearch capability lives server-side — hooks on the anysearch server
at `127.0.0.1:33333`, tool execution on `ans-mcp` HTTP at
`{ANS_MCP_URL}/mcp` (fail-open).

## Invariants

- `dependencies` must stay `{}` — every `@deepseek-ai/*` package is a
  type-only devDependency (the compile-time churn alarm). ship-gate step 1s
  fails on any runtime-dep leak.
- `private: false` + `publishConfig {access:public, provenance:true}` —
  publish-ready since R80 (ADR-0081 D-003 pre-publish path); verify the
  publish shape anyway: `pnpm pack` → `dsh plugin add <tgz>` →
  `dsh --dump-config` layer check.
- `lib/index.js` is a self-contained ESM bundle (esbuild + `createRequire`
  banner — bundled CJS hook modules carry `require()` calls that pure ESM
  rejects). External imports must stay `node:*` builtins only.
- Shared hook logic is imported from `@anysearch-cli/plugin` hook modules
  (bundled at build time) — never re-implement preheat/distill/policy here.
- `cordis.patch.yml` uses `- insert:` with whole-row restatement; since
  R90 it ships only the `anysearch-dsh-plugin` row — the `mcp-anysearch`
  bridge row was retired (revert the T4 commit to restore it).

## Hook surfaces

`agent/created` (fires for all session sources; this plugin only acts
when `source === 'startup'` — resume/clear/compact skip) → routing-card
`agent.inject()`; `ctx.systemPrompt`
→ `anysearch:routing-card` section; `tools/pre-execute` → URL-policy
deny/ask + recall preheat inject; `tools/post-execute` → distilled
`additionalContexts`; `tools/result` → `/index` IPC (fire-and-forget).

## Fail-open

Server unreachable → hooks pass through (allow), IPC calls drop silently, and
tool execution returns empty results (ans-mcp down → `{content:[]}`).
URL gating is the exception BY CONTRACT (ADR-0054/0055 fail-closed): no
reachable policy + URL in args → `ask` (deny in approval-less headless).
Upstream tool `isError`/RPC errors materialize as tool errors (fail-closed
at the tool-result level is intentional — do not convert them to empty).

## Tests

`node --import tsx --test` — mock-Cordis ctx + real localhost stand-ins for
the anysearch server AND the ans-mcp HTTP endpoint (stateless JSON-RPC
initialize/notifications/initialized/tools-call); no dsh process needed.
