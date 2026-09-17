# F-17 Sweep Ledger — eval-looks/golden read-write pipeline

Date: 2026-09-17. Scope per next-round.md T0: eval-looks/golden read+write pipelines + test loading chain. Method: writeFileSync/renameSync site enumeration (86 sites) + read->modify->write pattern classification + disk field-set vs writer field-set diff.

## Bug class

JSON.parse -> field-by-field object rebuild -> writeFileSync drops every field the writer does not model. Fired once in production: 9a466b9 release-bot read->append->write stripped root schema_version:1 from eval-looks.json (parity test red, ci+ship-gate double FAILURE on d7bed91/2b9e6e8).

## Same-class instances found: N=2 (both fixed in T0)

| # | Site | Pipeline | Fix |
|---|------|----------|-----|
| 1 | packages/store/src/eval/looks-ledger.ts (readLooksLedger/appendLook/writeLooksLedger) | eval cli ANS_EVAL_LOOKS_WRITE=1 append+write (the 9a466b9 firing path) | Tolerant Reader: index signature + {...j, schema, looks} spread; row-level {...raw, ...normalized}; appendLook spreads ledger |
| 2 | packages/store/src/eval/cli.ts:236-241 (eval:calibrate reset) | reset rebuild dropped compaction+all unknown roots | destructure-drop looks/compaction only; {...preserved, ...emptyLooksLedger()} |

## Inspected — SAFE (whole-object parse -> in-place mutate -> whole-object write)

| Site | File | Why safe |
|------|------|----------|
| scripts/badcase-backfill.mjs:36-112 | eval-looks.json, eval-badcases.json, eval-looks.coverage.json | mutates parsed object in place (golden.entries.push, bc.status=, d.count=), writes JSON.stringify(looks/badcases/cov) |
| scripts/attribution-calibrate.mjs:37,109 | .ship-gate/attribution-gold-preregistration.json | preregistration.derivedThresholds = {...} in-place mutation |
| scripts/gain-ledger.mjs:31-39 | gain warn ledger | parseGainLedger mutates j in place, returns j |
| packages/store/src/eval/skip-ledger.ts:131-263 | .ship-gate skip-ledger | parseSkipLedger validates+returns parsed j directly |
| packages/store/src/eval/override-ledger.ts:155-224 | .ship-gate ship-override-ledger | parseShipOverrideLedger validates+returns ledger |
| scripts/ship-gate.mjs:154-185 | .ship-gate access-chain-skip-ledger | readLedger()/writeLedger(l) mutate-in-place pairs |

## Inspected — read-only consumers (no write leg)

| Site | File |
|------|------|
| scripts/ship-gate.mjs:493 | eval-looks.json (OF look assertion) |
| scripts/release-gate.mjs:29,78 | eval-looks.json (pre-tag verdict read) |
| packages/kernel/test/eval-looks-stub.test.ts:27 | eval-looks.json (offline stub executor) |
| packages/store/test/online/eval-looks-live.online.ts:45 | eval-looks.json golden entries |
| scripts/quarantine-ratchet.mjs | eval-quarantine.json + baseline |

## Same shape, dismissed (no live read->modify->write pair)

| Site | Reason |
|------|--------|
| packages/store/src/eval/quarantine-ledger.ts readQuarantine | writeQuarantine has ZERO production callers; read is read-path normalization only (degrades to empty). eval-quarantine.json maintained by ratchet script + manual edits. Revisit if a writer lands. |

## Out of scope (report/output writers, not committed-ledger round-trips)

eval-report.json/md, probe-tavily ledger, install-smoke fixtures, eval-judge/eval-labels/revisions report paths, all test-side tmp writes (mkdtempSync pattern), attribution report paths.

## Disk field-set vs writer field-set diff

Before fix: disk {schema, schema_version, looks, golden} vs appendLook constructed set {schema, looks, compaction?, golden} -> schema_version dropped (verified via git show 9a466b9~1 vs 9a466b9).
After fix: writer emits the full disk set by construction (spread carry); contract test eval-docs-golden.test.ts section 7b asserts per-key byte-identical round-trip + key-position preservation.

## Pre-written rule outcome

N=2 > 1 -> both instances merged into T0 without expanding the round (per next-round.md T0 sweep rule).
