# AGENTS.md — @anysearch-cli/dsh-plugin

Thin Cordis bundle adapting DeepSeek Harness (dsh) to the anysearch hooks
layer (ADR-0073). In-process surface is minimal BY CONTRACT: this package
mounts listeners only; every anysearch capability lives in the anysearch
server at `127.0.0.1:33333` (HTTP IPC, fail-open).

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
- `cordis.patch.yml` uses `- insert:` with whole-row restatement; it owns
  the `mcp-anysearch` row id (a second insert with the same id anywhere is
  a hard loader error).

## Hook surfaces

`agent/created` (fires for all session sources; this plugin only acts
when `source === 'startup'` — resume/clear/compact skip) → routing-card
`agent.inject()`; `ctx.systemPrompt`
→ `anysearch:routing-card` section; `tools/pre-execute` → URL-policy
deny/ask + recall preheat inject; `tools/post-execute` → distilled
`additionalContexts`; `tools/result` → `/index` IPC (fire-and-forget).

## Fail-open

Server unreachable → hooks pass through (allow) and IPC calls drop silently.
URL gating is the exception BY CONTRACT (ADR-0054/0055 fail-closed): no
reachable policy + URL in args → `ask` (deny in approval-less headless).

## Tests

`node --import tsx --test` — mock-Cordis ctx + a real localhost stand-in
for the anysearch server; no dsh process needed.
