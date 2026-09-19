# DeepSeek Harness (dsh) integration — @anysearch-cli/dsh-plugin

DeepSeek Harness is the sixth verified agent host (ADR-0073). The integration
is two-phase: **Phase 1** wires the official MCP client bridge with zero
product code; **Phase 2** adds a thin Cordis bundle that mounts the anysearch
hooks layer inside the host process. All business logic stays in the anysearch
server at `127.0.0.1:33333` — the dsh process carries no retrieval logic, no
secrets beyond the shared IPC token, and no database access.

Verified against `@deepseek-ai/dsh@0.1.5-rc.2` (headless profile +
web-profile composition), 2026-09-19. Evidence:
`.scratch/grill-round-72/evidence/`.

## Phase 1 — MCP bridge only (no bundle)

Register the official MCP client bridge in the profile's user patch so the
five `mcp__anysearch__*` tools appear on `ctx.tools`. Edit
`$DSH_HOME/profiles/<name>/cordis.patch.yml`:

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
  (`duplicate loader entry id`). Do not keep a hand-inserted
  `mcp-anysearch` row once the Phase-2 bundle is installed — the bundle owns
  that id; user overrides use `- id:` entries.
- Tools register asynchronously after startup; the stable namespace is
  `mcp__anysearch__{search_web,research_web,recall_memory,query_knowledge,ans_chat}`.
- `failOnStartupError: false` + `reconnect` keep the host booting when the
  MCP server is absent — anysearch fail-open by contract.

## Phase 2 — hooks bundle (recommended)

```sh
dsh plugin --profile <name> add @anysearch-cli/dsh-plugin
```

`dsh plugin add` installs the package into the profile (zero runtime deps →
no `pendingBuilds` approval) and registers it under
`dsh.profile.bundles`. The bundle's own `cordis.patch.yml` inserts both
rows — the hooks plugin and the `mcp-anysearch` bridge — so Phase-1 becomes
automatic. Verify with `dsh --profile <name> --dump-config`: the bundle layer
shows `# == @anysearch-cli/dsh-plugin` with both rows; a user-layer override
shows a `patched by` marker.

Hook surfaces mounted by the bundle (all over HTTP IPC to the anysearch
server, fail-open — a dead server never blocks the agent):

| Surface | Behaviour |
| --- | --- |
| `agent/session-start` | `agent.inject()` writes the routing card as a durable user message (next request) |
| `ctx.systemPrompt` | registers `anysearch:routing-card` section (every request) |
| `tools/pre-execute` | URL-policy gate — `deny` on denylist hosts, `ask` on non-allowlist (fail-closed on URLs when the policy is unreachable) + recall preheat injected into the next request |
| `tools/post-execute` | appends the distilled result summary to `additionalContexts` |
| `tools/result` | indexes the final outcome to the project index (`POST /index`, fire-and-forget) |

Server endpoints used: `GET /policy`, `POST /recall`, `POST /index` on
`ANS_SERVER_URL` (default `http://127.0.0.1:33333`) with the shared
`ANS_SERVER_TOKEN` / `.anysearch-cli/server-token` credential and
`traceparent` + `x-anysearch-session-id` propagation.

## Layering rules (verified on the real loader)

- Bundle patches apply in `dsh.profile.bundles` order; the user patch applies
  last → user overrides win.
- Override a bundle row with `- id: <row-id>` entries (patch the fields you
  need; for `config` restate every key — whole-row replacement).
- `patchReload: "startup"` (headless) applies patches on next boot;
  `patchReload: "live"` (web) reloads the patch layer live — our listeners
  are fiber-scoped Cordis effects and dispose cleanly on reload.
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
- `ans_chat`/`research_web` long-call timeouts ride the bridge's
  `toolCallTimeoutMs` (60 s) — raise it in the user patch for deep-research
  workloads.
- Package is `private` this round; npm publish is a one-field change
  (`private: false` + `publishConfig`) deferred to the release track.
