# CodeBuddy Code integration

Verified host: **CodeBuddy Code 2.151.0** (Windows 11, Git Bash hooks). We
checked it on **2026-09-16** with the headless P1–P9 probe matrix: search,
recall, ans_chat, research, 3-event hooks, fail-open, and a with/without-tool
contrast. The stream-json transcripts are in
`.scratch/grill-round-65/evidence/t2-*.stream.jsonl`.
Contract source: `.scratch/grill-round-65/evidence/`.

On Windows, CodeBuddy hooks run commands through Git Bash. They put
`hook_event_name` on stdin (not `event`). They expect decisions wrapped in
`hookSpecificOutput` on stdout. They pass SessionStart stdout into context
word for word.

## 1. Install (fresh machine)

```bash
npm i -g @anysearch-cli/cli @anysearch-cli/mcp @anysearch-cli/plugin
ans doctor            # 22 pass expected; keys/providers/domains self-check
ans domain docs       # optional: pin the demo domain (persists to ~/.anysearch/config.env) <!-- machine-local: 用户级 ~ 路径引用（存量合规化） @ 2026-09-22 -->
```

## 2. Keys

Set these at the OS/user level. Never write them into config files:

- `ANYSEARCH_API_KEY` — the internal anysearch service
- `ANS_LLM_BASE_URL` + `ANS_LLM_API=chat` + `ANS_LLM_API_KEY` — an upstream
  OpenAI-compatible `v1/chat` endpoint (used by `ans_chat`)
- `ANS_LLM_PROVIDER` + `ANS_LLM_MODEL` — required by `ans_chat`. For a custom
  endpoint, the provider id can be anything (`custom` works). The model must
  be an id the upstream serves; check `GET <base>/models`
- `ANS_LLM_CONTEXT_WINDOW` — optional. It is the real model window in tokens
  for custom endpoints. It feeds request budgeting and the L0 `{fraction}`
  watermark on `ans chat`. For MCP `ans_chat` session and memory behavior,
  see [mcp-server.md](mcp-server.md). If you leave it unset, the window is
  unknown, and the CLI falls back to a flat 128000
- `EXA_API_KEY` / `TAVILY_API_KEY` — search providers

## 3. Plugin server (once per machine)

```bash
ans-plugin-server     # listens 127.0.0.1:33333, Bearer token auto-generated
```

On ≤0.0.3 there is no bin. Start it by hand:

```bash
node "$(npm root -g)/@anysearch-cli/plugin/dist/server/index.cjs"
```

The server writes a 0600 token to `<cwd>/.anysearch-cli/server-token`. Hooks
read the same file relative to their working directory. Start it from the
project you work in, or share its cwd with that project.

## 4. MCP registration — project `mcp.json`

```json
{
  "mcpServers": {
    "anysearch": { "command": "ans-mcp", "args": [], "env": {} }
  }
}
```

The empty `env` block is on purpose. The child inherits the host env, so keys
never sit in a file. Drive it headless with
`codebuddy -p --output-format stream-json --mcp-config mcp.json --strict-mcp-config`.

## 5. Hooks — project `.codebuddy/settings.json`

Shipped template: `@anysearch-cli/plugin/configs/codebuddy/hooks.json`.

```json
{
  "hooks": {
    "PreToolUse":  [{ "matcher": "search_web|research_web|recall_memory|query_knowledge|ans_chat",
      "hooks": [{ "type": "command",
        "command": "node \"$(npm root -g)/@anysearch-cli/plugin/dist/hooks/adapters/codebuddy.cjs\"", "timeout": 5 }] }],
    "PostToolUse": [{ "matcher": "search_web|research_web|recall_memory|query_knowledge|ans_chat",
      "hooks": [{ "type": "command",
        "command": "node \"$(npm root -g)/@anysearch-cli/plugin/dist/hooks/adapters/codebuddy.cjs\"", "timeout": 10 }] }],
    "SessionStart": [{ "matcher": "*",
      "hooks": [{ "type": "command",
        "command": "node \"$(npm root -g)/@anysearch-cli/plugin/dist/hooks/adapters/codebuddy.cjs\"", "timeout": 5 }] }]
  }
}
```

One adapter entry serves all three events. It dispatches on `hook_event_name`
itself. `$(npm root -g)` resolves the global install inside Git Bash.

What each event does:

| Event | Behavior |
|-------|----------|
| SessionStart | prints the ans_* routing card; stdout enters context word for word |
| PreToolUse | recalls the project index and returns `hookSpecificOutput.additionalContext` (preheat) |
| PostToolUse | distills `tool_response.results[]` into `hookSpecificOutput.updatedToolOutput`, and POSTs index entries to the plugin server (`/index`) |

## 6. Failure behavior

The hooks are fail-open. If the server is down, a key is missing, or stdin is
bad, the hook exits 0 and the host keeps running. Hooks never block
CodeBuddy.
