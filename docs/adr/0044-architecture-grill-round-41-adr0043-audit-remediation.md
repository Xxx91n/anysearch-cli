# ADR-0044: Grill Round 41 - ADR-0043 Audit Remediation Governance

## Status

Accepted (document round r43). This ADR records the remediation governance decisions only; source changes land in the next fixer round.

## Context

The r42 implementation of ADR-0043 introduced the consumed/synthetic switch state machine, chain-backed state block, and pre-registered threshold table. The r113 audit round found two P0 structural defects and several P1/P2 gaps:

1. Chain-first rebuild loses the S3->S2 and S4->S2 back edges because both are written as `stage-transition`, while the replay table only advances `NEXT_PHASE`.
2. The real eval path has no `reconcile` or `freezeEvidence` producer, so S1->S3 and later states are unreachable in production.
3. `@2->@3` upcast drops `reasonCode`; `registrationHash` is computed but never verified; `mcnemarExactBelowN` is declared but never consumed.
4. Integrity lineage fail-closed behavior exists only in ship-gate, not at the decision/publish boundary.
5. Synthetic drill/override paths can mutate real durable state if a caller reuses production `dbPath`/`outDir`.

Q1-Q5 were researched with atomcode against academic, industrial, and repository mental models. The decisions below complete the half-built models already present in ADR-0040 through ADR-0043; they do not introduce a paradigm migration.

## Decision

### D1 Edge-typed replay function and verify-by-replay

The switch chain must be a log of state, not a hint log. Expand `event_type` from three values to a closed per-edge enum within the existing six-column hashed field set:

`promote-s0-s1`, `promote-s1-s2`, `promote-s2-s3`, `hold-s3-s2`, `unfreeze-s4-s2`, `rollback-s2-s1`, `freeze-s3-s4`.

Replay folds every edge to exactly one resulting phase. `ans switch-state --verify` must replay the chain, derive the expected phase, and compare it with the materialized ledger state. When replay cannot be verified, fail loud and quarantine; never silently rebuild into a guessed phase.

Templates: Temporal history-service sufficiency invariant, Kafka Streams changelog, ARIES redo-only compensation records, projection-drift verify-by-replay.

### D2 Committed registration payload

Treat `fixtures/switch-registration.json` as a committed registration payload with three laws:

1. Single-consumer law: every registered value is consumed by exactly one decision point. Zero-consumption fields are dead registrations and are enforced by mutation tests.
2. Binding-verification law: load-time payload digest is compared with an independently pinned full-length SHA-256 expectation. Mismatch produces an `integrity-fail-*` fail-closed block, never a silent re-record.
3. Additive-evolution law: `reasonCode` is an open, deprecate-only enum. Ledger upcasts preserve existing fields byte-for-byte and remain backward transitive for the full history.

`registrationHash` moves from a 16-hex truncation to full-length 64-hex. Short prefixes are display-only. `mcnemarExactBelowN` must be read from the registration table, not hardcoded.

Templates: npm lockfile `integrity`, SLSA subject digest, Confluent Schema Registry backward compatibility, Stripe open enum safe fallback, Fowler Parallel Change.

### D3 PDP/PEP enforcement boundary

Fail-closed integrity enforcement belongs at the two places that consume evidence into a verdict or publication: the `advanceSwitch` decision point and ship-gate. The eval runner remains audit/report-only.

The eval report gains a run-level integrity contract with `verdict: pass|failed` and `runPurpose: observational|decision`. Eval feeds a real read-only chain probe into `decideSwitch.integrityFailed`. Ship-gate eval step consumes a failed integrity verdict as publish-red, independent of the existing step-1 chain verification.

Add the missing `S1->S0` back edge for a wholly untrustworthy consumed evidence base. Write failures remain observational telemetry in observational runs and become integrity failures in decision-grade runs.

Templates: Kubernetes Pod Security Admission audit/warn/enforce, NIST 800-207 PDP/PEP separation.

### D4 Synthetic drill plane

Drill and real execution are separate planes. `advanceSwitch` accepts `mode: drill|real` or equivalent source provenance. Drill mode structurally rejects non-scratch `dbPath`/`outDir`.

Chain events and state actions carry drill provenance without a schema bump. Synthetic-track `gate-not-met` must not increment the consumed-track three-streak escalation budget. Future fixture-drill CLI defaults must point at temporary directories, never `.ship-gate` or the durable database default.

Templates: Stripe test/live key planes, LaunchDarkly authoritative track, chaos experiment provenance tags, hardware-in-the-loop sandbox closure.

### D5 Pre-registered cadence and power guards

Add the remaining statistical and storage hardening:

- C2: register `slaFrequency` and check that observed evaluation cadence is at least 2x the SLA frequency; 2x is the Nyquist floor, and industrial practice prefers 4x or greater.
- S2: register a minimum discordant-pair floor (`n_d >= 10`). Below it, the window is WARN, never a silent pass and never red.
- skip-ledger: close the dual-writer read-modify-write window with a sidecar file lock or CAS, or move the ledger state into SQLite alongside the chain.
- sentinel row: replace the `retrieval_results` fake row with an independent switch event table or nullable FK plus CHECK.
- same-db anchor: preserve the current non-adversarial threat model but publish anchor digests as out-of-band git/report checkpoints; signatures and RFC 3161 stay registered triggers.

### D6 Test closure

The fixer round must add:

- replay equivalence for every back edge;
- mutation tests proving every registered threshold is consumed;
- ship-gate negative test for a failed eval integrity verdict;
- synthetic drill isolation tests proving drill cannot mutate real durable ledger;
- S1->S0 transition and lost-update regression tests.

## Consequences

- The chain becomes a total replay function, closing the false-positive `--verify` gap.
- Registered thresholds become enforceable commitments instead of advisory data.
- Integrity enforcement is positioned where evidence becomes a verdict, without breaking eval observational discipline.
- Synthetic drills cannot impersonate production verdicts or consume real escalation budget.
- The implementation round owns source changes, tests, packaging, and live-process verification.

## Implementation Plan

1. Extend switch chain event enum to the closed per-edge set and implement full replay plus replay-derived `--verify`.
2. Repair `@2->@3` upcast to preserve `reasonCode`; add full-length registrationHash expectation and use-site verification; consume `mcnemarExactBelowN`.
3. Add run-level integrity verdict and producer; consume it in ship-gate; add S1->S0 back edge.
4. Add drill/real plane enforcement, chain provenance, per-track streak accounting, and scratch-only drill defaults.
5. Register `slaFrequency`, cadence check, and S2 minimum discordant-pair guard.
6. Add skip-ledger file lock or CAS, remove the sentinel fake row, and publish out-of-band anchor digests.
7. Add mutation, replay-equivalence, isolation, negative ship-gate, and lost-update tests.
8. Verify tsc clean, store suite green, ship-gate empty/non-empty exit 0, eval 123/123, and packaged process alive.

## Acceptance

1. ADR-0044 seven sections present (Status/Context/Decision/Consequences/Implementation Plan/Acceptance/Research Sources); UTF-8, no BOM, no CRLF.
2. CONTEXT.md gains six terms (Edge-Typed Replay Function / Log Sufficiency with Materialized Cache / Committed Registration Payload / PDP-PEP Enforcement Boundary / Synthetic Drill Plane / Pre-Registered Statistical Power Guard), each with `_Avoid_`, and the trailing `*End of Glossary*` is preserved.
3. `docs/agents/audit-checklist.md` gains the r43 remediation checkpoint block.
4. This round is docs-only; no source files are modified.
5. Next fixer round: transition matrix, replay equivalence, mutation, isolation, and integrity negative tests green; tsc clean; store suite green; ship-gate exit 0 on empty and non-empty databases; eval 123/123; packaged binary boots and stays alive.

## Research Sources

The Q1-Q5 conclusions were produced by atomcode with Exa, Tavily, AnySearch, and original-page verification. Representative sources:

- Temporal history-service architecture: https://github.com/temporalio/temporal/blob/main/docs/architecture/history-service.md
- Kafka Streams changelog and RocksDB cache semantics: https://cwiki.apache.org/confluence/display/KAFKA/KIP-0000
- ARIES recovery algorithm: https://en.wikipedia.org/wiki/Algorithms_for_Recovery_and_Isolation_Exploiting_Semantics
- npm package-lock integrity: https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json
- SLSA verification: https://slsa.dev/
- Confluent schema evolution: https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html
- Stripe API versioning: https://stripe.com/docs/api/versioning
- Fowler Parallel Change: https://martinfowler.com/bliki/ParallelChange.html
- Kubernetes Pod Security Admission modes: https://kubernetes.io/docs/concepts/security/pod-security-admission/
- NIST Zero Trust Architecture: https://csrc.nist.gov/publications/detail/sp/800-207/final
- Stripe test/live keys: https://docs.stripe.com/keys
- LaunchDarkly migration flags: https://launchdarkly.com/docs/guides/flags/migrations
- GitHub Scientist: https://github.com/github/scientist
- Google SRE Workbook multi-window alerts: https://sre.google/workbook/alerting-on-slos/
- Connor 1987 and McNemar exact sample-size guidance: https://pubmed.ncbi.nlm.nih.gov/3581846/
