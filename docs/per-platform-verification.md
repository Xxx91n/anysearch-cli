# Per-platform verification checklist

How to check each real client. Every section records the host version it was
verified on and the date. "not recorded" means nobody wrote it down — do not
read it as a pass.

## Claude (supports SessionStart)

Verified: Claude Code 2.1.251, 2026-09-17.

- [ ] `hooks.json` is registered with Claude
- [ ] SessionStart fires, and the routing card is injected as `additionalContext`
- [ ] PreToolUse fires, and preheat injects `recall_memory` results
- [ ] PostToolUse fires, and distill writes its output plus the FTS5 index
- [ ] With the server down, the hooks keep going (nothing is blocked)

## CodeBuddy (supports SessionStart)

Verified: CodeBuddy Code 2.151.0, 2026-09-16.

- [ ] `hooks.json` is registered with CodeBuddy
- [ ] SessionStart fires, and the routing card enters context word for word (the host takes raw stdout, not the envelope)
- [ ] PreToolUse fires, and preheat returns `hookSpecificOutput.additionalContext`
- [ ] PostToolUse fires, and distill returns `hookSpecificOutput.updatedToolOutput` plus the FTS5 index
- [ ] With the server down, the hooks keep going (nothing is blocked)

## Codex (supports SessionStart)

Verified: codex-cli 0.142.5, 2026-09-17.

- [ ] `hooks.json` is registered with Codex
- [ ] SessionStart fires, and the routing card is injected as `additionalContext`
- [ ] PreToolUse fires, and preheat injects `recall_memory` results
- [ ] PostToolUse fires, and distill writes its output plus the FTS5 index
- [ ] With the server down, the hooks keep going (nothing is blocked)

## Antigravity (no SessionStart)

Verified: Antigravity CLI (`agy`) 1.2.5 and Antigravity IDE 2.12.2, 2026-09-17.
The IDE does not run hooks, so its supported surface is the rules fallback.

- [ ] `hooks.json` is registered with Antigravity
- [ ] There is no SessionStart event, so the `.mdc` file is generated on the first hook call
- [ ] The fallback file is generated at `.antigravity/rules/anysearch.mdc`
- [ ] PreToolUse/PreInvocation fires, and preheat runs
- [ ] PostToolUse/PostInvocation fires, and distill runs
- [ ] With the server down, the hooks keep going (nothing is blocked)

## HTTP stateless integration test

Verified: not recorded (protocol-level check; there is no host).

- [ ] With no session header, the server returns a JSON response
- [ ] Requests in a row are independent (no session leaks between them)
- [ ] `/health` returns 200 with `{ status: "ok" }`
