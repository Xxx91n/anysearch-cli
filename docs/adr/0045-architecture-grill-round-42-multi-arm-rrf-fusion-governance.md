# ADR-0045: Grill Round 42 — Multi-Arm RRF Fusion Governance

## Status

Accepted (document round r117, 2026-09-04). This ADR records fusion-governance decisions only; source changes land in the next fixer round.

## Context

The memory retrieval path has five recall arms (FTS / entity / vector semantic / relation / semantic memories) fused with weighted RRF k=60; the web retrieval path has three providers (Exa / Tavily / AnySearch) fused with equal-weight RRF k=60. Both paths already reuse the same pure RRF primitive, but only the memory path has an arm lifecycle. The web path has no weight config, no provider provenance snapshot, no k registry, and no score-kind discipline. Atomcode research against the repository ADR chain, academic evidence, and industrial templates concluded that the missing seam is fusion governance, not the fusion instances themselves.

## Decision

### D1 Unified Fusion Governance Scaffold

Introduce one Fusion Governance Contract with four layers: L0 existing rrf.ts primitive, L1 committed registration payload, L2 MemoryFusion and WebFusion instances, and L3 consumer contract. The two instances keep zero data sharing and keep their current algorithms. MemoryFusion uses weighted RRF k=60; WebFusion uses equal-weight RRF k=60.

### D2 Fusion Registry Field Set

Keep L0 nearly unchanged: remove the implicit k default and inject k from the registry. Register six fields in L1: k_fusion, rank_window, ROR_WINDOW, weights.memory, weights.web, and armAbsentSemantics; keep algorithm as a read-only deprecate-only enum. Split the three current values that all equal 60 into separate registered keys. Use a six-field common provenance shape (instance, labels, lists, weights, fusedIds, scoreKind), with memory-only texts and web-only native scores as instance extensions. Add sources.weights as a Record keyed by provider id. Configuration errors fail fast; provider runtime failures remain fail-open.

### D3 Top-k Consumption Contract

Order the pipeline as child search, key normalization, RRF, deterministic tie-break, pre-truncation provenance annotation, full-pool MVSS computation, top-k prefix truncation, and attribution over only the truncated result. A fused score is a rank_fusion signal only: it is not confidence, not a threshold or abstain signal, not cross-query comparable, and not evidence strength. Weak or absent-arm hits stay in natural score order with item-level annotation. Same-key votes are not folded before RRF; payloads fold after fusion. Memory keys are rowid values; web keys are normalizeUrl with entity override when present. Native provider scores never enter fusion ranking.

### D4 Weight Lifecycle Governance

Treat weights as gated configuration, not learned parameters. The shared lifecycle is candidate, baseline, retired, with events propose-weights, promote-weights, hold-weights, rollback-weights, demote, and remove. MemoryFusion uses golden eval as decision authority; WebFusion uses observational signals only and can never promote from observation. Memory weight changes require weakest-link or preregistered RoR gain evidence; FTS 1.0 is an anchor and scalar rescaling is forbidden. Web equal weight is the null model; demotion or removal may follow operational degradation, while deviation from equal weight is user preference and not proof of improvement. Runtime LLM or rule-adaptive weights are forbidden.

### D5 Algorithm Switch Gate

MemoryFusion keeps weighted RRF k=60 as the default. A future switch to CC or score fusion requires score completeness and stability, graded-label power, statistical power, and a registered normalization scheme, then reuses the ADR-0036/0038 gain-gate protocol. WebFusion stays equal-weight RRF; Exa and AnySearch have no native score, so score fusion is structurally unavailable. Candidate algorithms run only as shadow report-only observations. Promotion triggers fingerprint flip and forced rebaseline. Regression protection is fail-closed at landing; rollback is configuration flip plus ledger/chain record. Implementing this governance round must not change the fusion algorithm at the same time.

## Consequences

This round is docs-only plus two declaration-only enforcement touchpoints reserved for the fixer round. Runtime ordering, weights, and algorithms remain unchanged. The next round owns fusion-registry implementation, provenance snapshots, sources.weights validation, and the new regression tests. The main fingerprint remains unchanged unless a new observational fusion fixture lands.

## Implementation Plan

1. Land this ADR and its four CONTEXT terms.
2. Add the r45 audit-checklist block with current and next-round acceptance.
3. Before ADR-0045 implementation, commit the existing r43 fixer worktree and rerun its full acceptance to avoid cross-round contamination.
4. Add a fusion-registry fixture with pinned SHA-256 expected values and single-consumer mutation tests.
5. Add optional sources.weights to domain-schema and load-time validation; keep provider runtime failures fail-open.
6. Add web provider provenance snapshots and score_kind; keep fused score out of NormalizedResult.
7. Add regression pairs for registry drift, provenance loss, illegal weights, and fused-score exposure; integrate into existing ship-gate steps rather than adding a new step.
8. Run tsc, store tests, ship-gate on empty and non-empty database shapes, and packaged CLI liveness.

## Acceptance

Current round: seven sections present; UTF-8 no BOM and no CRLF; CONTEXT gains four terms with Avoid and preserves End of Glossary; audit-checklist gains the r45 block; no business source changes. Fixer round: tsc clean across packages; store suite green including new fusion tests; ship-gate exit 0 on both database shapes; packaged CLI help/switch-state verify process stays alive; main fingerprint remains unchanged unless the fusion fixture requires a declared observational fingerprint flip and recalibration.

## Research Sources

- Bruch, Gai, Ingber. An Analysis of Fusion Functions for Hybrid Retrieval. https://arxiv.org/abs/2210.11934
- Cormack, Clarke, Buettcher. Reciprocal Rank Fusion outperforms Condorcet and CombMNZ. https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf
- Elasticsearch Reciprocal rank fusion API. https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion
- Elasticsearch Labs Weighted RRF. https://www.elastic.co/search-labs/blog/weighted-reciprocal-rank-fusion-rrf
- OpenSearch RRF and score-ranker processor. https://opensearch.org/docs/latest/search-plugins/search-pipelines/score-ranker-processor/
- Weaviate hybrid search and PR 3939. https://docs.weaviate.io/weaviate/search/hybrid
- Azure AI Search hybrid search ranking. https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking
- Vespa Learn Hybrid Search. https://learn.vespa.ai/vector-search/hybrid-search
- Yuan, Su, Yao. Diagnosing Retrieval vs. Utilization Bottlenecks in LLM Agent Memory. https://arxiv.org/abs/2603.02473
- Ragas Context Precision. https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_precision/
- Anthropic. Demystifying evals for AI agents. https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- Hidasi, Czapp. Widespread Flaws in Offline Evaluation of Recommender Systems. https://arxiv.org/abs/2307.14951
- Laforge. Advanced RAG: Understanding RRF. https://glaforge.dev/posts/advanced-rag-understanding-rrf/
- The Neural Base. Fusion weight drift. https://theneuralbase.com/hybrid-search/learn/advanced/fusion-weight-drift/
- Google Developer Forum. Tuning RRF in Agent Retrieval. https://discuss.google.dev/t/tuning-reciprocal-rank-fusion-in-agent-retrieval-a-practical-guide/378525
- DAT: Dynamic Alpha Tuning. https://arxiv.org/abs/2503.23013
- Balancing the Blend, VLDB 2026. https://arxiv.org/abs/2508.01405
- DataRobot. Introducing MLOps Champion/Challenger. https://www.datarobot.com/blog/introducing-mlops-champion-challenger-models/
- Snowflake. ML Model Deployment. https://www.snowflake.com/en/artificial-intelligence/machine-learning/mlops/model-deployment/
- Assembled Engineering. Better RAG Results with RRF. https://www.assembled.com/blog/better-rag-results-with-reciprocal-rank-fusion-and-hybrid-search
