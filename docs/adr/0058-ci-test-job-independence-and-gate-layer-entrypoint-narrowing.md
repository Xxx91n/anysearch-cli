# ADR-0058: CI Test-Job Independence, Always() Success-Only Aggregation, and Gate-Layer Entrypoint Narrowing

Status: Accepted
Date: 2026-09-12
Amends: ADR-0034 (D5 single-entrypoint wording narrowed), ADR-0057 (D-D defer-0026 activation)

## Context

ADR-0057 D-D deferred the splitting of `npm test` out of `gate:all` into a
parallel CI job with an `always()` summary, registering the deferral as
defer-0026. ADR-0057 D-C's suite-count assertion and ADR-0056's corpus tiering
both shipped inside the existing test gate (order 100 in gates.json). The
post-audit handoff identified defer-0026 as the highest-value next
implementation target, with defer-0004 (generated ci.yml from gates.json)
bundled into the same round by registry presence-condition coupling.

This ADR records the nine grill-round decisions (D-001 through D-009) that
define the exact shape of the defer-0026 landing. Each decision was
researched via atomcode (multi-engine web research with industry precedent)
and confirmed by the user before recording.

## Decision

### D-A — Serial ordering: defer-0026 first, governance policy next doc round

`D-001`: defer-0026 lands in its own implementation round. The
decision-rule change-management policy (ADR-0049 leftover) is the next doc
round. CI contract change and metrology rule policy must NOT be in the same
round (ISO/IEC 17025 §8.3 / FDA Part 11 separation + project working
agreement doc round then impl round rhythm).

### D-B — A-hardened success-only aggregator

`D-002`: The summary job's `always()` aggregator uses a success-only
whitelist: green = each needed job's result strictly equals `success`;
`failure`, `cancelled`, `skipped`, and any unknown state are red. No
extra cancelled-only check. The canonical richja pattern (success || skipped)
is forbidden — it violates the "no skip-only-success gate" constraint. The
ju-manns defect (#26822, 2025-02-26) proves that GitHub masks failed legs as
`skipped` on partial re-run; the only true fix is `skipped = red`.

### D-C — defer-0004 evaluation scope: presence-coupled only

`D-003`: The defer-0026 round evaluates ONLY presence-coupled items:
defer-0004 + defer-0026 itself. No external-event harvesting. ADR-0016 D4
sub-item (i) (verifiable-log wheels: hypercore/ssb/Rekor) is registered as
`external-event / pending-evaluation`, yearly cadence, review_at aligned to
defer-0024 (2027-09-01). Sub-items (ii) (profile.js relocation + configDir
dedup) and (iii) (lint boundary) stay in ADR prose — no live trigger, no
registry entry. defer-0003 and defer-0024 are not touched.

defer-0004 evaluation is NOT auto-activation: `check-ci-jobs.js` outputs
SATISFIED, then a human chooses one of three exits (activate, re-defer +
update rationale, or close).

### D-D — Two-layer verification: presence in script, anti-patterns in wiring test

`D-004`: `check-ci-jobs.js` carries ONLY presence predicates (test job
exists + summary job exists + summary uses `always()`). Anti-pattern
assertions (path-filter absent on test job, skipped != success in summary
logic, gate:all no longer contains test step) go into
`test/adr-0058-wiring.test.js` as intent-shaped characterization tests.
"Summary is required check" is NOT machine-asserted — it lives in ADR prose +
human deployment checklist (branch protection is outside ci.yml; any
ci.yml-only script claiming to verify it is a vacuous-pass pseudo-assertion,
per steve-kaschimer 2026-05).

### D-E — ADR-0034 D5 narrowed to gate-layer entrypoint

`D-005`: D5 wording narrowed to: "gate:all is the single entrypoint for the
gate layer; test job is an independent CI-layer consumer that does not go
through gate:all." Two-layer entrypoint separation: gate layer (gate:all
owns exclusively) + CI layer (test job + summary job are CI-layer consumers,
not gate-layer). `check-ci-wiring.js` blocklist updated: test job running
`npm test` is NOT blocked (it is outside gate:all now).

### D-F — Test gate removed from gates.json; suite-count wrapper migrates

`D-006`: Test gate (order 100) is physically REMOVED from gates.json. Test
is no longer a gate-layer member; it belongs fully to the CI layer. The
suite-count assertion (ADR-0057 D-C) migrates with the `run-test-gate.js`
wrapper into the independent test job. `--expected-suites 48` is re-anchored
to the ci.yml call line + adr-0058-wiring.test.js.

Four same-round companion revisions:
1. gates.json: delete test gate entry
2. ci.yml: dual-job (gate:all + test) + wrapper call in test job
3. adr-0057-wiring.test.js: re-anchor D-C assertion (name-based, not order-based)
4. check-ci-jobs.js: presence expansion (test job + summary job + always())

### D-G — Summary job needs: [gate:all, test] full-set aggregation

`D-007`: Summary job `needs: [gate:all, test]` — aggregates ALL parallel
jobs (full set, not subset). Branch protection configures ONLY `summary` as
required check (single contract point, never changes). gate:all and test are
internal — their names can change without touching branch protection. This
is the industry consensus pattern (Marc Philipp 2026-08-10, steve-kaschimer
2026-05-29, suzuki-shunsuke required-status-check-action).

### D-H — CI test job: JIAHAO_TEST_TIER=public, symmetric tier contract

`D-008`: CI test job explicitly sets `JIAHAO_TEST_TIER=public` — verifies
the published form (clean-clone integrity, ADR-0056 title promise). gate:all
job maintains full tier (secret injection, current behavior unchanged). ADR
prose records the symmetric tier contract: gate:all=full / test job=public.
Test job does NOT depend on `JIAHAO_BENCH_CORPUS_B64` secret — fork PR and
main branch behave identically.

`--expected-suites 48` stays unchanged — suite count = 48 test files; tier
only changes test bodies, not suite collection.

### D-I — Order 100 gap: retired, not renumbered

`D-009`: Order 100 is left empty (gap). No renumbering. `run-gates.js`
sorts by order; the gap does not affect execution. ADR prose records: "order
100 retired, do not reuse." The slot is a retired position, not a tombstone
entry. gates.json already has ~30 gaps; contiguity was never this registry's
property (ADR-0043 used gap-insertion at order 115).

## Rejected alternatives

- **Canonical richja (success || skipped)**: violates D-001 (a) "no
  skip-only-success gate"; ju-manns primary evidence proves skipped is the
  mask state after partial re-run, not cancelled.
- **Option B (bucket-job, failure blacklist)**: cancelled/skipped/missing
  remain green; same ju-manns false-green surface.
- **Harvesting external-event deferred items** (defer-0003/0024): industry
  anti-pattern (KEP/PEP/RFC + tech-debt register consensus: per-item
  independent disposition); conflicts with D-001 serial/no-bundle discipline.
- **Full anti-pattern machine-check in check-ci-jobs.js**: "summary is
  required" is a pseudo-assertion from day one (steve-kaschimer vacuous-pass);
  deep assertions in presence evaluator violate D-003 + ADR-0035 D6.
- **Expanding gate:all semantics to include test as a lane**: god-facade
  anti-pattern (GoF Facade: per-layer entrypoint; refactoring.guru: Additional
  Facade); breaks ADR-0034 D1 "registry as fact-source."
- **Test gate stays in gates.json as UNVERIFIABLE/skip**: pseudo-UNVERIFIABLE
  violates ADR-0040 D3 (exit 2 only from capability probing deterministic
  negative); blocklist kills wrapper → D-C assertion silently lost.
- **Renumbering gates.json after test gate removal**: breaks 5 real wiring
  test order assertions + protobuf official names "aesthetically pleasing
  number order" as wrong motivation.
- **Tombstone entry (status: migrated)**: check-ci-wiring.js blocklist
  generated from registry → run-test-gate.js stays blocked → D-006 companion
  fail-closed; needs schema change larger than the problem it solves.
- **CI test job runs full tier via secret**: fork PR has no secret → same job
  runs full on main, public on fork → D-002 green=success semantic drifts.
- **CI test job auto-probes tier (no env)**: correctness fully depends on
  probe logic + environment implicit contract — johal.in/helmdeck/mockserver
  three incident common shape.

## Consequences

- `CONTEXT.md` gains: Success-Only Aggregator, Two-Layer Entrypoint,
  Retired Order Slot, Symmetric Tier Contract.
- `docs/adr/0034` D5 wording is amended (narrowed to gate layer).
- `docs/adr/0057` D-D is activated (defer-0026 lands).
- `docs/gates.json` loses the test gate entry (order 100 retired).
- `docs/deferred-registry.json` gains a new entry (ADR-0016 D4 verifiable-log
  wheels, pending-evaluation, yearly, review_at 2027-09-01) and defer-0004
  evaluation is recorded.
- `scripts/check-ci-jobs.js` is expanded (presence predicates for test job +
  summary job + always()).
- `scripts/check-ci-wiring.js` blocklist is updated (test job npm test not
  blocked).
- `test/adr-0058-wiring.test.js` is created (anti-pattern assertions).
- `test/adr-0057-wiring.test.js` D-C anchor is re-anchored (name-based).
- `.github/workflows/ci.yml` becomes three jobs: gate:all + test + summary.
- README ADR index rebuilds to 58 records.
- `test/adr-0033-wiring.test.js` extends the seed inventory to 21 entries.

## Acceptance

- `npm test` (serial): all suites pass, including new adr-0058-wiring.test.js.
- `npm run gate:all`: all gates pass (4 UNVERIFIABLE ci-mode-only expected).
- `npm run corpus:drift`: fingerprints OK.
- `npm pack --dry-run`: clean.
- `git diff --check`: clean.
- All written files UTF-8 no BOM, LF.
