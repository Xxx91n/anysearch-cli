# Per-Platform Verification Checklist

ADR-0012 D13: Real-client verification checklist + race condition troubleshooting guide.

## Claude (SessionStart supported)

- [ ] hooks.json registered with Claude
- [ ] SessionStart fires -> routing card injected as additionalContext
- [ ] PreToolUse fires -> preheat recall_memory injection
- [ ] PostToolUse fires -> distill output + FTS5 index
- [ ] Server down -> all hooks fail-open (no block)

## Codex (SessionStart supported)

- [ ] hooks.json registered with Codex
- [ ] SessionStart fires -> routing card injected as additionalContext
- [ ] PreToolUse fires -> preheat recall_memory injection
- [ ] PostToolUse fires -> distill output + FTS5 index
- [ ] Server down -> all hooks fail-open (no block)

## Cursor (SessionStart race condition)

- [ ] hooks.json registered with Cursor
- [ ] sessionStart fires (may race) -> additional_context emitted
- [ ] .mdc fallback file generated at .cursor/rules/anysearch.mdc
- [ ] PreToolUse fires -> preheat
- [ ] PostToolUse fires -> distill + updated_mcp_tool_output
- [ ] Server down -> all hooks fail-open (no block)

### Race condition troubleshooting

Cursor sessionStart has a known race condition (2026-04~2026-08, no ETA).
If routing card is not injected at session start:

1. Check .cursor/rules/anysearch.mdc exists (fallback path)
2. If missing, run any hook manually to trigger ensureMdc()
3. Verify hooks.json sessionStart timeout is >= 5s

## Antigravity (no SessionStart)

- [ ] hooks.json registered with Antigravity
- [ ] No SessionStart event -> .mdc generated on first hook invocation
- [ ] .mdc fallback file generated at .antigravity/rules/anysearch.mdc
- [ ] PreToolUse/PreInvocation fires -> preheat
- [ ] PostToolUse/PostInvocation fires -> distill
- [ ] Server down -> all hooks fail-open (no block)

## HTTP stateless integration test

- [ ] No session header -> server returns JSON response
- [ ] Consecutive requests are independent (no session leak)
- [ ] /health returns 200 with { status: "ok" }
