# ADR-0069: Grill Round 68 — Release Gate 双层化（pre-tag 自等 + post-tag 前置断言）与收口必填栏 lint

## Status

Accepted (implementation round r68). Records the round-68 decisions per the
serial ticket plan T0–T5. Ledger:
`D:\Aworker\anysearch-cli\.scratch\grill-round-68\decision-ledger.md`
(D-001..D-005). Evidence root:
`D:\Aworker\anysearch-cli\.scratch\grill-round-68\evidence\`.

## Context

The v0.0.5 release shipped from a red tree: the release-bot pre-tag job
commits+pushes the updated `eval-looks.json` ledger directly to main and never
waited for the checks that push triggers; the tag-push publish leg asserted the
recorded OF verdict but never re-checked ci/ship-gate on the TAGGED sha. Two
consecutive main tips (`2b9e6e8`, `d7bed91`) carried double-red
ci+ship-gate and the publish path had no signal to refuse.

Root mechanism (T0): the pre-tag ledger writer ran a read → normalize → write
cycle that rebuilt the object field-by-field and silently dropped
`schema_version: 1` (and would drop any future root/row field). The same
shape existed in the calibration-reset path in `cli.ts` — the F-17 sweep
found N=2 instances of the same bug class; both were fixed in T0 rather than
expanding the round.

Doc-side (T2): the R67 closeout landed without the handoff-template's required
「绿色 run URL」 section and Stack line — nothing machine-checked it.

## Decision

### D1 Fix discipline — preserve-unknown-fields (ledger D-001; T0)

- `looks-ledger.ts` is now a Tolerant Reader: root and row objects keep an
  index signature and every read/modify/write cycle spreads unknown fields
  through (`{ ...j, schema, looks, ... }` at root, `{ ...raw, ... }` per
  row, `{ ...ledger, schema, looks }` on append/compaction).
  `cli.ts` calibrate-reset preserves unknown root fields the same way.
- `eval-looks.json` regained `schema_version: 1` at root position 2.
- `eval-docs-golden.test.ts` asserts byte-level round-trip preservation of
  unknown fields (not merely "readable").
- `eval-abstain.test.ts` now passes
  `excludeGroups: OFFLINE_EXCLUDED_GROUPS` — the semantic/vector-arm group
  belongs to `test:online` per ADR-0060 D7.

### D2 Dual-layer release gate (ledger D-002; T1)

- **Layer 1 — pre-tag self-wait.** After the ledger commit+push, the
  release-gate job polls check-runs on the FIXED pushed SHA via
  lewagon/wait-on-check-action pinned at
  https://github.com/lewagon/wait-on-check-action/commit/369769072fe522a3a8a85c03c96af1e5242a1994
  (v1.9.1): `checks-discovery-timeout: 120` covers the empty window until
  push-run checks appear; `wait-interval: 30`; `wait-for-duplicates: false`
  keeps the latest run per check name; `check-regexp` covers the ci and
  ship-gate job families (check-build, install-smoke, test:online, ship-gate,
  memory-eval) and excludes macos-spillover-probe (EXPERIMENT) and
  native-smoke. The action has no total-timeout input, so the step carries
  `timeout-minutes: 20` as the fail-closed hard bound.
- **Layer 2 — post-tag/publish pre-assertion.**
  `scripts/assert-checks-green.mjs --sha ${{ github.sha }}` polls the tagged
  SHA's check-runs: all-green → exit 0; any terminal bad conclusion → fail-fast
  exit 1; in-progress → poll `--interval-sec 20` bounded by
  `--timeout-min 10`; no matching checks after `--discovery-sec 120` →
  fail-closed exit 2. Same-name dedupe = latest `started_at` per name; all
  five check families must be represented. The script doubles as the dry-run
  harness.
- **Alerting.** `concurrency: release` (fixed group, was per-ref); any gate
  red → blocking job failure + `$GITHUB_STEP_SUMMARY` + auto-opened issue +
  `release-gate` commit-status (state=failure) on the ledger commit when one
  exists. No auto-revert.
- **Verification boundary (explicit).** Dry-run evidence against concluded
  SHAs only — green leg `14514da` (8/8 ok, exit 0), red leg `d7bed91`
  (5 bad, exit 1 fail-fast), no-signal leg `4833833` (discovery → fail-closed
  exit 2). Transcript:
  `D:\Aworker\anysearch-cli\.scratch\grill-round-68\evidence\t1-dryrun-transcript.txt`.
  The Layer-1 wait action itself is NOT exercised by the dry-run — no OF look
  was spent on rehearsals. The gate is **partially verified** until the first
  real pre-tag dispatch; "fully verified" claims before that are invalid.

### D3 Closeout required-field lint (ledger D-002/D-004; T2)

- ship-gate step 1g checks closeout-shaped docs under
  `.scratch/*/handoffs/` (round-NN-* / *closeout* / *closure*; audit docs and
  next-round task books excluded) for: the 「绿色 run URL」 section, the Stack
  header line, ≥1 `actions/runs/<id>` URL, and — when `gh`+repo resolve —
  that at least one cited run's headSha is an ancestor-or-self of HEAD
  ("points at this round").
- Scope = closeouts touched by the diff ∪ the newest closeout on disk. Older
  untouched closeouts are grandfathered — the rule postdates them. The newest-
  closeout leg is standing: whichever round's closeout is latest on disk gets
  re-checked every run.
- Evidence pair: red leg flagged round-67-closeout.md (missing section +
  Stack + URL) before backfill; green leg after T4 backfill
  (`handoff-lint: 1 closeout doc(s) carry 绿色 run URL + Stack and cite a run
  on this round's history`).

### D4 Antigravity spike gating (ledger D-003; T3)

- Two-stage: spike (install → dual hooks.json probe → contract adjudication
  L0–L3 reorder → headless fire) gates any acceptance claims. Any broken leg
  records the exact leg number and downgrades to host-limitation evidence —
  no bare "Antigravity verified".
- Per-surface README verdicts only if the spike passes: CLI (agy) may claim
  verified with reduced matrix + absolute ledger path; IDE states "hooks not
  executed by host; rules fallback only".
- Audit points queued for the adapter: `hook_event_name` is NOT injected by
  agy (must come back via argv), host fields are camelCase, exit-0-only
  semantics, official top-level `{decision: allow|deny|ask|
  force_ask|deny_unless_prior_grant, reason?}`.

### D5 Governance — `but land` direct-to-main is the accepted channel (policy entry)

- R67 used `but land` twice; R68 T0 lands via the same path. The policy
  question (direct main push bypasses PR review) is adjudicated NOW rather
  than left tacit: **accepted for grill-round lands** because (a) CI gates on
  push to main provide the verification surface this repo uses (no required
  PR checks exist today), (b) every land is a recorded event in the decision
  ledger + closeout with run URLs, and (c) the T1 gate closes the specific
  hole that made it dangerous — publish now re-asserts the tagged SHA.
- **Future direction (recorded, not built):** move to PR-mode with required
  status checks (ci + ship-gate as required checks on main) once the gate
  signal is trusted; tag rulesets (`v*` restricted tags) and environment
  reviewers on the publish job are the complementary hardening — both are
  org/repo settings, noted here so the follow-up ticket has the pointers.

## Closure (回填位 — completed at T5)

(filled at round close)
