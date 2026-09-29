# DeepSeek Harness (dsh) integration — @anysearch-cli/dsh-plugin

DeepSeek Harness is the sixth verified agent host (ADR-0073). The integration
is two-surface: a thin Cordis bundle mounts the anysearch hooks layer inside
the host process AND registers the five `ans_*` tools natively on
`ctx.tools` (R90 — the Phase-1 MCP-client bridge row is retired; see the
legacy section). All business logic stays server-side: hooks reach the
anysearch server at `127.0.0.1:33333`, tool execution reaches `ans-mcp`
over its HTTP transport (default `127.0.0.1:3001/mcp`). The dsh process
carries no retrieval logic, no secrets beyond the shared IPC credentials, and
no database access.

Verified against `@deepseek-ai/dsh@0.1.5-rc.2` (headless profile +
web-profile composition), 2026-09-19. Evidence:
`.scratch/grill-round-72/evidence/`. R90: native tool plane implemented
and unit-verified against the pinned API (`@deepseek-ai/dsh-*@0.1.7-rc.1`);
bridge row retired (`cordis.patch.yml` now ships the plugin row only).

## Phase 1 (RETIRED — R90) — MCP bridge only (no bundle)

> The bundle below no longer ships this row: R90 moved the five tools onto
> native `ctx.tools` registration. This section stays as the manual/legacy
> path — e.g. a profile that wants the bridge without the bundle, or rollback
> of the R90 change (revert commit T4).

Register the official MCP client bridge in the profile's user patch so the
five `mcp__anysearch__*` tools appear on `ctx.tools`. Edit
`$DSH_HOME/profiles/<name>/cordis.patch.yml`: <!-- machine-local: POSIX env-var 路径引用（存量合规化） @ 2026-09-22 -->

```yaml
- insert:
    - id: mcp-anysearch
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: anysearch
        transport: stdio
        command: ans-mcp
        args: []
        toolCallTimeoutMs: 60000
        failOnStartupError: false
        reconnect:
          enabled: true
          initialDelayMs: 500
          maxDelayMs: 30000
          maxAttempts: 10
```

Phase-1 semantics (verified):

- Rows are **added** via `- insert:` with the complete row (`id` + `name` +
  `config`). An `- id:`-targeted entry on a missing row only warns
  (`patch: entry "mcp-anysearch" not found`).
- `config` **replaces a targeted row whole** — it never merges. Any override
  (e.g. pointing `command` at a repo-local `ans-mcp` build) must restate
  every key or the row loses them.
- Two `insert` entries declaring the same `id` are a hard loader error
  (`duplicate loader entry id`). On the native path the bundle owns no
  bridge row — a hand-inserted `mcp-anysearch` row is the rollback escape
  hatch only; user overrides use `- id:` entries.
- Legacy bridge namespace was
  `mcp__anysearch__{search_web,research_web,recall_memory,query_knowledge,ans_chat}`;
  the native plane registers the BARE names `ans_search_web` … `ans_ans_chat`
  directly on `ctx.tools`.
- `failOnStartupError: false` + `reconnect` keep the host booting when the
  MCP server is absent — anysearch fail-open by contract.

## Phase 2 — hooks bundle (recommended)

```sh
pnpm pack --pack-destination <tmp>          # in apps/dsh-plugin
dsh plugin --profile <name> add <tmp>/anysearch-cli-dsh-plugin-0.0.6.tgz
# post-publish equivalent: dsh plugin --profile <name> add @anysearch-cli/dsh-plugin
```

`dsh plugin add` installs the package into the profile (zero runtime deps →
no `pendingBuilds` approval) and registers it under
`dsh.profile.bundles`. The bundle's own `cordis.patch.yml` inserts the
plugin row only — tool registration happens inside `apply()` via
`ctx.tools.register`. Verify with `dsh --profile <name> --dump-config`:
the bundle layer shows `# == @anysearch-cli/dsh-plugin` with the single row;
a user-layer override shows a `patched by` marker.

Hook surfaces mounted by the bundle (all over HTTP IPC to the anysearch
server, fail-open — a dead server never blocks the agent):

| Surface | Behaviour |
| --- | --- |
| `agent/session-start` | `agent.inject()` writes the routing card as a durable user message (next request) |
| `ctx.systemPrompt` | registers `anysearch:routing-card` section (every request) |
| `tools/pre-execute` | URL-policy gate — `deny` on denylist hosts, `ask` on non-allowlist (fail-closed on URLs when the policy is unreachable) + recall preheat injected into the next request |
| `tools/post-execute` | appends the distilled result summary to `additionalContexts` |
| `tools/result` | indexes the final outcome to the project index (`POST /index`, fire-and-forget) |
| `ctx.tools.register` | five native `ans_*` tools; `execute` is pure transport — MCP `tools/call` JSON-RPC over HTTP, zero business logic in the bundle |

Server endpoints used: `GET /policy`, `POST /recall`, `POST /index` on
`ANS_SERVER_URL` (default `http://127.0.0.1:33333`) with the shared
`ANS_SERVER_TOKEN` / `.anysearch-cli/server-token` credential and
`traceparent` + `x-anysearch-session-id` propagation. Tool execution posts
MCP JSON-RPC to `POST {ANS_MCP_URL}/mcp` (default `http://127.0.0.1:3001` —
serve it with `ans mcp --transport http`; `ANS_MCP_KEY` supplies the Bearer
when set, else the server token is sent) — a stateless initialize handshake is
cached per endpoint, session errors re-handshake once, transport failure
degrades fail-open to empty results, upstream `isError` materializes a tool
error.

## Layering rules (verified on the real loader)

- Bundle patches apply in `dsh.profile.bundles` order; the user patch applies
  last → user overrides win.
- Override a bundle row with `- id: <row-id>` entries (patch the fields you
  need; for `config` restate every key — whole-row replacement).
- `patchReload: "startup"` (headless, verified) applies patches on next boot;
  `patchReload: "live"` (web) is expected to reload the patch layer live — our
  listeners are fiber-scoped Cordis effects that should dispose cleanly on
  reload — EXPECTED, not yet verified (see
  defer-r72-dsh-web-interactive-matrix).
- Upgrade check: after bumping `@deepseek-ai/dsh`, diff
  `--dump-default-config` to confirm the bundle rows still land — a future
  dsh release that ships its own `mcp-anysearch` id would collide (the
  duplicate-insert rule), which is exactly what the diff catches.

## Verification transcript (rerunnable)

Headless profile, isolated `$DSH_HOME` — full evidence under
`.scratch/grill-round-72/evidence/`:

```sh
# install + register
pnpm pack --pack-destination <tmp>          # apps/dsh-plugin
dsh plugin --profile headless add <tmp>/anysearch-cli-dsh-plugin-0.0.6.tgz
dsh --profile headless --dump-config        # bundle layer + patched-by markers

# live turn (task positional; exits after one task)
dsh --profile headless "<task>"
```

Verified on the wire: routing-card message + system-prompt section in the
first model request; `anysearch preheat` context in a later request;
denylisted URL in tool arguments → tool error `requires approval` (URL
gating is fail-closed by ADR-0054/0055 contract); distilled summary +
`POST /index` with real result entries carrying
`x-anysearch-session-id`.

## Limitations (this round)

- Interactive web UI turn untested — the two named web probes (routing-card
  inject + preheat marker) were verified on a web-profile composition driven
  headlessly; the full browser flow is a later round's matrix.
- Native tool-call timeouts are per-tool budgets inside the bundle
  (search 30 s / recall 15 s / knowledge 60 s / research+chat 300 s) — the
  bridge `toolCallTimeoutMs` knob no longer applies.
- Package is `private` this round; npm publish is a one-field change
  (`private: false` + `publishConfig`) deferred to the release track.
