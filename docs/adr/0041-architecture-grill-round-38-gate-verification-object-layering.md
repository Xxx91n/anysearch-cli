# ADR-0041: Grill Round 38 — Gate-Built Verification Object (verify-what-you-build)

Date: 2026-08-31. Status: **Accepted** (grill r38; research verdict via atomcode r105-Q2: 10 searches / 8 primary full-reads). Amends wording of ADR-0040 D2 and Acceptance 6; does not supersede ADR-0040.

## Context

The r104 three-track audit (spec sub-agent + standards sub-agent + atomcode research) returned PASS-with-conditions on ADR-0040. Four P2 findings drive this round:

1. **P2-1 — ship-gate step 1 is a structural false line on CI.** `stepAccessChainVerify` (scripts/ship-gate.mjs:132-152) spawns `scripts/verify-access-events.mjs` with no db path; the verifier resolves `argv[2] ?? ANS_DB_PATH ?? ~/.anysearch/anysearch.db`, which is absent on CI and on fresh machines -> exit 2 -> explicit skip + WARN ledger. ADR-0040 D5 "fixture databases rejected (verify-what-you-consume)" was executed literally, so the gate verifies a developer's private database and never an object the gate owns. GitHub official semantics: a skipped job reports Success and does not block merge — the skip line inherits exactly the fail-open weakness ADR-0040 D5 cited to reject fail-open.
2. **P2-2 — Acceptance 6 / D7 "RFC 8785 appendix bytes as cross-anchor" was not executed literally.** The implementation instead asserts section 3.2.2/3.2.3 key-order equivalence + literal byte-string vectors + empty-segment digest = sha256(''), because RFC 8785 appendix vectors contain REAL/Unicode values outside the INTEGER/TEXT whitelist. A legitimate adaptation, but the ADR text overclaims.
3. **P2-3 — D2 "git history is the low-cost anchor" is a claim without a mechanism.** Nothing binds the chain head or genesis anchor to git commits. Industrial consensus (SQL Server Ledger external digest storage; the-chain-head anchored where the operator cannot reach) treats un-anchored chains as recomputable by anyone with write access — consistent with our non-adversarial-operator threat model, but the terminology must not outrun the mechanism.
4. **P2-4 — test hygiene.** Dead copyFileSync/lgbak backup in access-chain-verify.test.ts; the same pre-upgrade schema-stripping regex duplicated across access-chain-verify / access-chain-telemetry / access-chain-bootstrap-spawn.

## Decision

**D1 (gate verification object layering — option A with three additions).** ship-gate step 1 gains a resolution ladder: (a) ANS_DB_PATH explicitly set but the file is missing -> misconfiguration -> **fail** (no silent skip); (b) default ~/.anysearch/anysearch.db exists -> verify-what-you-consume, unchanged; (c) neither -> **gate-built track**: spawn `pnpm exec tsx scripts/chain-gate-fixture.ts`, which materializes `.ship-gate/chain-gate.db` through the *real* `SqliteSessionStore` write path with deterministic content seeds, then the verifier runs against it via an explicit `--db` argument. The gate passes only on exit 0 AND JSON verdict "PASSED" (double-check; CVE-2025-25204 lesson), and records `object: consumed|gate-built` in the skip ledger and report. This is the SLSA verify-what-you-build pattern (slsa-github-generator builds, attests, and verifies within one run): the gate-built database is not a fixture standing in for production claims — it is the bytes this very gate run's write path produced, verified end-to-end by the independent verifier. The skip ledger (3-streak forced human review, ADR-0039 D7 discipline) is retained as defense-in-depth for the remaining exit-2 surface.

**D2 (ADR-0040 wording corrections).** (i) ADR-0040 D2 reworded: external anchoring stays rejected; "git history is the low-cost anchor" is softened to "git commits act as manual checkpoints only — no mechanism binds the chain head or genesis anchor to git" (claim aligned to mechanism; non-adversarial threat model unchanged). (ii) Acceptance 6 annotated with the adapted-form disclosure from Context item 2. (iii) ADR-0040 Implementation Notes gain entries 6-8 recording these r105 amendments.

**D3 (test hygiene).** Delete the dead copyFileSync/lgbak lines in access-chain-verify.test.ts; extract the shared pre-upgrade schema derivation into packages/store/test/access-chain-fixtures.ts (stripChainAnchorDdl / preUpgradeSchema), consumed by access-chain-verify, access-chain-telemetry, and access-chain-bootstrap-spawn.

Explicitly not in scope: external anchoring mechanisms, Merkle checkpoints, signatures — ADR-0040 D2 rejection triggers unchanged.

## Consequences

- (+) CI genuinely executes the chain write path plus the independent verifier end-to-end on every gate run; the structural skip-is-Success hole closes.
- (+) ANS_DB_PATH misconfiguration fails loudly instead of degrading into a misleading skip streak.
- (+) Single source of truth for pre-upgrade schema stripping; future schema edits touch one helper.
- (-) ship-gate runs a `pnpm exec tsx` fixture step before turbo build (TS from source, no dist dependency) — a few extra seconds in the gate.
- (-) The gate-built track verifies the write-path contract, not production data; the ADR amendment records this layering so future audits do not misread it as fixture substitution (D5's prohibition on fixture databases as production verification target stands).

## Implementation Plan (r105 fix round)

1. packages/store/test/access-chain-fixtures.ts; migrate the three chain tests; delete the dead lines (D3).
2. verify-access-events.mjs: add `--db <path>`; resolution order --db flag -> positional argv -> ANS_DB_PATH -> default path (D1).
3. scripts/chain-gate-fixture.ts: rm stale gate db, real SqliteSessionStore write path, deterministic content seeds, print dbPath (D1).
4. ship-gate.mjs stepAccessChainVerify rewrite: ladder + fail-on-explicit-missing + exit/verdict double-check + object recorded in ledger and report (D1).
5. Doc batch confirmation: ADR-0040 amendments including Notes 6-8 (below), CONTEXT.md +1 term (Gate-Built Verification Object) plus Fail-Closed Verification Gate entry refinement, audit-checklist r105 block (D2, D3 record) — docs landed in this grill round.
6. Regression evidence: tsc clean, store suite green, ship-gate 9/9, eval 123/123, fingerprint 113be271869dbc54 unchanged; but commit on e-branch-2.

## Acceptance

1. On a clean machine (no ~/.anysearch/anysearch.db) ship-gate step 1 no longer reports skip; results show object=gate-built and the ledger logs pass.
2. ANS_DB_PATH set to a nonexistent path -> ship-gate exits non-zero with a misconfiguration message.
3. Gate accepts only exit 0 AND verdict "PASSED"; deleting one chained row from the gate-built db turns the gate red.
4. The pre-upgrade strip regex exists exactly once (access-chain-fixtures.ts); dead lgbak/copyFileSync lines are gone; store suite green.
5. ADR-0040 D2 + Acceptance 6 wording corrected, Implementation Notes 6-8 present; CONTEXT.md new term carries _Avoid_; all touched files UTF-8 no BOM, LF only.

## Research Sources

- atomcode r105-Q2 research report — Sufficiency Gate: 10 searches (Exa x6, Tavily x2, AnySearch x2), 8 primary full-reads, domains slsa.dev / docs.github.com / github.com / certificate.transparency.dev / cossacklabs.com / learn.microsoft.com; verdict: option A with three additions, Confidence high.
- GitHub Docs: About status checks — a skipped job reports Success and does not block merge (official evidence that structural skip = fail-open).
- SLSA spec v1.2 Verification Summary Attestation (subject-digest binding to the artifact instance); slsa.dev verifying-artifacts (verify at upload / download / monitor); slsa-github-generator build+attest+verify pattern.
- CVE-2025-25204 — exit-code semantics alone cannot be trusted; corroborated by the verdict double-check requirement.
- Microsoft Learn SQL Server Ledger (external digest storage) and RFC 6962/9162 Certificate Transparency monitor model — contrast set confirming that the single-operator threat model needs no external anchor, but claims must match mechanisms.
- Repo evidence: scripts/ship-gate.mjs:131-152; scripts/verify-access-events.mjs:56-63; packages/store/test/access-chain-verify.test.ts:100; r104 audit findings (handoff anysearch-cli-handoff-round104-adr0040-audit.md).
