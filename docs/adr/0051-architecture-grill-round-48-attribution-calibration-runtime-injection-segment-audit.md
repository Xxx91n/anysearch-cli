# ADR-0051: Architecture Grill Round 48 — Attribution Calibration Runtime Injection and Segment Audit

Status: Accepted.

ADR-0050 closed the beta-fit, label, head, and threshold loop, but packaged CLI/MCP runtime never loads the active calibration head. This round locks the production seam and the observation contract for future memory/web divergence without pre-forking a calibration line. No source change is made in this grill round; implementation is deferred to a dedicated fixer session.

## Decisions

- **D1 Runtime seam**: `RetroaererdEngine` accepts an optional immutable `attributionCalibration`. The composition root resolves the active calibration bundle through the store reader, injects it once, and `engine.search()` forwards it to `attachAttribution()`. Kernel remains pure; only the composition root owns revision-root resolution and file I/O.
- **D2 Calibration object**: beta calibration and dual thresholds apply only to claim-level fused attribution confidence. RRF rank-fusion scores and response-level confidence are never calibrated.
- **D3 Single global line**: keep the existing single `attribution-gold` line. `--line` remains a first-class capability, not an obligation; memory/web are not pre-forked while memory-side attribution evidence is absent.
- **D4 Segment audit field**: `AttributionGoldSampleSchema` moves to schema `@2` and adds `instance: "web" | "memory"`, default `"web"`, included in the canonical sample fingerprint. The field lives on sample records only, never labels or the line manifest. It is audit-only and cannot enter beta fitting or threshold derivation.
- **D5 Per-group observability**: blind batches are stratified by instance. Reports emit per-instance n, prevalence, coverage, PSI/KS, and ECE/Brier bootstrap differences; small groups are `insufficient`, not forced through a gate. A known-but-unforked mixture can be explicitly reported as `mixed-calibration-acknowledged`.
- **D6 Fork gate**: a new calibration line requires all of: an independent memory attribution score path is live; each candidate line meets sample and statistical gates; distribution and calibration differences are significant and stable across at least two time slices; the fork improves held-out precision for the affected group; and the plan is preregistered and human-reviewed. Before forking, the order remains re-threshold, refit, revision.
- **D7 No source change**: this ADR is the scope contract and handoff baseline. Schema migration, engine wiring, runtime smoke, and L1-L5 verification belong to the implementation round.

## Consequences

- The current single calibration line remains sample-efficient and preserves one head/rollback/audit surface.
- The `instance` field makes mixed calibration observable without converting observability into an implicit split.
- Production behavior remains the existing degraded `0.6` floor until the next round actually wires and verifies the active head.
