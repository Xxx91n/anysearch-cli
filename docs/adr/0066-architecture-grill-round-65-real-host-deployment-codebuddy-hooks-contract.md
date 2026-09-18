# ADR-0066: Grill Round 65 — Real-Host Deployment: CodeBuddy 全栈三件套 + Hooks 契约对齐（开门轮）

## Status

Accepted (implementation round r65). Records the round-65 implementation
decisions; changes landed per ticket plan T1–T6. Ledger:
`.scratch/grill-round-65/decision-ledger.md` (D-001..D-006, all current).
Evidence root: `.scratch/grill-round-65/evidence/`.

## Context

Every prior round verified the plugin layer against synthetic stdin and unit
tests — no real agent host had ever run the stack end to end. Round-65 is the
"open the door" round: deploy the published npm `@anysearch-cli/*@0.0.3`
(true stranger path: `npm i -g`, no repo build) onto a real second host —
CodeBuddy Code 2.149.0 — and measure actual behavior with headless
scriptable probes (`codebuddy -p --output-format stream-json --mcp-config`).

The grill surfaced three latent defects that unit tests could not see:

1. All four hook adapters plus `session-start.ts` read `stdin.event`, but
   real hosts (CodeBuddy, real Claude Code) inject `hook_event_name`. The
   adapters therefore parse event="" and exit 0 silently — deployed but
   doing nothing (false-green).
2. All four shipped `configs/*/hooks.json` templates pointed Pre/PostToolUse
   at `dist/hooks/{preheat,distill}.cjs` — library modules with no `main()`
   and no stdin read. Even with the correct field name, wiring per the
   shipped template is a silent no-op. The executable entry is
   `adapters/<host>.cjs` (one entry, both events, internal dispatch).
   Additionally `files: ["dist"]` meant `configs/` was never published to
   npm at all — strangers had no template to copy.
3. `@anysearch-cli/plugin` declared no `bin`, so the long-running plugin
   server (127.0.0.1:33333) had no start entry — a stranger must hand-run
   `node <npm-global>/.../dist/server/index.cjs`.

## Decision

### D1 Theme = real-host usability closure on CodeBuddy (ledger D-001; T1–T6)

Deployment unit = full three-piece stack on published npm 0.0.3:
`ans` CLI + `ans-mcp` (mcp.json registration) + plugin (server +
hooks layer via `.codebuddy/settings.json`). First real user = a real
integration on another agent host. Out of scope (registered): OIDC trusted
publishing (debt due 0.0.4), watch-window duty, en dual-host harvest, real
Claude Code host verification, interactive TUI, embedding arm.

### D2 Deployment-gap fork-fix (ledger D-002/D-004; T1/T3/T4)

The measured object stays published 0.0.3 — gaps found on it are recorded
as usability findings ("a stranger must hand-launch the server"), while the
repo fixes accumulate into the next release and are verified through the
real ship channel: `pnpm pack` tarball → `npm i -g <tgz>` (not the repo
build, not a re-publish).

Fixes landed:
- `apps/plugin/package.json`: `bin.ans-plugin-server → dist/server/index.cjs`;
  `files` gains `configs` so hook templates actually ship.
- `apps/plugin/src/server/index.ts`: `#!/usr/bin/env node` line 1 (bin
  shebang, same mechanism as `ans-mcp`).
- `apps/plugin/src/hooks/adapters/codebuddy.ts` (new): single entry for
  PreToolUse / PostToolUse / SessionStart on the verified CodeBuddy
  contract — stdin `hook_event_name`, stdout decisions inside
  `hookSpecificOutput{permissionDecision|additionalContext|updatedToolOutput}`,
  SessionStart emits the routing card as raw text (CodeBuddy injects stdout
  verbatim). Fail-open everywhere, exit 0.
- `claude|cursor|codex|antigravity.ts` + `session-start.ts`:
  `hook_event_name ?? event` — one-line field fallback benefiting every
  host that sends the real field (including real Claude Code).
- `configs/{claude,codex,antigravity}/hooks.json`: Pre/PostToolUse
  repointed from library files to `adapters/<host>.cjs`. Audit rework
  (F-A1): `configs/cursor/hooks.json` was missed in this pass — repointed
  to `adapters/cursor.cjs` in the rework commit; the "four platforms
  fixed" wording here and in CHANGELOG was overclaimed.
- `configs/codebuddy/hooks.json` (new): `{matcher, hooks:[{type:"command",
  command}]}` schema; the command resolves the global install via
  `node "$(npm root -g)/@anysearch-cli/plugin/dist/hooks/adapters/codebuddy.cjs"`
  — Git-Bash-compatible on Windows (CodeBuddy forces Git Bash for hooks).
- `test/codebuddy-contract.test.ts`: 10 synthetic-stdin contract tests
  (real CodeBuddy shapes per event + legacy fallback + claude regression);
  rework grew the file to 20/20 (array tool_response per platform,
  template-target executability sweep).
- `build:hooks` / `exports` gained the codebuddy entry.

### D3 Probe matrix protocol (ledger D-003; T2/T4)

Headless scriptable probes, one assertion each: P0 install/doctor, P1 MCP
registration + tools/list, P2 in-domain search (docs domain), P3
out-of-domain abstain, P4 ans_chat over the v1/chat upstream, P5
recall_memory round-trip, P6 hooks three-event injection, P7 server-down
fail-open, P8 research_web multi-turn + query_knowledge stub recorded.
P9 (D-006 iv): same-question A/B with and without the tools, stream-json
both runs, comparing citation quality / refusal behavior / tool traces.

Evidence discipline: e2e site lives outside the repo
(`D:\Aworker\e2e-r65-codebuddy`) so the host never reads this repo's <!-- machine-local: sibling e2e checkout on build host @ 2026-09-19 -->
AGENTS.md; transcripts + server logs + project-index.db row deltas copy
back to `evidence/`; defects track found/fixed/deferred triples in
`evidence/defect-ledger.md`.

### D4 Key discipline (ledger D-004; all tickets)

`ANYSEARCH_API_KEY` + `ANS_LLM_*` are supplied by the user at run time
(Windows user-level env or session env). Key values never enter the
conversation, transcripts, evidence, or commits. `mcp.json` carries an
empty `env` block — the child process inherits the host env; settings.json
holds no plaintext keys.

### D5 Six-ticket serial order, evidence-first (ledger D-005)

T1 deploy leg → T2 probe round 1 → T3 fix ticket → T4 pack-tarball re-run
→ T5 docs → T6 closure. Every fix requires a red→green evidence pair; T4
re-verifies through the real ship channel (local tarball install), since
the fixes are not in 0.0.3.

## Closure (回填位 — completed at T6)

(i) Deployment evidence: `npm i -g` → `ans doctor` 22/3/0 (repo cwd AND
stranger cwd) → `ans domain docs` persisted → `ans-mcp` tools/list 5 tools
→ server up (401 no-token / 200 +Bearer) → `mcp.json` picked up by
CodeBuddy (`allServers=[anysearch:connecting]`). Re-runnable log set:
`evidence/README.md` table.

(ii) Probe transcripts: **P1–P9 all green on live CodeBuddy 2.151.0**
(headless `stream-json`, model=fast-model; transcripts under
`evidence/t2-*.stream.jsonl`, host hook execution under
`~/.codebuddy/debug/<session>.txt`). Live probing surfaced four defects
invisible to synthetic tests — F-09 (tool_response array-of-blocks →
`unwrapToolResponse`), F-10 (`ans-mcp` couldn't resolve shipped domain
TOMLs → domain steering dead on MCP path), F-11 (`ans_chat` ignored
ANS_LLM_BASE_URL/API/API_KEY), F-12 (pi-runtime waited for a nonexistent
`"text"` event → bare "Agent completed"). All four fixed and re-verified
live (index rows 6→16→66 across probes; OOD query returns
modelcontextprotocol.io-only results identical to direct CLI).

(iii) Defect ledger: `evidence/defect-ledger.md` — F-01..F-04 + F-09..F-12
fixed with red→green pairs; F-05 query_knowledge stub deferred (live probe
confirms honest `adapter=none` surfacing); F-06/F-07 credential gates
resolved by user; deferred list keeps: internal anysearch provider
returned 0 successes under query (fail-open held), recall_memory
projectIndex/store-root split, real Claude Code/Cursor/Codex/Antigravity
hosts, interactive TUI, embedding arm, cross-OS matrix (CI).

(iv) Product surface: README verified-hosts table lists CodeBuddy Code
2.151.0 as **live-verified** (headless P1–P9 green, including the
with/without-tool P9 contrast: no-tool answer cited a wrong doc URL,
tool-equipped answer cited the real pnpm.io/settings page).

## Consequences

- The plugin package now ships a real server entry (`ans-plugin-server`)
  and usable hook templates (`configs/` in the tarball) — the "stranger
  must hand-launch" gap closes with the next publish (≥0.0.4).
- `hook_event_name ?? event` is backward compatible: legacy `event` input
  still works (contract tests pin both paths).
- hooks.json Pre/Post entries now point at a single adapter file that
  dispatches internally; SessionStart keeps its own entry on non-CodeBuddy
  hosts (`.mdc` fallback semantics unchanged).
- CodeBuddy SessionStart emits raw card text (stdout→context verbatim),
  NOT a JSON envelope — host-specific by design.
- Live probe adjudicated the open assumption: `hookSpecificOutput` does
  NOT require a `hookEventName` field — SessionStart/PreToolUse/
  PostToolUse all executed and CodeBuddy consumed the envelopes (see
  `~/.codebuddy/debug/<session>.txt` hook stdout records).
- New hard-won contract facts (live-verified, now pinned by tests):
  CodeBuddy `tool_response` arrives as an ARRAY of content blocks
  (`[{type:"text",text:"<json>"}]`) — handled by `unwrapToolResponse`;
  `ans-mcp` must carry `domains/` in its tarball and append the package
  dir to the domains chain or ANS_DOMAIN silently no-ops; `ans_chat`
  requires the ANS_LLM_* endpoint trio threaded into createLlmSession;
  pi-ai AssistantMessageEvent exposes `text_delta`/`text_end`, never
  `text`.
