# ADR-0042: Grill Round 39 — Observational Data Feeding (dual-track synthetic fixtures + skip-ledger reason codes)

## Status

Accepted (document round r39). This ADR records decisions only; implementation lands in the following rounds (r108+).

## Context

ADR-0039 shipped the full observational layer (BG/NBD spawn, PSI drift, tiered gain gate, skip-ledger, dashboard), but eval/CI runs against an empty or near-empty database: access_events holds 0 active rows, 0 fittable units, and a 0-day observation window. The BG/NBD AND-gate therefore always produces the same gate-not-met warning, the skip streak grows without bound, and every report carries one fixed warning — governance noise with zero signal. Grill r39 fixes the root cause by feeding the observational layer, not by loosening the gate.

Questions Q1-Q7 were decided in dialogue with the user, each cross-checked by atomcode web research against industrial practice (BG/NBD literature, lifetimes/pymc-marketing simulation, SLSA/artifact attestations, snapshot/golden-file testing, test-pyramid scoping):

- Q1 root cause: insufficient observational data, not a broken gate.
- Q2 data source strategy: dual-track, real consumed data preferred, synthetic fixture fallback.
- Q3 fixture artifact strategy: offline generation + static snapshots + hash pin (D2).
- Q4 fixture matrix size: four fixtures (D3).
- Q5 ledger semantics: schema @2 with reason codes (D4).
- Q6 documentation landing: this ADR + ADR-0039 append-only errata + CONTEXT.md terms + audit-checklist r108 block.
- Q7 acceptance: four-fixture end-to-end matrix plus ledger-semantics tests (D6).

## Decision

### D1 Dual-track data source

Two strictly separated tracks:
- Consumed track: real access_events from production/eval databases. Always preferred when present.
- Synthetic track: static fixture snapshots, used only for CI/gate/dashboard verification.

Tracks never mix ledgers, thresholds, or fingerprints. Synthetic data must never feed production retrieval or archive signals; it exercises machinery only. Fixture rows carry an explicit marker so a miswired loader cannot pass them off as consumed data.

### D2 Static fixture snapshots, offline generation, hash-pinned

Fixtures are generated offline with the pinned Python stack under scripts/tau/, committed as static files (golden/snapshot pattern: lifetimes generate_data, insta snapshot testing). CI/ship-gate only loads them and verifies a SHA-256 hash — no runtime generation in CI (SLSA-style artifact verification). Regeneration is a deliberate act: fingerprint flip plus forced re-baseline, reviewed in the diff. A regenerate-and-diff CI guard fails the build if committed fixtures drift from the generator pinned at the recorded seed. No external data registry (DVC etc.) is introduced. Fixture metadata is embedded alongside: seed, BG/NBD parameters, generator version, definition hash.

### D3 Four-fixture falsification matrix

Exactly four fixtures, one per gate clause (OFAT-style minimal falsification set):
1. pass-stable — satisfies T1 (active rows), T2 (PSI stable), T3 (observation window); expected to pass the whole chain.
2. T1-fail — active rows just below 300 (299 at integration level; the 99-fittable-units edge stays in unit tests).
3. T2-fail — PSI drift crossing the 0.25 threshold; PSI stability itself is an attribute of the pass fixture, not a separate fixture.
4. T3-fail — observation window shorter than 90 days (simulated clock, see D5).

Unit-level T1/T2/T3 negatives are already covered by packages/store/test/bgnbd-spawn.test.ts; the fixtures test the end-to-end chain only — no duplication with the stub matrix.

### D4 Skip-ledger schema @2 with reason codes

The skip-ledger schema bumps from @1 to @2 (also closing the r106 F-08 leftover):
- new field track: consumed | synthetic.
- reason code split: data-absent (structural absence of data) vs gate-not-met (data present, gate failed).
- Only gate-not-met counts toward the 3-streak human-escalation rule.
- After a run of data-absent entries, the first gate-not-met starts counting from 1.
- @1 ledgers migrate losslessly: existing entries default to consumed track and gate-not-met reason where the streak semantics already matched.

### D5 Simulated observation window (synthetic track only)

Fixture timestamps are generated on a simulated clock so T3 (observation window >= 90 days) can be exercised without wall-clock waiting. Reports produced under the synthetic track must be labelled simulated-observation-window. The consumed track keeps strict wall-clock semantics — no simulation there, ever. This is recorded as an ADR-0039 D6 errata (append-only).

### D6 Regression-test closure and CI guards

Acceptance closed-loop (implementation round):
1. Four-fixture end-to-end matrix: fixture -> histogram -> PSI -> AND-gate -> tier/skip -> ledger entry. pass-stable must reach gate ok; each fail fixture must produce its specific skip reason and nothing else.
2. Ledger-semantics tests: data-absent never increments streak; gate-not-met starts at 1 after data-absent; @1 -> @2 migration preserves prior entries.
3. Regenerate-and-diff guard: re-running the pinned generator at the recorded seed must reproduce the committed fixtures byte-identically.
4. Fingerprint flip: the fixture definition hash joins the baseline fingerprint; the flip in the implementation round is an expected one-time re-baseline and must be declared and reviewed, not smuggled.
5. Integration assertions stop at gate ok + ready-to-spawn; the real Python spawn path stays covered by the existing stub matrix (no Python on dev machines required).
6. Platform acceptance unchanged: tsc clean, store suite green, ship-gate exit 0, eval 123/123, packaged artifact launches and the process stays alive.

## Consequences

- The fixed gate-not-met warning disappears from empty-database runs: structural absence is data-absent and no longer erodes the 3-streak budget.
- Gate machinery becomes continuously exercised in CI via four fixtures instead of never.
- Fixture churn is expensive by design (hash + fingerprint flip + regenerate-and-diff), keeping synthetic data honest.
- One-time costs: skip-ledger @1 -> @2 migration, four fixture snapshots in repo, baseline re-pin.
- Deferred: whether more worlds/parameter matrices are warranted is a future grill once real consumed data exists.

## Implementation Plan (next rounds, NOT this one)

1. skip-ledger schema @2 + migration + reason-code split (F-08 closure).
2. Offline fixture generator under scripts/tau/ with embedded metadata.
3. Commit four fixture snapshots + hash manifest.
4. Loader path: consumed first, synthetic fallback, track field plumbed through gate/skip/ledger/dashboard.
5. Four-fixture end-to-end test matrix.
6. Ledger-semantics unit tests.
7. Regenerate-and-diff CI guard.
8. Baseline fingerprint flip, declared in the commit message.

## Acceptance (for the implementation round)

- Four fixtures behave exactly as D3/D6 specify.
- data-absent never increments the escalation streak; gate-not-met counting starts at 1.
- regenerate-and-diff guard enforced in CI.
- ADR-0039 errata applied append-only; CONTEXT.md terms present.
- tsc clean; store suite green; ship-gate exit 0; eval 123/123; packaged build launches and the process stays alive.
- Fingerprint flip declared and reviewed.

## Research Sources (atomcode, r39)

- Fader, Hardie, Lee — BG/NBD counting-your-customers simulation literature.
- pymc-marketing discussion #717 — BG/NBD synthetic data generation.
- lifetimes (Cam Davidson-Pilon) — generate_data fixture generator for BG/NBD.
- keyanyang — BG/NBD simulation notes.
- Datadog synthetic testing docs; Grafana synthetic monitoring — synthetic vs real traffic separation.
- SLSA verifying artifacts; GitHub artifact attestations; slsa-github-generator — hash-pinned artifact verification.
- seedfaker --fingerprint; safeseed drift validation — seeded fixture fingerprinting.
- insta snapshot testing; Kent C. Dodds snapshot testing; golden-file testing guides; midnightntwrk regeneration/drift issue; atheory golden tests — static snapshot + regenerate-and-diff guard pattern.
- RepliSims — replication-simulation fixture matrices.
- Fiddler / Arize / DriftSense PSI references — PSI threshold and drift fixtures.
- WSC17 OFAT — one-factor-at-a-time minimal falsification design.
- Martin Fowler — test pyramid (unit vs end-to-end scoping).

Full source list preserved at %TEMP%/atomcode-r39-sources.txt. <!-- machine-local: Windows env-var 路径引用（存量合规化） @ 2026-09-22 -->
