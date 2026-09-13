# ADR-0061: Grill Round 60 — Product Body Round: Vertical Domain Delivery Closure（产品正文轮：垂直领域可交付闭环）

## Status

Accepted (document round r60). This ADR records the round-60 grill decisions only; source changes land in the fixer round per the ticket plan below. Ledger: `.scratch/grill-round-60/decision-ledger.md` (D-001..D-006; D-002 twice revised by D-004 and D-005).

## Context

Round-59 (ADR-0060) closed archive truthfulness; its closure report fixed Round-60 as the **product body round** with the hard constraint **new code lines > governance lines**. The standing pain: the product has never been walked end-to-end by anyone — three stale `0.0.0` tarballs (2026-08-21) are the only pack artifacts, and the README→doctor→search path has never been tested against a real install. The grill evaluated three themes: retrieval-quality deepening (A), vertical domain deliverable closure (B), productization reliability (C).

Five atomcode deep-research passes (q1–q5) fed the decisions; reports in `.scratch/grill-round-60/q{1..5}-atomcode.md`.

## Decision

### D1 Round-60 theme = B, vertical domain deliverable closure (ledger D-001)

Task set: **B1** example-domain walking skeleton, **B2** install-to-use CI verification, **B3** doctor self-service enhancement, **B4** badcase backfill loop, **C1** release-lines against real artifacts, **G1** graceWindow/deepMode governance mini-ticket. Negative constraints: (1) B is not bare B — its first ticket contains C's minimal slice (pack → clean-env install → doctor → search); (2) A never becomes its own round, only a thin probe on B (real badcases backfill Golden); (3) governance items (graceWindow/deepMode) ship as an independent mini-ticket whose diff lines do not count toward the body-lines comparison; (4) no synthetic-question Golden expansion without real traffic (per Respan: synthetic-only expansion self-loops); (5) without macOS dual-platform capability, macOS is a documented limitation, never claimed as tested.

### D2 Example domain = `docs`, technical-docs retrieval, narrow wedge (ledger D-002, revised by D4 and D5)

The `docs` domain anchors on first-party documentation the team actually depends on. Golden lives in `eval-looks.json` (schema `anysearch/eval-looks@2`), not in `golden-cases.ts` (that harness is memory-lifecycle scoped). The user's premise "repo already has a cc-persona domain" was falsified by local glob (domains/ contains only default.toml and research.toml); B1 spec text must carry this correction.

### D3 Ticket order = serial milestones B1 → B2 → B4 → B3, C1/G1 trailing (ledger D-003)

Walking-skeleton doctrine: each milestone ends with something that demonstrably works. Parallel streams are rejected — B4 consumes B2's real badcases, B3 consumes B1/B2 exposed gaps, G1 consumes B1–B4 usage evidence; faking parallelism only adds merge cost (mergify: branch-lifetime × integration-cost is superlinear).

| Ticket | Milestone (what demonstrably works) | Key acceptance anchors |
|---|---|---|
| B1 | docs domain retrieval end-to-end; golden first batch landed | domain TOML + `eval-looks.json` first batch; pack→install→doctor→search passes; spec fixes the cc-persona misstatement; schema-compat check vs `golden.test.ts`; line-classification ("body line") definition stated |
| B2 | real artifact walks install→use in CI | A2 offline golden CI green; offline uses snapshot fixtures, URL-hard-assertion lives in the online layer (D-003 R1 layering); A3 attribution URL hard assertion; A4 abstain/injection reuse existing mechanisms |
| B4 | badcase → golden-entry → regression-caught loop reproducible | backfill loop demonstrated; thin probe only (D-001); no synthetic Golden (D-001) |
| B3 | doctor self-service | covers exactly the gaps B1/B2 surfaced, listed one by one; A5 honesty: macOS documented limitation |
| C1 | release-lines green against the real pack artifact produced by B2 | no waiver claimed; CI-script line classification declared in B1 spec |
| G1 | graceWindow/deepMode remove-or-implement adjudicated from B1–B4 usage evidence | waiver follows the Waiver Quintet with explicit sunset (Round-61 must not auto-inherit); diff lines excluded from the body-lines comparison; a lawful outcome may be documented deferral + revisit conditions |

### D4 Corpus allowlist = rules layer first, URLs instantiate per ticket (ledger D-004, revises D-002's "anchored list" phrasing)

The anchored unit is the **inclusion rule**, not a URL list; the URL list is the rule's current output (first batch: MCP specification transports page, TypeScript tsconfig reference, pnpm settings). Inclusion requires all of: first-party origin, demonstrated daily dependence, revistable URL (versioned/permalink), and added value to at least one of the eight golden slice dimensions. Ejection triggers: upstream supersede, staleness beyond the source-class budget (spec-major 90d / reference-stable 180d / reference-active 90d), two consecutive rounds with no golden reference, repeated 404/410 without a successor. Ejected URLs follow Corrective Supersession: append-only, reused supersession state machine and HITL outlet — no new wheels. First-batch URLs live in the B1 spec annex, not in this ADR body (government-lines discipline).

### D5 Golden sources + coverage manifest (ledger D-005, second revision of D-002)

First batch: real questions back-harvested from internal sessions through Round-59 (provenance `internal-dogfood`) plus verbatim external real questions from SO/GH issues (provenance `external-community`); realistic volume 8-14 items. 10-20 items is the round-60 closing stock target (post-B4 backfill), not the B1 shelf-gate. New first-class artifact: `eval-looks.coverage.json` — a coverage manifest per dimension `covered|deferred`; every deferred dimension carries a named entry trigger (B4 backfill / first real abstain event / first real injection attempt) and hangs on the D-004 rolling mechanism. Deferred dimensions that still cannot be truly harvested after two rounds are recorded in the ADR as documented deferral — conversion to synthesis is forbidden. Honesty scoring: acceptance scores "declared, yes/no", not "collected, yes/no".

### D6 Version policy = 0.0.1 (ledger D-006)

C1 publishes as `0.0.1` — the honest signal: skull installable, features still converging. Release-lines must run against the real artifact (no mock); no minor-semantics claims; no publish before B1–B4 complete.

## Consequences

- Round-60 has one lawful source of decisions: the ledger; the B1 spec, CONTEXT.md terms, and the handoff task book all derive from it.
- The Waiver Quintet gains one instance (G1) with explicit sunset.
- The deferral-not-synthesis stance now covers both corpus membership (D4) and golden dimensions (D5).
- ADR-0002's example narrative in later specs must stop citing cc-persona as a present domain (corrected by D-002's falsification pass).
