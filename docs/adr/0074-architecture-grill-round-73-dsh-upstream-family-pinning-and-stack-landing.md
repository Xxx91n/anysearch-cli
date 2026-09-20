# ADR-0074: Grill Round 73 — dsh 上游依赖族钉版 + 顺序合流 + 0.0.7 发布

## Status

Accepted (implementation round r73). Records the round-73 decisions per the
serial ticket plan T0–T4. Ledger:
`.scratch/grill-round-73/decision-ledger.md`
(D-001~D-007, 无断号). Evidence root:
`.scratch/grill-round-73/evidence/`. Upgrade ledger:
`.scratch/grill-round-73/upgrade-ledger.md`.

## Context

R72 audit F7 found the caret ranges on `@deepseek-ai/dsh-*` prerelease
devDependencies let transitive packages drift to `0.1.6-alpha.*` on
lockfile regeneration — a mixed-version tree producing TypeScript
branded-type conflicts (`UserMessage`/`MessageId` no longer assignable
across versions). The committed lockfile masked the drift locally, but any
`pnpm up`/regen detonated it. Separately, upstream 0.1.6 renamed the hook
event `agent/session-start` → `agent/created` with a new payload
shape (`source: fresh|resume|clear|compaction`), which would silently
double-inject the routing card if adopted unguarded.

Meanwhile three stacks (r71-audit, r72-grill, r72-audit — 12 commits) were
sitting unlanded in GitButler, leaving main fact-drifted from the audited
state and both audit handoffs carrying a PENDING "绿色 run URL" field.

## Decision

### D1 Two-layer pin, catalog as the single point (ledger D-002; T1)

- `apps/dsh-plugin/package.json`: all five `@deepseek-ai/*`
  devDependencies (cordis + 4 dsh-*) now read `catalog:` — the package
  spec itself declares "no drift accepted". `dependencies:{}` and
  `private:true` untouched.
- `pnpm-workspace.yaml`: new `catalog:` block is the single source of
  pinned versions — 15 `@deepseek-ai/dsh-*` = `0.1.5-rc.2` plus
  `@deepseek-ai/cordis` = `4.0.2`. `overrides:` enumerates all 16
  names pointing at `catalog:`, forcing whole-tree convergence
  (direct + transitive). pnpm has no glob selector — enumeration is
  unavoidable, and overrides live only in the root workspace yaml (the
  package.json `pnpm.overrides` form is silently ignored by pnpm 11).
- Cordis is pinned deliberately: it hosts the Events declaration-merging
  surface; leaving it on `^` keeps a drift backdoor.
- Lockfile regenerated in the same commit. Validation: frozen install
  green; forced cold regen (lockfile + node_modules deleted) converges
  all 16 pins with zero `0.1.6` in the lockfile and `tsc` green.

### D2 Unlock conditions (ledger D-002)

- The override enumeration may be removed (or reverted to ranges) only
  when upstream ships a stable/RC line (`0.1.6-rc.1`+) whose changelog
  has been reviewed, or a functional bridge gap / deprecation window
  forces the move. Every upgrade attempt runs the rehearsal first
  (D3). The comment block in `pnpm-workspace.yaml` states this inline.

### D3 Rehearsal ≠ adoption — upgrade posture (ledger D-003; T2)

- Stay pinned at `0.1.5-rc.2`; do NOT migrate to `agent/created` this
  round. For each upstream release, run the rehearsal (point catalog at
  the new version → install → tsc) and treat the expected RED as the
  compatibility alarm doing its job — record a post-mortem, do not
  implement.
- R73 rehearsal evidence: catalog → `0.1.6-alpha.2` installed the
  whole family uniformly (17 packages — upstream added
  `dsh-ptc-runtime`, `dsh-sandbox`, `dsh-sandbox-policy`); tsc
  produced exactly the predicted single error
  (`src/index.ts:87 TS2345 'agent/session-start' not in keyof Events`),
  and the mixed-tree branded-type cascade vanished under a uniform
  tree. Repin restored green with zero `0.1.6` residue.
- The upgrade ledger carries the rename map, source-guard pseudocode
  (durable injection only when `source === 'fresh'`), the payload
  diff, the expected-RED list, a staleness clause (re-review the
  changelog when `0.1.6-rc.1` appears — and re-derive the override
  enumeration since the family grew to 17), and the three adoption
  triggers.

### D4 Sequential stack landing (ledger D-004; T0)

- Four stacks landed on main in causal order via `but land`
  (linear history, no merge commits): r71-audit → `3028a4a9`,
  r72-grill → `409723a7`, r72-audit → `5f16c8e3`, r73-grill →
  `dff7539b`. The local gate (frozen install + `turbo check` +
  `turbo test` + `ship-gate --quick`) ran green between every land.
- Push → CI green runs → both audit handoffs' PENDING "绿色 run URL"
  fields backfilled with real run URLs (r71: ci 35448195039 /
  ship-gate 35448195038 / native-smoke 35448195040; r72: ci
  35449008756 / ship-gate 35449008684 / native-smoke 35449008674).
- Residual branches/stacks are listed as cleanup candidates only
  (`origin/r71-grill` confirmed merged ancestor) — nothing deleted
  without user confirmation.

### D5 0.0.7 patch release (ledger D-005; T3)

- After landing, bump all 9 package.json versions (8 packages incl.
  private dsh-plugin + root) 0.0.6 → 0.0.7 in one commit with the
  ship-gate release pin and a CHANGELOG `0.0.7` section folding the
  r72 adapter work, R71 F1–F6 fixes, and R73 pinning.
- Release flow: `release.yml` pre-tag dispatch (OF look spent,
  `eval-looks.json` committed as `dbe52e7c`, self-dispatched
  ci+ship-gate on the ledger sha both green) → tag `v0.0.7` on the
  ledger sha → post-tag assertion + publish run 35453100400 success
  (OIDC trusted publishing + provenance) → `npm view` verified
  0.0.7 for all four publishable packages
  (embedding / cli / mcp / plugin). dsh-plugin stays private.

## Consequences

- Positive: the F7 mixed-version hole is closed at two independent
  layers (package spec + whole-tree override) with a single catalog
  point to bump; the upgrade posture converts an upstream break into a
  rehearsed, documented migration with explicit triggers; the release
  delivered verified fixes to users the same day.
- Negative/cost: the 16-name override enumeration must be re-derived
  whenever the dsh family grows (already observed: alpha.2 → 17
  packages); `minimumReleaseAge` stays complementary (fresh-version
  quarantine) while pins handle semantic drift.
- Watch items: upstream `0.1.6-rc.1` arrival starts the
  ledger-reconciliation clock; a second consumer of the dsh family
  would make repo-wide overrides too broad (switch to parent>child
  selectors); CI runner flakes observed this round (windows
  install-smoke hang → cancel+rerun; pnpm/setup ECONNRESET → rerun)
  are infrastructure noise, not gate defects.

## Closure evidence

D-007 four-segment backfill (full reconciliation table:
`.scratch/grill-round-73/reports/2026-09-19-report.md`):

- **(i) Stack landing**: causal order r71-audit→`3028a4a9`,
  r72-grill→`409723a7`, r72-audit→`5f16c8e3`, r73-grill→`dff7539b`
  (linear history, zero merge commits). Between-lands gate logs:
  `.scratch/grill-round-73/evidence/t0-gate-*.log` (60 pass each) +
  `t0-test-before-r73-land.log` (13/13). Green runs — r71:
  `35448195039/35448195038/35448195040`; r72:
  `35449008756/35449008684/35449008674`; r73-grill:
  `35451319160/35451319130/35451319161`. Audit-handoff PENDING
  backfilled in `9d4259a4`. Landing transcript:
  `evidence/t0-merge-transcript.md`; cleanup candidates listed only
  (`origin/r71-grill` proven merged via merge-base).
- **(ii) F7 disposal**: pin diff `1137ce67` (catalog single point +
  16-name override enumeration + unlock-condition comment + same-commit
  lockfile regen). Frozen install green; forced cold regen → zero
  `0.1.6` in lockfile, whole family converged on `0.1.5-rc.2`/`4.0.2`
  (`evidence/t1-pinning.md`). alpha.2 rehearsal transcript
  `evidence/t2-alpha2-rehearsal.log` (17 packages uniform → single
  expected RED → repin green). Upgrade ledger `upgrade-ledger.md`
  (rename map / source-guard / payload diff / expected-RED list /
  staleness clause / three triggers).
- **(iii) Release**: tag `v0.0.7`→`dbe52e7c`; post-tag run
  `35453100400` success (pre-tag `35452475915` externally cancelled in
  the wait section — ledger commit and green checks already complete);
  `npm view` = `0.0.7` for all four publishable packages
  (embedding/cli/mcp/plugin, OIDC provenance); CHANGELOG `0.0.7`
  section; 9 manifests + ship-gate pin in one commit `2ff74bb8`;
  dsh-plugin stays private.
- **(iv) Documentation closeout**: this ADR + index regen (74 ADRs);
  CONTEXT.md six R73 term blocks (:1183-1199); deferred-registry
  `defer-r73-dsh-event-rename` appended (11 entries);
  found/fixed/deferred closed in the round report; pathlint covers
  round-73 via the existing `.scratch/**/*.md` glob; working tree
  clean.
