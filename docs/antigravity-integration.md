# Antigravity integration (`agy` CLI + IDE)

Verified hosts: **Antigravity CLI (`agy`) 1.2.5** (Windows 11, headless
`agy -p` probes) — hook contract + end-to-end adapter verified 2026-09-17;
**Antigravity IDE 2.12.2** — the IDE host does not execute hooks
(reproduced); the `.antigravity/rules/anysearch.mdc` rules fallback is the
supported surface there. Contract source: ADR-0069 +
`.scratch/grill-round-68/evidence/` (s2 contract legs + s3 six-leg
acceptance + SEP-2484 exclusion ledger).

Hard-won host facts (live-verified on agy 1.2.5 — do not guess these):

- **hooks.json is a named-hook map** — `{ "<name>": { "<Event>": [{ matcher,
  hooks: [{ type: "command", command, timeout }] }] } }`. The Gemini-legacy
  `{hooks:{...}}` wrapper **fails to parse** ("command hook must specify
  'command'"). Tool events take matcher groups; non-tool events take flat
  handlers (`{type,command,timeout}` — see PreInvocation below).
- **stdin is camelCase** — `conversationId` / `toolCall{name,args}` /
  `workspacePaths` / `transcriptPath` / `artifactDirectoryPath` /
  `modelName` / `stepIdx`. There is **no `hook_event_name`** — the event
  travels via argv (`ans-hook-antigravity <Event>`). PostToolUse carries
  `toolCall` + `error` but **no tool output**.
- **stdout is strict protojson** — on PreToolUse `{}` = DENY (a decision is
  required), empty stdout = allow, and the decision object is
  `{decision: allow|deny|ask|force_ask|deny_unless_prior_grant, reason?,
  permissionOverrides?}` — unknown fields reject (protojson strict).
  PostToolUse accepts only `{}`. Context injection =
  `injectSteps[].ephemeralMessage` on Pre/PostInvocation. A non-zero exit
  is a tool-level ERROR (stderr surfaces to the agent).
- **Two hook files both load** — `~/.gemini/antigravity-cli/hooks.json` and
  `~/.gemini/config/hooks.json` (same-named entries deduped).
- **No SessionStart event** — the five events are PreToolUse / PostToolUse /
  PreInvocation / PostInvocation / Stop. The routing card rides
  `PreInvocation` with `invocationNum === 0` instead.
- **`agy -p` headless hangs if a configured MCP server never finishes
  connecting** (observed with a hung `1mcp` server) — sandbox `HOME` or fix
  the server. The OAuth token lives in Windows Credential Manager and
  survives a sandboxed `HOME`.
- **Antigravity IDE does not execute hooks** — do not wire
  `configs/antigravity/hooks.json` into IDE settings.

## 1. Install (stranger path)

```bash
npm i -g @anysearch-cli/cli @anysearch-cli/mcp @anysearch-cli/plugin
ans doctor            # env/keys/providers self-check
```

Global install puts `ans`, `ans-mcp`, `ans-plugin-server`, and
`ans-hook-antigravity` on PATH — the shipped hook commands resolve by bin
name.

## 2. Keys

User/OS-level env, never written into config files — `ANYSEARCH_API_KEY`,
`ANS_LLM_BASE_URL` + `ANS_LLM_API` + `ANS_LLM_API_KEY`,
`ANS_LLM_PROVIDER` + `ANS_LLM_MODEL`, `EXA_API_KEY` / `TAVILY_API_KEY`.

## 3. Plugin server (once per machine)

```bash
ans-plugin-server     # listens 127.0.0.1:33333, Bearer token auto-generated
```

The server writes a 0600 token to `.anysearch-cli/server-token` relative to
its working directory and serves `/preheat` `/recall` `/index` `/policy`.

## 4. MCP tools — `call_mcp_tool` umbrella dispatch

agy dispatches every MCP call as `toolCall.name = "call_mcp_tool"` with the
real tool name inside `toolCall.args` (`args.toolName`). The shipped
matcher below covers both the `ans_*` tool names and the umbrella; the
adapter unwraps the inner name before matching. Register `ans-mcp`
(`command: "ans-mcp"`, stdio) through agy's own MCP configuration surface
so the five `mcp__anysearch__*` tools appear — the hooks layer is what was
live-verified end-to-end; the MCP call path is contract-tested
(SEP-2484 P7: the isolated probe `HOME` carried no user MCP servers).
Caveat: a configured-but-hung MCP server stalls headless turns.

## 5. Hooks — user-level `hooks.json`

Both files are read: `~/.gemini/antigravity-cli/hooks.json` (preferred) and
`~/.gemini/config/hooks.json`. Copy the shipped template
`$(npm root -g)/@anysearch-cli/plugin/configs/antigravity/hooks.json` into
one of them — the top-level key (`"anysearch"`) is an arbitrary hook-group
name, merge under your own names if the file already exists:

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
| PreToolUse | Emits `{decision:"allow"}` — an explicit allow, never `{}` (which would deny); for `ans_*` tools the recall preheat is staged to `anysearch-pending.jsonl`. The protojson deny path (`{decision:"deny", reason}` blocks the tool) is sentinel-proven, but this adapter never gates. |
| PostToolUse | For `ans_*` tools: distills on `toolCall.args` (the host sends no tool output), POSTs `/index` to the plugin server (fire-and-forget), and stages the distilled summary; emits `{}` — the only compliant shape. |
| PreInvocation | `invocationNum === 0` → `injectSteps[].ephemeralMessage` carries the routing card (verified reaching the transcript); also flushes staged preheat/distill text. |
| PostInvocation | Flushes any remaining staged text as `ephemeralMessage`; else `{}`. |
| Stop | `{}`. |

Every hook invocation also ensures `.antigravity/rules/anysearch.mdc` in
the workspace — the IDE-facing fallback surface (SessionStart does not
exist on this host). Pending staging lives at
`<artifactDirectoryPath>/anysearch-pending.jsonl` (falls back to
`.antigravity/` when the host sends no artifact dir).

## 6. Antigravity IDE — rules fallback

The IDE host does not execute hooks (reproduced on 2.12.2 — IDE session
transcripts show no hook execution). The supported surface is the rules
file `.antigravity/rules/anysearch.mdc`, written by any hook invocation
under the project working directory — if the file has not appeared, run a
hook once manually to trigger it:

```bash
printf '{}' | ans-hook-antigravity PreInvocation
```

Do not wire `configs/antigravity/hooks.json` into IDE settings — the
named-hook map is a CLI-host contract.

## 7. Fail-open contract

Server down / key missing / malformed stdin → hooks exit 0; PreToolUse
still emits an explicit allow and every other event emits `{}` — the agent
is never blocked by anysearch. A dead plugin server turns `/index` and
preheat into no-ops. Contract-tested in `apps/plugin/test/` (adapter emits
`allow` on every error path).

## Verification transcript (rerunnable)

Headless `agy -p` with an isolated `HOME` (a hung user MCP server stalls
turn initialization; the OAuth token survives — it lives in Windows
Credential Manager):

```sh
printf '{}' | ans-hook-antigravity PreToolUse     # {"decision":"allow"}
printf '{}' | ans-hook-antigravity Stop           # {}
agy -p "<task>"                                    # all five events fire
```

Evidence ledger: `.scratch/grill-round-68/evidence/t3-s2s3-verdict.md`
(s2 contract legs + s3 six-leg acceptance + SEP-2484 exclusions —
`call_mcp_tool` unwrap, `conversationId`→session propagation, `injectSteps`
delivery, fail-open, `PostToolUse` no-output shape, `.mdc` fallback).
