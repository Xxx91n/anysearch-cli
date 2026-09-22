# Codex CLI integration

Verified host: **codex-cli 0.142.5** (Windows 11) — headless `codex exec
--json` probes, verified **2026-09-17**; transcripts in
`.scratch/grill-round-67/evidence/`.
Contract source: ADR-0068 +
`.scratch/grill-round-67/evidence/t1-defect-ledger.md`.

Hard-won host facts (live-verified on 0.142.5 — do not guess these):

- **stdin field is `hook_event_name`** (adapters fall back to legacy
  `event`). Real payload: `{session_id, transcript_path, cwd,
  hook_event_name, model, permission_mode, source?, tool_name?,
  tool_input?, tool_response?, turn_id?}`.
- **stdout must use the `hookSpecificOutput` envelope.** Bare top-level
  `additionalContext` is racy (~80% dropped, measured 1/8 + 1/3); bare
  `permissionDecision` never blocks; **exit code 2 does not block**.
  Envelope `permissionDecision:"deny"` + `permissionDecisionReason` blocks
  the tool call (verified end-to-end via the URL denylist).
- **Hooks schema**:
  `{ "<Event>": [{ matcher, hooks: [{ type:"command", command, timeout }] }] }`.
  The `{name,command,args}` shape (shipped ≤0.0.4) registers **zero** hooks.
- **Matcher is a FULL-MATCH regex** — `mcp__anysearch__` does not match
  `mcp__anysearch__search_web`. Use `.*(search_web|research_web|
  recall_memory|query_knowledge|ans_chat)$` or `.*`.
- **`-c` cannot inject hooks** — `-c hooks.X=[...]` is parsed as a string
  ("expected a sequence"). Hook definitions must be materialized into a
  config file layer.
- **Config layers**: `[features] hooks = true` + `[[hooks.<Event>]]`
  sections in `$CODEX_HOME/config.toml`, or project `.codex/hooks.json` <!-- machine-local: POSIX env-var 路径引用（存量合规化） @ 2026-09-22 -->
  (fires when the project is trusted via `[projects.'<path>']` in the user
  config; hook trust itself is persisted as `[hooks.state."<key>"]
  trusted_hash = "sha256:..."` entries — headless probes use
  `--dangerously-bypass-hook-trust`, labeled accordingly).
- **Hooks inherit codex's env** — `ANS_SERVER_URL` / `ANS_SERVER_TOKEN` /
  `ANYSEARCH_*` set in the codex process env reach hook processes.
- **`required = true` MCP servers hard-exit** on startup failure (by
  design); anysearch tools/hooks themselves stay fail-open.
- **PostToolUse context injection is same-turn-variable** — the distilled
  `additionalContext` lands at the next-turn boundary; durable value comes
  from the `/index` side effect (project-index accumulation is verified).

## 1. Install (stranger path)

```bash
npm i -g @anysearch-cli/cli @anysearch-cli/mcp @anysearch-cli/plugin
ans doctor            # env/keys/providers self-check
```

Global install puts `ans`, `ans-mcp`, `ans-plugin-server`,
`ans-hook-codex`, `ans-hook-session-start` on PATH — the shipped hook
commands resolve by bin name.

## 2. Keys

User/OS-level env, never written into config files — `ANYSEARCH_API_KEY`,
`ANS_LLM_BASE_URL` + `ANS_LLM_API` + `ANS_LLM_API_KEY`,
`ANS_LLM_PROVIDER` + `ANS_LLM_MODEL`, `EXA_API_KEY` / `TAVILY_API_KEY`.

## 3. Plugin server (once per machine)

```bash
ans-plugin-server     # listens 127.0.0.1:33333, Bearer token auto-generated
```

The server materializes `.anysearch-cli/policy.json` per project (hook-side
policy fallback) and serves `/preheat` `/recall` `/index` `/policy`.

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

Exposes `search_web`, `research_web`, `recall_memory`, `query_knowledge`,
`ans_chat`. Leave `required` unset/false unless a hard startup dependency
is intended — Codex exits when a required MCP fails.

## 5. Hooks

**Option A — project layer** (`<project>/.codex/hooks.json`): copy
`configs/codex/hooks.json` from the installed plugin package
(`$(npm root -g)/@anysearch-cli/plugin/configs/codex/hooks.json`). Requires
the project to be trusted (`[projects.'<path>'] trust_level = "trusted"` in
user config) and the hook trust prompt accepted once per definition.

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

- **SessionStart** → injects the routing card via
  `hookSpecificOutput.additionalContext` (envelope required — the bare form
  is dropped), and writes `.cursor/rules/anysearch.mdc` as the
  Cursor/Antigravity fallback.
- **PreToolUse** → URL-policy gate (`permissionDecision` deny/ask via
  envelope — verified blocking) + recall preheat context.
- **PostToolUse** → distills the tool response, POSTs `/index` into the
  project FTS5 index (verified +N rows per call), and emits the distilled
  summary as `additionalContext` for the next turn.

**Optional — project `AGENTS.md` hint.** The plugin ships a ready-made
anysearch block (`ans_*` tool whitelist + fail-open semantics + namespace
conventions) at
`$(npm root -g)/@anysearch-cli/plugin/AGENTS.md`. Paste it into your
project's `AGENTS.md` so the host agent recognizes the `ans_*` tools and
knows hook/server failures degrade gracefully.

## 6. Fail-open

Server down → tools fall back to direct providers, hooks exit 0, sessions
uninterrupted. Malformed hook stdin → exit 0, no output. Contract-tested in
`apps/plugin/test/codex-contract.test.ts`.
