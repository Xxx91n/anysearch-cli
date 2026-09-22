# R71 T2 — 0.0.6 real release through the dual-layer gate

Date: 2026-09-19. First real guest through the R68 dual-layer release gate.

## Flow executed

1. Version bump: 7 workspace pkgs + root 0.0.5/0.0.3 → 0.0.6; ship-gate pin
   `!== "0.0.5"` → `!== "0.0.6"` in the same commit (F-01 discipline); CHANGELOG
   0.0.6 entry (R68–R71 delta). Commit `wno` → integrated to main as `d897707a`.
2. Pre-tag dispatch #1 `runPurpose=pre-tag` — run
   https://github.com/Xxx91n/anysearch-cli/actions/runs/35385345425 — **RED**:
   burned look 4 (ledger commit `114da320`), then the layer-1 wait failed at
   discovery — "The requested check was never run against this ref",
   `check-runs total_count=0` on the ledger sha. Root cause: the ledger push
   uses the job's GITHUB_TOKEN, which GitHub never cascade-triggers; zero
   check-runs is structural, not transient.
3. Repair: release-gate self-dispatches `ci`+`ship-gate` on temp ref
   `release-gate-ledger` pinned at the ledger sha (`actions: write` added);
   cleanup deletes the ref after the wait. Commit `nlk` → main `86fe753d`.
4. Pre-tag dispatch #2 — run
   https://github.com/Xxx91n/anysearch-cli/actions/runs/35386495456 — **GREEN**
   (7m25s): look 5 burned (ledger commit `6c289397`), self-dispatch produced 9
   real check-runs on the ledger sha (check-build×2, install-smoke×2,
   test:online, ship-gate×2, memory-eval=success-skipped, +
   macos-spillover-probe=expected-failure EXPERIMENT non-blocking outside the
   regexp); layer-1 wait green; temp ref cleaned.
5. `git tag v0.0.6 6c289397` + push — post-tag run
   https://github.com/Xxx91n/anysearch-cli/actions/runs/35387286412 —
   **GREEN**: `post-tag verdict unexpired (look 5, TTL pass, no look spent)`;
   `assert-checks GREEN: all 8 ci/ship-gate checks terminal+allowed on
   6c289397`; publish job → `+ @anysearch-cli/{embedding,cli,mcp,plugin}@0.0.6`
   with sigstore provenance (transparency log e.g. logIndex=2887641864).

## Post-release verification

- `npm view @anysearch-cli/{cli,mcp,plugin,embedding} version` → **0.0.6 ×4**
  (after ~4min registry propagation; `+ pkg@0.0.6` confirmations in publish log).
- `npm i -g --prefix $TMP/r71-verify006 @anysearch-cli/cli@0.0.6 <!-- machine-local: POSIX env-var 路径引用（存量合规化） @ 2026-09-22 -->
  @anysearch-cli/embedding@0.0.6` → `added 220 packages`, exit 0, **zero
  EBADDEVENGINES** (devEngines removal verified on the real artifact).
- Registry tarball LICENSE: `npm pack @anysearch-cli/cli@0.0.6` →
  `package/LICENSE` = canonical "Apache License Version 2.0, January 2004"
  (Apache ×4 matches).
- Installed binary: `ans --version` → `0.0.6`; `ans doctor` →
  `[OK] vector arm (present embeds=0 failures=0)` — vector arm activates on
  the published artifact under npm.

## OF look ledger

`eval-looks.json` looks tail: look 3 (v0.0.5 era, warn/pass), look 4
(`114da320`, pre-tag attempt #1, warn+integrity pass), look 5 (`6c289397`,
pre-tag attempt #2 after gate repair, warn+integrity pass). Two real spends —
both recorded, neither replayed.
