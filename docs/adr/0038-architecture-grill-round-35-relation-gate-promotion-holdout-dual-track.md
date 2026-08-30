# ADR-0038: Grill Round 35 — Relation-Arm Gain Gate Promotion (three-tier) + Dual-Track Holdout + Preregistered OF Alpha Spending + Graded-Label Skeleton

## Status

Accepted (grill round 35, docs-only landing 2026-08-30). Implements Q1–Q7 of the gain-gate-promotion interview; research-driven, one question at a time, atomcode-verified on every question (round-topic selection, gate behavior, holdout partition, peeking correction, holdout growth semantics, gate authority, semantic-label depth). Companion non-architectural chores (kernel llm-init env cleanup) land as a separate refactor commit per ADR-0029 scope discipline.

## Context

ADR-0036 preregistered the relation-arm gain rule (paired BCa lower bound > 0 AND point estimate >= minGain 10pp, sign-flip p<0.05 belt-and-suspenders) over the expanded golden (123 cases; relations group 78; RoR paired sample 38). Multiple observation rounds have now satisfied that rule (point estimate about +14.8pp, BCa CI excluding zero), so keeping the gate at report-only observance is a discipline waste: the decision the gate exists to make is already made. ADR-0033 keeps the semantic arm in observation; its golden coverage is assertion-style binary and cannot separate true gain from near-answer distractors (the D8 probe measured cosine 0.84-0.87 distractors landing inside the positive band). CONTEXT.md (ADR-0028 D2) pins aggregate MRR/nDCG to the report layer and names qrels gates at n~20 an anti-pattern. Industry and academic research (recorded per question below) converges on: gain-type optimization metrics are gated differently from safety/floor invariants; fixed holdout slice plus production reflow beats rotating slices; offline CI gates have no platform precedent for cross-release sequential correction, so we assemble one from clinical-trial group-sequential practice; graded relevance labels precede any judge calibration, which precedes any gate.

## Decision

**D1 (topic) — Round scope: relation-arm gain gate promotion is the main theme; the semantic-arm graded-label skeleton lands same round as data-only prerequisite; kernel env cleanup is a separate refactor commit; tau recalibration is deferred to a data-ready round.** One gate family per round. The tau (7/30/90-day decay) topic is registered as a future fitting round gated on real usage data (FSRS-style default-then-fit rhythm; we lack per-item success/failure feedback, so fitting now would be an empty run); observation instrumentation from ADR-0037 is sufficient for now. The llm-init ts:134-136 env fallback removal (OPENAI_/ANTHROPIC_/GOOGLE_API_KEY) ships as its own refactor commit with a CHANGELOG entry — provider auth stays inside pi-ai; this is r94-deferred hygiene, not an architecture decision.

**D2 (gate behavior) — Three-tier green/WARN/red semantics with exit-code decoupling; red is reserved for proven-negative or preregistered-rule failure, never for merely-unproven-positive.** Green = the full-sample preregistered rule holds AND the holdout slice shows no contradiction (holdout is NOT required to reach significance on its own — at n approximately 19 pairs that is statistically unrealistic). WARN = holdout underpowered (mdeForPaired > minGain, the existing dormant rule), exclusion rate > 20%, or full sample passes while holdout does not (gain may contain overfit). Red = holdout paired statistics detect degradation (BCa upper bound < 0 or sign-flip p < 0.05), or the full-sample preregistered rule fails. Gain results ship as an independent gate-conclusion field, not merged into a single exit code (the C-side architecture of the interview). Hard fail-closed on "unproven positive" (option A of the interview) is rejected: conflating failure to reject H0 with evidence of harm systematically false-blocks at n=80 and the community evidence (thenewstack on LLM eval gates being bypassed) shows overly strict gates are routed around, which is worse than no gate.

**D3 (holdout partition) — B-prime: one-time stratified 8:2 split over all golden, strata keys = arm x difficulty x CN/EN; the partition ratio inside the holdout is set by judgment-statistical power, not by corpus percentage.** The gain judgment consumes only the RoR paired sample (38 pairs); a mechanical 20% would leave about 8 pairs (MDE about 15pp) and the three-tier gate would park in WARN forever. The holdout therefore over-represents RoR pairs against the power boundary (roughly 15-19 pairs) and stays a fixed, versioned, never-optimized slice. Training-vs-holdout rotation (option C of the interview) is rejected on Lones Patterns 2024 / Raschka grounds: cases that passed through the tuning loop cannot be promoted back into a judgment slice without breaking independence. Freshness drift is countered by production reflow plus versioned refresh (Braintrust / Langfuse model), not by rotation. Labels in the holdout are assertion-style (edge presence, expected rank) — machine-verifiable design-consistency review, full manual CN+EN double review in the first round; LLM judge pre-annotation is reserved for the future subjective graded labels with the ADR-0029 kappa calibration channel.

**D4 (peeking correction) — Preregistered Lan-DeMets O'Brien-Fleming alpha spending with a k_max convergence clause; the cross-release FWER upper bound is written quantitatively; always-valid betting confidence sequences are registered as the upgrade path.** Implementation: a closed-form OF spending function alpha(t) = 2 - 2*Phi(z_{1-alpha/2} / sqrt(t)) applied on two axes — the sign-flip p-axis (alpha(t_k) threshold per look) and the BCa confidence level (1 - alpha(t_k)); minGain and point estimate untouched; bootstrap machinery untouched (only thresholds change); OF z-boundaries are calibrated to bootstrap percentiles under H0 by simulation at preregistration time (per Bowyer 2025, no CLT at n<100-200), producing a precomputed look -> critical-value -> spent-alpha table. Convergence clause: after k_max looks the gain claim either is established (promoted to constant monitoring — Track B SPC continues, no further significance retesting) or is judged unproven and the arm is demoted. A fixed golden set is never retested indefinitely. The ADR body states the naive cross-release FWER upper bound (about 40% at k=10 without correction) so the discipline cost is on record. Upgrade path: when holdout pair count reaches roughly 300-1000 or ad-hoc any-time looks become a need, replace the spending table with a betting confidence sequence (Waudby-Smith; GrowthBook stats engine as OSS reference), which handles the clipped discrete paired-rank distribution natively.

**D5 (holdout growth) — Dual-track: the baseline holdout freezes permanently; production-reflow cases form a separate incremental slice family; two independent OF spending tracks.** Baseline track: the D3 fixture is immutable; looks are counted t_k = k/K_max. Reflow track: backflow slices versioned per round (backflow-slice-<period>.ts, schema anysearch/holdout-slice@1) with provenance metadata (sourceTraceId / backflowRound / sliceId / addedAt / inputHash); inputHash dedupes against baseline and all prior slices — a case may never sit in both tracks (independence is the premise of the FWER bound). Reflow track uses information time t_j = n_j / N_max over accumulated cases (Lan-DeMets designed exactly for unpredictable look timing). Family budget: alpha_1 + alpha_2 each 0.025 (total <= 0.05), written into the ADR. Any case change in either family = set change = fingerprint flip + forced recalibration (ADR-0027 D9), after which that family's OF restarts re-registered. Both tracks must be green for release. A case rollover into an existing observation window and mid-window top-up stay forbidden (ADR-0036 D2 precedence). ADR-0038 notes explicitly that dual-track OF for offline eval gates has no platform precedent; the parts (OF tables from 40 years of clinical-trial practice; two-layer datasets from Langfuse/Braintrust practice) are each backed.

**D6 (gate authority) — The three tiers drive ship decisions.** Red blocks ship; WARN permits ship only through a recorded human review (three consecutive WARN windows escalate to mandatory review: disable the arm, demote back to observance, or stay WARN — the Flagger/Argo failure-budget shape, following Langfuse warn-to-block promotion discipline); green passes. This is not a report-only tier; the ADR-0028 D1 WARN-band and Track B observance remain as their own layers and are unchanged.

**D7 (semantic-arm label skeleton) — Graded relevance labels (0-3 relevant-id) land this round as data plus report-layer nDCG@k; no gate, no second OF track.** Scope: RoR paired cases of the relation and semantic zones get graded relevant-id labels; distractor-bearing corpus cases are graded, single-relevance cases keep their rank-integer labels (per the ADR-0028 _Avoid_ list); labels go through the same CN+EN double-review annotation channel as a field extension (marginal cost is low). nDCG@k is emitted to the eval report only and its empirical correlation with the existing rank-integer metric is observed one round before any threshold is contemplated. The semantic-arm OF family is preregistered as a placeholder (name, spending function, axes) but not computed and not spent; activation conditions for the next round: label count past the Sakai power threshold AND judge-vs-human calibration agreement at the ADR-0029 kappa bar, with the dual-track holdout structure of D5 reused mechanically. Inter-annotator agreement (Cohen kappa or AC1) on the 0-3 scale is recorded at skeleton landing as the calibration baseline for the future judge.

## Consequences

- ship-gate gains a gain-gate module emitting an independent green/WARN/red conclusion field plus the spent-alpha ledger; regression gates unchanged.
- golden-cases gets a frozen holdout fixture and a backflow slice family; fingerprint discipline now covers both families.
- The r94-deferred llm-init env cleanup lands as a separate refactor commit; tau fitting and semantic-arm gate activation are formally deferred with named trigger conditions, removing open-ended observance drift.

## Implementation Plan

1. Golden: perform the D3 stratified split (arm x difficulty x CN/EN, RoR pairs over-represented per power), freeze the baseline holdout fixture; single fingerprint flip + recalibration (EVAL_TIMEOUT_MS budgeted, landed-to-disk polling).
2. Ship-gate: add the independent gain-conclusion field (green/WARN/red per D2) with exit-code decoupling; wire WARN-review bookkeeping.
3. Statistics: preregister the OF spending table (H0-simulation-calibrated bootstrap critical values, k_max, alpha per axis); persist looks and spent alpha in the evidence layer (.ship-gate).
4. Dual track: backflow slice family fixture + provenance schema + inputHash dedup; separate fingerprint; reflow goes only into new windows.
5. Labels: extend golden schema with graded relevant-id for RoR pairs (relation + semantic zones), double-review CN+EN, record inter-annotator kappa.
6. Report layer: nDCG@k emitted alongside rank-integer metrics; no gate wiring.
7. Chore commit: remove llm-init ts residual env fallback (OPENAI_/ANTHROPIC_/GOOGLE_API_KEY), CHANGELOG entry.
8. Docs: CONTEXT.md terms, audit-checklist section, CHANGELOG.

## Acceptance

- pnpm -r check / pnpm -r test / pnpm -r build green; ship-gate all gates green; CLI/MCP process-alive probe.
- Gate emits the independent three-tier conclusion field; red path demonstrably blocks ship in a planted-degradation test; WARN escalation counter works.
- Holdout fixture frozen with OF table present; dual fingerprints enforced; reflow dedup by inputHash tested.
- Graded labels present on RoR pairs only; nDCG@k in report, absent from any gate; semantic OF family registered as inert placeholder.
- Non-goals honored: no always-valid CS code, no rotation of training into holdout, no second live OF track.

## Research Sources

- Spotify Engineering, Risk-aware product decisions in A/B tests with multiple metrics (2024, arXiv:2402.11609)
- Johari et al., Peeking at A/B Tests (arXiv:1512.04922); Waudby-Smith betting confidence sequences (SAVI, arXiv:2210.01948)
- Lan-DeMets alpha spending; rpact/gsDesign group-sequential tooling; UW-Madison biostatistics notes; FDA Adaptive Designs for Clinical Trials guidance (2019)
- Lones, Avoiding common machine learning pitfalls (Patterns 2024, PMC11573893); Kapoor & Narayanan, Leakage and the reproducibility crisis (Patterns 2023, arXiv 2207.07048)
- Evan Miller, Adding Error Bars to Evals (arXiv:2411.00640); Cameron Wolfe, Applying Statistics to LLM Evaluations (2026-03-09)
- Tian Pan, Your LLM Eval Is Lying to You: the statistical power problem (2026-04-15); The Golden Dataset Decay Problem (2026-04-20); The benchmark leak (2026-04-23)
- Bowyer et al., Don't use the CLT in LLM evals with fewer than a few hundred datapoints (arXiv:2503.01747, ICML 2025 Spotlight)
- Langfuse, Golden dataset evaluation and LLM regression testing docs (warn-to-block promotion; append-mostly golden log)
- Braintrust, LLM evaluation guide and Eval-driven development (versioned datasets from production traces; judge calibration before gating)
- Confident AI best-practices (pass/fail/neutral; floor + baseline-tolerance thresholds); DeepEval CI unit testing docs
- Argo Rollouts analysis docs (Successful/Inconclusive/Failed, failureLimit); Flagger metric threshold/failure budget docs
- Statsig docs (mSPRT sequential testing; golden datasets standards); Eppo docs (avoid fully-sequential when power is scarce); GrowthBook stats engine (Waudby-Smith asymptotic CS)
- Anthropic, Demystifying evals for AI agents (2026-01-09)
- Shi et al., Judging the Judges: position bias (IJCNLP-AACL 2025); deepchecks, LLM judge calibration; mbrenndoerfer, Position bias in LLM judges
- RAGAS context precision docs; eugeneyan, Evaluating the effectiveness of LLM evaluators
- CSA research note on MCP/AI-coding-assistant credential theft; GitGuardian Secrets Sprawl 2026 (env credential surface hygiene)
- TypeGraph time-decay blog; Mem0 memory eviction/forgetting; Hindsight consolidation post (2026-05-21); fsrs4anki (FSRS fitting constraints)

## r99 Text Errata (append-only; closes r98 audit F4; no code change)

- D2 closing sentence "if the preregistered rule fails, red" contradicts the tier premise stated at the top of the same decision (red is reserved for proven-negative; never for merely-unproven-positive). Authoritative reading: the implementation is correct — unproven-positive is never red. The last sentence of D2 is to be read as applying to the original two-tier WORLD only; the three-tier table at the start of D2 supersedes it.
- D6 sentence "WARN permits ship only through a recorded human review" contradicts the shipped WARN-streak-3 ledger mechanism (a single WARN ships, with a ledger entry; three consecutive WARNs escalate to mandatory human review). Authoritative reading: the implementation is correct — D6 is to be read as the escalation form (WARN ×3 ⇒ review), not per-instance.

Pending physical text correction deferred to a docs-only pass; semantics above are normative.
