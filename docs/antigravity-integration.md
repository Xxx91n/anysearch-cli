# Antigravity integration (`agy` CLI + IDE)

Verified hosts: **Antigravity CLI (`agy`) 1.2.5** (Windows 11, headless
`agy -p` probes). We checked the hook contract and the end-to-end adapter on
2026-09-17. **Antigravity IDE 2.12.2** does not run hooks (we reproduced
this). On that host the supported surface is the rules fallback
`.antigravity/rules/anysearch.mdc`. Contract source:
`.scratch/grill-round-68/evidence/` (s2 contract checks, s3 six-part
acceptance, SEP-2484 exclusion ledger).

These facts were checked on a real host (agy 1.2.5). Do not guess them:

- **hooks.json is a map of named hooks**: `{ "<name>": { "<Event>": [{ matcher,
  hooks: [{ type: "command", command, timeout }] }] } }`. The Gemini-legacy
  `{hooks:{...}}` wrapper fails to parse ("command hook must specify
  'command'"). Tool events take matcher groups. Non-tool events take flat
  handlers (`{type,command,timeout}`; see PreInvocation below).
- **stdin is camelCase**: `conversationId`, `toolCall{name,args}`,
  `workspacePaths`, `transcriptPath`, `artifactDirectoryPath`, `modelName`,
  `stepIdx`. There is no `hook_event_name`. The event arrives through argv
  (`ans-hook-antigravity <Event>`). PostToolUse carries `toolCall` and `error`,
  but no tool output.
- **stdout is strict protojson**: on PreToolUse, `{}` means deny, because a
  decision is required. Empty stdout means allow. The decision object is
  `{decision: allow|deny|ask|force_ask|deny_unless_prior_grant, reason?,
  permissionOverrides?}`. Unknown fields are rejected (protojson is strict).
  PostToolUse accepts only `{}`. Context injection uses
  `injectSteps[].ephemeralMessage` on Pre/PostInvocation. A non-zero exit is a
  tool-level error, and stderr shows up to the agent.
- **Two hook files both load**: `~/.gemini/antigravity-cli/hooks.json` and <!-- machine-local: 用户级 ~ 路径引用（存量合规化） @ 2026-09-22 -->
  `~/.gemini/config/hooks.json` (same-named entries are deduped). <!-- machine-local: 用户级 ~ 路径引用（存量合规化） @ 2026-09-22 -->
- **No SessionStart event**: the five events are PreToolUse, PostToolUse,
  PreInvocation, PostInvocation, and Stop. Instead, the routing card rides on
  `PreInvocation` when `invocationNum === 0`.
- **`agy -p` headless hangs** if a configured MCP server never finishes
  connecting (we saw this with a hung `1mcp` server). Use a sandboxed `HOME`,
  or fix the server. The OAuth token lives in Windows Credential Manager and
  survives a sandboxed `HOME`.
- **Antigravity IDE does not run hooks.** Do not wire
  `configs/antigravity/hooks.json` into IDE settings.

## 1. Install (fresh machine)

```bash
npm i -g @anysearch-cli/cli @anysearch-cli/mcp @anysearch-cli/plugin
ans doctor            # env/keys/providers self-check
```

Global install puts `ans`, `ans-mcp`, `ans-plugin-server`, and
`ans-hook-antigravity` on PATH. The shipped hook commands find them by bin
name.

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

The server writes a 0600 token to `.anysearch-cli/server-token` relative to
its working directory. It serves `/preheat`, `/recall`, `/index`, and
`/policy`.

## 4. MCP tools — `call_mcp_tool` umbrella dispatch

agy sends every MCP call as `toolCall.name = "call_mcp_tool"`, with the real
tool name inside `toolCall.args` (`args.toolName`). The shipped matcher below
covers both the `ans_*` tool names and this umbrella call. The adapter
unwraps the inner name before matching. Register `ans-mcp`
(`command: "ans-mcp"`, stdio) through agy's own MCP configuration so the five
`mcp__anysearch__*` tools appear. We verified the hooks layer end to end. The
MCP call path is covered by contract tests (SEP-2484 P7: the isolated probe
`HOME` carried no user MCP servers). Caveat: a configured but hung MCP server
stalls headless turns.

## 5. Hooks — user-level `hooks.json`

Both files are read: `~/.gemini/antigravity-cli/hooks.json` (preferred) and <!-- machine-local: 用户级 ~ 路径引用（存量合规化） @ 2026-09-22 -->
`~/.gemini/config/hooks.json`. Copy the shipped template <!-- machine-local: 用户级 ~ 路径引用（存量合规化） @ 2026-09-22 -->
`$(npm root -g)/@anysearch-cli/plugin/configs/antigravity/hooks.json` into
one of them. The top-level key (`"anysearch"`) is just a hook group name. If
the file already exists, merge under your own names:

```json
{
  "anysearch": {
    "PreToolUse": [
      {
        "matcher": "call_mcp_tool|.*ans_.*|.*search_web|.*research_web|.*recall_memory|.*query_knowledge",
        "hooks": [
          { "type": "command", "command": "ans-hook-antigravity PreToolUse", "timeout": 5 }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "call_mcp_tool|.*ans_.*|.*search_web|.*research_web|.*recall_memory|.*query_knowledge",
        "hooks": [
          { "type": "command", "command": "ans-hook-antigravity PostToolUse", "timeout": 10 }
        ]
      }
    ],
    "PreInvocation": [
      { "type": "command", "command": "ans-hook-antigravity PreInvocation", "timeout": 5 }
    ],
    "PostInvocation": [
      { "type": "command", "command": "ans-hook-antigravity PostInvocation", "timeout": 10 }
    ],
    "Stop": [
      { "type": "command", "command": "ans-hook-antigravity Stop", "timeout": 5 }
    ]
  }
}
```

What each event does (adapter behavior, verified on the real host):

| Event | Behavior |
|-------|----------|
| PreToolUse | Sends `{decision:"allow"}`: an explicit allow, never `{}` (which would deny). For `ans_*` tools it stages the recall preheat to `anysearch-pending.jsonl`. The protojson deny path (`{decision:"deny", reason}` blocks the tool) is proven by a sentinel, but this adapter never gates. |
| PostToolUse | For `ans_*` tools: distills from `toolCall.args` (the host sends no tool output), POSTs `/index` to the plugin server (fire-and-forget), and stages the distilled summary. Sends `{}`, the only shape the host accepts. |
| PreInvocation | When `invocationNum === 0`, `injectSteps[].ephemeralMessage` carries the routing card (verified reaching the transcript). It also flushes staged preheat and distill text. |
| PostInvocation | Flushes any remaining staged text as `ephemeralMessage`; otherwise sends `{}`. |
| Stop | `{}`. |

Every hook invocation also ensures `.antigravity/rules/anysearch.mdc` exists
in the workspace. That file is the IDE fallback surface, because this host
has no SessionStart event. Pending staging lives at
`<artifactDirectoryPath>/anysearch-pending.jsonl`; it falls back to
`.antigravity/` when the host sends no artifact dir.

## 6. Antigravity IDE — rules fallback

The IDE host does not run hooks. We reproduced this on 2.12.2: IDE session
transcripts show no hook execution. The supported surface is the rules file
`.antigravity/rules/anysearch.mdc`. Any hook invocation writes it under the
project working directory. If the file has not appeared, run a hook once by
hand:

```bash
printf '{}' | ans-hook-antigravity PreInvocation
```

Do not wire `configs/antigravity/hooks.json` into IDE settings. The
named-hook map is a CLI-host contract.

## 7. Failure behavior

If the server is down, a key is missing, or stdin is malformed, hooks exit 0.
PreToolUse still sends an explicit allow, and every other event sends `{}`.
anysearch never blocks the agent. A dead plugin server turns `/index` and
preheat into no-ops. Contract tests live in `apps/plugin/test/`; the adapter
sends `allow` on every error path.

## Verification transcript (rerunnable)

Headless `agy -p` with an isolated `HOME`. A hung user MCP server stalls turn
initialization; the OAuth token survives because it lives in Windows
Credential Manager:

```sh
printf '{}' | ans-hook-antigravity PreToolUse     # {"decision":"allow"}
printf '{}' | ans-hook-antigravity Stop           # {}
agy -p "<task>"                                    # all five events fire
```

Evidence ledger: `.scratch/grill-round-68/evidence/t3-s2s3-verdict.md`. It
covers s2 contract checks, s3 six-part acceptance, and SEP-2484 exclusions:
`call_mcp_tool` unwrap, `conversationId`→session propagation, `injectSteps`
delivery, fail-open, the `PostToolUse` no-output shape, and the `.mdc`
fallback.
