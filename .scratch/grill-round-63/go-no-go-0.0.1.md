# Go/No-Go Adjudication — npm `0.0.1` (Round 63, T8)

Date: 2026-09-15 · Adjudicator: fixer/dev sub-agent · Decision basis: ledger
D-001..D-008, ship-gate full local run, offline eval.

## VERDICT: GO WITH CAVEATS

GO WITH CAVEATS — the third exit per CONTEXT.md: release may proceed with the
carried known-illness items minuted below (each with owner + due + closure
criterion + delegated adjudication authority). All remaining steps are
execution-gated external actions, not defect gates. No release blocker stands.

## Per-decision reconciliation

| D | disposition | evidence |
|---|---|---|
| D-001 三出口过堂 | done — every item landed blocker-fix / carried / post-release | this document + T1–T7 commits |
| D-002 con_add_then_noop | **blocker cleared** — decideOp null-cos branch, θ_jac=0.80 calibrated, embeddingAbsent counted, tests+eval green | nwm (7478628); offline eval 126/126 fp 4a529f6fbe2096c8 |
| D-003 隔离集带病+棘轮 | carried with machine guard — ratchet live in ship-gate step1r; T6 root-cause registered, TTL 2026-10-14 | lzk (0f3159c); ratchet 9-assert test green; real-ledger run 0 errors |
| D-004 rework F-1..F-5 | done — all five landed + 2 sharp cuts; F-5 optional leg included | vwq (36216ff) + zmt (2a8fd3e) |
| D-005 bundled-CLI shape | done — 4 publish manifests, peer-optional embedding, dist bare-require guard, pack anchor verified | ztq (72c8a82); tarball manifests inspected; ship-gate step5 pass |
| D-006 manual first release | mechanism ready; execution = user-authorized below | publishing.md; release-notes/0.0.1.md |
| D-007 serial T1–T8 + Apache-2.0 | done — serial stack r63-grill→t7 in git log; LICENSE landed | `git log` 9-commit chain; LICENSE at root + 4 dirs |
| D-008 closure evidence 4-part | (i) pending landing (see execution ticket); (ii) this document; (iii) pending publish; (iv) n/a on GO | sections below |

## Blocker ledger — cleared

- `con_add_then_noop`: offline eval 126/126, fingerprint unchanged, targeted
  test + degraded-path integration green.
- Shared publish blockers (license / repository / access / manifest shape):
  all asserted inside ship-gate step 5 and green.

## Carried items (known illness, minuted)

| item | owner | due | closure criterion | adjudication authority |
|---|---|---|---|---|
| 10 quarantined live-drift entries | maintainer | 2026-10-14 (TTL) | per-entry promote/retire/longterm ruling in eval-quarantine.json; ratchet enforces | maintainer (delegated; ratchet is the tripwire) |
| page-level mustHitUrl assertions 0/12 active | maintainer | with quarantine rulings | ≥2 exact-URL legs re-asserted on stable hosts (or explicit longterm) | maintainer |
| macOS lanes (exit-time libc++abi + registration-seg red @#1) | CI maintainers | ≥5 consecutive green probes | restore macos-latest to blocking matrix | maintainer |
| abstain exit-code rewrite on Windows teardown | backlog | next round | structured abstain field documented as authoritative (done in README) | maintainer |
| no npm provenance on 0.0.1 | maintainer | 0.0.2 | trusted publishers configured per package; CI OIDC publish | maintainer |
| FTS-only dedup degrade (Jaccard-only) | by design | — | n/a — documented limitation (README) | n/a |

## Verification evidence (this workspace, serial stack HEAD 7461f9a)

- `node scripts/ship-gate.mjs` — **all 9 steps green** incl. quarantine
  ratchet, publish-shape assertions, consumer-real install, peer dual-install,
  T0 smoke, memory eval 126/126 (fp 4a529f6fbe2096c8), MCP init, fail-open boot.
- `node scripts/install-smoke.mjs` — 26/26 (online search leg green with keys).
- `turbo check` 7/7, `turbo build` green, `turbo test` all green (serial).
- `pnpm pack` ×4 — manifests carry zero `@anysearch/*` in dependencies,
  `peerDependenciesMeta.optional:true` on embedding, Apache-2.0, repository,
  `publishConfig.access: "public"`; embedding tarball resolves `dist/index.js`.

## Release execution ticket (GO path — every step needs explicit authorization)

1. Land the serial stack to main (`but land` — user-run) → push.
2. Await main-tip `ci` + `ship-gate` double green; record run URLs.
3. Register/hold `@anysearch` npm scope (already user-owned per D-006 note; verify).
4. Dispatch `release.yml` with `runPurpose=pre-tag`.
5. `git tag v0.0.1` + push tag.
6. Post-tag checks green.
7. User runs `pnpm -r publish` for the 4 publish packages.
8. Within 72h unpublish window: clean-machine `npm i -g @anysearch/cli@0.0.1` (no npm release-age gate exists — exact-version install), `ans doctor`/`search` smoke, FTS-only leg (no
   embedding) confirmed; `npm view` registry manifest check (version,
   dist-tags.latest, access, repository).
9. Publish release notes (docs/release-notes/0.0.1.md).
10. Backfill ADR-0064 Closure Evidence URLs.

## NO-GO contingency (not taken)

Gap list empty at adjudication time. Re-review triggers (event-driven): any
new ship-gate red, ratchet red, or main-tip CI red before publish. Calendar
fallback: re-review 2026-10-15 if publish hasn't executed.
