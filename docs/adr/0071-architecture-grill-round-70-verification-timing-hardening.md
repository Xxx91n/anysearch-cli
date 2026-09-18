# ADR-0071: Grill Round 70 — 验证层时序语义硬化（assert-checks-green 严格两段式 + spawnSync 抖动处置）

## Status

Accepted (implementation round r70). Records the round-70 decisions per the
serial ticket plan T0–T3. Ledger:
`D:\Aworker\anysearch-cli\.scratch\grill-round-70\decision-ledger.md`
(D-001~D-004, 无断号). Evidence root:
`D:\Aworker\anysearch-cli\.scratch\grill-round-70\evidence\`.

## Context

R68 audit finding F-S4 was carried as documented-behaviour debt:
assert-checks-green's discovery window only applied while ZERO check-runs
matched — a partial match (some families present, a required family never
registering) was bounded by the full `--timeout-min` alone, so a missing
family silently burned the entire completion budget before failing closed
with an undifferentiated timeout line. atomcode R70-Q2 research
(lewagon/wait-on-check-action contract, pvk.ca absolute-deadline
discipline, NILUS deadline propagation, Temporal timers) adjudicated A″:
strict two-phase with an absolute outer anchor — discovery as a nested
fast-fail sub-window inside the process-start deadline, phase-split error
lines, no third flag (an upgrade trigger is recorded instead). Research
archive: `D:\Aworker\anysearch-cli\.scratch\grill-round-70\q2-atomcode.md`.
Secondary thread (ledger D-001): store `*.integration.test.mjs` Windows
load jitter — spike reproduced the signature before disposition.

## Decision

### D1 Strict two-phase gate over a Stub-Registration Invariant (ledger D-002; T0)

- `scripts/assert-checks-green.mjs` rewritten to strict two-phase
  semantics. Phase 1 discovery: EVERY one of the five required families
  (check-build, install-smoke, test:online, ship-gate, memory-eval) must
  register >=1 check-run within `--discovery-sec` (default 120); on expiry
  -> fail-closed exit 2 with a `phase=discovery` error naming missing AND
  present families. Phase 2 completion: once all five are present, poll
  latest runs to terminal under the same absolute deadline. RED
  (terminal non-allowed conclusion) short-circuits exit 1 inside EITHER
  phase; `--once`/exit-10 probe behaviour unchanged; release.yml call-site
  flags unchanged (`--timeout-min 10 --discovery-sec 120 --interval-sec 20`).
- **Stub-Registration Invariant （必录）**: the strict predicate is sound
  ONLY because this repo guarantees every required family a check-run —
  conditional-step stubs that always register (skipped is an allowed
  conclusion) — never native `paths:` filtering, which creates no
  check-run at all and would leave a required check pending forever
  (GitHub community #44490 monorepo pain; standard workaround = N+1 stub
  workflow). `memory-eval` is the live instance: a path-filtered *step*
  inside an always-run job. Any future move to native `paths:` filtering
  on a required family immediately false-fails strict discovery — that
  trade-off is on record here.

### D2 Absolute deadline anchor + phase-split diagnostics (ledger D-002; T0)

- `--timeout-min` stays an ABSOLUTE deadline anchored at process start —
  the lewagon contract has exactly one time input (checks-discovery-
  timeout) and bounds completion by the outer job clock. Re-anchoring the
  completion clock at the discovery-finished event (rejected option B) is
  the moving-anchor anti-pattern: it silently stretches the external
  bound (10min -> ~12.2min worst case) and is the only option that
  deviates from the lewagon contract it claims to mirror.
- Error lines are phase-split (the D-core of Q2 folded into A″): discovery
  failure names `missing-families=` + `present-families=`; completion
  timeout names `pending=` checks + `not-allowed=` conclusions. Exit
  codes unchanged — 2 = fail-closed for both phases; the MESSAGE carries
  the phase.

### D3 Upgrade Trigger Record (ledger D-002; T2)

- The richer alternative (Temporal-style dual budget / a third
  `--completion-min` flag) was rejected as YAGNI for a fixed 5-family
  single-purpose script — but a rejection is a suspension with a trigger,
  not a deletion. Recorded triggers: (a) discovery registration habitually
  >30s; (b) a real completion-budget starvation incident — required-check
  p99 approaching or exceeding the 10min absolute bound.
- **Trigger watch — partially armed by this round's own evidence (D4)**:
  ship-gate (windows-latest) max = 740s > the 600s bound. The C-upgrade
  condition is no longer purely theoretical; see D4 for the standing
  caveat and the deferred mitigation.

### D4 Check-duration quantile evidence （必录； T2)

- gh api `commits/<sha>/check-runs` sampled over 15 shas — 9 release-run
  head_shas (release.yml runs 35211259312/35211150217/35172953708/
  34990675633/34987961772/34981241843/34970372081/34970221257/34968562955)
  + 6 pushed main tips (2f6d990a, 3a9d4578, 01f8d7ff, 6c801678, 72495cb3,
  3b78b835) — 167 completed check-runs. Raw dump:
  `D:\Aworker\anysearch-cli\.scratch\grill-round-70\evidence\t2-checkrun-durations.json`.

  | family | n | p50 | p90 | p99/max (s) |
  |---|---|---|---|---|
  | check-build | 24 | 209 | 273 | 319 |
  | install-smoke | 24 | 190 | 262 | 388 |
  | test:online | 12 | 37 | 42 | 44 |
  | ship-gate | 23 | 248 | 492 | **740** |
  | memory-eval | 12 | 35 | 42 | 47 |
  | native smoke | 48 | 25 | 41 | 49 |
  | macos-spillover-probe | 12 | 29 | 36 | 38 |
  | release gate | 9 | 17 | 37 | 37 |
  | publish to npm | 3 | 71 | 79 | 79 |

- Registration corroborates the internal 「注册秒级」 fact: required-5
  started_at spread per pushed tip = 0–36s (median ~1–3s) — discovery-sec
  120 carries >=3x headroom; strict discovery false-fails only on genuine
  non-registration, not on normal event-delivery jitter.
- **Tail erosion — reported per the task-book threshold (p99 ~8min)**:
  ship-gate (windows-latest) reached 740s (12.3min; run
  https://github.com/Xxx91n/anysearch-cli/actions/runs/35331384726/job/105556283719)
  and a release-run head_sha hit 611s — both OVER the 600s absolute
  bound. If a tag ever lands while a slow windows ship-gate is still in
  flight, assert-checks-green fails closed on a run that would have gone
  green ~2min later. Today's publish flow makes this near-unreachable
  (the pre-tag lewagon wait blocks until checks are green, so the assert
  sees an all-terminal snapshot), but the bound-vs-tail inversion is a
  fact on record: the D3 trigger is armed, and the cheapest direct
  mitigation — raising `--timeout-min` at the release.yml call site — is
  deferred as an explicit follow-up, not silently absorbed.

### D5 Jitter disposition: bound the synchronous child, keep the suite (ledger D-001; T1)

- Spike (8-worker CPU saturation; transcript
  `D:\Aworker\anysearch-cli\.scratch\grill-round-70\evidence\t1-jitter-spike.txt`):
  `eval-labels.integration.test.mjs` + `revision-cli.integration.test.mjs`
  exceeded a 60s observation bound every round; `revision-fixture` +
  `access-chain-nodb` slowed but passed. Signature = spawnSync-child CPU
  starvation slowdown: the .mjs files are bare scripts (no test() wrapper)
  and therefore unbounded by --test-timeout, and spawnSync's synchronous
  block cannot be preempted anyway — a starved child held the event loop
  past any outer bound.
- Disposition (b) per signature: every inner spawnSync now carries an
  explicit timeout (60s generic; 180s for the eval-calibrate --boot 200
  judge run) and throws a descriptive ETIMEDOUT error — a starved child
  fails fast with a real signature instead of an unbounded hang. Same-load
  re-run: both tests completed green (66s / 94s; verify transcript
  `D:\Aworker\anysearch-cli\.scratch\grill-round-70\evidence\t1-fix-verify.txt`).
- Rejected: (a) Flaky Case Quarantine — the golden-case machine
  (ADR-0027/0065: ledger + SLA + ratchet) adjudicates labelled eval
  cases, not binary integration processes; fitting it here is a
  mechanism mismatch, not a configuration. (c) limitations.md alone —
  the signature reproduced deterministically, so doc-only closure would
  under-dispose; residual saturation-mode failure is bounded and signed,
  which is the honest end-state.

## Closure (回填位 — completed at T3)

- (i) F-S4: strict two-phase shipped in `scripts/assert-checks-green.mjs`
  (land 72495cb3; ci run 35346930128 + ship-gate run 35346930060 +
  native-smoke run 35346929991 all required-green); ESM fixture 7/7
  red->green pair at
  `D:\Aworker\anysearch-cli\.scratch\grill-round-70\evidence\t0-fixture-{red,green}.txt`;
  real-SHA --once probe GREEN exit 0
  (`D:\Aworker\anysearch-cli\.scratch\grill-round-70\evidence\t0-real-sha-once.txt`).
- (ii) jitter: spike signature = spawnSync-child CPU starvation on bare
  .mjs files; disposition (b) inner timeouts landed (land 3b78b835;
  ci 35349184977 / ship-gate 35349185004 / native 35349185022 all green);
  transcripts t1-jitter-spike.txt + t1-fix-verify.txt.
- (iii) duty: install-smoke 26/26 and ship-gate --quick 57x[pass] on the
  committed clean tree (t3 transcripts); release.yml flags untouched.
- (iv) docs/closeout: this ADR + CONTEXT term (SpawnSync Starvation
  Bound) + CHANGELOG r70 entry + ledger 落地对账 + goal finalized;
  round report
  `D:\Aworker\anysearch-cli\.scratch\grill-round-70\reports\2026-09-18-report.md`;
  final land 6736aaae — ci run 35350962475 + ship-gate run 35350962449 +
  native-smoke run 35350962481 all required-green (macos-spillover-probe
  EXPERIMENT failure, non-blocking, deferred).
