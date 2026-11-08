# Per-platform verification checklist

How to check each real client, plus how to debug the Cursor `sessionStart`
race.

## Claude (supports SessionStart)

- [ ] `hooks.json` is registered with Claude
- [ ] SessionStart fires, and the routing card is injected as `additionalContext`
- [ ] PreToolUse fires, and preheat injects `recall_memory` results
- [ ] PostToolUse fires, and distill writes its output plus the FTS5 index
- [ ] With the server down, the hooks keep going (nothing is blocked)

## Codex (supports SessionStart)

- [ ] `hooks.json` is registered with Codex
- [ ] SessionStart fires, and the routing card is injected as `additionalContext`
- [ ] PreToolUse fires, and preheat injects `recall_memory` results
- [ ] PostToolUse fires, and distill writes its output plus the FTS5 index
- [ ] With the server down, the hooks keep going (nothing is blocked)

## Cursor (SessionStart has a race)

- [ ] `hooks.json` is registered with Cursor
- [ ] sessionStart fires (it may race), and `additional_context` is emitted
- [ ] The fallback file is generated at `.cursor/rules/anysearch.mdc`
- [ ] PreToolUse fires, and preheat runs
- [ ] PostToolUse fires, and distill runs with `updated_mcp_tool_output`
- [ ] With the server down, the hooks keep going (nothing is blocked)

### Debugging the race

Cursor sessionStart has a known race (2026-04~2026-08, no ETA). If the
routing card is not injected at session start:

1. Check that `.cursor/rules/anysearch.mdc` exists (this is the fallback).
2. If it is missing, run any hook by hand to trigger `ensureMdc()`.
3. Check that the `hooks.json` sessionStart timeout is >= 5s.

## Antigravity (no SessionStart)

- [ ] `hooks.json` is registered with Antigravity
- [ ] There is no SessionStart event, so the `.mdc` file is generated on the first hook call
- [ ] The fallback file is generated at `.antigravity/rules/anysearch.mdc`
- [ ] PreToolUse/PreInvocation fires, and preheat runs
- [ ] PostToolUse/PostInvocation fires, and distill runs
- [ ] With the server down, the hooks keep going (nothing is blocked)

## HTTP stateless integration test

- [ ] With no session header, the server returns a JSON response
- [ ] Requests in a row are independent (no session leaks between them)
- [ ] `/health` returns 200 with `{ status: "ok" }`
