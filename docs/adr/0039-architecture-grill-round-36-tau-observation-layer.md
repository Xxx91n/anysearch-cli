# ADR-0039: Grill Round 36 — Tau Observation Layer (access-age histogram + tau sensitivity scan + BG/NBD readout, no fitting this round)

## Status

Proposed (grill round 36, landed). Decisions D1–D7 ratified via grill Q1–Q7 with atomcode web research (r100 topic selection, r101 component set, and r36 follow-up A–C rounds on form, revival semantics, acceptance layerification).

## Context

`time-decay.ts` hardcodes tiered half-life tau = 7/30/90 days (Q: news / standard / evergreen), consumed by two subsystems: (1) the Fused Freshness Factor in retrieval ranking (ADR-0030) and (2) the forgetting/archive eligibility gate in consolidate (ADR-0037 D5 uses factor * tau). ADR-0038 D1 formally deferred tau fitting with a named trigger ("data-ready round"). Grill r36 asks whether that trigger is met now and, if not, what the industry-grade intermediate looks like.

Research verdict (atomcode, 4 seriatim deep research rounds, high confidence): every academic fitting route (Half-Life Regression, FSRS optimizer, Elo/IRT) requires per-item binary outcome labels, which we do not collect; industry (Elasticsearch decay, Mem0, LangChain/Generative Agents, Yahoo Today) universally hand-tunes decay hyperparameters — no vendor fits tau from data, and no mature JS/TS fitting library exists. BG/NBD cohort lifetime models are the one合法的 data-driven layer: they fit a group-level exponential lifetime from access events alone (no outcome labels). Using retrieval top-k hit-rate as a proxy outcome was explicitly rejected (circular: position bias + collinearity with the fitted object; Hu/Koren 2008 implicit-feedback limits; Joachims 2002 click bias).

So this round is an **observation round**, not a fitting round: land the telemetry, sensitivity scan, and cohort readout that any future fitting round legally requires, with tau left hardcoded.

## Decision

**D1 (round shape) — Observation-only round; tau 7/30/90 stays hardcoded.** No tau fitting ships this round. The four deliverables are (P0) access-age histogram and tau sensitivity scan; (P1) BG/NBD cohort readout, calibration plot, and archive-revival telemetry; plus the pre-reserved `age_at_access` instrumentation interface. The "tau fitting round" trigger from ADR-0038 D1 is re-registered with the concrete AND-gate in D6 below.

**D2 (BG/NBD dependency boundary) — Out-of-process Python script with versioned JSON exchange.** `scripts/tau/bgnbd_fit.py` (lifetimes `BetaGeoFitter` MLE; pinned `lifetimes==0.11.3`, `numpy>=2.1`, scipy pinned in `scripts/tau/requirements.txt`). The TypeScript side is a thin `spawn` wrapper passing (frequency, recency, T) rows as JSON and receiving `{params, palive, conditional_expected, converged}`. Explicitly rejected: calling Python from inside a TS package (breaks pure-TS delivery), and a JS/TS Bayesian port (no mature npm package exists — triple-engine search confirmation; bgits/customer-lifetime-value proves the "TS engine + independent Python reference" industrial form). lifetimes entered maintenance freeze (last release 2020-07; official successor PyMC-Marketing is overkill for an MLE-only readout). Fallback if lifetimes breaks under numpy 2.x: self-implement the BG/NBD closed-form likelihood (scipy.special.hyp2f1 suffices) or take the D7 explicit-skip.

**D3 (sensitivity scan) — Independent offline script, report-only, zero look-ledger contact.** `scripts/tau-scan.mjs` (zero-dependency, like eval-judge.mjs) replays the production scoring pure function over the golden query set with candidate taus (7/30/90 ± delta grid) and reports **rank-displacement distributions** (Kendall-tau / position-shift histogram), never hit-rate. It must not run through the eval runner: the runner is a memory-lifecycle case machine (different data contract) and any path through eval CLI entangles the OF alpha look ledger — `ANS_EVAL_NO_LOOK=1` is a test guardrail, not a semantic solution. Compatibility: observation never enters gates (ADR-0032 D5 / ADR-0036), read-only scanning respects ADR-0029 D5 budget guard.

**D4 (day-bucket invariance) — Locked once in this ADR and in the eval baseline; change = fingerprint flip + forced re-baseline.** Buckets: 0-1 / 2-7 / 8-30 / 31-90 / 91+ days (aligned with the 7/30/90 tiers), encoded as a constants + pure-function module whose definition hash joins the baseline fingerprint. Buckets are by construction independent of any model prediction (they depend on access age alone), per the FSRS calibration "no self-sealing bins" rule. _Avoid_: post-hoc bucket tuning, bucket boundaries derived from observed outcomes, cross-dataset bucket comparison without fingerprint.

**D5 (access-age instrumentation) — New append-only `access_events` table (option B), inserted lazily in the read path's touchAccessed point.** `session-store.ts` `touchAccessed` (post-RRF, post secret-filter, exactly-once semantics from ADR-0030 D3) gains an INSERT into `access_events(memory_id, accessed_at)`; `schema.sql` is the single source of truth and `schema-content.ts` is regenerated (the double-file sync contract catches drift). The write path (saveResults) is untouched — it cannot know future accesses. Cost bound: at most `limit` INSERTs per search request, same order as the existing touch loop; all histogram aggregation is offline (tau-scan stage) and never runs in the read path. Time semantics: access_events is transaction-time-only append-only; it does not inherit `valid_until`, is never rewritten or deleted on undo (event-sourcing rule: undo = new event / flip of unrelated state, not event mutation).

**D6 (revival telemetry definition + BG/NBD activation gate) — Revival = explicit unarchive; fitting gated by a preregistered AND-gate.** Primary revival metric: rows in `archive_log` with `undone_at` non-null over archived rows in the same window (Anki unsuspend / Notion restore / Gmail move-to-inbox precedent — restoration is always an explicit action; "archived row hit again in retrieval" is structurally impossible since all read paths filter `archived=0`, making that candidate a degenerate definition). Sub-metric (revival justification): revived rows re-hit within 30 days or access_count growth. BG/NBD first-fit AND-gate, following the `SEMANTIC_OF_PLACEHOLDER` inert-registration pattern: T1 >= 300 active rows AND >= 100 fittable units (repeat-access sequences); T2 PSI < 0.25 between baseline and rolling 30d access-age histogram (same buckets as D4, symmetric-KL form, epsilon bucket smoothing); T3 observation window >= 90 days after this layer ships, and >= 30 days between subsequent fits (anti-peeking). Any unsatisfied condition → D7 skip.

**D7 (insufficient-data fallback) — Three-tier explicit-skip, never fail-open, never fail-closed.** When the AND-gate fails, the affected metric (BG/NBD fit / calibration plot / revival stratification) is marked skipped, the report carries a deferred reason quoting the triggering condition verbatim, a ship-log entry lands in the WARN ledger (exit 0, ship allowed, traceable; three consecutive identical skips escalate to human review per ADR-0038), and no placeholder parameters are ever emitted in place of a fit. This is isomorphic to the existing WARN ledger / uncalibrated-marker / deferred-registry disciplines (ADR-0029 / ADR-0033 / ADR-0038); externally it matches TrigGuard's SILENCE tier, the ML reject-option / learning-to-defer literature, and FedRAMP POA&M explicit-record requirements.

## Consequences

- Observation layer becomes real data infrastructure: any future tau fitting round (semantic-arm OF activation, D7-of-0038, or D6-of-this-ADR = its trigger) inherits legal inputs without retrofitting.
- The repository now consumes Python as a build-time-only, path-filtered CI citizen (ubuntu full + Windows smoke), following memory-eval's path-filter precedent; runtime stays pure TypeScript.
- undo of archived rows now has a quantified observability: `undo_reentry_events` (archived rows re-accessed within 30d of undo) lands in the Observational report zone, noting it is a project-coined metric without direct industrial precedent (confidence medium).
- Backflow second OF track (r98 audit F2) is explicitly deferred with a registered trigger (first non-empty backflow slice); ADR-0038 text errata (r98 F4) is closed this round by the `## r99 Text Errata` append-only section appended to ADR-0038.
- Deferred registry rows (with trigger + owner): tau calibration round (trigger = D6 AND-gate first satisfied; owner: eval gate reviewer); semantic-arm OF (ADR-0038 D7 conditions); F2 backflow OF; r90 F4/F5 leftovers from earlier audits.

## Boundaries

- access_events = transaction-time-only append-only event log; no valid_until, no update, no delete, undo-neutral.
- Undo-rewrite pollution tolerance: tolerated (events are immutable facts) with guardrails — T2 PSI catches distribution-level pollution, T3's 30-day inter-fit interval damps single-undo noise, `undo_reentry_events` makes the pollution visible rather than presumed minimal. No hard percentage cap is fabricated (no industrial precedent for a local single-user corpus).
- Performance bound: a search request adds at most `limit` INSERTs; zero aggregation in the read path.

## _Avoid_ (round-36 registry)

1. Gating on observational metrics (Goodhart; ship-gate must fail on any Observational-field gate reference).
2. Online histogram aggregation in the read path.
3. Post-hoc day-bucket reselection (bucket change without fingerprint flip).
4. Rewriting or deleting access events on undo.
5. Silent skip on tau-scan or BG/NBD failure (skip must carry reason + ledger entry; fail-open is not swallowing).
6. Using a fitted tau as a ranking bias before its own gate round.
7. Hand-editing `schema-content.ts` (double-file drift).
8. Feeding BG/NBD outputs (P(alive), expected lifetime) into any production signal.

## Implementation Plan

1. `access_events` schema + migration + schema-content.ts regen + fingerprint flip (one commit; schema changes concentrate into a single flip).
2. touchAccessed instrumentation: INSERT into access_events on both read paths; extend access-count.test.ts exactly-once assertions (negative: archived rows accumulate nothing).
3. Day-bucket constants + pure function + boundary table tests (1/2/7/8/30/31/90/91 membership, full coverage, no gaps/overlaps; definition hash into baseline fingerprint).
4. `scripts/tau-scan.mjs`: replay production scoring with tau candidates → rank-displacement report; property tests with seeded RNG (mulberry32 precedent), replay determinism assertions.
5. `scripts/tau/bgnbd_fit.py` + `requirements.txt` + TS spawn wrapper with timeout/SIGKILL fallback, non-JSON stdout defense, converged:false → skip; spawn contract tests (slow stub, garbage-stdout stub, contract schema, non-convergence).
6. Explicit-skip three-tier implementation: skip marker + deferred reason + WARN ledger + 3-streak escalation; negative assertions (silent swallow = fail).
7. eval-report.json / eval-report.md Observational zone: pre-registered empty tau fields (access-age histogram, tau-scan table, BG/NBD status, revival metrics, undo_reentry_events); ship-gate fails if the zone is absent (report-as-contract).
8. CI: path-filtered Python job (ubuntu full fit smoke + linux/Win import-and-small-fit smoke), `actions/setup-python` pinned version + pip cache + locked requirements; lifetimes×numpy2 smoke assertion on Windows.

## Acceptance

L1 Existence — E1 both scripts exist under scripts/tau/; E2 access_events in schema.sql with schema-content.ts regenerated and hash-consistent; E3 Observational zone pre-registered, empty values allowed, missing zone = fail; E4 CI Python job present and path-filtered; E5 day-bucket constants + pure fn + fingerprint linkage present.

L2 Correctness — C1 bucket boundary table test for 1/2/7/8/30/31/90/91; C2 touchAccessed exactly-once on both read paths; C3 negative: archived rows accumulate no events; C4 negative: spawn failure → three-tier skip with ledger entry and no silent swallow, ship not blocked; C5 T1/T2/T3 each has an independent negative (single condition unsatisfied → "not-yet", no BG/NBD run); C6 fit self-validation = chi-square goodness-of-fit + frequency-distribution comparison (Fader-Hardie-Lee 2005), PSI symmetric-KL with epsilon smoothing reusing D4 buckets; C7 revival main = undone_at, 30-day sub-metric negative case excluded.

L3 Non-violation — N1 no gate references Observational fields; N2 no read-path aggregation; N3 bucket/boundary change forces fingerprint flip + rebaseline; N4 instrumentation writes never affect retrieval results or ordering.

## Research Sources

- Settles & Meeder, Half-Life Regression (ACL 2016) and the Duolingo halflife-regression repo — HLR data contract = (p, delta, x) triples with binary recall outcomes (arxiv.org/abs/1708.05609? canonical: aclweb.org anthology P16-1174).
- FSRS project (awesome-fsrs wiki "The Metric", 2025-10; fsrs4anki) and Anki manual (leech/unsuspend; FSRS "needs a few hundred reviews") — fitting requires 4-scale ratings and 400–1000 reviews; calibration bins must be model-independent.
- Fader, Hardie & Lee, "RFM and CLV: Using Iso-value Curves for Customer Base Analysis" (2005) and the BG/NBD family; PyMC/lifetimes docs & MetricGate ("a few hundred customers"; <100 fails to converge); BTYD `bgnbd.EstimateParameters`.
- lifetimes PyPI (0.11.3, 2020-07, archived 2024-06) and PyMC-Marketing successor notices; juanitorduz (2022) maintenance-mode note.
- bgits/customer-lifetime-value — TS engine + independent Python reference with 5 preregistered verification gates (industrial precedent for the D2 boundary).
- Elasticsearch date decay docs (origin/scale/decay), Mem0 decay docs (0.3–1.5 band), LangChain/Generative Agents recency formulas, Yahoo Today Module recency lambda — industry hand-tunes tau; nobody fits it.
- Hu, Koren & Volinsky (2008) implicit feedback has no negative evidence; Joachims (2002) click position bias; Saito (2019) unbiased metrics — proxy fitting circularity.
- arXiv 2509.19376, Freshness and the Limits of Heuristic Trend Detection in Temporal RAG (2026) — recency prior is parameter-sensitive; Latest@10 swings 0.00→1.00 across parameterizations (sensitivity scan is mandatory evidence).
- Prometheus histogram practices; NN/g search-log analysis (access-age distributions as first-class telemetry).
- Kuzi et al. (2019) LTR adaptive-training robustness (report robustness vs best single feature); AWS/Azure ADR practice; Nygard append-only ADR discipline; bool.dev ADR anti-patterns 4/5/6/7; hartiga Debt-Aware ADR.
- PSI references: FutureAGI glossary, PMC11844046, Fiddler / Arize / Databricks (symmetric KL + epsilon smoothing); minitab note that PSI grows with sample size (T1 before T2 justification).
- TrigGuard fail-closed-with-SILENCE (2026); arXiv 2107.11277 reject-option survey; Nature 2025 learning-to-defer benchmark; FedRAMP POA&M explicit-record regime.
- Notion trash/restore docs; Gmail archive/return-to-inbox; NARA appraisal & Yale reappraisal; Colgate/Villanova weeding retention-request policies; Fable (dead-link revival, ACM) and WebCite (JMIR 2005).
- Node child_process docs (timeout/killSignal/maxBuffer/windowsHide); actions/setup-python README (pin version, lock requirements, pip cache); numpy 2.x EOL tracker (SPEC 0, numpy 2.0 EOL 2026-06-17); better-sqlite3 perf docs (WAL single-writer).
- SQLite ALTER/ADD COLUMN docs (schema-only, O(1)); Azure Event Sourcing "compensating event" pattern; softwarepatternslexicon bi-temporal discipline.
- thinkr.io (2026) testable acceptance criteria with numbers + failure scenarios; rework.com AC vs DoD separation; ISO/IEC 25010 quantification.

*Glossary additions land in CONTEXT.md (Tau Observation Layer / Pre-Registered Day Buckets / Access Events Log / Explicit-Skip Telemetry).*

## r100 Implementation Amendment (append-only)

- D2 pin revised during implementation: the frozen stack is `numpy==1.26.4 + pandas==2.0.3 + scipy==1.11.4 + autograd==1.7.0 + lifetimes==0.11.3` (see `scripts/tau/requirements.txt`), NOT the `numpy>=2.1` earlier text. Rationale (r100 atomcode re-check): lifetimes scales its objective with autograd, and autograd is incompatible with numpy 2.x (removed `numpy.core` attribute map import path plus float-cast behavior changes), so the lifetimes+autograd pairing fixes the stack below numpy 2. The D2 fallback clause unchanged: if the frozen stack breaks, self-implement the BG/NBD closed-form likelihood (scipy.special.hyp2f1) or take D7 explicit-skip. CI smoke prints `numpy.__version__` and asserts the envelope, so any future drift fails loudly in the tau-python workflow.
- EVAL_TIMEOUT note: the observational zone makes the 50-round calibration exceed the ADR-0029 D5 default 600s watchdog; calibration runs set `EVAL_TIMEOUT_MS=3600000` locally. Watchdog and ADR stay unchanged — the default keeps blind regression-catching fast; the override is an explicit operator action.

## r108 Text Errata (append-only)

- D6 T3 (observation window >= 90 days): under the synthetic track introduced by ADR-0042, a simulated clock is permitted; reports must be labelled simulated-observation-window. The consumed track keeps wall-clock semantics unchanged.
- D7 skip semantics: reason codes split into data-absent (structural absence, never counts toward the 3-streak escalation) and gate-not-met (counts; after a data-absent run it restarts at 1). Introduced by ADR-0042 D4.
- This section is append-only; no ADR-0039 body text was modified.
