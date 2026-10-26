# AGENTS.md — anysearch-cli

AnySearch: a vertical-domain information-specialist agent CLI (`ans`) — strict domain allowlist, evidence-anchored retrieval, out-of-domain abstention. `GLOSSARY.md` is the single authority for terminology.

## How to run
- `pnpm install --ignore-scripts` (better-sqlite3 ships prebuilds; no node-gyp)
- `pnpm -r check` / `pnpm -r test` / `pnpm -r build` (turbo, same tasks per package)
- `node scripts/ship-gate.mjs` — product smoke gate (release verdict)
- `pnpm -C packages/store eval --offline` — golden memory-eval offline slice
- `cp scripts/hooks/pre-commit-user .git/hooks/pre-commit-user && cp scripts/hooks/pre-push-user .git/hooks/pre-push && chmod +x .git/hooks/pre-commit-user .git/hooks/pre-push` — install the test gates (full workspace suite; `git push` and `but push` run pre-push, plain `git commit` chains pre-commit — `but commit` runs no git hooks, so the push gate is the real backstop)

### Merge gate (#58 direction — decided, see #59)

The gate is **discipline-based, not mechanical**: branch protection is unavailable (private repo + GitHub Free, `403`), `--no-verify` can bypass pre-push, and deletes may skip the hook entirely. Therefore:

- Before every merge: run the full `pnpm test` locally and require it green — the red of CI is information, not a blocker.
- `pre-push` is the real backstop gate (the only hook that actually runs on a real push), but it is not a guarantee; never treat a pushed green as a substitute for a pre-merge green.
- We deliberately do NOT switch repo visibility or upgrade the GitHub plan (option rejected in #58; recorded in #59).
- #67 is the empirical ticket: it will prove (via a deliberately failing push) that the pre-push hook really blocks outside `--no-verify`, and the evidence lands in #58.

## Directory conventions
- `packages/{kernel,store,retriever,embedding}` core libs; `apps/{cli,mcp,plugin,dsh-plugin}` delivery surfaces; `GLOSSARY.md` terminology authority; `docs/agents/` agent-facing conventions

## Gotchas (not visible in the code)
- better-sqlite3@13 loads a prebuilt .node; `allowBuilds: false` in pnpm-workspace.yaml is deliberate — flipping it needs MSBuild + ClangCL, leave it
- pnpm is pinned to 11.24.0 with `pmOnFail: error`: a version mismatch fails immediately and never rewrites the lockfile; bump both pinned fields in one commit
- All version control goes through GitButler (`but`); never push without an explicit order
- Host hook contract gotchas (Codex accepts only the hookSpecificOutput envelope / Antigravity stdin is camelCase + PreToolUse `{}`=DENY, etc.) — see `docs/*-integration.md` and comments in `apps/plugin/src/hooks/adapters/`

## Agent skills

### Issue tracker

Issues live in GitHub Issues; all operations use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles, label strings equal to role names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: one `GLOSSARY.md` at the repo root. See `docs/agents/domain.md`.
