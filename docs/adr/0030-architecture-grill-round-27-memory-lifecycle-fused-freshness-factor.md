# ADR-0030 (grill r27): Memory Lifecycle Governance — Fused Freshness Factor + Explicit Invalidation

- Date: 2026-08-28
- Status: Accepted (grill r27, Q1-Q7 全用户确认)

## Status
Accepted. Supersedes nothing; complements ADR-0008 (Time Edge Effect G019 origin), ADR-0023 (retrieval deepening), ADR-0027 (eval harness), ADR-0028 (rank gate), ADR-0029 (scope discipline + judge calibration). This round is the deferred "decay semantics independent research" item from ADR-0029 D6.

## Context

The store already implemented time-decay (ADR-0008 D2): exp(-Δt/τ) kernel, τ ∈ {7,30,90}d tiers, FLOOR=0.3, interpolation fusion `bm25 × (1 − w·(1−decay))` (w=0.25/0.4), QDF keyword gating, pinned exemption, bi-temporal `valid_until` write-path invalidation, quarantine read-side exclusion. Two gaps were found this round:

1. `last_accessed`/`access_count` are written on every recall hit (`touchAccessed`, ADR-0009 D3 L2) but never enter any rank expression — collected signal, disconnected.
2. QDF trigger regex `/最新|最近|news|2024|2025|2026|latest|recent|新闻|更新/i` hardcodes year literals (silent failure from 2027-01-01), and the kernel (`memory-pipeline.ts:380`) carries a drifted inline copy contradicting ADR-0023 D2's "reuse store classifiers" intent.

Industry research (Mem0 official docs + blog 2026-05, SurrealDB, Zep/Graphiti, FadeMem arXiv 2601.18642, LongMemEval, EMem, A-TMA, MemStrata, Anderson & Schooler 1991, ES function_score) converges: decay (retrieval-time re-rank), invalidation (conflict-driven, invalidate-not-delete), expiry (TTL sweep), overwrite (write-time adjudication) are four separate channels; soft decay is a ranking bias, never a filter; stale-under-similarity is irreducible for pure soft decay (MemStrata AUROC 0.59) so write-time invalidation stays mandatory.

## Decision

**D1. Lifecycle strategy = retrieval-time soft decay + explicit invalidation; no TTL, no full bi-temporal.** (Q1=C) Layered governance keeps: soft decay for staleness, user-invoked invalidation mapped onto the existing `valid_until`/quarantine write path (no new column, no new table). TTL is rejected as a recall tool (Mem0: TTL is a compliance tool); "knowledge should not expire" matches the vertical-specialist positioning.

**D2. Fusion = multiplicative scaling band, replacing the interpolation form.** (Q2=B) The old `1 − w·(1−decay)` interpolation capped the observable reordering at ~21–38% score swing; the fused multiplier must behave as a direct scaling factor. The `w` parameter is retired (recorded, not silently deleted).

**D3. Access reinforcement = recency(last_accessed) + frequency(access_count), both compressed into ONE multiplicative band; no new schema columns.** (Q3=C) Existing fields are sufficient. ACT-R full base-level (access_history ring buffer + ln(Σ t_j^−0.5)) is deferred to a later round if the band form proves insufficient. A pre-flight sanity check must confirm `access_count` increments exactly once per recall hit before wiring.

**D4. Fused single factor [0.3, 1.5]: created_at decay, last_accessed recency, access_count frequency fuse into ONE factor; stacking two independent recency-shaped multipliers is the documented Mem0 anti-pattern ("over-correct buries useful old facts").** (Q4=A) Exemptions: pinned rows bypass entirely; evergreen queries bypass the decay component but keep access reinforcement. Combined floor is 0.3 (never 0.09).

**D5. QDF year literals removed + kernel drift fixed.** (Q5=A) Store regex drops `2024|2025|2026` (year-literal channels are not a verified freshness trigger; Google QDF is spike/hotness-driven); kernel `memory-pipeline.ts` switches to importing the store's exported classifiers (fulfilling ADR-0023 D2), eliminating the `什么是X` drift. Due-chore channel: may ship as its own commit.

**D6. Default parameters: τ = 7/30/90 days unchanged; factor band [0.3, 1.5] aligned to Mem0 production values; frequency term cap = 0.15 (recency dominant).** (Q6=A) All defaults are marked calibration-pending: ADR-0027/0029 eval harness and judge calibration own any future tuning. τ=5/14/365 alternatives lack second-source evidence.

**D7. Rejection list + acceptance closure.** (Q7 confirmed) Rejected this round: (a) TTL hard expiry; (b) full bi-temporal four-timestamp model; (c) ACT-R complete access_history; (d) stacked independent multipliers; (e) dynamic year injection into QDF. Acceptance: factor boundary tests (0.3/1.5), exemption tests (pinned/evergreen), fusion monotonicity, year-literal-free regex assertion, kernel-reuse test; then turbo check, build, store tests, ship-gate quick, CLI alive.

## Consequences

- Ranking becomes explainable in one sentence: "every memory carries a single [0.3×, 1.5×] freshness factor".
- Old-but-useful knowledge can sink to 0.3× but never vanishes; cannot satisfy "point-in-time truth" queries (accepted, no product need today).
- `access_count` becomes a load-bearing scoring input: its write semantics (exactly-once per recall) now matter and must be verified.
- The QDF trigger loses the year channel by design; queries whose only freshness signal is a bare year become neutral — accepted (Google-style hotness detection is out of scope).
- eval rank-gate pair assertions (ADR-0028) must be re-baselined through review, not silently re-run.

## Implementation Plan

1. `packages/store/src/time-decay.ts`: replace interpolation with fused factor `freshnessFactor(createdAt, lastAccessed, accessCount, tier, {pinned, evergreenQuery})` → [0.3, 1.5]; τ table unchanged; frequency term capped 0.15; QDF regex year literals removed; QDF weight switch (0.25/0.4) retired with interpolation.
2. SQL surface: `time_decay()` UDF signature extended (or new `freshness_factor()` UDF) receiving last_accessed/access_count; `session-store.ts:218` + `fts5.ts:45` rank expressions updated.
3. Verify `access_count` write path (exactly-once per recall) via a dedicated test; fix if missing.
4. `packages/kernel/src/memory-pipeline.ts`: replace inline QDF lambdas with imports from `@anysearch/store`.
5. Tests: factor boundary at both ends of the band; pinned/evergreen exemptions; fusion monotonicity (fresher accessed > stale untouched at equal BM25); regex contains no 4-digit year; kernel uses store classifiers.
6. Eval: golden cases keep temporal anchors (21d/90d/365d); rank gate re-baseline reviewed and committed with fingerprint update (ADR-0027 D9 discipline).
7. Full verification: `turbo check` (6/6), `turbo build`, store tests, ship-gate quick, CLI `--help` alive.
8. Docs: CONTEXT.md +3 terms; this ADR; CHANGELOG notes interpolation `w` retirement.

## Acceptance

- [x] Factor output always within [0.3, 1.5] for any input (fuzzed unit test).
- [x] Pinned memory unchanged; evergreen query bypasses decay half only.
- [x] access_count increment exactly-once test green.
- [x] No 4-digit year literal in `time-decay.ts`; kernel imports store classifiers (no inline regex).
- [x] turbo check 6/6, turbo build green, store tests green.
- [x] ship-gate quick green; CLI --help alive.
- [x] ADR + CONTEXT terms landed, UTF-8 no BOM, no CRLF.

## Research Sources

1. Mem0 Memory Decay docs — https://docs.mem0.ai/platform/features/memory-decay (0.3×/1.5× band, 20-touch cap, candidate pool ×3, threshold-before-decay, clamp semantics)
2. Mem0: Introducing Memory Decay — https://mem0.ai/blog/introducing-memory-decay-in-mem0
3. Mem0: Agent Memory Staleness / long-running agents — https://mem0.ai/blog/memory-decay-for-long-running-agents (stacked-recency over-correction warning; penicillin allergy ranking experiment)
4. Mem0: Memory eviction and forgetting — https://mem0.ai/blog/memory-eviction-and-forgetting-in-ai-agents (ondelete four strategies; LRU rare-but-critical failure)
5. Mem0: AI Memory Security Best Practices — https://mem0.ai/blog/ai-memory-security-best-practices (MINJA / AgentPoison; expiry as security control)
6. Mem0 issue #5330 — https://github.com/mem0ai/mem0/issues/5330 (Ebbinghaus 0.5^(days/7) default; offline-time anchor; UPDATE defense)
7. SurrealDB Agent Memory: Caching and Invalidation — https://surrealdb.com/docs/agent-memory/tuning/caching-and-invalidation (tier TTL, ×0.95/day schedule, lifecycle.expire/decay)
8. Zep: Temporal Knowledge Graph — https://www.getzep.com/ai-agents/temporal-knowledge-graph/ ; arXiv 2501.13956 (bi-temporal; invalidate-not-delete)
9. Graphiti engineering post — https://blog.getzep.com/beyond-static-knowledge-graphs
10. FadeMem — https://arxiv.org/html/2601.18642v2 (half-life 5–11d; β shape; LLM fusion)
11. Anderson & Schooler 1991 — Reflections of the Environment in Memory (need odds; power law)
12. ACT-R base-level activation — act-r.psy.cmu.edu subsymbolic manual (Bi = ln Σ t^−d, d≈0.5); critique: UCSD outsider perspective PDF
13. Generative Agents — arXiv 2304.03442 (recency × importance × relevance)
14. Learning What to Remember — arXiv 2606.12945 (recency-only 0.368 vs multi-factor 0.770)
15. A-TMA ghost memory — arXiv 2607.01935; MemStrata — arXiv 2606.26511 (AUROC 0.59 stale-detection limit → write-time invalidation mandatory)
16. AI Agent Memory Design Guide — hidekazu-konishi.com/entry/ai_agent_memory_design_guide.html (over-eager forgetting / stale facts / stacked contradictions)
17. Elasticsearch function_score decay — elastic.co function-score-query docs
18. Google Freshness / QDF — developers.google.com ranking systems guide; US patent 9189526
19. hermes-agent issue #677 — https://github.com/NousResearch/hermes-agent/issues/677 (weighted 0.5/0.3/0.2 composite, 30d half-life)
20. Local sources: packages/store/src/time-decay.ts, session-store.ts, fts5.ts, schema.sql; packages/kernel/src/memory-pipeline.ts, query-rewrite.ts; ADR-0008/0009/0023/0027/0028/0029.
