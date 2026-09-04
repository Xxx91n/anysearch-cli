# ADR-0046: Grill Round 43 — Multi-Arm RRF Fusion Gain Observation

## Status

Accepted (document round r46, 2026-09-04). This ADR records fusion-level ablation decisions only; source changes land in the next fixer round.

## Context

The memory path fuses FTS, entity, vector, relation, and semantic arms with weighted RRF. The web path fuses Exa, Tavily, and AnySearch with equal-weight RRF. ADR-0036 has a relation-arm gain observation, and ADR-0038 defines the three-tier gain gate, but the other arms have no local evidence. Atomcode research found published cases where RRF is net negative on paraphrase-heavy long-memory workloads, and where fusion gains disappear after top-k truncation. The governance model already exists in ADR-0036/0038/0045; the missing piece is not another algorithm but a uniform counterfactual observation layer.

## Decision

### D1 Paraphrase-only Golden Slice

Add a three-tier paraphrase slice derived from existing golden cases. Light paraphrase variants must include a positive assertion. Medium paraphrase variants form the main `paraphrase-only` slice. Heavy paraphrase variants are report-only and counterfactual-positive inputs. Each variant has a pre-registered `maxLexicalOverlap` upper bound, initially left unset pending a 50-run calibration. Variant generation may use LLM synthesis, but labels are human-written and dual-reviewed. This slice is not given a positive threshold gate.

### D2 Six-Arm Ablation Counterfactual

Parameterize the eval runner with `ablate(label)`. Dropping one arm recomputes RRF from the remaining lists and records `rankOn`, `rankOff`, and the excluded label. The FTS anchor arm is report-only and never judged. The web fusion snapshot already carries per-provider lists and weights, so the same rank-only counterfactual applies without new schema.

### D3 Three-Tier Decision Boundary

Keep one primary metric: post-fusion RoR. Arm-level deltas are secondary and never gate independently. Add a reverse weakest-link regression gate: an arm that is present and makes fused RoR materially worse is treated as a maintenance signal, not as a gain-promotion failure.

### D4 Reverse Weakest-Link Gate

Use a pre-registered one-sided harm test: `H0: delta >= 0` versus `H1: delta < 0`. Reuse `pairedGainStats` BCa bounds and sign-flip p-values. It shares the existing OF alpha track with the gain gate and does not open a second alpha budget. Per-arm guardrails receive no multiplicity alpha adjustment; beta is corrected for the number of tested non-anchor arms. `minHarm = -minGain = -10pp`. `n < 10` degrades harm verdicts to WARN. Holdout remains a no-contradiction check and is not required to be independently significant.

### D5 Web Provider Observational Ledger

Record per-web-run provider overlap, exclusive hits, `nativeScoresMissing`, and failures in the existing Observational zone. No verdict, no threshold, no gate, and no new table. This ledger may only feed WARN review, human review, and ADR-0045 operational degradation events.

### D6 Ship Disposition

For critical arms, a confirmed weakest-link red forces arm demotion and blocks ship (`publish-red`). For observational arms, red enters the WARN band and does not block. There is no cross-release failure budget. A single red is not confirmation: it halts advancement and uses the existing streak counter. Emergency release requires a closed-enum `reasonCode`, `runPurpose=override`, at most one override per release window, forced rebaseline, and a postmortem obligation.

### D7 Observational Contract and Report Zone

Pre-register the new Observational fields (`exclusiveHits`, `nativeScoresMissing`, `armDeltas`, `maxLexicalOverlap` when calibrated) and fail the report if a registered field is absent. Ship-gate exits `0` for pass or WARN, `1` for confirmed publish-red, and `2` for unverifiable/inconclusive.

## Consequences

This round is docs-only. The next fixer round owns runner parameterization, the paraphrase fixture group, the arm registry, report-zone validation, and static ship-gate assertions. Runtime fusion algorithms and weights remain unchanged.

## Implementation Plan

1. Land this ADR and four CONTEXT terms.
2. Add the r46 audit-checklist block with current and next-round acceptance.
3. Extend the runner from relation/semantic-specific counterfactuals to `ablate(label)`.
4. Add the paraphrase fixture group with lexical-overlap assertions and dual-reviewed labels.
5. Extend the Observational report zone and enforce missing-field failure.
6. Add ship-gate assertions for arm registry provenance and observational-field non-gating.
7. Run tsc, store/kernel/retriever tests, ship-gate on both database shapes, and packaged CLI liveness.

## Acceptance

Current round: seven sections present; UTF-8 no BOM and no CRLF; CONTEXT gains four terms with Avoid and preserves End of Glossary; audit-checklist gains the r46 block; no business source changes. Fixer round: runner supports all non-anchor arm ablations; paraphrase fixtures pass lexical-overlap and dual-review checks; one primary RoR gate remains; observational fields fail when missing; critical red blocks ship and observational red does not; packaged CLI stays alive.

## Research Sources

- Bruch et al. An Analysis of Fusion Functions for Hybrid Retrieval. https://arxiv.org/abs/2210.11934
- Balancing the Blend, VLDB 2026. https://arxiv.org/abs/2508.01405
- RAG Fusion production evaluation. https://arxiv.org/html/2603.02153v1
- Lunardi et al. Paraphrase robustness evaluation. https://arxiv.org/abs/2509.04013
- Qdrant. How to Tune Hybrid Search. https://qdrant.tech/articles/how-to-tune-hybrid-search/
- Elasticsearch Labs. Weighted RRF. https://www.elastic.co/search-labs/blog/weighted-reciprocal-rank-fusion-rrf
- Spotify. Statistical guards for online metrics. https://arxiv.org/abs/2402.11609
- FDA. Multiple Endpoints in Clinical Trials. https://www.fda.gov/media/162416/download
- Flagger. How it works. https://docs.flagger.app/usage/how-it-works
- Argo Rollouts. Analysis. https://argo-rollouts.readthedocs.io/en/stable/features/analysis/
- Chromium Commit Queue design. https://chromium.org/developers/testing/commit-queue/design/
- Skia Gold. https://docs.skia.org/docs/dev/testing/skiagold/

