# ADR-0048: Architecture Grill Round 45 — Local Eval-Gate Calibration Contract

Status: Accepted.

The deterministic eval gate is already statistically disciplined, but ADR-0029's 30-case judge-vs-human calibration set was inert because human labels had no durable system of record, no review flow, and no promote contract. This round defines the calibration data lifecycle and implementation contract without changing the frozen golden gate.

## Decisions

- Human relevance labels live in `packages/store/calibration-labels.jsonl`; the frozen `calibration-cases.ts` remains the seed definition.
- A paired manifest records schema version, case fingerprint, labels fingerprint, annotator metadata, and promote state.
- TypeBox is the single schema source; JSON Schema is only a mechanically derived view.
- `scripts/eval-labels.mjs` provides `add`, `set`, `remove`, `list`, `status`, `validate`, and `promote`.
- Promotion is an explicit human action that only freezes the label set and increments its version; judge enablement remains gated by the existing kappa CI lower-bound rule.
- Validation exits `0` for pass, `2` for format/precondition failure, and `12` for seed/manifest fingerprint mismatch.
- CI runs validation as a prerequisite, but calibration labels never feed the golden gate and never alter the golden fingerprint.

## Consequences

- Calibration labels become auditable through git diff and promote revisions.
- The judge remains in an uncalibrated report-only state until enough blinded human labels support the pre-registered kappa criterion.
- The implementation adds one pure core, one thin CLI, one schema module, one labels file, one manifest, and focused tests; no new runtime dependency is required.
