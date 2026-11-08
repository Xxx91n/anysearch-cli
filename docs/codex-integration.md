# Codex CLI integration

Verified host: **codex-cli 0.142.5** (Windows 11). We checked it with headless
`codex exec --json` probes on **2026-09-17**. Transcripts are in
`.scratch/grill-round-67/evidence/`.
Contract source: `.scratch/grill-round-67/evidence/t1-defect-ledger.md`.

These facts were checked on a real host (0.142.5). Do not guess them:

- **stdin field is `hook_event_name`.** Adapters also accept the old `event`
  field. The real payload is `{session_id, transcript_path, cwd,
  hook_event_name, model, permission_mode, source?, tool_name?,
  tool_input?, tool_response?, turn_id?}`.
- **stdout must be wrapped in `hookSpecificOutput`.** A bare top-level
  `additionalContext` is unreliable. We measured about 80% dropped (1/8 and
  1/3). A bare `permissionDecision` never blocks, and exit code 2 does not
  block either. The wrapper with `permissionDecision:"deny"` plus
  `permissionDecisionReason` does block the tool call. We checked this end to
  end with the URL denylist.
- **Hooks schema**:
  `{ "<Event>": [{ matcher, hooks: [{ type:"command", command, timeout }] }] }`.
  The old `{name,command,args}` shape (shipped ≤0.0.4) registers zero hooks.
- **A matcher is a full-match regex.** `mcp__anysearch__` does not match
  `mcp__anysearch__search_web`. Use `.*(search_web|research_web|recall_memory|query_knowledge|ans_chat)$` or `.*`.
- **`-c` cannot inject hooks.** `-c hooks.X=[...]` is read as a string
  ("expected a sequence"). Hook definitions must go into a config file.
- **Config layers**: add `[features] hooks = true` plus `[[hooks.<Event>]]`
  sections in `$CODEX_HOME/config.toml`, or use the project file `.codex/hooks.json` <!-- machine-local: POSIX env-var 路径引用（存量合规化） @ 2026-09-22 -->
  It fires when the project is trusted through `[projects.'<path>']` in the
  user config. Hook trust itself is saved as `[hooks.state."<key>"]
  trusted_hash = "sha256:..."` entries. Headless probes use
  `--dangerously-bypass-hook-trust`, and we label them that way.
- **Hooks inherit codex's env.** `ANS_SERVER_URL`, `ANS_SERVER_TOKEN`, and
  `ANYSEARCH_*` set in the codex process env reach hook processes.
- **`required = true` MCP servers hard-exit** when they fail at startup. That
  is by design. anysearch tools and hooks themselves stay fail-open.
- **PostToolUse context arrives at the next turn.** The distilled
  `additionalContext` lands at the next-turn boundary, and delivery varies.
  The lasting value comes from the `/index` side effect: project-index growth
  is verified.

## 1. Install (fresh machine)

```bash
npm i -g @anysearch-cli/cli @anysearch-cli/mcp @anysearch-cli/plugin
ans doctor            # env/keys/providers self-check
```

Global install puts `ans`, `ans-mcp`, `ans-plugin-server`,
`ans-hook-codex`, and `ans-hook-session-start` on PATH. The shipped hook
commands find them by bin name.

## 2. Keys

Set these at the user/OS level. Never write them into config files:
`ANYSEARCH_API_KEY`, `ANS_LLM_BASE_URL` + `ANS_LLM_API` + `ANS_LLM_API_KEY`,
`ANS_LLM_PROVIDER` + `ANS_LLM_MODEL`, and
`EXA_API_KEY` / `TAVILY_API_KEY`.
`ANS_LLM_CONTEXT_WINDOW` is optional. It is the real model window for custom
endpoints. It feeds request budgeting and the `{fraction}` L0 watermarks on
`ans chat`. For MCP `ans_chat` session and memory behavior, see
[mcp-server.md](mcp-server.md).

## 3. Plugin server (once per machine)

```bash
ans-plugin-server     # listens 127.0.0.1:33333, Bearer token auto-generated
```

The server writes `.anysearch-cli/policy.json` for each project (the
hook-side policy fallback). It serves `/preheat`, `/recall`, `/index`, and
`/policy`.

## 4. MCP server

`config.toml` (`$CODEX_HOME/config.toml`, default `~/.codex/config.toml`): <!-- machine-local: POSIX env-var 路径引用（存量合规化） @ 2026-09-22 -->

<!-- machine-local: illustrative placeholder path in doc example @ 2026-09-19 -->
```toml
[mcp_servers.anysearch]
command = "ans-mcp"
startup_timeout_sec = 60

[mcp_servers.anysearch.env]
# optional: explicit project-index location for recall_memory
# ANS_PROJECT_DB = "D:/path/to/project/.anysearch/project-index.db"
```

It exposes `search_web`, `research_web`, `recall_memory`, `query_knowledge`,
and `ans_chat`. Leave `required` unset or false unless you want a hard startup
dependency. Codex exits when a required MCP server fails.

## 5. Hooks

**Option A — project layer** (`<project>/.codex/hooks.json`): copy
`configs/codex/hooks.json` from the installed plugin package
(`$(npm root -g)/@anysearch-cli/plugin/configs/codex/hooks.json`). The project
must be trusted (`[projects.'<path>'] trust_level = "trusted"` in the user
config). Accept the hook trust prompt once per definition.

**Option B — user layer** (`$CODEX_HOME/config.toml`): <!-- machine-local: POSIX env-var 路径引用（存量合规化） @ 2026-09-22 -->

```toml
[features]
hooks = true

[[hooks.SessionStart]]
matcher = "startup"
hooks = [{ type = "command", command = "ans-hook-session-start --envelope", timeout = 5 }]

[[hooks.PreToolUse]]
matcher = ".*(search_web|research_web|recall_memory|query_knowledge|ans_chat)$"
hooks = [{ type = "command", command = "ans-hook-codex", timeout = 5 }]

[[hooks.PostToolUse]]
matcher = ".*(search_web|research_web|recall_memory|query_knowledge|ans_chat)$"
hooks = [{ type = "command", command = "ans-hook-codex", timeout = 10 }]
```

What each hook does:

- **SessionStart** injects the routing card through
  `hookSpecificOutput.additionalContext`. The wrapper is required; the bare
  form is dropped. It also writes `.cursor/rules/anysearch.mdc` as the
  Cursor/Antigravity fallback.
- **PreToolUse** runs the URL policy check (`permissionDecision` deny/ask
  inside the wrapper; blocking is verified) and adds recall preheat context.
- **PostToolUse** distills the tool response and POSTs `/index` into the
  project FTS5 index (verified: +N rows per call). It also sends the
  distilled summary as `additionalContext` for the next turn.

**Optional — project `AGENTS.md` hint.** The plugin ships a ready-made
anysearch block at `$(npm root -g)/@anysearch-cli/plugin/AGENTS.md`. It holds
the `ans_*` tool whitelist, fail-open behavior, and namespace conventions.
Paste it into your project's `AGENTS.md` so the host agent knows the `ans_*`
tools. It also learns that hook and server failures degrade gracefully.

## 6. Failure behavior

If the server is down, tools fall back to direct providers. Hooks exit 0, and
sessions keep running. Malformed hook stdin also exits 0 with no output.
Contract tests live in `apps/plugin/test/codex-contract.test.ts`.
