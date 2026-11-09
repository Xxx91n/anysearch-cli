# AGENTS.md — @anysearch-cli/dsh-plugin

This package is a small Cordis bundle. It plugs DeepSeek Harness (dsh) into anysearch's shared hook code. Since R90 it also registers the five `ans_*` tools through `ctx.tools.register`. What runs inside this package is deliberately small: it only listens to events and declares the tool definitions. Every real capability lives in the anysearch server: hooks talk to that server at `127.0.0.1:33333`, and tool calls go to `ans-mcp` over HTTP at `{ANS_MCP_URL}/mcp`. Apart from the URL policy, a broken layer does not block the call (fail-open).

## Invariants

- `dependencies` must stay `{}`. Every `@deepseek-ai/*` package is a type-only devDependency. That is how we catch upstream changes: if their types move, this build breaks. ship-gate step 1s fails if any runtime dependency sneaks in.
- `private: false` plus `publishConfig {access:public, provenance:true}` makes the package ready to publish since R80. Still check the packaged shape: `pnpm pack` → `dsh plugin add <tgz>` → `dsh --dump-config`, then look at the layer list.
- `lib/index.js` is a self-contained ESM bundle (esbuild adds a `createRequire` banner, because the bundled CJS hook modules call `require()` and plain ESM rejects those calls). External imports must be `node:*` builtins only.
- Shared hook logic is imported from `@anysearch-cli/plugin` hook modules and bundled at build time. Never re-implement preheat, distill or URL policy here.
- `cordis.patch.yml` uses `- insert:` and restates the whole row. Since R90 it ships one row only, `anysearch-dsh-plugin`. The `mcp-anysearch` bridge row is gone. To bring it back, revert the T4 commit.

## Hook surfaces

- `agent/created` fires for every session source. This plugin acts only when `source === 'startup'`; resume, clear and compact are skipped. It calls `agent.inject()` with the routing card.
- `ctx.systemPrompt` gets a section named `anysearch:routing-card`.
- `tools/pre-execute` applies the URL policy (deny or ask) and injects the early recall lookup text.
- `tools/post-execute` adds a shorter version of the tool output as `additionalContexts`.
- `tools/result` sends the final result to `/index` and does not wait for an answer.

## When something breaks

If the server cannot be reached, hooks allow the call, IPC calls disappear silently, and tool calls return empty results (`{content:[]}` when ans-mcp is down). The URL policy is the one exception, and that is on purpose: when it cannot check the URL, it must not silently allow the call (0055). If no policy can be reached and the arguments contain a URL, the answer is `ask` (which becomes deny when there is no approval channel, as in headless runs). If the upstream tool returns `isError` or an RPC error, the tool call fails. That is also on purpose: errors at the tool-result level stay errors, so never turn them into empty results.

## Tests

`node --import tsx --test` runs them. A mock Cordis ctx plus real localhost stand-ins cover both the anysearch server and the ans-mcp HTTP endpoint (stateless JSON-RPC `initialize`, `notifications/initialized` and `tools/call`). No dsh process is needed.
