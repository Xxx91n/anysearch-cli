# ADR-0043: Grill Round 40 — Consumed/Synthetic Switch Governance (five-stage state machine + pre-registered triggers + TOST reconcile)

## Status

Accepted (document round r40). This ADR records decisions only; implementation lands in a following round. The parallel r110 fix round (ADR-0042 SP-F-01..) implements the data-absent semantics contract specified here in D1/D3; the two rounds do not block each other.

## Context

The r109 audit of the ADR-0042 implementation found its Acceptance unmet: SP-F-01 (severe) — the consumed-track AND-gate inputs were hardcoded to zero (runner.ts) and the dataAbsent criterion was too narrow (cli.ts), so every eval run with written events recorded gate-not-met, the skip streak grew unbounded, and ship-gate exited 1. Stated in one sentence: the switch trigger from synthetic to consumed was never pre-registered, and the implementation used a placeholder posing as a decision.

Grill r40 governs the behavior that appears once real access_events arrive: how the system moves gate authority from the synthetic observation track (ADR-0042) to the consumed track — the switch state machine, its triggers, its equivalence check, its rollback semantics, its freeze semantics, and where the state lives.

Questions Q1–Q7 were decided in dialogue with the user; each question was researched by atomcode against industrial practice (LaunchDarkly migration flags, Stripe Scientist migrations, Expand/Contract + pgroll, Argo Rollouts / Flagger / Kayenta, Temporal, TOST/equivalence-testing literature):

- Q1 scope: this round is docs-only governance design, running in parallel with the r110 fix round (D1).
- Q2 state machine grain: five stages S0–S4 with explicit back edges (D2).
- Q3 S0→S1 trigger: pre-registered composite threshold table C1–C4 with k_max convergence (D3).
- Q4 S2 reconcile semantics: TOST paired equivalence testing with McNemar as directional diagnostic only (D4).
- Q5 rollback: graded automatic rollback, with the integrity lineage split out as fail-closed, and Inconclusive-hold separated from true rollback (D5).
- Q6 S4 freeze: evidence-driven, reversible freeze of the synthetic track as a hash-pinned CI baseline (D6).
- Q7 state carrier: skip-ledger schema @3 materialized state block + hash-chain stage-transition events + `ans switch-state` query (D7).

The governing mental model: there is no one-shot switch — only a permanent dual track plus a staged state machine. The synthetic track builds the baseline and is never retired into deletion.

## Decision

### D1 Scope and r110 coupling

This ADR is the specification; r110 is the implementation vehicle for the parts already encoded in ADR-0042. Concretely: the data-absent semantics — "events exist but no fit-eligible data" classifies as data-absent (skip, never counted toward the escalation streak) — is defined by this ADR (D3) and implemented in the r110 fix round. This round changes no source code.

### D2 Five-stage switch state machine with explicit back edges

The switch is a staged state machine, not a binary flag:

- S0 synthetic-only: synthetic track is the sole gate evidence. data-absent skips may stay here indefinitely.
- S1 consumed-observed: consumed data flows into the observational zone only (ADR-0039); the gate still consumes the synthetic track. Entry requires the C1–C4 trigger table (D3).
- S2 dual-track reconcile window: both tracks compute the gate on the same observation input; TOST paired equivalence (D4) must hold before promotion.
- S3 consumed-primary: the consumed track is the gate authority; the synthetic track remains as active warm standby for regression and reconcile drift.
- S4 synthetic frozen: the synthetic track is frozen as a hash-pinned static CI baseline (D6). Archives are kept, never deleted.

Back edges are mandatory: S3→S2 (pause-and-recheck), S2→S1 (true rollback) per D5. A state machine without back edges is a pipeline, not governance.

### D3 S0→S1 pre-registered readiness trigger (C1–C4)

Promotion S0→S1 requires all four pre-registered clauses, wall-clock semantics on the consumed track (no simulated clock, ADR-0042 D5):

- C1 data volume: fit-eligible rows at or above the pre-registered floor (reuses ADR-0039 T1 shape: >=300 active rows and >=100 fittable units; re-calibration for the fit purpose is an implementation-round decision).
- C2 observation window: continuous observation window >= W days (default W=90, same shape as ADR-0039 T3); in-window evaluation cadence >= 2x the SLA frequency.
- C3 distribution stability: PSI < 0.25 in-band, same-bucket symmetric-KL (ADR-0039 T2). Evaluation order is part of the registration: C1 before C3, because PSI grows with sample size.
- C4 anti-flap: the above must hold for N consecutive rounds (default N=3, aligned with the 3-streak escalation cadence); k_max convergence — after k_max rounds without promotion, file WARN to the ledger and require human review; never retry indefinitely.

Classification semantics: any C1–C4 unmet -> stay in S0. "Events exist but no fit-eligible data" is data-absent (skip-ledger reason code, never counted in the escalation streak — the SP-F-01 fix contract). C1–C3 met but C4 unmet is gate-not-met (counted). Neither classification ever promotes.

### D4 S2 reconcile = TOST paired equivalence; McNemar is a diagnostic, not a judge

S2 asks an equivalence question ("may consumed take authority?"), not a difference question. The two tracks consume the same observation input — a textbook paired design — so the reconcile verdict is:

- Primary criteria (all three, pre-registered SESOI bands frozen before the S2 window opens, alpha budgeted through the ADR-0038 OF table, one share only):
  - tier verdict concordance rate >= pre-registered lower bound (e.g. 95%);
  - PSI difference <= 0.25, same-bucket symmetric-KL (ADR-0039 D6 reuse);
  - rank displacement within a tolerance band (median <= 1 position, p95 <= 3 positions).
- McNemar discordant-pair statistics are reported; directional asymmetry (consumed systematically worse) is a WARN diagnostic written to the WARN ledger, not a promotion criterion — it measures marginal shift, not equivalence.
- Sample discipline: n_d < 25 uses exact binomial; >= 25 allows the chi-square approximation. Insufficient power in S2 is WARN, never red (ADR-0038 D2 three-state discipline), and never a silent pass.

Gate authority stays on the synthetic track through S2; the consumed track is the candidate under test (Scientist topology: ADR-0042 D1's "synthetic never impersonates production" maps to control, consumed to candidate). The rejected alternatives: dual independent AND-gating (wrong sample structure — independence was the premise of ADR-0038's holdout FWER bound) and compound AND+equivalence (double alpha spend for redundant information).

### D5 Graded rollback; integrity failures are not rollbacks but fail-closed blocks

Two lineages, two reasonCode families in the skip-ledger:

- Degradation lineage (`rollback-*` / `check-*`):
  - Light — a single C-family metric out of band (PSI or rank displacement): S3→S2 as an Inconclusive hold (Argo pause semantics). The reconcile re-runs; if it passes, promotion resumes and nothing is counted as a rollback. reasonCode `check-s3-s2`, never counted in the escalation streak.
  - Heavy — continuous data outage beyond the pre-registered window, or the directional McNemar WARN confirmed: S2→S1 true rollback after N consecutive confirmations (N pre-registered, ~3, per Argo failureLimit / Flagger threshold precedent). reasonCode `rollback-s2-to-s1`.
- Integrity lineage (`integrity-fail-*`): hash-chain verification failure, event write failures, fixture fingerprint drift — not a rollback. Fail-closed hard block plus human intervention (ADR-0040 D5 deterministic-verification semantics; circuit-breaker OPEN, not degradation).

Rollback hygiene: rollback events are written to the skip-ledger and to the access_events hash chain (event_type='rollback' rows) but never increment the 3-streak roll-up — a rollback is an action, not a skip. Re-promotion after a rollback restarts the full pre-registered flow with counters reset. Hysteresis discipline: the consecutive-success count required to promote must exceed the consecutive-failure count required to roll back, so the two cliffs flank a stability plateau instead of flapping. Rollback is idempotent and reversible: it demotes state, it deletes no data. The synthetic track may only rehearse the rollback mechanism (fixture-driven); true rollback verdicts are computed from the consumed track only.

### D6 S4 freeze is evidence-driven and reversible

Entry to S4 requires an evidence bundle: S3 stability over the pre-registered warm-standby window (>= 1 week order of magnitude) plus N consecutive reconciles with only diagnostic-level mismatches. On freeze, the synthetic track becomes a hash-pinned static baseline consumed only by the CI fixture matrix (the ADR-0042 four-fixture library and fingerprint discipline carry over unchanged). Freeze is recorded as a ledger action plus chain event (event_type='freeze'). Freeze is reversible: a major consumed-track change (schema/version shift) can unfreeze the synthetic track back into S2 reconcile. The synthetic track is never deleted — Expand/Contract discipline: contract only happens with proof of zero remaining consumers, and here the CI baseline is a permanent consumer.

### D7 State carrier: skip-ledger @3 + chain stage-transition events + status CLI

- skip-ledger upgrades to schema @3: an added state block {phase, since, transitionId, evidenceHash}, upcast losslessly from @2 (precedent: @1→@2 upcast, ADR-0042 D4). Unknown/newer schema versions fail loud, never silently wipe (canonizes r110 SA-F-03).
- Chain events use the existing six-column hashed field set with event_type='stage-transition' — zero schema bump, zero new golden vectors (ADR-0040 D4). Conversion details (from/to/evidence) live in the ledger state block; the evidenceHash cross-binds the two.
- Write order: chain event first, then the ledger (tmp+rename, canonizes r110 SA-F-08 atomic write). If the chain write succeeds and the ledger write fails, fail loud and rebuild the state block from the chain — the ledger is a materialized, rebuildable cache; the chain is the immutable source of truth; on conflict the chain wins.
- `ans switch-state` (read-only; --verify cross-checks evidenceHash against the chain) exposes current phase and last transition, per the ADR-0037 manual-CLI precedent.

Rejected: a standalone state.json (an unprotected second source of truth); pure event-sourced state derivation (industrial evidence — Temporal persists summaries precisely because replay is too slow — and it would demand byte-identical semantics between the replay engine and the runtime write path, a trap ADR-0040 already refused).

## Consequences

- The SP-F-01 accident class (placeholder posing as a trigger) becomes structurally impossible: every promotion/rollback predicate is a pre-registered table entry, auditable against the ADR.
- alpha discipline is preserved: S2 spends exactly one OF share; the rejected compound design would have spent two.
- The synthetic track's permanent retention converts "cost" into the CI regression asset — the four fixtures and fingerprint pinning stay load-bearing forever.
- r110 must implement the D1/D3 data-absent contract verbatim; audit-checklist r110 SP-F-01 acceptance (ship-gate exit 0 on both empty and non-empty databases) is unchanged.
- docs-only round: no code changes here; the implementation round owns tsc/test/ship-gate closure.

## Implementation Plan

1. skip-ledger schema @3: state block {phase, since, transitionId, evidenceHash}; lossless upcast from @2; unknown-version fail-loud.
2. Chain writer: event_type='stage-transition' / 'rollback' / 'freeze' rows within the existing six-column hashed field set; chain-first then ledger write order with rebuild fallback.
3. Switch-runner module: evaluates C1–C4 (S0→S1), TOST+McNemar reconcile (S2), back-edge predicates (D5), freeze evidence (D6); every verdict logged with pre-registered table row referenced by id.
4. ans switch-state read-only CLI with --verify cross-check.
5. Fixture drills (synthetic track): promote/hold/rollback/freeze rehearsal scenarios through the four-fixture matrix; synthetic may never trigger a true verdict.
6. Pre-registration tables shipped as data (threshold config with version + hash), not constants in code.
7. Tests: state-machine transition matrix test; upcast @2→@3 round-trip; rollback leaf-through (ledger + chain + no streak increment); hysteresis anti-flap test; integrity-lineage fail-closed test.
8. Ship-gate integration: read state through the ledger; exit-0 semantics unchanged on both empty and non-empty databases (r110 acceptance rides through).

## Acceptance

1. ADR-0043 seven sections present (Status/Context/Decision/Consequences/Implementation Plan/Acceptance/Research Sources); UTF-8, no BOM, no CRLF.
2. CONTEXT.md gains 3 terms (Switch State Machine (S0–S4) / Pre-Registered Readiness Trigger / Graded Rollback with Inconclusive Hold), each with _Avoid_, trailing *End of Glossary* preserved.
3. audit-checklist.md gains the r40 checkpoint block.
4. docs-only: no source files modified; fingerprint 5be13f8abcfab1f9 unchanged.
5. Next implementation round acceptance: state-machine transition matrix test green; ship-gate exit 0 on both database shapes; eval 123/123; tsc clean; packaged binary boots and stays alive.

## Research Sources

All findings cross-checked by atomcode (multi-engine) during r40 Q1–Q7; originals fetched and verified.

- LaunchDarkly — Performing multi-stage migrations with migration flags (2/4/6-stage table): https://launchdarkly.com/docs/guides/flags/migrations
- LaunchDarkly — Kill switch flags: https://launchdarkly.com/docs/home/flags/killswitch
- Stripe — Online migrations at scale (Scientist double-read, four-phase): https://stripe.com/blog/online-migrations
- GitHub — Scientist (control/candidate, mismatch recorded not raised): https://github.com/github/scientist
- Martin Fowler — Parallel Change (expand/migrate/contract): https://martinfowler.com/bliki/ParallelChange.html
- Liquibase — Expand and Contract pattern: https://www.liquibase.com/technical-glossary/expand-contract-pattern
- Xata — Schema changes and expand-contract with pgroll: https://xata.io/blog/pgroll-expand-contract
- Netflix TechBlog — Automated Canary Analysis with Kayenta: https://netflixtechblog.com/automated-canary-analysis-at-netflix-with-kayenta-3260bc7acc69
- Spinnaker — Kayenta canary docs (Mann-Whitney, Nodata semantics): https://spinnaker.io/docs/guides/user/pipeline/triggers-with-artifacts/
- Argo Rollouts — AnalysisRun Successful/Failed/Inconclusive, failureLimit: https://argo-rollouts.readthedocs.io/
- Argo Rollouts issue #3850 — Inconclusive not respected under background analysis: https://github.com/argoproj/argo-rollouts/issues/3850
- AWS — Canary deployments with Flagger (threshold=5): https://aws.amazon.com/blogs/opensource/
- Lakens — Equivalence Tests: A Practical Primer (TOST): https://pmc.ncbi.nlm.nih.gov/articles/PMC5502906/
- EMA — Guideline on the choice of non-inferiority margin: https://www.ema.europa.eu/en/documents/scientific-guideline/guideline-choice-non-inferiority-margin_en.pdf
- MedCalc — McNemar test (n_d<25 exact binomial): https://www.medcalc.org/en/book/mcnemar-test.php
- EmiTechLogic — Shadow Deployment and Canary Testing for ML Models (observation vs comparison windows, warm standby >=1 week): https://emitechlogic.com/
- Streamkap — Zero-Downtime Database Migration with CDC (three-phase cutover): https://streamkap.com/
- Temporal — History Service architecture (event history + materialized mutable state): https://github.com/temporalio/temporal/blob/main/docs/architecture/history-service.md
- Microsoft Azure — Circuit Breaker pattern (three-state, half-open probe): https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker
- Microsoft SQL Server — Ledger (append-only + hash chain + materialized history): https://learn.microsoft.com/en-us/sql/relational-databases/security/ledger/ledger-overview
- OpenFeature — Flag Evaluation spec (MUST NOT throw, default value): https://openfeature.dev/specification/sections/flag-evaluation
- Hespanha & Morse — Stability of switched systems with hysteresis (hysteresis constant): https://www.sciencedirect.com/science/article/abs/pii/S0005109802002418

## Implementation Notes (r42 impl, 2026-09-02)

1. Q5 gaps finalized: rollback/freeze chain events satisfy the access_events FK via the `switch-events-sentinel` row (`archived=1` + `quarantine='switch-events-sentinel'`, invisible to all read paths); consecutive-count first values are pre-registered in `fixtures/switch-registration.json` (promote C4=3 consecutive, heavy rollback=2 confirmations — the hysteresis pair 3>2; k_max=10 rounds).
2. Industry audit trail (atomcode, three-engine): there is no maintained JS/TS TOST/McNemar package fit for gate duty — evaluation-gate projects (wasmagent-js, mcnemar-nlp) hand-roll scipy-semantics pure functions; XState's own author and the Argo/Kubernetes controller ecosystem both endorse the hand-rolled transition table for sub-10-state machines; data-file thresholds with version+hash follow DVC/Git-LFS/npm-lockfile precedent. Consequently zero new dependencies: McNemar (exact binomial n_d<25 / Yates-corrected chi-square above), SESOI-band checks, and the decision core are ~150 LOC of pure functions in `packages/store/src/eval/switch-machine.ts`.
3. Wheels reused, not reinvented: hash-chain mechanics reuse ADR-0040 `eventHash`/bootstrap unchanged (six-column hashed field set, zero schema bump); ledger IO reuses the r110 SA-F-03/08 quarantine + tmp+rename contract; PSI/kl reuse `bgnbd.psi` against the `pass-stable` pinned baseline fixture (C3).
4. Packaging hardening: the CLI bundle is CJS, so every eval module's path resolution is lazy (no top-level `fileURLToPath(import.meta.url)` evaluation). `fixtures/` ships in the store tarball; fixture-backed registrations therefore resolve inside packed installs, and the module graph can no longer crash `ans` at boot (regression found + fixed in this round).
5. Drills vs truth: promotion/reconcile verdicts are computed from the consumed track only; the synthetic fixture track exercises the machinery in `test/eval-switch-state.test.ts` (drill) — verdicts from synthetic readings are structurally impossible to leak into the ledger state because only `advanceSwitch` (durable-DB sourced / explicit override) mutates state.
6. r42 verification evidence: tsc clean (all 7 packages); store test suite green incl. eval-switch-state (38 asserts) and eval-skip @3 upcast (38 asserts); ship-gate 9/9 exit 0 with the pre-fixture empty-database shape; eval re-run against a seeded non-empty durable DB (2 units, 6 events) exits 0 with 123/123 and fingerprint 2cf98c9130018956 unchanged; `ans pref --help`, `ans switch-state --verify` on the packaged artifact exit 0 (process alive).
7. audit-checklist.md r40 checkpoint + r10x block bookkeeping this round: the file carried an in-flight foreign edit (staged/unstaged pair from a parallel window) at handoff time — the r40 boxes are asserted met here and the checklist edit is deferred to the checklist owner to avoid committing another agent's staged content.
