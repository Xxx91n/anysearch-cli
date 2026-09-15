# T6 — Live-Drift Sorting-Regression Investigation (pre-registered, non-blocking)

Round 63 / D-003 follow-up. Investigates whether the 10 quarantined
`eval-looks-live` cases share one provider/ranking-algorithm cause.
**Ruling deadline: quarantine TTL `2026-10-14`** — before then each entry needs
promote / retire / longterm (longterm exit capped at 1 ledger-wide, T3 ratchet).

## Case inventory (from eval-quarantine.json reasons)

| id | symptom | variant family |
|---|---|---|
| docs-g0001 | flaky: dated spec path `/specification/2025-06-18/basic/transports` flips run-to-run | dated |
| docs-g0002 | flaky: `/settings` absent; `/10.x/` + `/zh/` variants returned | version+locale |
| docs-g0003 | `/settings` absent; `/zh/` + `/10.x/` returned | version+locale |
| docs-g0004 | `/tsconfig` flaky across runs | version/alias |
| docs-g0005 | dated spec path absent; newer `/specification/…` returned | dated |
| docs-g0006 | `/tsconfig` absent | version/alias |
| docs-g0008 | mustHitHosts requires pnpm.io + typescriptlang.org; only pnpm.io (zh variants) landed | host-coverage |
| docs-g0009 | flaky `/tsconfig` | version/alias |
| docs-g0010 | verdict drift: terse query now yields all-off-domain → legitimate abstain | verdict |
| docs-g0011 | `/settings` absent; `/10.x/` + `/zh/` variants | version+locale |

## Mechanism of failure (verified in code)

`urlHit` (`packages/store/test/online/eval-looks-live.online.ts:55`) asserts
**exact `hostname + pathname` equality** after `trimSlash`. `hostHit` (line 46)
is host/subdomain tolerant. Every failing leg is a `mustHitUrls` assertion —
host-level legs kept passing (host-level 12/12 stood through the drift).

## Common-cause determination

**Yes — one dominant cause, and it is NOT a ranking/RRF regression.**

Candidate-table disposition:

| hypothesis | verdict | evidence |
|---|---|---|
| RRF weight regression | **rejected** | no retriever weight change in the drift window; host-level precision unchanged |
| `www`/host normalization bug | **rejected** | `bareHost` already strips `www`; hosts still hit |
| URL normalization missing for locale/version prefixes | **root cause (mechanism)** | `urlHit` is byte-exact path equality; providers now serve `/zh/` (locale), `/10.x/` (version), `/specification/<date>/` (dated) variants for the same logical doc |
| fixture staleness | **root cause (content)** | expected `mustHitUrls` were written when docs served canonical unversioned paths |
| provider outage / ranking drift | **rejected** | same hosts, same count of results, different path shapes |

Decomposition:
- **7 cases (g0001/2/3/4/6/9/11)** — path-shape drift: page exists on the right
  host under a locale/version/dated-qualified path; exact-path assertion misses.
- **g0008** — host-coverage crowding: zh-localized pnpm.io slots displaced
  typescriptlang.org in top-K (localized clustering reduced cross-host diversity).
- **g0010** — semantic verdict drift: provider index shifted such that abstain
  became the *correct* outcome; the fixture's expected answer is stale, not wrong
  code.

## Ruling options before TTL 2026-10-14

1. **promote** (preferred for the 7 path-drift cases): weaken `mustHitUrls` to
   `mustHitHosts` for sites serving locale/version docs, or re-pin expected URLs
   to today's canonical paths with a recheck cadence. Keep ≥2 exact-path entries
   on stable sites so page-level precision stays asserted somewhere.
2. **promote (g0010)**: re-spec expected verdict to `abstain` — the drift is the
   provider's, the new verdict is legitimate.
3. **promote or retire (g0008)**: either relax to single-host coverage + diversity
   note, or keep pending one more review cycle.
4. **longterm** — at most ONE entry may convert (T3 ratchet enforces); reserve
   for a case that is genuinely unfixable, none currently qualifies.

## Verification hooks when re-run

- Re-run `pnpm -C packages/store test:online` with keys; record per-id pass/fail.
- Ratchet (`scripts/quarantine-ratchet.mjs`) enforces: no new ids, no renewals,
  no unruled expiry — ruling edits land in `eval-quarantine.json` `reviews[]`.
