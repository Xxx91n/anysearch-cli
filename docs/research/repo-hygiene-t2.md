# Repo cleanup T2 — research for #88

Date: 2026-11-03. Sources: local repo inspection only — what is on disk,
`git log`/`git check-ignore`, and searches over tracked files on `main` @ `61d6398f`.
**This ticket only decides what to do: the user runs the commands. No file was
deleted or moved; the two edits below exist only on this branch.**

---

## Item A — `.venv-tau-proto/` (326 MB folder at repo root, not tracked)

### What we found

- **What it is**: a Python 3.11.9 virtualenv for Windows, created with
  `python -m venv D:\Aworker\anysearch-cli\.venv-tau-proto` (`pyvenv.cfg`,
  `include-system-site-packages = false`). It has a `Lib/` + `Scripts/` layout
  and takes 326 MB.
- **What is inside** (`Lib/site-packages`): `lifetimes` 0.11.3, `pandas` 2.0.3,
  `scipy` 1.11.4, `numpy` 1.26.4 (kept below 2.x), `autograd` 1.7.0, `dill`,
  `dateutil`/`pytz`/`six`/`tzdata` — this is *exactly* the frozen set pinned in
  `scripts/tau/requirements.txt` (its header comment: "pinned python stack for
  `scripts/tau/bgnbd_fit.py` … numpy stays pinned BELOW 2.x with autograd>=1.7").
- **Why it exists**: `scripts/tau/bgnbd_fit.py` does
  `from lifetimes import BetaGeoFitter` at call time; the TypeScript side
  (`packages/store/src/eval/bgnbd.ts`) starts `python` (or an interpreter
  passed in) — it never names this venv. The `-proto` suffix points to a one-off
  prototype experiment.
- **Anyone else using it**: no. `grep -rn 'venv-tau-proto\|\.venv'` over
  `scripts/ docs/ package.json pnpm-workspace.yaml .github/ .gitignore` found 0
  hits. `git log --all -- .venv-tau-proto` is empty (not tracked).
  `git status` shows `?? .venv-tau-proto/`; `git check-ignore` says it is NOT
  ignored, so it shows up in every `git status` as an untracked entry.
- **`.gitignore` today**: it ignores `node_modules/`, `dist/`, `.scratch/`,
  `.model-cache/`, and so on — but has no venv rule, which is why this 326 MB
  folder could sit there unhandled.

### Decision: **delete it** (after the user says yes) and add a `.venv*/` ignore rule

Why:

- **It takes seconds to rebuild**: `python -m venv .venv-tau-proto &&
  .venv-tau-proto/Scripts/pip install -r scripts/tau/requirements.txt` gives you
  the same set again; every package is pinned to the patch level. Nothing inside
  is irreplaceable — no editable installs, no local data.
- **Nothing can break**: no tracked references, no history, and the build, tests
  and release check (ship-gate) do not see it (they only use the pnpm workspace).
- **326 MB of working-tree weight** for a folder whose whole value is a 5-line
  `requirements.txt`.
- Why not `move under .scratch/`: it would work — `.scratch/` is already ignored
  — but it keeps 326 MB of dead weight under a name whose only audience is
  git-ignore. Deleting is better; if the user wants a "just in case" period,
  moving gives the same tidiness without the destructive flag.
- Why not "keep it and just ignore it": that fixes the `git status` noise but not
  the disk weight, and leaves a folder nobody owns at the repo root. Still fine
  as a zero-risk interim if deletion is put off.

### Suggested `.gitignore` line

```gitignore
# python virtualenvs — scratch/prototype interpreters, never repo content
.venv*/
```

Put it after the `# os/editor` block. `.venv*/` covers `.venv/`,
`.venv-tau-proto/`, `.venv-*/` (any future `-proto` or experiment suffix) in one
line. (Deleting `.venv-tau-proto/` itself destroys data, so it **needs the user
to say yes first; not done here**.)

---

## Item B — CHANGELOG r100 section that no longer matches the code

### What we found

- At the time, `CHANGELOG.md` line 29 carried
  `## Unreleased — r100: 元验证封顶（…）` (lines 29–47). Every bullet describes
  checks that no longer exist: `docs/enforcement-anchors.json` schema v2 plus a
  `fails` word list plus audit tiers, `pending_anchors` seats,
  `stack-orphaned-by-land`, the `enumerateScriptFiles`/`scripts/top-level-effects.mjs`
  AST gate, and `audit-checklist` §5 plus `scripts/handoff-reanchor.mjs`.
- **All of it was removed**: `git show --stat 3f85fee8` ("governance court:
  retire meta-validation machinery, untrack .scratch") deleted 13 governance
  scripts (handoff-lint, enforcement-anchors, claims-verbatim,
  closeout-coverage, governed-json, vocab registry/scan, top-level-effects,
  pathlint, handoff-reanchor), removed `docs/enforcement-anchors.json` +
  `docs/agents/audit-checklist.md`, and took the governance steps out of
  `ship-gate.mjs`. `find` for `enforcement-anchors*` / `audit-checklist*` finds
  nothing; `scripts/` has none of the named files; `docs/` has no `adr/` or
  enforcement artifacts.
- The same removal applies to the r96–r99 sections, but this ticket only fixes
  r100 — the other sections follow the same pattern and can be swept later if
  wanted.
- The r100 *product* work is NOT gone: the tau observation layer
  (`scripts/tau/bgnbd_fit.py`, access_events, switch machine) still runs and is
  written up separately in the English `[Unreleased]` section (line ~964 at the time).

### Decision: **put a banner under the r100 heading — keep the history, do not rewrite it**

Rewriting or deleting the section would change the record of what r100 actually
shipped; leaving it bare would make readers think the anchors registry still
exists. A one-paragraph banner right under the heading is the smallest honest
fix. The banner (same meaning as the one under the r100 heading in
`CHANGELOG.md`, lines 31–33 at the time):

```markdown
> ⚠️ 这节写的检查工具（检查项 schema v2、待办条目/`pending_anchors`、STACK_RED_CODES、`enumerateScriptFiles`/AST 前置检查、handoff-reanchor 等）已经被治理那边的 commit `3f85fee8`（"governance court: retire meta-validation machinery, untrack .scratch"）整套删掉——`docs/enforcement-anchors.json` 和 `docs/agents/audit-checklist.md` 都不在了，相关的 ship-gate 检查步骤也拆了。这一节只当历史记录留着：事实没改，只把解释文字换成了大白话。

/ ⚠️ The checks described below (enforcement-anchor schema v2,
pending_anchors seats, STACK_RED_CODES, the enumerateScriptFiles/AST front
gate, handoff-reanchor) were removed wholesale by the governance-court commit
`3f85fee8` ("governance court: retire meta-validation machinery, untrack
.scratch"). `docs/enforcement-anchors.json` no longer exists. The section is
kept as history: facts unchanged, wording in plain language.
```

(Two versions of the same text are shown above — the committed banner uses the
zh blockquote single-paragraph form; the English note is for this doc.)

---

## What the user needs to do (nothing was done on `main`)

1. **Say yes to deleting `.venv-tau-proto/`** (destructive, user only):
   `rm -rf .venv-tau-proto` — or `mv .venv-tau-proto .scratch/` instead.
2. **Choose what to do with the branch**: land `research/repo-hygiene-t2` as a PR
   (the diff already has the `.gitignore` line + CHANGELOG banner + this doc),
   or make those two one-line edits directly on `main` and drop the branch.
3. If landing: the only tracked diffs are `.gitignore` (+2 lines),
   `CHANGELOG.md` (+1 banner line under the r100 heading), and this file.
4. Optional follow-up (outside this ticket): put the same banner on the r96–r99
   sections, which describe the same removed tools.
5. Close #88 once the deletion is confirmed and the branch decision is made.
