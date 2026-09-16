# CodeBuddy Code integration

Verified host: **CodeBuddy Code 2.149.0** (Windows 11, Git Bash hooks).
Contract source: ADR-0066 + `.scratch/grill-round-65/evidence/`.

CodeBuddy hooks run commands through Git Bash on Windows, inject
`hook_event_name` on stdin (not `event`), expect decisions inside a
`hookSpecificOutput` envelope on stdout, and pass SessionStart stdout into
context verbatim.

## 1. Install (stranger path)

```bash
npm i -g @anysearch-cli/cli @anysearch-cli/mcp @anysearch-cli/plugin
ans doctor            # 22 pass expected; keys/providers/domains self-check
ans domain docs       # optional: pin the demo domain (persists to ~/.anysearch/config.env)
```

## 2. Keys

Set at OS/user level — never written into config files:

- `ANYSEARCH_API_KEY` — internal anysearch service
- `ANS_LLM_BASE_URL` + `ANS_LLM_API=chat` + `ANS_LLM_API_KEY` — upstream
  OpenAI-compatible `v1/chat` endpoint (for `ans_chat`)
- `EXA_API_KEY` / `TAVILY_API_KEY` — retrieval providers

## 3. Plugin server (once per machine)

```bash
ans-plugin-server     # listens 127.0.0.1:33333, Bearer token auto-generated
```

On ≤0.0.3 there is no bin — hand-launch instead:

```bash
node "$(npm root -g)/@anysearch-cli/plugin/dist/server/index.cjs"
```

The server writes a 0600 token to `<cwd>/.anysearch-cli/server-token`;
hooks read the same file relative to their working directory. Launch it
from (or share cwd with) the project you work in.

## 4. MCP registration — project `mcp.json`

```json
{
  "mcpServers": {
    "anysearch": { "command": "ans-mcp", "args": [], "env": {} }
  }
}
```

Empty `env` block is deliberate: the child inherits the host env, so keys
never sit in a file. Drive headless with
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

One adapter entry serves all three events (it dispatches on
`hook_event_name` internally). `$(npm root -g)` resolves the global install
inside Git Bash.

What each event does:

| Event | Behavior |
|-------|----------|
| SessionStart | prints the ans_* routing card — stdout enters context verbatim |
| PreToolUse | recalls the project index and returns `hookSpecificOutput.additionalContext` (preheat) |
| PostToolUse | distills `tool_response.results[]` → `hookSpecificOutput.updatedToolOutput`, and POSTs index entries to the plugin server (`/index`) |

## 6. Fail-open contract

Server down / key missing / bad stdin → the hook exits 0 and the host runs
unaffected. Hooks never block CodeBuddy.
