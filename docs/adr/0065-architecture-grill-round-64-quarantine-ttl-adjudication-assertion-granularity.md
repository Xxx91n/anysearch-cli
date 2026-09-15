# ADR-0065: Grill Round 64 — Quarantined Golden TTL Adjudication + Assertion-Granularity Re-anchor（隔离金案例裁决收口/页族断言层/证据模式）

## Status

Accepted (implementation round r64). Records the round-64 implementation
decisions; changes landed per ticket plan T1–T6. Ledger:
`.scratch/grill-round-64/decision-ledger.md` (D-001..D-007, all current).

## Context

Round-63 (ADR-0064) shipped the quarantine ratchet around 10 live-scoped
`eval-looks.json` golden entries quarantined for provider URL-shape drift
(byte-exact `mustHitUrls` vs returned `/zh/` locale, `/10.x` version and dated
`/specification/<date>/` variants). The quarantine TTL expires
2026-10-14T19:02:29Z and the shrink-only ratchet required every entry to reach
a promote/retire/longterm ruling. Simultaneously the R63 caveat was on record:
page-level assertion precision had degenerated to 0/12 live entries. This
round closes the loop: a new assertion granularity layer, evidence-driven
adjudication of all 10 cases, machine-checked criterion anchors, and the
documented obligations the grill demanded.

## Decision

### D1 Theme = quarantined golden TTL adjudication + mechanism close-out (ledger D-001; T6)

The 10 drift-quarantined entries must each receive an explicit ruling inside
the TTL — promote, retire, or longterm — with recorded evidence. There is no
"暂不裁决" exit: an entry that cannot meet its evidence tier retires with a
recorded reason. The TTL itself is a calendar fallback; the round closes well
before expiry.

### D2 Page-family assertion layer + 8 migrations + retained byte-exact legs (ledger D-002; T1/T2)

`eval-looks.json` gains `mustHitPaths` — pathname substring patterns matched
against live results, host-scoped to the entry's `mustHitHosts` when declared
(the promise is "site X page family", not "any host with a /settings-shaped
path"). Each pattern carries a REQUIRED (possibly empty) `tolerate` list
declaring which wrapper-segment classes it forgives: `locale` (/zh/),
`version` (/10.x/), `dated` (/specification/2025-06-18/ → /latest/). Every
entry using `mustHitPaths` must also pin `mustNotHitPaths` — written-down
unrelated page families that must not be hit (over-broad-substring guard).
`urlHit()` semantics are untouched — no hidden normalization.

The eight path-drift cases (g0001/2/3/4/5/6/9/11) migrated to the new layer
with fragments calibrated against live probe returns
(`.scratch/grill-round-64/evidence/probe-0.json`); reducing them to host-only
assertions was explicitly not allowed. Byte-exact `mustHitUrls` legs survive
only anchored to `controlled|frozen-spec` targets — landed three, all on
frozen dated MCP spec snapshots verified by recurrence probes
(g0001→2026-07-28 streamable-http 3/3, g0005→2025-11-25 transports 6/6,
g0010→2024-11-05 transports 3/3). The initial 2025-06-18 leg on g0001 rotated
out mid-round (present probe-0/run-01/run-02, absent runs 03–06) and was
re-anchored — dated-snapshot coverage rotates even when the page itself is
frozen; post-promote watch is the armed mitigation for that residual risk,
not a fixture defect.

### D3 Residual rulings (ledger D-003; T2/T3)

- **g0010** — took the re-spec fallback branch: live runs resumed answering
  on-domain (`/specification/{draft,2026-07-28}/deprecated` + 2024-11-05
  transports), so the case merged into the `mustHitPaths` cluster
  (`/deprecated` family) instead of re-spec'ing to abstain. The earlier
  all-off-domain abstain was a transient provider episode, not a durable
  re-spec condition.
- **g0008** — downgraded `mustHitHosts` to `[pnpm.io]`; the typescriptlang
  leg was suppressed by locale clustering (probe: 10/10 results
  `pnpm.io/zh/*`). `failure_class: locale-clustering-suppressed-cross-host`;
  `hops:multi` survives as a `dimensions` observation, not an assertion.
- **longterm** — not enabled this round. Enablement threshold: only a
  genuine retire candidate that cannot be re-spec'd (permanent known-issue
  conversion, cap `QUARANTINE_MAX_LONGTERM=1`) may take the longterm exit;
  every case here could either re-spec or go green.

### D4 Evidence mode + single classification implementation (ledger D-004; T1/T3)

`ANS_EVAL_EVIDENCE=1` switches `eval-looks-live.online.ts` into
quarantined-but-runnable mode: quarantined entries actually execute (a skipped
case can never emit a gone-green signal), each executed entry appends an
`EVIDENCE <id> <pass|fail> <ISO-ts> <run-ref> p=<n> f=<n>` quadruple to
`ANS_EVAL_EVIDENCE_LOG` (default `.scratch/eval-evidence.log`), a run whose
only failures are quarantined exits 0 (`EVIDENCE-ONLY-FAILURES`), and an entry
all-red in consecutive evidence runs prints `RETIRE_CANDIDATE` for
`reviewDue()`. The runner's quarantine classification was unified onto the
ledger's `activeIds()` — the previous inline copy had already drifted once
(ignored the `longterm` flag) — and `eval-looks-live-parity.test.ts` pins the
contract on a mixed longterm/expired/retired ledger plus a no-inline-copy
source assertion. Evidence runs invoke the file directly (`node --import tsx`)
because the 180 s node-test file timeout cannot fit a full quarantined sweep.

Adjudication tiers applied (all met): stable tier ≥1 green; flaky tier
(g0004/6/9) ≥5 runs with flip<0.2; g0010 ≥2 consistent runs; g0008 ≥1 green
post-downgrade. Observed across 8 post-migration runs: every entry green on
the new granularity except g0001's initial leg (re-anchored, then 3/3 green)
and one transient g0005 abstain flip — those plus the flaky three carry
`watch:true`.

### D5 Schema fields, migration provenance, gate anchors, watch circuit (ledger D-005; T1/T4)

Additive schema v1 (no breaking change → `schema_version: 1` root sentinel
only, no v2 migration script): `mustHitPaths`, `mustNotHitPaths`,
`stability_class` (controlled|frozen-spec|external), `failure_class`,
`migration` ({from,to,drift,decidedAt}), `watch`.

**Tombstone boundary**: `promoteEntry` physically deletes the ledger entry,
so promote-side provenance lives on the golden entry's `migration` block —
the only durable carrier. Retire-side provenance stays inside the ledger
(Case Tombstone semantics); the two landing spots are deliberately distinct
and must not be conflated.

ship-gate §1n machine-checks: ≥2 live `mustHitUrls` holders AND each anchored
on `stability_class` controlled|frozen-spec; ≥1 live `mustHitPaths` holder;
all migrated cases carry complete `migration` blocks.

**Watch circuit**: `watch:true` entries announce via a `WATCH` runner line.
A CI flip re-enters quarantine through the existing TTL decision path — the
same baseline id re-entering is legal (entries ⊆ baseline), `renewals` stay
0, and the re-entry inherits normal TTL governance. It is a re-quarantine,
not a renewal bypass.

**Ratchet boundary**: the quarantine ratchet governs ledger entries
(membership ⊆ baseline, renewals=0, ruling-before-expiry) — NOT the golden
assertion vocabulary. Migrating an entry's expected shape does not need
ratchet clearance; only the ledger lifecycle does.

**Re-spec legitimacy**: changing an entry's expected verdict/assertion is a
legitimate re-spec iff (i) the observed reality change sits outside the
product's stable commitment surface (third-party provider behaviour, corpus
death, dated-URL supersede), AND (ii) the re-spec'd case still asserts a real
product behaviour. If the asserted object was observational-only, the same
drift calls for retire, not re-spec.

### D6 Serial ticket plan (ledger D-006)

T1 mechanism → T2 fixture migration → T3 evidence+adjudication → T4 ship-gate
→ T5 docs → T6 closure. Mechanism and migration deliberately landed in
separate commits for diff auditability; documentation follows evidence, never
precedes it. No npm release this round; OIDC trusted publishing remains a
0.0.4 candidate (out of scope).

### D7 Closure evidence — four-part structure (ledger D-001/D-007; T6)

(i) code evidence — typecheck + offline suite + targeted parity/quarantine
tests. (ii) adjudication evidence — evidence.log runs + adjudication.json +
per-id promote reviews. (iii) gate evidence — ship-gate green incl. the new
anchors and the empty ratchet view. (iv) gaps/limitations — recorded
honestly: evidence is a resolvable self-witness (producer = the adjudicated
object's own pipeline; independently replayable), not external attestation;
the byte-exact legs rest on provider coverage of frozen snapshots, which can
rotate — the watch circuit, not fixture certainty, carries that residual
risk.

## Consequences

- Active quarantine view is empty; all 10 cases carry rulings + evidence.
- Page-level assertion coverage restored at page-family granularity
  (9 entries carry `mustHitPaths`), plus 3 frozen-spec byte-exact legs —
  the R63 "0/12 page precision" caveat is closed.
- A second classification predicate can no longer silently drift — the
  parity test fails if the runner stops calling `activeIds()`.
- Watch-marked entries (g0001/4/5/6/9) re-enter quarantine through normal
  TTL governance on any CI flip — statistical-power debt is carried by the
  loop, not hidden.
- `eval-looks.json` stays schema v1 (`schema_version: 1` sentinel);
  consumers ignoring the new optional fields are unaffected.

## Closure evidence

Backfilled at T6 (four-part per D7):

| leg | anchor | status |
|---|---|---|
| code | pending T6 | pending |
| adjudication | pending T6 | pending |
| gate | pending T6 | pending |
| gaps/limitations | pending T6 | pending |
