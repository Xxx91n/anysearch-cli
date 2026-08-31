# ADR-0040: Grill Round 37 — Access Events Tamper-Evidence Layer (prev_hash chain + independent verifier + alert-on-silence)

## Status

Proposed (grill round 37, landed). Decisions D1–D7 ratified via grill Q1–Q7; every question researched by atomcode three-engine web research (sources below). Grounding corrections applied during the grill: (a) the r101 audit-report claim of an in-repo "reverify hash-chain precedent" was falsified by `rg` (zero hits anywhere in the repo) and is recorded here as an erratum against that report; (b) Q4's assumed six-column field set was corrected mid-grill to the real schema — `access_events` today is `{id, memory_id, accessed_at}` with a single write point at `session-store.ts:365`.

## Context

ADR-0039 introduced `access_events` as a discipline-level append-only audit log (no UPDATE/DELETE in code; undo never rewrites events). The r100/r101 dual-track audit (F6) found the name overclaims: no hash chain, no verifier, no schema version, no idempotency constraint, and the instrumentation write path swallows failures in bare `catch {}` (an alert-on-silence hole). Industry baselines (Sigilbase guide; PCI DSS v4.0 "failures of the logging system itself"; SQL Server Ledger; systemd FSS; RFC 5848; CT) converge on tamper-evidence = hash chain + independent verifier + alert-on-silence as the minimal complete set. Threat model: single-user local CLI; the operator is the user; primary risks are accidental corruption, software bugs, disk faults — not an adversarial operator.

## Decision

**D1 (topic) — Tamper-evidence layer for `access_events` is this round's single theme.** Chosen over the observational-data-feeding and BG/NBD-domain-fit alternatives; it is an ADR-grade new decision, closing r101 audit F6.

**D2 (component set A') — Three components plus schema_version.** (1) `prev_hash` hash chain (SHA-256) over canonical events; (2) independent zero-dependency `scripts/verify-access-events.mjs` wired into ship-gate step 1; (3) the instrumentation `catch {}` becomes counted telemetry `eventWriteFailures` in the Observational zone (ADR-0039 report-as-contract; never gated — Goodhart). Plus `schema_version` + `event_type` columns from day one (Sigilbase step 1: immutable logs must version). Explicitly rejected with registered triggers: Ed25519 signatures (trigger: multi-user / service deployment — signatures only defend against the operator, who is the user), Merkle checkpoints (trigger: scale makes O(n) re-verification impractical), external anchoring / RFC 3161 (git history is the low-cost anchor; evaluate only for compliance delivery), idempotency keys (trigger: writes gain retries/concurrency — better-sqlite3 single-threaded writes have none), forward-secure truncation defense (local truncation risk accepted; git commits act as natural checkpoints). Chain guarantees start at ingestion (honest limits, Sigilbase).

**D3 (legacy cut-over, B+C) — Zero rewrite of legacy rows plus one genesis anchor.** UPDATE of legacy rows is forbidden (ADR-0039 append-only; SQL Server Ledger "cannot convert — provision and copy"; systemd FSS rotates forward; RFC 5848 signs only post-deployment). The anchor commits to a deterministic aggregate digest over all legacy rows in `id` order (RFC 8785 serialization rules), the Sigilbase FAQ "honest approach". Implementation-driven refinement, recorded: with `PRAGMA foreign_keys = ON`, an in-table genesis row (`event_type='chain_genesis'`, `memory_id` sentinel) would violate the `memory_id REFERENCES retrieval_results(id)` NOT NULL FK; the anchor therefore lands as a single-row table `access_chain_anchor (id INTEGER PRIMARY KEY CHECK (id = 1), digest TEXT NOT NULL, genesis_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))` — same semantics (seal legacy history as a one-off snapshot at cut-over), different storage. Verifier semantics: recompute the legacy aggregate digest and compare to the anchor; recompute `genesis_hash`; walk the chained segment from the first row with non-NULL `prev_hash`; report legacy and chained segments explicitly — never silently skipped.

**D4 (hash input contract).** Field set `{id, memory_id, accessed_at, prev_hash, schema_version, event_type}` — all six hashed, id included to detect reorder/delete. Canonicalization = fixed field array → named-key object → JSON.stringify with fixed key order, byte-equivalent to RFC 8785 for this closed ASCII scalar schema (RFC §3.2.3: ASCII keys sort identically). Hand-concatenated `key:value|...` strings are forbidden (Canopy ADR-014 Amendment 3: field-boundary shifts, None-vs-"NONE" collisions). Chain formula: `hash = SHA-256(canonical(entire row including prev_hash))` — written down, not implied. NULL = JSON null. TEXT/INTEGER-only whitelist: REAL columns never enter the chain. `accessed_at` byte-exact (SQLite `datetime('now')` format, no normalization; writer and verifier must agree byte-wise — Canopy Bug 6 lesson; any future format change requires schema_version split). Verification iterates `ORDER BY id` — never by timestamp (same-second collisions; nyay-setu #1525) — and detects forks (sibling rows sharing a `prev_hash`). Field order never derived from `PRAGMA table_info`. 3 core + 2 boundary golden byte vectors pin the serializer. Mandatory clause: any future hashed-column addition requires a `schema_version` bump plus golden-vector extension.

**D5 (verifier gate semantics) — Fail-closed at ship-gate step 1, locally runnable.** Deterministic verification has no false-positive rate to calibrate, so there is no WARN observation round (an ever-green verifier is the elvatis anti-pattern; SLSA VSA verificationResult is binary PASSED/FAILED; cosign / `journalctl --verify` exit non-zero on failure). Broken chain / first error / FALSE-PASS (schema missing or empty-but-claimed) = exit 1, ship red — a broken chain is proven-negative under ADR-0038 D2. No database present => verifier exits 2 ("no input"; sysexits EX_NOINPUT spirit), and ship-gate maps that to explicit-skip with reason + WARN ledger entry (exit 0 with trace, 3-streak escalation per ADR-0039 D7). Fixture databases rejected (verify-what-you-consume); fail-open rejected (GitHub: skipped checks report Success). Full O(n) re-verification, no sampling (SLSA / journalctl never sample; local scale is sub-second).

**D6 (bootstrap mechanism) — Lazy bootstrap in the SessionStore constructor, immediately after the existing idempotent ALTER chain, inside `db.transaction(fn).immediate()`.** BEGIN IMMEDIATE is mandatory: WAL snapshot reads do not survive a read→write upgrade under a concurrent commit (SQLITE_BUSY_SNAPSHOT, which busy_timeout does not cover — SQLite isolation docs; one defensive retry permitted). Sequence: anchor-existence check → create `access_chain_anchor` if absent → scan legacy rows `ORDER BY id` → aggregate digest → insert anchor. The single-row CHECK constraint plus upsert semantics give DB-level idempotency under CLI+MCP dual-process open (Liquibase DBCL discipline: uniqueness by key, serialization by lock). busy_timeout=5000 (ADR-0036 D6); persistent busy/IO failure degrades to stderr WARN + telemetry bit (ADR-0009 D6 fail-open — the "C" option survives only as A's failure mode). The write path re-probes anchor existence before the first chained insert so cut-over survives a crashed constructor. The anchor is the chain head (SQL Server Ledger block-chain precedent). Optional manual command `ans access-chain bootstrap --dry-run/--apply` as a thin wrapper over the same idempotent core (backfill-* precedent). One anchor per DB file; no cross-file transactions (SQLite WAL: no cross-db atomicity).

**D7 (test closure) — 8+3 items converging to 6 zero-dependency test files.** (1) Golden vectors: 3 core + 2 boundary, NIST CAVP KAT structure, RFC 8785 appendix bytes as cross-anchor. (2)+(3) Positive full-chain verify (exit 0) + four tamper-injection classes (modify/insert/delete/reorder — AuditWeave taxonomy) → exit 1 with first-error location; one deterministic case per class, optional seeded-RNG sweep (mulberry32 precedent). (4) No-library run → exit 2 → ship-gate skip + skip-ledger trace. (5) Concurrent bootstrap via **real spawned double processes** — worker_threads same-process dual connections are rejected (POSIX fcntl locks are per-process; no inter-process contention on Unix; SQLite's own concurrency suite is mptester multi-process and its crash tests spawn children; bgnbd-spawn precedent). Spawn a thin bootstrap script, not the full CLI; assert both paths (retry → exactly one anchor; busy-timeout → WARN degrade, write path unblocked). (6) eventWriteFailures injection increments the counter, never silent. (7) Second construction is idempotent (no duplicate anchor, zero legacy bytes changed) — shares (5)'s fixture. (8) Acceptance = tsc + pack + CLI/MCP liveness + new tests green + eval-gate 123-case regression + fingerprint flip registration (ADR-0027 D9). Plus three gap items: verifier performance smoke at 10k/100k rows (report-only, never gated — Cossack: verification-in-seconds is a security requirement); schema_version forward/backward assertions (v2 verifies v1; v1 verifier on v2 → explicit-skip; unknown version → explicit error); whitelist boundary negatives (a REAL column or variable-precision timestamp entering chain input → explicit rejection).

## Consequences

- `access_events` graduates from append-only-by-discipline to tamper-evident-by-construction; the repo gains its first integrity gate at ship-gate step 1.
- Cost: one table, one script, six test files, ~120 LOC of runtime code. Zero new dependencies (node:crypto + better-sqlite3 only).
- Errata recorded: (a) r101 audit report's "in-repo reverify hash-chain precedent" is false (falsified by rg; the chain is a fresh minimal implementation); (b) D5's no-WARN stance deliberately narrows the ADR-0038/0039 observation-round habit, justified by the deterministic-verification argument, and is consistent with ADR-0038 D2 (proven-negative => red).
- Deferred registry rows (trigger + owner): signatures / Merkle / external anchoring (D2 registered triggers; owner: architecture grill); verifier performance budget (trigger: 100k-row smoke exceeds seconds scale); BG/NBD domain-fit grill (r101 audit candidate, untouched here).

## _Avoid_ (round-37 registry)

1. UPDATE/DELETE on `access_events` or `access_chain_anchor` (legacy rows stay byte-identical forever).
2. WARN grace periods on chain verification (binary: PASSED/FAILED).
3. Shared serialization code between writer and verifier (the bug must not be able to hide in both).
4. Sampling or spot-check verification.
5. Ordering verification by `accessed_at` (id order only); ignoring fork rows.
6. Gating ship on `eventWriteFailures` (observational; Goodhart).
7. Hand-concatenated hash-input strings.
8. Adding hashed columns without a schema_version bump and new golden vectors.

## Implementation Plan

1. Schema: idempotent ALTER ADD COLUMN `prev_hash TEXT`, `schema_version INTEGER` (NULL = legacy v0), `event_type TEXT` (NULL = legacy 'access') + `access_chain_anchor` single-row table + schema.sql ↔ schema-content.ts regen (hand-editing schema-content.ts stays forbidden) + fingerprint flip.
2. Writer-side canonical serializer + golden-vector test file; serialization spec constants duplicated verbatim in this ADR so the verifier is implemented independently.
3. Constructor bootstrap (immediate transaction; anchor existence check; legacy scan; digest; insert; busy/WARN degrade) + second-construction idempotency.
4. Write path: chained insert reads the last chained `prev_hash` in the same statement path; instrumentation catch → `eventWriteFailures` telemetry; pre-insert anchor re-probe.
5. `scripts/verify-access-events.mjs` (independent canonical implementation; ORDER BY id; legacy digest compare; fork detection; exit 0/1/2; perf counters).
6. ship-gate step 1 wiring (fail-closed; no-db → skip + ledger) + `ans access-chain bootstrap --dry-run/--apply`.
7. Six test files per D7 (golden-vectors; verify positive+negative; no-db-skip; concurrent-bootstrap spawn; telemetry + idempotency; perf smoke + schema fwd/back).
8. Acceptance run: pnpm -r check, build/pack, CLI + MCP liveness, eval-gate 123/123 regression, fingerprint flip registered in the eval baseline, CHANGELOG Added.

## Acceptance

1. Tamper injection (4 classes) on a fixture DB → verifier exit 1 with first-error location; untouched control → exit 0.
2. Two-process concurrent bootstrap → exactly one anchor row; both processes' subsequent events verify clean.
3. No-library run → exit 2; ship-gate converts to ledgered skip (exit 0 with trace); 3 consecutive skips escalate per existing ledger discipline.
4. Legacy bytes: full-table dump of access_events before/after upgrade identical except appended rows (no UPDATE evidence).
5. Perf smoke at 10k/100k rows reported in milliseconds/seconds; never gated.
6. Golden vectors byte-match RFC 8785 appendix cross-checks.
7. Compile + pack + CLI/MCP liveness + eval-gate 123/123 all green.

## Research Sources

- Sigilbase tamper-evident audit-logs guide + FAQ (retrofit = cut-over chain + one-off legacy snapshot, "the honest approach"; alert on silence; schema version from day one; honest limits) — sigilbase.io.
- Microsoft SQL Server 2022 Ledger docs (ledger tables cannot be converted; provision-and-copy migration; block hash chains) — learn.microsoft.com.
- systemd-journal Forward Secure Sealing (seal from activation; `journalctl --rotate`; Fedora 43 deprecation noted as currency check) — systemd.io JOURNAL_FILE_FORMAT; netdata docs; lwn.net/898522.
- RFC 5848 (Signed Syslog: post-deployment signing only); RFC 9162 / RFC 6962 (Certificate Transparency: tree starts empty, consistency proofs); RFC 8785 JCS (§3.2.2/§3.2.3 key order, numbers, Unicode; appendix golden bytes) — datatracker.ietf.org / rfc-editor.org.
- Canopy ADR-014 (concat-collision Amendment 3; timestamp-precision Bug 6); schemabrain canonical.py (sort_keys; "set membership is load-bearing"); arbitus (Rust/SQLite chain; legacy-skip semantics); nyay-setu issue #1525 (ORDER BY timestamp intermittent flake).
- SLSA Verification Summary Attestation spec (binary PASSED/FAILED); sigstore cosign exit codes; GitHub Actions docs (skipped check reports Success); Veracode CLI exit-code layering; sysexits EX_NOINPUT; bettercli exit-code minimalism; elvatis ever-green-verifier anti-pattern; finqub audit pitfalls.
- pytest skip-with-reason docs; Flyway / Rails / EF Core / JetBrains migration-automation stances; Liquibase DBCL/DBCLL; multica#3647 (lockless multi-replica startup migration failure); K8s init-container / Helm-hook migration practice (andrewlock.net; HN 17388317).
- SQLite official: isolation (SQLITE_BUSY_SNAPSHOT), lang_transaction (BEGIN IMMEDIATE), WAL (per-db atomicity), upsert (ON CONFLICT), datatype3 (affinity), mptester / crash tests; better-sqlite3 api.md (`transaction().immediate()`); apenwarr on POSIX per-process locking.
- Cossack Labs audit-log requirements (verification in seconds; AL-Verifier); AuditWeave tamper-mutation taxonomy; NIST CAVP KAT vectors; Confluent Schema Registry compatibility docs; INNOQ schema-testing guidance; QLDB discontinuation notice (2024-07 EOL 2025-07-31) — industry convergence on self-hosted chain+verifier.

*Glossary additions land in CONTEXT.md (Tamper-Evident Hash Chain / Chain Genesis Anchor / Fail-Closed Verification Gate / Alert-on-Silence Telemetry).*
