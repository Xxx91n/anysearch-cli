# Repo-hygiene T2 — research for #88

Date: 2026-11-03. Sources: local repo inspection only — filesystem evidence,
`git log`/`git check-ignore`, and tracked-file greps on `main` @ `61d6398f`.
**This is a DECISION ticket: execution stays with the driver/user. No file was
deleted or moved; the two edits below exist only on this branch.**

---

## Item A — `.venv-tau-proto/` (326 MB untracked dir at repo root)

### Evidence

- **What it is**: a Windows Python 3.11.9 virtualenv created with
  `python -m venv D:\Aworker\anysearch-cli\.venv-tau-proto` (`pyvenv.cfg`,
  `include-system-site-packages = false`). `Lib/` + `Scripts/` layout, 326 MB.
- **Contents** (`Lib/site-packages`): `lifetimes` 0.11.3, `pandas` 2.0.3,
  `scipy` 1.11.4, `numpy` 1.26.4 (pinned below 2.x), `autograd` 1.7.0, `dill`,
  `dateutil`/`pytz`/`six`/`tzdata` — this is *exactly* the frozen stack pinned in
  `scripts/tau/requirements.txt` (header comment: "pinned python stack for
  `scripts/tau/bgnbd_fit.py` … numpy stays pinned BELOW 2.x with autograd>=1.7").
- **Why it exists**: `scripts/tau/bgnbd_fit.py` imports
  `from lifetimes import BetaGeoFitter` at call time; the TS side
  (`packages/store/src/eval/bgnbd.ts`) spawns `python` (or an injected
  interpreter) — it never names this venv. The `-proto` suffix indicates a
  one-off prototype/provisioning experiment.
- **Tracked references**: none. `grep -rn 'venv-tau-proto\|\.venv'` over
  `scripts/ docs/ package.json pnpm-workspace.yaml .github/ .gitignore` → 0
  hits. `git log --all -- .venv-tau-proto` → empty (untracked).
  `git status` shows `?? .venv-tau-proto/`; `git check-ignore` → NOT ignored —
  it currently pollutes every `git status` as an untracked entry.
- **`.gitignore` today**: ignores `node_modules/`, `dist/`, `.scratch/`,
  `.model-cache/`, etc. — but has **no venv rule**, which is why this 326 MB
  artifact was able to sit flagged-but-unhandled.

### Verdict: **delete it** (pending user confirmation), AND add a `.venv*/` ignore rule

Reasoning:

- **Recreatable in seconds**: `python -m venv .venv-tau-proto &&
  .venv-tau-proto/Scripts/pip install -r scripts/tau/requirements.txt`
  reproduces it byte-for-byte in intent; the stack is pinned to the patch level.
  There is no irreplaceable state inside — no editable installs, no local data.
- **Nothing can break**: zero tracked references, zero history, ignored or not
  it is invisible to the build/test/ship-gate toolchain (pnpm workspace only).
- **326 MB of working-tree weight** for a directory whose entire value is
  captured by a 5-line `requirements.txt`.
- Why not `move under .scratch/`: viable fallback — `.scratch/` is already
  ignored — but it preserves 326 MB of dead weight under a name whose only
  audience is git-ignore. Prefer deletion; if the user wants a "just in case"
  period, the move achieves the same hygiene without the destructive flag.
- Why not "leave + ignore only": solves the `git status` noise but not the
  disk weight and keeps an unowned artifact at repo root. Still acceptable as
  a zero-risk interim if deletion is deferred.

### Recommended `.gitignore` addition

```gitignore
# python virtualenvs — scratch/prototype interpreters, never repo content
.venv*/
```

Placed after the `# os/editor` block. `.venv*/` covers `.venv/`,
`.venv-tau-proto/`, `.venv-*/` (any future `-proto`/-experiment suffix) in one
line. (Deletion of `.venv-tau-proto/` itself is destructive → **requires
explicit user confirmation; not performed here**.)

---

## Item B — CHANGELOG r100 dangling section

### Evidence

- `CHANGELOG.md` line 29 carries
  `## Unreleased — r100: 元验证封顶（…）` (lines 29–47). Every bullet documents
  governance machinery: `docs/enforcement-anchors.json` schema v2 + `fails`
  vocabulary + audit tiers, `pending_anchors` seats, `stack-orphaned-by-land`,
  `enumerateScriptFiles`/`scripts/top-level-effects.mjs` AST gate,
  `audit-checklist` §5 + `scripts/handoff-reanchor.mjs`.
- **All of it is retired**: `git show --stat 3f85fee8` ("governance court:
  retire meta-validation machinery, untrack .scratch") removed 13 governance
  scripts (handoff-lint, enforcement-anchors, claims-verbatim,
  closeout-coverage, governed-json, vocab registry/scan, top-level-effects,
  pathlint, handoff-reanchor), deleted `docs/enforcement-anchors.json` +
  `docs/agents/audit-checklist.md`, and stripped the governance legs from
  `ship-gate.mjs`. `find` for `enforcement-anchors*` / `audit-checklist*` →
  nothing; `scripts/` contains none of the named files; `docs/` has no `adr/`
  or enforcement artifacts.
- The same retirement applies to the r96–r99 sections, but the ticket scopes
  the fix to r100 only — the other sections follow the same convention and
  can be swept in a follow-up if desired.
- The r100 *product* deliverable is NOT retired: the tau observation layer
  (`scripts/tau/bgnbd_fit.py`, access_events, switch machine) is live and is
  documented separately in the English `[Unreleased]` section (line ~964).

### Verdict: **insert a banner under the r100 heading — history retained, not rewritten**

Rewriting/deleting the section would falsify the historical record of what r100
shipped; leaving it bare misleads readers into thinking the anchors registry is
live. A one-paragraph banner directly under the heading is the minimal honest
fix. The banner (applied on this branch, lines 31–33 of `CHANGELOG.md`):

```markdown
> ⚠️ 本节所载治理机器（执行锚 schema v2、坐席/`pending_anchors`、STACK_RED_CODES、`enumerateScriptFiles`/AST 前门、handoff-reanchor 等）已由治理庭 commit `3f85fee8`（"governance court: retire meta-validation machinery, untrack .scratch"）整体退役——`docs/enforcement-anchors.json` 与 `docs/agents/audit-checklist.md` 均已不存在，相关 ship-gate 治理腿已拆除。本节仅作历史记录保留，未改写。

/ ⚠️ The governance machinery documented below (enforcement-anchor schema v2,
pending_anchors seats, STACK_RED_CODES, the enumerateScriptFiles/AST front
gate, handoff-reanchor) was retired wholesale by governance-court commit
`3f85fee8` ("governance court: retire meta-validation machinery, untrack
.scratch"). `docs/enforcement-anchors.json` no longer exists. Section retained
as history — not rewritten.
```

(Two formulations of the same text are shown above — the committed banner uses
the zh blockquote single-paragraph form; the English gloss is for this doc.)

---

## Execution checklist (for the driver/user — nothing done on `main`)

1. **Confirm `.venv-tau-proto/` deletion** (destructive, user-only):
   `rm -rf .venv-tau-proto` — or fallback `mv .venv-tau-proto .scratch/`.
2. **Decide branch disposition**: land `research/repo-hygiene-t2` as a PR
   (diff already carries the `.gitignore` line + CHANGELOG banner + this doc),
   or redo the two one-line edits directly on `main` and drop the branch.
3. If landing: the only tracked diffs are `.gitignore` (+2 lines),
   `CHANGELOG.md` (+1 banner line under the r100 heading), and this file.
4. Optional follow-up (out of scope): apply the same banner treatment to the
   r96–r99 sections, which document the same retired machinery.
5. Close #88 once deletion is confirmed and the branch disposition is chosen.
