# Claude Code integration

Verified host: **Claude Code 2.1.251** (Windows 11) — headless `-p`
stream-json probes; transcripts in `.scratch/grill-round-66/evidence/`.
Contract source: ADR-0067 + `.scratch/grill-round-66/evidence/defect-ledger.md`.

Hard-won host facts (live-verified, do not guess these):

- **stdin field is `hook_event_name`** (adapters fall back to legacy `event`).
- **stdout must use the `hookSpecificOutput` envelope.** Bare top-level
  `additionalContext` / `updatedToolOutput` / `permissionDecision` are silently
  dropped — proven by deny sentinels: `hookSpecificOutput.permissionDecision:
  "deny"` and legacy `{decision:"block"}` both block the tool call; the same
  fields at top level execute anyway (`permission_denials: []`).
- **settings hooks use the official schema**
  `{ "<Event>": [{ matcher, hooks: [{ type:"command", command, timeout }] }] }`.
  The old `{name,command,args}` shape is accepted silently but **poisons the
  whole event column** — every hook for that event is dropped.
- **Pre/PostToolUse hooks run headless but emit no stream-json events**
  (hook_started/hook_response only appear for SessionStart). Input-validation
  failures (`{}` args) precede hook dispatch — a failed tool call never
  reaches hooks. Observe tool hooks via side effects (marker files, /index
  deltas), not the transcript.
- **`type:"http"` hooks in settings are silently dropped** (Claude Code
  2.1.251) — command hooks are the only viable settings path.
- **MCP tool calls DO trigger hooks** — matcher `.*` and
  `mcp__anysearch__.*` both work.

## 1. Install (stranger path)

```bash
npm i -g @anysearch-cli/cli @anysearch-cli/mcp @anysearch-cli/plugin
ans doctor            # env/keys/providers self-check
ans domain docs       # optional: pin the demo domain
```

## 2. Keys

User/OS-level env, never written into config files — `ANYSEARCH_API_KEY`,
`ANS_LLM_BASE_URL` + `ANS_LLM_API=chat` + `ANS_LLM_API_KEY`,
`ANS_LLM_PROVIDER` + `ANS_LLM_MODEL`, `EXA_API_KEY` / `TAVILY_API_KEY`.
Claude's own model/proxy env (`ANTHROPIC_*`) lives in `~/.claude/settings.json`.

## 3. Plugin server (once per machine)

```bash
ans-plugin-server     # listens 127.0.0.1:33333, Bearer token auto-generated
```

On `≤0.0.3` there is no bin — hand-launch
`node "$(npm root -g)/@anysearch-cli/plugin/dist/server/index.cjs"`.
The server writes a 0600 token to `<cwd>/.anysearch-cli/server-token`;
hooks resolve the same file relative to their cwd.

## 4. MCP registration — project `mcp.json`

```json
{
  "mcpServers": {
    "anysearch": { "command": "ans-mcp", "args": [], "env": {} }
  }
}
```

Empty `env` is deliberate (child inherits host env). Headless drive:
`claude -p "<prompt>" --output-format stream-json --verbose
--mcp-config mcp.json --dangerously-skip-permissions` — `--verbose` is
required for stream-json to include init/hook/tool detail.

## 5. Hooks — project `.claude/settings.json`

Shipped template: `@anysearch-cli/plugin/configs/claude/hooks.json`
(official schema; commands are the package's global bins):

```json
{
  "hooks": {
    "PreToolUse":  [{ "matcher": ".*",
      "hooks": [{ "type": "command", "command": "ans-hook-claude", "timeout": 5 }] }],
    "PostToolUse": [{ "matcher": ".*",
      "hooks": [{ "type": "command", "command": "ans-hook-claude", "timeout": 10 }] }],
    "SessionStart": [{ "matcher": "startup",
      "hooks": [{ "type": "command", "command": "ans-hook-session-start", "timeout": 5 }] }]
  }
}
```

`ans-hook-claude` dispatches Pre/PostToolUse internally on
`hook_event_name`. Narrow the matchers to
`mcp__anysearch__.*` if you only want ans_* tools intercepted.

What each event does:

| Event | Behavior |
|-------|----------|
| SessionStart | `hookSpecificOutput.additionalContext` = the ans_* routing card (injected into context) |
| PreToolUse | recall preheat → `hookSpecificOutput.additionalContext`; URL policy → `permissionDecision` ask/deny inside the same envelope |
| PostToolUse | distill `tool_response.results[]` → `hookSpecificOutput.additionalContext` summary; POSTs index entries to the plugin server (`/index`) |

## 6. Plugin form (experimental)

The package is a valid Claude Code plugin: `.claude-plugin/plugin.json` +
`hooks/hooks.json` + `.mcp.json` ship in the tarball and
`claude plugin validate <pkg-dir>` passes. Load per-session with
`claude --plugin-dir <pkg-dir>` (repeatable; `--plugin-url` fetches a .zip).

**Experimental because**: plugin hooks reference
`${CLAUDE_PLUGIN_ROOT}/dist/...`, and `CLAUDE_PLUGIN_ROOT` expansion is
broken on Windows (upstream issue #16116 chain). The settings.json path
(§5) is the supported one; the plugin skeleton exists so the same layout
works the day the upstream bug is fixed.

## 7. Fail-open contract

Server down / key missing / bad stdin → hook exits 0, session unaffected
(live-verified: kill 33333 mid-matrix → session completes, all SessionStart
hooks exit 0). Hooks never block Claude.
