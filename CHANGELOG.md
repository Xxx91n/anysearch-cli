# Changelog

All notable changes to this project are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow
[SemVer](https://semver.org/).

## [Unreleased]

### Added
- ADR-0037: `ans consolidate` and `ans memory forget --undo` CLI; durable maintenance DB
  via ANS_DB_PATH (default ~/.anysearch/anysearch.db); semantic_memories sixth RRF arm
  (serve, weight 0.5, conditional activation, fail-closed regression gate); three-protocol
  LLM endpoint config (ANS_LLM_BASE_URL + ANS_LLM_API=chat|messages|responses + ANS_LLM_API_KEY).

### Fixed
- r94 audit (ADR-0037, atomcode Spec-1): single-query searchMemory resolved the semantic arm
  through a byId map that was never populated with semantic hits — sixth arm silently dropped
  on that path (MCP recall_memory consumer). Fixed + regression test.
- r94 audit (ADR-0037, atomcode S1): kernel llm-init read ANS_LLM_API_KEY from the environment,
  violating its own "No env reads in kernel" contract; callers pass the key explicitly now.
- r94 audit (ADR-0037): applyArchive explicit-ids path now enforces pinned / closed /
  quarantined exclusions at the force point; LLM summarize moved out of the BEGIN IMMEDIATE
  write lock (plan/apply split; dry-run exact prediction unchanged); `ans consolidate`
  rejects unknown flags (exit 2).

## [0.1.0-rc.0] — 2026-08-22

### Fixed
- r90 audit (ADR-0036): D5 RoR delta sign convention corrected in ADR-0036 and CONTEXT.md
  (positive = relation arm pushed the memory earlier; sign was documented inverted while
  code/tests/baseline all used positive=helps — regression trap removed).
- r90 audit (ADR-0036 D6): backfill retry counter snapshot now also covers
  `relatedToWriteOnce` so a failed batch retry no longer double-counts that telemetry bit;
  busy-injection test now holds the foreign lock past busy_timeout (5200ms) so the
  exponential-backoff branch actually executes (a 150ms hold was absorbed by busy_timeout).

### Added
- ADR-0020 ship-gate pipeline: `scripts/ship-gate.mjs` (Node stdlib, single file)
  as the blocking Product Smoke Gate, plus a non-blocking
  `modelcontextprotocol/conformance` workflow as the Protocol Heartbeat.


### Added
- ADR-0030: fused freshness factor [0.3, 1.5] in store ranking — creation-age decay,
  `last_accessed` recency, and `access_count` frequency fused into ONE multiplicative band
  (`freshness_factor()` UDF replaces `time_decay()`). `access_count` column added via
  idempotent migration; every returned recall hit increments it exactly once, on both
  `searchMemory` and `searchMemoryMulti` paths.
- ADR-0030 D5: kernel `memory-pipeline.ts` now imports `isTimeSensitive`/`isEvergreen`
  from `@anysearch/store` (inline regex copy deleted; the QDF regex itself no longer
  carries year literals).

### Removed
- ADR-0029 D6: dropped `--write-baseline` from `packages/store eval` (the one-round alias for `--calibrate`).
- ADR-0030 D2: retired the `w` interpolation weight (0.25/0.4) and the
  `1 - w·(1-decay)` fusion form. Ranking is a direct multiplicative scaling band now.

### Infrastructure
- 16 prior ADRs landed across rounds 1–17 (MCP Phase2, Kernel Engine
  composition, dual-era SDK v1+v2 bridge, TypeBox source-of-truth, plugin
  hooks layer, SessionStart routing, L0/L1 memory pipeline).

### Added
- ADR-0035 KG-lite relation arm (fifth RRF arm, weight 0.5): closed 8-predicate table
  (`works_on/depends_on/uses/part_of/member_of/located_at/authored_by/related_to`) with EN+CN alias map,
  rule-first extraction (verb frames + url<->handle bridge + 2-preKnown co-occurrence), single-call
  LLM seam behind a strict post-filter (JSON degrade parse, never blocks the write path), edges table
  with partial-unique active index and episode provenance, merge redirects edges within the combine
  transaction with snapshot-driven bounded unmerge restore, `pendingEdges` gauge + relationTel counters,
  golden `relations` group (12 cases: 8 predicate positives incl. CJK quoted, fail-closed supersede,
  observational no_edge + 1-hop hit-rate), ship-gate 1j static + relation-zone metric assertions.
- ADR-0035 D7: `ans relation list` + `ans relation backfill-relations` (dry-run default, keyset
  pagination, `--reprocess` supersedes stale rules_version rows, exit codes 0/1/2).

[0.1.0-rc.0]: https://github.com/anysearch/anysearch-cli/releases/tag/v0.1.0-rc.0

### Added
- ADR-0036 relation-arm gain observance (Phase-1): single-run counterfactual ablation for the
  relation arm — SqliteSessionStore captures arm provenance per searchMemory call; the eval runner
  drops the relation list and recomputes RRF, producing paired rank deltas for every expectRankOf
  golden op. Gate statistics: paired BCa 95% CI (seeded mulberry32 bootstrap + jackknife), one-sided
  sign-flip permutation p, Sakai sample-size lock (cap 80), chi-square upper sigma_d. Decision rule
  (BCa lo > 0 AND mean >= minGain AND signFlip p < 0.05) fails closed; under-powered / degenerate /
  missing-baseline downgrade to WARN. Golden relations group expanded 12 -> 78 (30 EN + 8 CN RoR
  pairs with 14-memory distractor corpus, 14 EN + 8 CN alias edges, 6 no_edge negatives); baseline
  recalibrated over 50 seeded runs (sigmaDU=0.102, lockedN=17). New test eval-relation-gain.test.ts.

### Changed

- ADR-0036 D6 (Phase-2): `ans relation backfill-relations --apply` now commits one IMMEDIATE
  transaction per batch (was a single whole-run transaction), retries SQLITE_BUSY with exponential
  backoff (50ms base, 5s cap, <=8 tries, aligned with busy_timeout=5000), fails fast on
  SQLITE_BUSY_SNAPSHOT, and runs a passive WAL checkpoint after each committed batch. The dry-run
  path keeps the single rolled-back transaction, so counters remain exact predictions (ADR-0035 r87).
  The "no concurrent MCP traffic during backfill" constraint is relaxed to recommended-not-required;
  CLI help and ADR-0035 D7 wording updated. Regression coverage: per-batch exact-parity and
  live-writer contention cases in relation-edges.test.ts.

