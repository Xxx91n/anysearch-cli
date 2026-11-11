# AGENTS.md — anysearch-cli

AnySearch is an agent CLI (`ans`) that works inside one domain only. It keeps retrieval results tied to their sources, filters them against a strict domain allowlist, and says there is nothing to answer when no results pass the domain filter. Answers that a provider generates itself (for example Exa or Tavily answer mode) do not pass through this filter and are marked unverified. `GLOSSARY.md` is the only place to look up what a term means.

## How to run
- `pnpm install --ignore-scripts` — install dependencies. better-sqlite3 ships a prebuilt binary, so no node-gyp.
- `pnpm -r check` / `pnpm -r test` / `pnpm -r build` — run the same task in every package (turbo). `apps/cli` and `apps/plugin` build what their tests read, so `pnpm -r test` is green from a clean checkout too: `apps/plugin`'s `pretest` compiles `dist/` only, and `apps/cli`'s `pretest` builds `apps/mcp/dist` only when it is missing (`ans mcp` forwards to it). Caveat: the root `pnpm test` runs turbo, whose `test` task depends on `build`; that `build` still runs `gen:configs` first, so the plugin's config-drift test only sees a hand-edit when you run `pnpm -C apps/plugin test` directly. This dependency is older than #256 and unchanged here.
- `node scripts/dep-age-status.mjs` — answer "why does install reject the lockfile". It lists dependency versions inside the release-age window (`minimumReleaseAge` in `pnpm-workspace.yaml`) and prints the moment the last one clears. Exit 0 = the lockfile passes; exit 1 = something is blocked (too young, or no publish time); exit 2 = the registry lookup failed. Waiting is the fix; `PNPM_CONFIG_MINIMUM_RELEASE_AGE=0` only hides the check locally.
- `node scripts/ship-gate.mjs` — release smoke check. It runs checks, build, packaging, a real install and a real start, and its answer decides whether the release is good.
- `pnpm -C packages/store eval --offline` — offline run of the fixed memory test set.
- `node scripts/dsh-approval-acceptance.mjs` — real-host check of the dsh approval channel (allow once, reject, cancel, headless no-channel). It builds its own temp `DSH_HOME`, workspace, servers and model patch, then deletes them on exit; `--keep` leaves the sandbox. Needs Node 22.15+ (zstd session logs), `ANS_LLM_BASE_URL`, `ANS_LLM_API_KEY`, `ANS_LLM_MODEL`, plus `ANS_ACCEPTANCE_PLAYWRIGHT` (module or directory) and optionally `ANS_ACCEPTANCE_BROWSER`. `DSH_BIN` picks the host; no version is pinned.
- `cp scripts/hooks/pre-commit-user .git/hooks/pre-commit-user && cp scripts/hooks/pre-push-user .git/hooks/pre-push && chmod +x .git/hooks/pre-commit-user .git/hooks/pre-push` — install the test gates. Both run the full workspace test suite. `git push` and `but push` run the pre-push hook; a plain `git commit` runs pre-commit. `but commit` runs no git hooks at all, so the push gate is the last one that really runs.

### Merge gate (#58 direction — decided, see #59)

The rule is kept by discipline, not by a machine. Branch protection is not available (private repo on GitHub Free returns `403`), `--no-verify` can skip the pre-push hook, and a delete may skip the hook entirely. So:

- Before every merge, run the full `pnpm test` locally and wait for it to pass. A red CI tells you something, but it does not block anything.
- `pre-push` is the last real gate, because it is the only hook that runs on a real push. It is still not a guarantee. A push that passed the hook never replaces a full green run before the merge.
- We do not make the repo public and do not upgrade the GitHub plan. That option was rejected in #58 and recorded in #59.
- #67 showed, by pushing a commit that was meant to fail, that the pre-push hook really does block a push unless you pass `--no-verify`. Proof: [the closeout comment on #67](https://github.com/Xxx91n/anysearch-cli/issues/67#issuecomment-6431860529).

## Directory conventions
- `packages/{kernel,store,retriever,embedding}` are shared libraries. `apps/{cli,mcp,plugin,dsh-plugin}` are the four ways users run the tool. `GLOSSARY.md` is the word list. `docs/agents/` holds notes for agents.

## Gotchas (not visible in the code)
- better-sqlite3@13 loads a prebuilt `.node` file. `allowBuilds: false` in pnpm-workspace.yaml is on purpose. Turning it on would need MSBuild + ClangCL. Leave it.
- pnpm is pinned to 11.24.0 with `pmOnFail: error`. A version mismatch stops at once and never rewrites the lockfile. Change both pinned fields in one commit.
- All version control goes through GitButler (`but`). Never push without an explicit order.
- Each host's hook format has its own trap. Codex accepts only the `hookSpecificOutput` shape. Antigravity sends camelCase JSON on stdin, and on `PreToolUse` an empty `{}` means DENY. The rest are listed in `docs/*-integration.md` and in the comments under `apps/plugin/src/hooks/adapters/`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues. Use the `gh` CLI for everything. See `docs/agents/issue-tracker.md`.

### Triage labels

There are five triage roles, and each label string is the role name itself. See `docs/agents/triage-labels.md`.

### Domain docs

This repo has one context: a single `GLOSSARY.md` at the root. See `docs/agents/domain.md`.
