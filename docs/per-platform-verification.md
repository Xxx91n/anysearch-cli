# Per-platform verification checklist

How to check each real client.

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
