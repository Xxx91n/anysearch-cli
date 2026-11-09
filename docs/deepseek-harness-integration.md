# DeepSeek Harness (dsh) integration — @anysearch-cli/dsh-plugin

DeepSeek Harness is the sixth verified agent host. The integration has two
surfaces. A thin Cordis bundle mounts the anysearch hooks layer inside the
host process. It also registers the five `ans_*` tools natively on
`ctx.tools` (R90: the Phase-1 MCP-client bridge row is retired; see the
legacy section). All business logic stays on the server. Hooks reach the
anysearch server at `127.0.0.1:33333`. Tool calls reach `ans-mcp` over its
HTTP transport (default `127.0.0.1:3001/mcp`). The dsh process holds no
retrieval logic, no secrets beyond the shared IPC credentials, and no
database access.

Verified against `@deepseek-ai/dsh@0.2.2-rc.1` on 2026-11-10. The web profile
loaded the plugin unchanged, a browser chat turn ran, the routing card showed
up, preheat recall fired, and a live patch reload moved the next model request
to a new port. Evidence is the triage comment on #19 (two green runs, exit 0,
16/16 checks) plus the sandbox report. The anysearch server, the MCP endpoint,
and the model were local stubs, so this round proves the dsh host wiring, not
retrieval quality or real-model behavior. R90: the native tool plane is
implemented and unit-tested against the pinned API
(`@deepseek-ai/dsh-*@0.2.2-rc.1`). The bridge row is retired
(`cordis.patch.yml` now ships the plugin row only).

## Phase 1 (RETIRED — R90) — MCP bridge only (no bundle)

> The bundle no longer ships this row. R90 moved the five tools onto native
> `ctx.tools` registration. This section stays as the manual/legacy path: for
> example, a profile that wants the bridge without the bundle, or a rollback
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

Phase-1 behavior (verified):

- Rows are added with `- insert:` and the complete row (`id` plus `name` plus
  `config`). An `- id:` entry that targets a missing row only warns
  (`patch: entry "mcp-anysearch" not found`).
- `config` replaces the whole targeted row. It never merges. Any override
  (for example, pointing `command` at a repo-local `ans-mcp` build) must
  restate every key, or the row loses them.
- Two `insert` entries with the same `id` are a hard loader error
  (`duplicate loader entry id`). On the native path the bundle owns no bridge
  row. A hand-inserted `mcp-anysearch` row is only the rollback escape
  hatch. User overrides use `- id:` entries.
- The legacy bridge namespace was
  `mcp__anysearch__{search_web,research_web,recall_memory,query_knowledge,ans_chat}`.
  The native plane registers the bare names `ans_search_web` … `ans_ans_chat`
  directly on `ctx.tools`.
- `failOnStartupError: false` plus `reconnect` keep the host booting when the
  MCP server is absent. anysearch is fail-open by contract.

## Phase 2 — hooks bundle (recommended)

```sh
pnpm pack --pack-destination <tmp>          # in apps/dsh-plugin
dsh plugin --profile <name> add <tmp>/anysearch-cli-dsh-plugin-<version>.tgz
# post-publish equivalent: dsh plugin --profile <name> add @anysearch-cli/dsh-plugin
```

`dsh plugin add` installs the package into the profile (zero runtime deps, so
no `pendingBuilds` approval) and registers it under `dsh.profile.bundles`.
The bundle's own `cordis.patch.yml` inserts the plugin row only. Tool
registration happens inside `apply()` through `ctx.tools.register`. Check it
with `dsh --profile <name> --dump-config`: the bundle layer shows
`# == @anysearch-cli/dsh-plugin` with the single row. A user-layer override
shows a `patched by` marker.

Hook surfaces mounted by the bundle. All of them go over HTTP IPC to the
anysearch server and are fail-open: a dead server never blocks the agent.

| Surface | Behavior |
| --- | --- |
| `agent/created` | with `source === 'startup'`, `agent.inject()` writes the routing card as a durable user message (next request). Resume, clear, and compact are skipped. |
| `ctx.systemPrompt` | registers the `anysearch:routing-card` section (every request) |
| `tools/pre-execute` | URL policy check: `deny` on denylist hosts, `ask` on non-allowlist. It is fail-closed on URLs when the policy is unreachable. Recall preheat is injected into the next request. |
| `tools/post-execute` | appends the distilled result summary to `additionalContexts` |
| `tools/result` | indexes the final outcome into the project index (`POST /index`, fire-and-forget) |
| `ctx.tools.register` | five native `ans_*` tools; `execute` is pure transport: MCP `tools/call` JSON-RPC over HTTP, with zero business logic in the bundle |

Server endpoints used: `GET /policy`, `POST /recall`, and `POST /index` on
`ANS_SERVER_URL` (default `http://127.0.0.1:33333`). They use the shared
`ANS_SERVER_TOKEN` / `.anysearch-cli/server-token` credential and pass
`traceparent` plus `x-anysearch-session-id`. Tool execution posts MCP
JSON-RPC to `POST {ANS_MCP_URL}/mcp` (default `http://127.0.0.1:3001`; serve
it with `ans mcp --transport http`). When set, `ANS_MCP_KEY` supplies the
Bearer token; otherwise the server token is sent. The bundle caches a
stateless initialize handshake per endpoint. Session errors re-handshake
once. A transport failure degrades fail-open to empty results. An upstream
`isError` becomes a tool error.

## Layering rules (verified on the real loader)

- Bundle patches apply in `dsh.profile.bundles` order. The user patch applies
  last, so user overrides win.
- Override a bundle row with `- id: <row-id>` entries. Patch the fields you
  need. For `config`, restate every key: the whole row is replaced.
- Live reload comes from `dsh-hmr`, which the shipped `web` template enables.
  The old `patchReload` profile field was removed in 0.1.7, so do not add it.
  Verified on 2026-11-10 with 0.2.2-rc.1: changing the `llm-deepseek` baseURL
  in the user patch while the host was running sent the next request to the
  new port, and the `anysearch:routing-card` section still appeared exactly
  once (no duplicate registration).
- Upgrade check: after bumping `@deepseek-ai/dsh`, diff
  `--dump-default-config` to confirm the bundle rows still land. A future dsh
  release that ships its own `mcp-anysearch` id would collide (the
  duplicate-insert rule). That is exactly what the diff catches.

## Verification transcript (rerunnable)

Headless profile, isolated `$DSH_HOME`. The 2026-09-19 headless evidence and
the 2026-11-10 web run are both recorded in the #19 triage comment.

```sh
# install + register
pnpm pack --pack-destination <tmp>          # apps/dsh-plugin
dsh plugin --profile headless add <tmp>/anysearch-cli-dsh-plugin-<version>.tgz
dsh --profile headless --dump-config        # bundle layer + patched-by markers

# live turn (task positional; exits after one task)
dsh --profile headless "<task>"
```

Verified on the wire:

- the routing-card message and the system-prompt section appear in the first
  model request;
- `anysearch preheat` context appears in a later request;
- a denylisted URL in tool arguments returns a tool error
  `requires approval` (URL gating is fail-closed by the /0055 contract);
- the distilled summary is appended to `additionalContexts`, and `POST /index`
  carries real result entries with `x-anysearch-session-id`.

## Limitations (this round)

- The 2026-11-10 web run used local stubs for the anysearch server, the MCP
  endpoint, and the model. It proves plugin load, the routing card, preheat,
  a native tool call, `/index`, live reload, host shutdown, and port release.
  It does not prove real retrieval or real-model behavior.
- Native tool-call timeouts are per-tool budgets inside the bundle
  (search 30 s / recall 15 s / knowledge 60 s / research+chat 300 s). The
  bridge `toolCallTimeoutMs` knob no longer applies.
- npm publish is deferred to the release track. The package already ships
  `private: false` plus `publishConfig`, so publishing is a release step, not
  a code change.
