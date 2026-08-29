# ADR-0036: Grill Round 33 — Relation-Arm Gain Observation (preregistered gain gate over expanded golden) + chunked backfill

## Status

Accepted (grill round 33, landed 2026-08-29). Implements Q1-Q7 of the relation-arm-gain interview; research-driven, one question at a time, atomcode-verified on Q2/Q3/Q4/Q5/Q6.

## Context

ADR-0035 D5 opened the relation arm (KG-lite fifth RRF arm) with an observational zone and a preregistered budget formula whose numeric values were left blank; the ADR itself records "53-case suite lacks statistical power". Round 33 settles the transition protocol: how to expand the golden relations group to a statistically meaningful size, what the paired-bootstrap decision rule is, what exactly is paired, which metric carries the judgment, and (as an explicitly orthogonal same-round engineering item) how to relax the ADR-0035 D7 "no concurrent MCP traffic during backfill" constraint. Research anchors: Sakai topic-set-size design (IRJ 2016 / EVIA 2014), Webber/Moffat/Zobel 2008 on pilot-variance unreliability, arXiv 2511.19794 paired bootstrap + sign-flip protocol (k=3 never over-claims), BMJ 2006 dichotomization cost (median split wastes ~1/3 effective n), FDA multi-endpoint single-primary discipline, Spotify four-metric gating (success/guardrail/deterioration/quality), and SQLite official WAL/12-step table-rebuild semantics.

## Decision

**D1 (Q1) — Round theme: relation-arm gain observation landing; backfill concurrency relaxation rides as a separate same-round refactor commit.** KG-lite query deepening (2-hop / as-of traversal) stays deferred as P2+ ("Graphiti's value zone, not ours yet"), predicated on this round proving the relation arm actually helps. Scope discipline per ADR-0029: the backfill change lands as its own refactor commit, not as an undocumented side-effect.

**D2 (Q2) — B+ expansion: n decided ONCE by formula, capped at 80; assertion-style labels with human + second-person review; LLM synthesizer produces cases, never labels.** The existing 53 relations-adjacent cases serve as the pilot: per-case paired RoR deltas estimate sigma_d; the Sakai formula n = 2*sigma^2*lambda/minD^2 is filled with the pilot upper-CI sigma_d_hat (sigma^2_d = 2*sigma^2 conservative upward bias per Sakai 2018, honoring Webber 2008's warning that pilot variance estimates carry wide error margins and iterative enlargement biases toward significance). n is locked once computed (cap 80, aligned with the ADR-0034 observational-exit precedent of n>=80); mid-course top-ups are forbidden. Golden stays assertion-style (deterministic assert_edge / no_edge / rank); LLM synthesis is allowed at the case/query/scenario level only (RAGAS evol-generate style), labels are always human-written with second-person review (CN+EN both reviewed); synthesizer-vs-human agreement runs through the ADR-0029 kappa calibration channel as "synthesizer calibration", never as judge-on-duty.

**D3 (Q3) — Dual-track pairing: Track A ablation is the sole causal judgment channel; Track B consumes the Track-A delta time series.** Track A: same case, same moment, relation-arm off vs on, per-case delta; implementation prefers single-run counterfactual (run 5 arms once, recompute the 4-arm RRF in post from arms provenance) so evaluation cost stays ~1x rather than 2x. Track B: the A-delta values accumulated across releases feed the SPC control chart (ADR-0034 D5 precedent); the raw historical baseline (pre-ADR-0035) is NEVER a gate input — it is not even a DiD (no control group), its H0-permutation exchangeability fails, and ADR-0027 D9 fingerprint discipline forbids cross-fingerprint comparison anyway.

**D4 (Q4) — MDE/MEI separation, paired formula, preregistered floor.** `mdeFor` stays unchanged in its allowance-check role (failure-rate tolerance). New `mdeForPaired(n, sigma_d_hat_upper) = 2.8 * sigma_d / sqrt(n)` governs the arm-gain check; sigma_d_hat_upper = 95% upper CI of the 53-case pilot per-case delta sd, written into the eval baseline by `--calibrate` and recomputed whenever the fingerprint flips (ADR-0027 D9). minGain = 10pp is an independently preregistered MEI business floor ("is the relation arm worth 10pp of ranking gain"), never derived from n or sigma_d; the decision rule is paired BCa lower bound > 0 AND point estimate >= minGain (sign-flip permutation p<0.05 as belt-and-suspenders). When n or power is insufficient for the paired check, the result degrades to WARN (ADR-0028 D1 band), never FAIL. ADR-0034's "8-10%" wording is reinterpreted as a paired-mean-design MDE derivable when sigma_d in [0.25, 0.38] gives 8-12pp at n=80 — converting an unverifiable sentence into an auditable derivation.

**D5 (Q5) — RoR delta is the single judgment metric; 1-hop hit-rate is a sanity/telemetry channel and never gates.** Judgment metric: per-case delta = rank_off - rank_on of the golden's expected memory in the final RRF ranking (positive = relation arm pushed the relevant memory earlier); censoring for relevant item outside top-k resolved as clip-to-(k+1) or exclusion with recorded exclusion rate — exclusion rate > 20% degrades the whole round to WARN; k aligns with the existing RRF window (60). Sanity channel: 1-hop hit-rate (on-run relation arm surfaced >= 1 one-hop-adjacent episode_memory_id inside fused top-k) plus relationTel stay in the observational zone (ADR-0035 D5 position unchanged); two anomaly combinations trigger report WARN + human review: (a) high hit-rate with RoR delta ~ 0 ("hits but useless"), (b) hit-rate = 0 with RoR delta < 0 ("arm idle but ranking moved"). Binary hit-rate is excluded from BCa/minGain/significance by construction: its sigma_d = sqrt(p(1-p)) ceiling makes 10pp at n=80 statistically unreachable (dichotomization wastes ~1/3 of effective sample, BMJ 2006; McNemar discordant-pair requirement would demand hundreds of pairs). FDA multi-endpoint single-primary precedent: one preregistered primary metric means no multiplicity correction.

**D6 (Q6) — Backfill chunked: one transaction per batch + SQLITE_BUSY exponential backoff + keyset resume; dry-run keeps the single rolled-back transaction.** `backfillRelations` apply mode switches from a single whole-run transaction to per-batch commit; SQLITE_BUSY retried with exponential backoff (50ms base, capped ~5s, consistent with the existing busy_timeout=5000); SQLITE_BUSY_SNAPSHOT (deferred-upgrade class) fails fast (retry is meaningless); an optional `PRAGMA wal_checkpoint(PASSIVE)` may run per batch to bound WAL growth. `--from-id` keyset resume, idempotency key, and `--full-refresh` guard (r88) unchanged. Dry-run keeps the ADR-0035 r87 single rolled-back transaction (exact-prediction semantics must not regress). Expand-contract / shadow-table approaches are rejected: SQLite's 12-step table-rebuild requires the atomic switch and the copy in ONE transaction, so "lock-free full backfill + atomic switch" does not exist on SQLite; expand-contract's value premise (multi-version app co-deployment) does not apply to a single-process CLI. The ADR-0035 D7 quiet-window constraint is rewritten to "recommended, not required: chunked transactions + busy retry + resumable --batch make concurrent live writes safe".

**D7 (Q7) — Two-phase landing with independent verification.** Phase-1: golden expansion to n (locked per D2) + judgment pipeline (RoR ablation delta, mdeForPaired, paired WARN band, sanity channel); Phase-2 (same round, separate commit): backfill chunking per D6. Each phase passes compile + package tests + ship-gate + CLI liveness independently; Phase-1 golden change triggers fingerprint flip and forced recalibration per ADR-0027 D9, with the cost borne by Phase-1 alone.

## Consequences

- Positive: the relation arm's value becomes a falsifiable, preregistered claim instead of an anecdote; every prior eval discipline (fingerprint, WARN band, observational zone, scope discipline) is reused rather than reinvented; the Observatory-to-gate transition becomes reproducible.
- Negative: golden expansion to ~80 assertion-style cases is real authoring + review labor (CN+EN); the pilot sigma_d is an empirical unknown that can in principle show power insufficient even at n=80 (in which case the paired WARN band says so honestly).
- Risks retired: no historical-baseline comparison can masquerade as a causal claim; no binary metric can sneak into the judgment seat; no long backfill transaction can silently block live writes.

## Implementation Plan

1. Run 53-case pilot with relation-arm counterfactual to produce per-case RoR deltas and sigma_d_hat with upper 95% CI; record with the run report.
2. Lock n via Sakai formula (cap 80); if pilot suggests n > 80, the round report states the required n and the round stays in observational mode (no silent renegotiation).
3. Expand relations golden group to the locked n (assertion-style, human labels + second-person review, LLM case-synthesis allowed); flip fingerprint; recalibrate (ADR-0027 D9).
4. Implement mdeForPaired + paired WARN band in eval gate; preregister minGain=10pp and the BCa+sign-flip rule in the runner; unit-test both directions (reject when point estimate < minGain even if CI > 0).
5. Implement single-run counterfactual RoR ablation (arms provenance -> recompute 4-arm RRF) with per-case output; pilot it against a small golden slice.
6. Wire sanity channel: hit-rate + relationTel report-only fields; the two anomaly combos raise WARN + human-review note.
7. (Phase-2, separate commit) Chunked backfill: per-batch transaction, SQLITE_BUSY backoff, SQLITE_BUSY_SNAPSHOT fail-fast, optional passive checkpoint; dry-run path untouched; update ADR-0035 D7 wording + CLI help.
8. Update CONTEXT.md glossary (new terms), docs/agents/audit-checklist.md (round-33 audit items), ship-gate assertions; CHANGELOG entries (Added for Phase-1, Changed for Phase-2 refactor).

## Acceptance

1. `pnpm -r check` / `pnpm -r test` / `pnpm -r build` all green after each phase.
2. CLI liveness: `ans` CLI exit 0 post-build; ship-gate 9/9 PASS including new relation-judgment assertions.
3. Golden fingerprint flips exactly once for the expansion; baseline recalibrated; sigma_d_hat upper CI recorded in the baseline artifact.
4. mdeForPaired rejects a synthetic case where CI > 0 but point estimate < minGain (fail-closed against "significant but meaningless"); paired WARN band demonstrable at undersized n.
5. Backfill chunking: a live MCP write during `backfill-relations --apply` completes within busy_timeout instead of erroring; dry-run bit-exact prediction preserved (r87 acceptance intact).

## Research Sources

- Sakai, IRJ 2016 topic set size design; EVIA 2014 full text (topic counts vs minD); SIGIR 2016 tutorial.
- Sakai & Kando 2015 (minDelta_t vs minD_t dual registration); Sakai 2018 ICTIR (sigma^2_d = 2*sigma^2 conservative bias).
- Webber/Moffat/Zobel 2008 SIGIR (pilot variance unreliable; iterative enlargement bias; TREC 50-state detects 6-8pp at 80% power).
- arXiv 2511.19794 (paired bootstrap Protocol: BCa lower bound > 0 + sign-flip permutation; k=3 never over-claims).
- BMJ 2006 PMC1458573 (dichotomizing continuous variables costs ~1/3 effective sample); datamethods.org #3402.
- FDA 2022 Multiple Endpoints in Clinical Trials (single primary = no multiplicity; secondary/exploratory do not gate).
- Urbano 2019 SIGIR (paired bivariate model; no universally best test; skewness dominant confounder); Urbano 2013~500M comparisons; Sanderson & Zobel 2005 (paired = common query set).
- Airbnb arXiv 2508.00751 (interleaving paired on queries+users); Chapelle et al. 2012; Netflix interleaving; DataRobot champion/challenger (shadow replay; history never promotes).
- Spotify four-metric gating (success superiority / guardrail NIM / deterioration / quality; beta-correction over guardrails); Analytics-Toolkit Georgiev (MDE vs MEI).
- RAGAS docs (evol-generate synthesizers; context precision rank-aware main metric); arXiv 2508.11758 (synthetic reliable for retriever variants, misleading for generator ranking); QASkills golden-dataset guide (second-person review); LayerLens; Evidently synthetic-data guidance; Toloka search-relevance evaluation; LinkedIn arXiv 2410.21549.
- Zheng et al. 2023 LLM-evaluator biases (eugeneyan.com); Adaline bias survey; arXiv 2506.22316.
- SQLite official: wal.html (single writer, smaller-transactions advice, checkpoint semantics), lang_altertable.html 12-step table rebuild (atomic switch + copy in one transaction), lang_with.html; tenthousandmeters + Bert Hubert on busy_timeout limits and deferred-upgrade SQLITE_BUSY_SNAPSHOT; better-sqlite3 community retry patterns; PG CREATE INDEX CONCURRENTLY docs; ES reindex alias swap; expand-contract (thebackenddevelopers / Palma).
