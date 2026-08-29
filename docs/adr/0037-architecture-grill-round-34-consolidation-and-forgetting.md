# ADR-0037: Grill Round 34 — Episodic-to-Semantic Memory Consolidation (sixth RRF arm) + Reversible Active Forgetting (G019 closure)

## Status

Accepted (grill round 34, landed 2026-08-29). Implements Q1–Q7 of the consolidation interview; research-driven, one question at a time, atomcode-verified on every question (topic selection, trigger, storage form, pipeline, forgetting, phasing, endpoint compatibility).

## Context

Golden-cases notes record "decay (G019) is P2 and currently has NO gate coverage"; time-decay.ts declares "soft decay is a ranking bias, never a filter". Meanwhile retrieval_results (episodic retrieval snapshots) grows monotonically: rows are soft-closed (valid_until) but never removed, so the candidate pool inflates and retrieval noise rises with library age. Academic anchors: Generative Agents reflection (arXiv 2304.03442, signal-gated threshold ~150), Mem0 update stage (arXiv 2504.19413) and its 2026-04 algorithm retreat to single-pass ADD-only (LoCoMo 71.4→92.5), HaluMem (arXiv 2511.03506, LLM ops as hallucination injection point), MemoryBank Ebbinghaus curve (arXiv 2305.10250), MemoryOS hot/warm/cold tiering (arXiv 2506.06326), FadeMem adaptive decay (lambda 0.1, promote/demote 0.7/0.3, 45% storage reduction with 82.1% key-fact retention). Industrial anchors: Zep/Graphiti ("episodes are the permanent provenance ground truth; every derived fact traces back", bi-temporal invalidate-not-delete), Mem0 Memory Decay blog ("passive aging is for noise; active forgetting is for facts"), LangMem background manager (debounce 30–60min), Elastic agent-memory ("relevance decay, not truth decay"). ADR-0034's claim-attribution layer supplies the fidelity gate; ADR-0031/0033/0035 supply the three prior "side table + new RRF arm" precedents; ADR-0032/0036 supply the reversible-log and phase-split precedents.

## Decision

**D1 (Q1) — Round theme: episodic→semantic consolidation with embedded active forgetting.** Distill stale/low-value episodic retrieval snapshots into semantic memory rows with dedup (ADD/UPDATE/NOOP), gate summary fidelity through the ADR-0034 claim-attribution layer, and close G019 by adding a hard-archival (active forgetting) channel. Consolidation and forgetting are one coin (Mem0: consolidation = summarization + deduplication); splitting them would double-build the dedup/archive machinery. Rejected this round: pure TTL cleanup (subsumed by the archive policy), standalone fact-invalidation round (already ~80% present: valid_until on retrieval_results/entities/edges), read-time contradiction arbitration (deferred until the semantic layer exists to surface conflicts against), MemGPT self-editing memory / full Graphiti port / A-MEM / MemoryOS (all over-engineered for a local single-user CLI).

**D2 (Q2) — Trigger = deterministic signal-gated threshold + manual CLI.** A deterministic candidate-pool signal (episode count + freshness-decay band + access_count; zero per-item LLM scoring — Generative Agents' per-event LLM importance is rejected on cost) proposes a consolidation batch; the user runs `ans consolidate --dry-run` / `--apply` (backfill-* precedent). No resident background process (LangMem background manager and Letta dreaming rejected: CLI has no daemon). LangMem's debounce idea is internalized only as the batch-window design; RecMem's recurrence clustering (87% token savings) informs the batch clustering signal.

**D3 (Q3) — Storage: new `semantic_memories` table + sixth RRF arm.** Fields: content, source_episode_ids JSON (structured provenance back-links; original episodes preserved, never physically deleted — Zep/Graphiti provenance model), created_at, valid_until, salience. Retrieval: sixth RRF arm, weight 0.5, conditional activation (arm absent when zero rule/signal hits), `WHERE valid_until IS NULL` filter — ADR-0031 D4 patches reused verbatim. Rejected: same-table kind column (pollutes url NOT NULL semantics, FTS external-content triggers, memory_embeddings/memory_entity FKs, entity/KG episode_memory_id back-links — the exact "Confusion with episodic recall" failure mode Mem0 warns against); rerank-only metadata (no persistent asset). v2 backlog: entities.summary column for entity-level semantic evolution (Zep-style), complementary to this topic-level arm.

**D4 (Q4+Q7) — Pipeline: LLM via the existing pi-ai seam, deterministic ops quadruple, fidelity gate reuses classifyClaim.** Summary generation: one bounded LLM call per cluster through the pi-ai seam. Endpoint compatibility (user hard requirement): pi-ai 0.84.2 natively implements all three wire protocols (openai-completions / openai-responses / anthropic-messages) plus Google; the seam gains an endpoint config (env `ANS_LLM_BASE_URL` + `ANS_LLM_API` (chat | messages | responses, explicit — no protocol sniffing, per Copilot CLI / Cline / pi models.json precedent) + `ANS_LLM_MODEL`); memory-pipeline.ts unchanged; zero custom wire-adaptation code (~30-line opts surface on createLlmSession). Local text generation (transformers.js) and pure rule-based summaries rejected on quality ceiling. Ops quadruple, all deterministic: NOOP when cosine vs existing semantic row > theta_dup = 0.90 (fold into access-count); UPDATE when CONTRADICTION_RE + high overlap → soft-close old row (valid_until) + write new row (edges re-assertion supersedes precedent); DELETE = archiving (D5). HaluMem: every LLM ops call is a hallucination injection point — judgment never goes to the LLM. Fidelity gate: classifyClaim reused with core logic unchanged; four adaptations: (1) episode→NormalizedResult adapter (thin pure function), (2) threshold recalibration on the eval harness (semantic claims anchor on entities; jaccard naturally lower), (3) cluster-scoped evidence (only in-cluster episodes), (4) evidence.sourceKey → source_episode_ids mapping. fail-open semantics preserved: gate unavailable → row marked low-confidence, never blocked (ADR-0034 D4).

**D5 (Q5) — Active forgetting = soft archive, reversible, episodic-layer only.** `archived` flag (0/1) on retrieval_results plus retrieval filter `AND archived=0`; hard DELETE forbidden (provenance chain must survive: edges.episode_memory_id, memory_entity.memory_id, semantic_memories.source_episode_ids all keep resolving). semantic_memories/entities/edges never TTL-archived — they change only via supersession. Deterministic eligibility: age (tiered tau 7/30/90 reusing time-decay bands), access_count, last_accessed, salience (column filled by the consolidate LLM call; the *decision* consumed deterministically). Reversibility: `archive_log` table (entity_merge_log precedent: kind archive/unarchive + detail JSON snapshot + undone flag); undo = archived=0 flip + undone=1. Dry-run report shape: wouldArchive counts by tier, impact on edges/semantic refs/embeddings, rrfArmImpact breakdown, undoable: true. Golden gains a `forget` group (pinned exemption, access threshold, salience threshold, idempotency, undo flip); L0 contract assertions fail-closed immediately, quality thresholds land after an observation window (ADR-0034 D5 two-stage cadence).

**D6 (Q6) — Three phases, one fingerprint flip, arm default-off (shadow).** Phase-1 observational harness: golden semantic + forget assertion groups land together with the schema migration (semantic_memories + archive_log + archived index); fingerprint flips exactly once; consolidate pipeline full capability but the sixth arm serves nothing (shadow telemetry only; --dry-run exact prediction, --apply writes to DB). Phase-2 production core: sixth-arm wiring (conditional activation, weight 0.5), regression gate fail-closed immediately (post-fusion RoR not worse than the five-arm baseline), gain RoR delta to the ADR-0036 observation zone. Phase-3 forgetting CLI closure: archive/unarchive UX, rollback bit-exactness golden, ship-gate forget assertions. Two-phase rejected: forgetting carries delete-semantic risk and needs its own observation window. ship-gate: 4 new assertion classes (schema/seed, semantic zone keys, forget zone keys, fingerprint single-flip) + 2 reused (task-parity LLM budget, report-only telemetry). Sixth arm shadow→promotion: default-off + conditional activation + non-exempt regression gate — the weighted combination of the ADR-0033 (default-on + circuit breaker) and ADR-0035 (conditional activation) precedents, plus shadow/promotion discipline.

**D7 — Acceptance assertions (six):** (1) fidelity negative cases: unsupported summary claims never persist (or persist low-confidence only); (2) ops quadruple is deterministic — no LLM in the decision path; (3) dedup theta_dup = 0.90 boundary covered by golden; (4) archive is reversible: apply → undo restores bit-exact retrieval behavior; (5) sixth-arm regression gate fail-closed at activation, gain threshold after one observation window (pre-registered, ADR-0036 formula); (6) dry-run exact prediction preserved across consolidate and archive paths.

## Consequences

- The library stops growing without bound: episodic snapshots archive out of every retrieval arm while remaining auditable.
- Semantic memory becomes a first-class knowledge asset (cross-session "facts we have established in this domain") feeding RRF, with attribution-grade provenance.
- G019 closes: decay gains gate coverage and an active-forgetting channel instead of being a pure ranking bias.
- First user-facing write-side LLM consumption: the pi-ai seam's endpoint config becomes part of the contract; all three wire protocols supported from day one with zero custom adapters.
- Risk called out by research: consolidation's real-data distribution (cluster sizes, fidelity re-calibration targets) is unproven; Phase-1 observation exists to size it. Exa was rate-limited (429) in several research rounds; conclusions rest on Tavily/AnySearch/direct-fetch cross-verification.

## Implementation Plan

1. Golden first (Phase-1): semantic + forget assertion groups, schema migration, consolidate dry-run/apply pipeline with shadow arm; single fingerprint flip + one recalibration (EVAL_TIMEOUT_MS budgeted).
2. Ship-gate: schema/seed assertions, semantic zone keys, forget zone keys, fingerprint single-flip check; reuse task-parity + report-only telemetry.
3. Phase-2: sixth-arm wiring (weight 0.5, conditional activation, archived/valid_until filters), regression gate fail-closed, gain observation into ADR-0036 zone.
4. Phase-3: ans memory forget --dry-run/--apply + undo, archive_log, rollback golden, ship-gate forget assertions.
5. Endpoint config (ANS_LLM_*) documented; llm-init.ts gains endpoint field (~30 lines); no custom protocol code.
6. CONTEXT.md terms: Episodic-to-Semantic Consolidation, Signal-Gated Consolidation Trigger, Soft Archive with Undo Log, Three-Protocol LLM Endpoint Config.

## Acceptance

- pnpm -r check / pnpm -r test / pnpm -r build green; ship-gate all gates green; CLI/MCP process-alive probe.
- Six ADR-specific assertions (D7) covered by tests/golden.
- Golden fingerprint flipped exactly once; baseline recalibrated.
- Dry-run exact prediction holds on both consolidate and archive paths; undo restores retrieval exactly.
- No protocol sniffing; explicit ANS_LLM_API three-way select works against a stubbed endpoint for each protocol in tests.

## Research Sources

- Generative Agents reflection — https://arxiv.org/abs/2304.03442 (threshold trigger; fanpu.io/portkey cross-checks for the 150 value)
- Mem0 — https://arxiv.org/abs/2504.19413 (four-op update stage)
- Mem0 2026 algorithm reversal (single-pass ADD-only) — https://mem0.ai/blog/ai-memory-benchmarks-in-2026
- Mem0 memory eviction/forgetting strategies — https://mem0.ai/blog/memory-eviction-and-forgetting-in-ai-agents
- HaluMem — https://arxiv.org/abs/2511.03506
- MemoryBank — https://arxiv.org/abs/2305.10250
- MemoryOS — https://arxiv.org/abs/2506.06326
- FadeMem — arXiv 2601.18642 ; Human-inspired memory — arXiv 2605.08538 ; BEAM — https://arxiv.org/abs/2510.27246
- Zep temporal KG memory — https://arxiv.org/abs/2501.13956 ; Graphiti — https://github.com/getzep/graphiti
- LangMem background memory manager — https://github.com/langchain-ai/langmem
- Elastic agent-memory — elastic.co blog ("relevance decay, not truth decay")
- RecMem recurrence consolidation (87% token savings)
- pi-ai multi-protocol providers (createProvider + baseUrl + compat) — pi.dev providers/models docs + GitHub source (packages/ai)
- Endpoint config UX precedents — GitHub Copilot CLI BYOK, Cline base URL, pi models.json (explicit baseUrl + explicit protocol; no sniffing)
- Internal: ADR-0029 (scope discipline), ADR-0031 D4/D6, ADR-0032, ADR-0033, ADR-0034, ADR-0035, ADR-0036
