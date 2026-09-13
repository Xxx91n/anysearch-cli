# ADR-0059: Architecture Grill Round 58 — CI/Ship-Gate Full-Green Closure (multi-ticket override of ADR-0029, eval governance thaw)

- Status: Accepted
- Date: 2026-09-12
- Round: grill-round-58
- Ledger: .scratch/grill-round-58/decision-ledger.md (D-001..D-009, all current at decision time)
- Predecessor closure target: Round-57 leftover debt F-15/F-16/F-17 + permanent gates + doc alignment + remaining hostile-review cuts

## Context

Round 57 made main's ci workflow green for the first time but left ship-gate red on all three OSes (F-15 structural, F-16 pre-existing native crash, F-17 memory-eval nondeterminism), no permanent gates for the lessons learned (F-10 workflow YAML, F-11 stale dist masking), README ADR index lagging by 12 entries, and four hostile-review findings (.codex-tmp/锐评.txt) explicitly excluded from previous rounds.

### Goal (rewritten — round-58 audit R-5)

The umbrella goal was originally stated as "CI/ship-gate full-green closure". The round-58
independent audit found the macOS native crash (F-16) unsolvable within scope and accepted the H3
known-issue exit, so the goal is **rewritten** to: **non-macOS double-green** (`ci` ubuntu+windows
green AND `ship-gate` ubuntu+windows green) **+ a macOS H3 known-issue ledger entry**
(`defer-f16-macos-native-crash`). The macOS `ship-gate` job stays honestly red; no workflow-level
silent skip is permitted. The original slug in this file name is retained (append-only ADR
convention).
## Decision

### D1. One round, six tickets — explicit one-round waiver of ADR-0029 (ledger D-001/D-002)

This round carries an umbrella theme "CI/ship-gate closure" (goal sharpened by the round-58 audit to non-macOS double-green + macOS H3 ledger — see Goal note) and is executed as six ordered, independently-verified tickets. The waiver is one-shot: ADR-0029 is NOT rewritten. Ticket order: T-1 (F-15 eval layering) → T-2 (F-17 quarantine) → T-3 (F-16 macOS native crash) → T-4 (permanent gates) → T-5 (README automation) → T-6 (four hostile-review cuts). T-4 must come after the functional tickets, otherwise the new gates block their own PRs. Each ticket lands as done or deferred-with-reason; silent dropping is forbidden.

### D2. T-1: CI runs observational grade; decision grade binds to release actions (ledger D-003/D-004)

- ship-gate step 7 in regular CI runs with ANS_EVAL_NO_LOOK=1 (observational; never consumes OF looks). The existing switch is reused; no new mechanism.
- decision grade runs only at release: a new release.yml with `on: push tags v*` plus workflow_dispatch(runPurpose). pre-tag dispatch consumes the OF look (the only allowed peek); post-tag release.yml asserts the verdict is unexpired and consumes NO new look (no OF double-spend).
- The OF look ledger moves into the repo as an append-only file (git as storage, single-maintainer private-repo rationale over external object storage); an information-density compaction with a hard row cap keeps it bounded, preserving a hash of pre-compaction state.
- ship-gate.yml Node 24 → 22 to match ci.yml.
- Rationale (industrial consensus, atomcode-verified): "deterministic checks gate merges; statistical metrics report" (FirstMate); two-tier eval gates (aiarch.dev, FutureAGI, Braintrust promotion criteria); OF alpha spending semantics "you only spend alpha when you peek" (Spotify). This is the completion of ADR-0044 D3 (PDP/PEP boundary) and ADR-0058 (CI/judgement separation), not a new paradigm. F-15 is re-classified as a governance bug (decision-grade semantics wired to every CI run), not an engineering bug.
- Explicitly rejected: fixing the ledger technology alone (treats symptom); C-mode pinning look=1 as the decision scheme (destroys preregistration).

### D3. T-2: F-17 via ledger-marked quarantine + SLA clock (ledger D-005)

Execute ADR-0027 D8's existing contract: the 2 flaky golden cases enter a quarantine ledger as policy-layer marks (golden set membership and fingerprint unchanged — zero recalibration cost), with 30-day TTL, weekly review, max 2 renewals. In the same commit, a 20-run fixed-input audit classifies each case (threshold-adjacent noise vs true nondeterminism, BuildPulse three-bucket model). Re-promotion requires evidence; removal-and-return never resets statistical budgets (ADR-0038 symmetry). Per-case statistical slack (majority vote / 2σ band) is REJECTED: on deterministic assertions it equals rerun-until-pass (ADR-0027 D7 slot-machine ban), and the statistical layer already lives at release-grade OF spending.

### D4. T-3: F-16 five-gate decision chain (ledger D-006)

① H1' half-day macOS probe to identify the crashing process and culprit module (better-sqlite3 vs onnxruntime-node@1.21.0 — the latter matches onnxruntime issue #24579's exit-time mutex crash verbatim); ② Node 22 alignment carries a better-sqlite3 #1514 verification gate (darwin-arm64 SIGSEGV risk); ③ if onnxruntime is confirmed, a "necessary exception" upgrade to >=1.24.1 (upstream fix, same major, prebuilt path untouched, allowBuilds=false untouched, better-sqlite3 pinned at 13.0.3); ④ if still unsolved: H2-strong subprocess isolation + sentinel exit code (wigolo 02b5200 precedent, ADR-0058 success-only compatible); ⑤ final exit: H3 quarantine-ledger known-issue with issue link + TTL (ADR-0057 D2 / ADR-0027 D8 form) — workflow-level silent skipping is forbidden. No preemptive upgrades before the probe.

### D5. T-4: permanent gates in ship-gate step_0 (ledger D-007)

Three invariants run first in ship-gate.mjs (including --quick): (a) workflow YAML validity — .scratch/check-workflows.mjs is promoted to a formal script (closes backlog B-2) with its fail-open flipped to fail-closed, auto-discovering both .yml and .yaml; (b) clean-tree invariant — `git status --porcelain` must be empty before a release verdict (prism-coder check-publish-clean precedent); (c) gitignore-drift invariant — `git ls-files -z -c --ignored --exclude-standard` must be empty (the literal `-z --ignored` form is rejected by git: `-i` requires `-o` or `-c`; `-c` implements the same intent). Pre-requisite hygiene: one-time `git rm -r --cached .scratch/` as an independent chore commit, otherwise the drift gate is permanently red. Optional enhancement: a path-filtered actionlint CI signal job (binary download, SHA256-pinned, zero npm deps) folded into the ADR-0058 summary aggregation — never a standalone required check. Rejected: pre-commit hooks as enforcement (bypassable, hooks are fast-feedback only); a ci.yml explicit clean step (redundant with fresh checkout).

### D6. T-5: README ADR index automation (ledger D-008)

scripts/gen-adr-index.mjs (Node stdlib only, per ADR-0020 D5) regenerates a marker block in README.md from docs/adr/*.md; ship-gate gains a --check assertion (regenerate + diff, terraform-docs pattern). The one-time catch-up fixes README's 0001-0046 lag to the actual count. The index is generated from the git tree of a ref (default HEAD), not the working-tree filesystem (round-58 audit R-1). Manual maintenance is rejected (documented failure mode: "Decision Documentation Theater"). docs/adr is the single source of truth; the README index is a derived artifact.

### D7. T-6: four hostile-review cuts, two-state verdicts (ledger D-009)

1. engine dead config (grace-window / providers_cancelled claimed but unimplemented): FIX BY DOCUMENTATION — remove the false claims from CONTEXT.md / ADR-0005, keep engine.ts's honest ponytail-debt note (ADR-0014), add a wiring assertion preventing recurrence. Not fixing by implementation: allSettled is functionally correct; grace-window is latency-only.
2. doctor prints v0.0.0: FIX — use the existing __PACKAGE_VERSION__ tsup define (one standard, matching index.ts).
3. plugin server without token + open CORS: FIX, highest priority of this round (MCP spec MUST: Origin validation). Six stdlib-only measures: Host loopback whitelist (ADK #5288), Origin check (missing Origin = native client = allow; non-loopback = 403), auto-generated 256-bit ANS_SERVER_TOKEN when unset, crypto.timingSafeEqual, readBody ≤1MB, and a deliberate 403-before-401 ordering (Resilio model).
4. api.anysearch.com ownership: DEFERRED WITH DEADLINE — verified live (CloudFront CNAME, Amazon wildcard cert valid to 2026-12-03, fresh status subdomain cert), not dead infrastructure; legal ownership is an internal-confirmation item logged as an ADR entry with named owner + date, an annotation block in anysearch.ts (endpoint, CNAME, confirmation date, fail-open note), and CT/expiry monitoring folded into the quarterly review cadence (ADR-0010 precedent).

## Consequences

- Green definition sharpens (round-58 audit R-5 rewrite): closure = **non-macOS double-green** (`ci` ubuntu+windows ✓ AND `ship-gate` ubuntu+windows ✓) **plus** a macOS H3 known-issue ledger entry (`defer-f16-macos-native-crash`); the macOS `ship-gate` job stays honestly red. main's ship-gate is red until T-1..T-4 land; after landing, the non-macOS signal becomes trustworthy again.
- Release ergonomics change permanently: tagging without a pre-tag decision-grade dispatch is now an unverifiable act.
- Deferred items are not silent: T-6.4 carries an owner and a monitoring channel; T-3's H3 exit carries issue links and TTL.
- This ADR closes Round-57 leftover debt F-15, F-16, F-17 and the "no gate for the gate itself" class (F-10/F-11 lessons).

## r59 Text Errata (2026-09-13, ADR-0060 follow-up)

D2's citation of ADR-0058 ("This is the completion of ... ADR-0058") is historical context only: ADR-0058 is superseded by ADR-0060 (2026-09-13) — its body describes a parallel universe (see its r58 Text Errata) and must not be read as governing this repo. Body unmodified (append-only).
