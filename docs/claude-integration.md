# Claude Code integration

Verified host: **Claude Code 2.1.251** (Windows 11). We checked it with
headless `-p` stream-json probes on **2026-09-17**. Transcripts are in
`.scratch/grill-round-66/evidence/`.
Contract source: `.scratch/grill-round-66/evidence/defect-ledger.md`.

These facts were checked on a real host. Do not guess them:

- **stdin field is `hook_event_name`.** Adapters also accept the old `event` field.
- **stdout must be wrapped in `hookSpecificOutput`.** A bare top-level
  `additionalContext`, `updatedToolOutput`, or `permissionDecision` is dropped
  without notice. We proved this with deny sentinels.
  `hookSpecificOutput.permissionDecision: "deny"` and the old
  `{decision:"block"}` both block the tool call. The same fields at top level
  do not block: the call runs anyway (`permission_denials: []`).
- **Settings hooks use the official schema**
  `{ "<Event>": [{ matcher, hooks: [{ type:"command", command, timeout }] }] }`.
  The old `{name,command,args}` shape is accepted silently, but it poisons the
  whole event column: every hook for that event is dropped.
- **Pre/PostToolUse hooks run headless but emit no stream-json events.**
  hook_started and hook_response only appear for SessionStart. Input
  validation failures (`{}` args) happen before hook dispatch, so a failed
  tool call never reaches hooks. Watch tool hooks through side effects (marker
  files, /index deltas), not the transcript.
- **`type:"http"` hooks in settings are silently dropped** (Claude Code
  2.1.251). Command hooks are the only settings path that works.
- **MCP tool calls do trigger hooks.** Both matcher `.*` and
  `mcp__anysearch__.*` work.

## 1. Install (fresh machine)

```bash
npm i -g @anysearch-cli/cli @anysearch-cli/mcp @anysearch-cli/plugin
ans doctor            # env/keys/providers self-check
ans domain docs       # optional: pin the demo domain
```

## 2. Keys

Set these at the user/OS level. Never write them into config files:
`ANYSEARCH_API_KEY`, `ANS_LLM_BASE_URL` + `ANS_LLM_API=chat` + `ANS_LLM_API_KEY`,
`ANS_LLM_PROVIDER` + `ANS_LLM_MODEL`, `ANS_LLM_CONTEXT_WINDOW` (optional), and
`EXA_API_KEY` / `TAVILY_API_KEY`.
`ANS_LLM_CONTEXT_WINDOW` is the real model window for custom endpoints. It
feeds request budgeting and the `{fraction}` L0 watermarks on `ans chat`. For
MCP `ans_chat` session and memory behavior, see
[mcp-server.md](mcp-server.md).
Claude's own model/proxy env (`ANTHROPIC_*`) lives in `~/.claude/settings.json`. <!-- machine-local: 用户级 ~ 路径引用（存量合规化） @ 2026-09-22 -->

## 3. Plugin server (once per machine)

```bash
ans-plugin-server     # listens 127.0.0.1:33333, Bearer token auto-generated
```

On `≤0.0.3` there is no bin. Start it by hand:
`node "$(npm root -g)/@anysearch-cli/plugin/dist/server/index.cjs"`.
The server writes a 0600 token to `<cwd>/.anysearch-cli/server-token`.
Hooks look for the same file relative to their cwd.

## 4. MCP registration — project `mcp.json`

```json
{
  "mcpServers": {
    "anysearch": { "command": "ans-mcp", "args": [], "env": {} }
  }
}
```

An empty `env` is on purpose: the child inherits the host env. To drive it
headless, run
`claude -p "<prompt>" --output-format stream-json --verbose --mcp-config mcp.json --dangerously-skip-permissions`.
`--verbose` is required for stream-json to include init, hook, and tool detail.

## 5. Hooks — project `.claude/settings.json`

Shipped template: `@anysearch-cli/plugin/configs/claude/hooks.json`. It uses
the official schema, and the commands are the package's global bins:

```json
{
  "hooks": {
    "PreToolUse":  [{ "matcher": ".*",
      "hooks": [{ "type": "command", "command": "ans-hook-claude", "timeout": 5 }] }],
    "PostToolUse": [{ "matcher": ".*",
      "hooks": [{ "type": "command", "command": "ans-hook-claude", "timeout": 10 }] }],
    "SessionStart": [{ "matcher": "startup",
      "hooks": [{ "type": "command", "command": "ans-hook-session-start --envelope", "timeout": 5 }] }]
  }
}
```

`ans-hook-claude` dispatches Pre/PostToolUse internally, based on
`hook_event_name`. Narrow the matchers to `mcp__anysearch__.*` if you only
want ans_* tools intercepted.

What each event does:

| Event | Behavior |
|-------|----------|
| SessionStart | `hookSpecificOutput.additionalContext` carries the ans_* routing card, which goes into context |
| PreToolUse | recall preheat goes into `hookSpecificOutput.additionalContext`; the URL policy sends `permissionDecision` ask/deny inside the same `hookSpecificOutput` |
| PostToolUse | distills `tool_response.results[]` into a `hookSpecificOutput.additionalContext` summary; also POSTs index entries to the plugin server (`/index`) |

## 6. Plugin form (experimental)

The package is a valid Claude Code plugin. The tarball ships
`.claude-plugin/plugin.json`, `hooks/hooks.json`, and `.mcp.json`.
`claude plugin validate <pkg-dir>` passes. Load it per session with
`claude --plugin-dir <pkg-dir>` (you can repeat the flag; `--plugin-url`
fetches a .zip).

**Why it is experimental**: plugin hooks point at
`${CLAUDE_PLUGIN_ROOT}/dist/...`, and `CLAUDE_PLUGIN_ROOT` expansion is <!-- machine-local: POSIX env-var 路径引用（存量合规化） @ 2026-09-22 -->
broken on Windows (upstream issue #16116 chain). The settings.json path
in §5 is the supported one. The plugin skeleton exists so the same layout
works once the upstream bug is fixed.

## 7. Failure behavior

If the server is down, a key is missing, or stdin is bad, the hook exits 0 and
the session is unaffected. We checked this on a real host: we killed the
server on port 33333 in the middle of the probe matrix, and the session still
finished; all SessionStart hooks exited 0. The hooks are fail-open, so they
never block Claude.
