# ADR-0057: Architecture Grill Round 57 — Test Truthfulness and CI Credibility (node:test migration + expectations governance)

- Status: Accepted
- Date: 2026-09-12
- Round: grill-round-57
- Ledger: .scratch/grill-round-57/decision-ledger.md (D-001..D-007)
- Closes: ADR-0056 AC5 (see "Carried-over Acceptance Criteria Closure")

## Context

Round 56/57 push-closure left AC5 (pnpm -r check/test/build clean + ship-gate, CI green) as PARTIAL due to pre-existing CI breakage. An independent hostile review (.codex-tmp/锐评.txt) then demonstrated that the test execution mechanism itself was untrustworthy:

- store/package.json chained 50+ test files with shell && (1916-char script); first failure aborts all remaining files; eval-switch-state-fixes.test.ts was never on the chain and never executed.
- Per-file hand-rolled `let passed = 0` counters instead of a real test runner; exit-code correctness manual.
- ci.yml/ship-gate.yml ran only `pnpm --filter @anysearch/kernel test` — 59/73 test files never ran in CI.
- domain-loader.test.ts hardcoded "D:/Aworker/anysearch-cli" (3 occurrences) — tests fail on any other machine.
- packages/embedding tests download the model from HuggingFace on first run — red offline.
- README claims .scratch/ is not committed to git while 16 files are tracked (base feat/grill-56 tip).

Per ADR-0029 scope discipline this round does ONLY test truthfulness + CI credibility. The other review findings are explicitly excluded and carried as separate rounds (engine dead config, doctor version, plugin CORS/token, api.anysearch.com ownership, eval governance freeze).

## Decision

### D1. Test execution mechanism: node:test official runner (ledger D-002)

- Every package's `test` script becomes `node --import tsx --test "test/**/*.test.ts" "test/**/*.test.mjs" --test-timeout=30000`. All && chains deleted; file discovery by Node's own quoted-glob expansion (cross-platform, no shell globstar).
- Phase-by-phase: first zero test-code changes (runner judges by process exit code, per official docs); then incrementally rewrite hand-rolled counters to describe/it + node:assert/strict.
- turbo.json test task: `{ "dependsOn": ["^test"], "cache": false }` (conservative first; per-package cache later).
- CI explicitly passes `--test-reporter=spec` (Node 22 non-TTY default is TAP).
- vitest is explicitly rejected: whole Vite dependency tree conflicts with the zero-new-dependency discipline (ADR-0017/0026); its sweet spots (Vite pipeline, component tests, snapshots) do not exist in this project.

### D2. Red-test handling: expectations-inventory model (ledger D-003)

Adopt the industrial known-failure model verified across Chromium TestExpectations / WebKit TestExpectations (lint-enforced bug id) / WPT metadata / Mozilla manifestparser auto-bug-filing / pytest strict_xfail:

- Phase 0 (mechanism-only PR): all packages switch to node:test discovery; all && chains deleted; CI runs `turbo run test --continue=dependencies-successful` (Turbo 2.5 flag: one red package must not block the others from executing — collect the full truth).
- Phase 1 (triage): every red test is fixed / marked `{ todo: '<issue link>' }` (still executes, stays green per node:test semantics, execution evidence retained) / deleted with per-commit justification. Unconditional skip (dead code) is forbidden; silent non-fixing is forbidden.
- Phase 2 (anti-rot ledger): reuse the existing .ship-gate/skip-ledger.json pattern and the ADR-0020 conformance expected-failures precedent. CI guard: every todo/skip must carry an issue link; ledger count only goes down; audited every grill round.
- Node 22 constraint: node:test `expectFailure` (true xfail — flips pass/fail, XPASS goes red) requires Node >= 24.14. This round uses `todo`; a later Node upgrade migrates todo entries to expectFailure.

### D3. Enabling change: resolveDbPath mkdir (ledger D-004; revises D-001 exclusion)

The gap is at apps/mcp/src/server.ts:25 (createEngine(undefined, { dbPath: resolveDbPath() }) without mkdir; apps/cli/src/db.ts:9 has it). One-line fix + regression coverage via apps/mcp/test/server.test.ts Test 4. Rationale: without it, Phase 0's hard criterion (all test files executing in CI) fails red at apps/mcp, and the ci.yml MCP smoke step is already red today. Google Small CLs "Don't Break the Build" / SWE-book ch23 presubmit discipline classify this as an impediment cleared immediately, not backlog.

### D4. Embedding test network sealing (ledger D-005; revises D-001 sub-item c)

embedding.test.ts restructured into two layers: default suite fully stubbed via __setExtractorForTest (role prefixing, normalize/pooling, circuit breaker, telemetry, fail-open — wrapper logic which is what these assertions target); real-model path split into an explicitly gated `test:online` script (node:test native tags + --test-tag-filter; fallback: separate script + env gate — both zero new dependencies). test:online is excluded from default CI (or runs as a separate cached job). Pure-stubbing everything is rejected: cosine/fidelity assertions against a stub are circular and leave the real model with zero coverage — contradicting this round's truthfulness theme. Precedents: SWE-book ch23 hermetic-by-default, pytest-test-categories size tiers, Sopel --offline, vcrpy @pytest.mark.online, Fowler ContractTest.

### D5. AC5 carried-over closure (ledger D-006)

See "Carried-over Acceptance Criteria Closure" below.

### R1. doc-reality drift cleanup (ledger D-001)

README states .scratch/ is not committed; 16 files are tracked at the base tip. Align reality with the doc (untrack + hygiene commit). Rework (audit F-1/F-2): the first hygiene commit removed only 8 of the 16; the residual 8 were untracked in a follow-up commit (rpz), leaving git ls-files .scratch empty.

### E1. Incidental fix: pnpm pack --pack-destination resolves against the invocation cwd (ledger D-002/D-003; audit F-5)

Discovered while making the CI test job trustworthy. `pnpm --filter X pack --pack-destination ../../artifacts` was intended to land tarballs in `<repo>/artifacts`, but a relative `--pack-destination` is resolved against the **invocation** cwd (the workspace root), not the package directory, so the tarballs landed in `D:/artifacts/` outside the workspace. `actions/upload-artifact@v4` uses `path: artifacts/*.tgz` with `if-no-files-found: error`, so the CI pack step would fail on both OSes. Fix: `--pack-destination artifacts` (commit `cb2518a0510eec52f32bf24e7e31f61ffa4caba3`). Decisive probe: `--pack-destination zz-probe-out` run from the repo root produced `zz-probe-out/` at the repo root and nothing under `apps/mcp/`. A CI-credibility defect, in scope for this round; not an out-of-scope review cut.

### E2. Incidental fix: ship-gate step 5 dist assertion made conditional on the manifest (ledger D-002; audit F-5)

The gate asserted `dist/` exists in **every** tarball. Four of seven packages (kernel / retriever / store / embedding) are source-only: `exports: "./src/index.ts"`, no build script, no files/bin. Their tarballs legitimately contain no `dist/`, so the unconditional assertion made the gate unsatisfiable for 4/7 packages (`[fail] anysearch-embedding-0.1.0-rc.0.tgz: dist/ missing in tarball`). Fix: assert `dist/` only when the manifest (`files`/`main`/`module`/`bin`/`exports`) declares a dist entry, mirroring the existing no-bin branch in the same function (commit `b694a0bd47a536aed94c4e1f2ac00357b9b65d63`). Pre-existing defect, unrelated to the runner migration. Both fixes are recorded here per ADR-0029 (undocumented incidental edits are the anti-pattern).
## Carried-over Acceptance Criteria Closure

Closes ADR-0056 AC5: `pnpm -r check/test/build` clean + ship-gate passes (CI green). Evidence to be attached at merge: CI run link (turbo test, ubuntu+windows), ship-gate log, 81-file (73 .test.ts + 8 .test.mjs) execution record. ADR-0056 receives a single status-pointer line "AC5: CLOSED by ADR-0057 (2026-09-12)" and its body stays unmodified (Nygard / AWS / MS / MADR / KEP / GEP bidirectional-pointer convention, atomic same PR). deferred-registry gains one AC5 entry marked closed-by: ADR-0057.


**Atomicity of the three legs (audit P2 / rework F-4).** The legs do not sit in one commit: the ADR-0057 document and the ADR-0056 pointer line were introduced by `a76598d90361717e197387cf103509d48061dd4e` (tip of `feat/grill-56-session-id-propagation`), while the deferred-registry entry lives in `027226dcffc071a0c0917797ff581d317d195527` (on `fix/grill-57-test-truthfulness`).

Adjudication, stated precisely rather than absolutely. The GitButler reference documents that `but pr` creates reviews against the right bases and updates stack footers in PR descriptions, and that `but pr new <top-branch>` publishes the whole stack. In the GitHub stacked-PR model the merge granularity is fixed at "a bottom-up contiguous prefix, or the whole stack": a mid-stack PR cannot be merged in isolation, and merging the top PR lands the entire stack as a single atomic operation. Therefore the three legs are **co-scheduled and ordering-bound** — the registry entry can never land without the ADR document below it — but they are **NOT transactional**. A contiguous-prefix landing is an explicit, documented platform outcome: merging `feat/grill-56` alone would land the ADR document and the ADR-0056 pointer while leaving the registry entry unlanded, i.e. the two legs that assert closure without the record.

Mitigation, recorded as an operational constraint for the PR: create the series with `but pr new <top-branch>` so the bases chain and the stack footers are written, and **merge from the top** so that one action lands all layers; never merge `feat/grill-56` alone. Residual risk accepted and disclosed: stacked PRs were in public preview at the time of writing, with documented mid-merge-failure and stale-base defects (github/gh-stack#485), so a partial landing remains possible on failure. Industrial precedent for the mechanism: GitHub stacked PRs with stack-aware merge queues (Graphite / Aviator / Trunk / Mergify); Gerrit `submitWholeTopic` + `Submitted Together` for a topic-level unit guarantee.
## Acceptance Criteria (ledger D-007)

1. Mechanism: the node:test glob discovers 81 test files (73 .test.ts + 8 store .test.mjs); all execute in CI on ubuntu+windows; the chain-based membership-exclusion mechanism is structurally gone. (D-002)
2. Zero unregistered red: every red test is fixed / todo-with-issue / deleted-with-justification; no silent skip. (D-003)
3. Green CI: ci.yml and ship-gate.yml both green via `turbo run test --continue=dependencies-successful`. (D-002/D-003)
4. Network sealing: embedding default suite fully stubbed; test:online explicitly gated; `turbo test` green offline. (D-005)
5. Enabling fix: apps/mcp resolveDbPath mkdir + regression test. (D-004)
6. AC5 closure: this ADR declares Closes ADR-0056 AC5; ADR-0056 pointer line; deferred-registry entry; atomic same PR. (D-006)
7. Drift cleanup: .scratch/ tracking matches README. (D-001)

## Explicitly out of scope (each its own round)

- engine dead config (AbortController without .abort(), graceWindow, deepMode) — review cut 2
- doctor printing v0.0.0 — cut 3
- plugin server default no-token + CORS * — cut 4
- api.anysearch.com ownership — cut 5
- eval governance layer (6562 LoC) freeze — cut 6

## Rejected

- vitest (D-002): dependency tree unjustified here.
- Keep hand-rolled scripts, only fix chains (D-002): no discovery/report/timeout/parallelism gains.
- Strategy A/C for red tests (D-003): fix-everything-now balloons the round; stage-by-package preserves silent exclusion.
- Pure-stub embedding suite (D-005): circular assertions, zero real-model coverage.
- Round-scope splash A: mixing a + b + c across three subsystems violates one-logical-change (Google Small CLs; ACM ESEC/FSE 2018: size is the top reviewability factor).

## Consequences

Positive: CI becomes a real witness on both OSes; every future test file is auto-discovered; red debt is visible and attributable; AC5 historical wound closes with a traceable link.
Costs/risks: store file-level parallelism may need --test-concurrency=1 (shared sqlite temp dirs) — measure at rollout; Node 22 test-tags may be experimental — fallback is a separate test:online script; hand-written counter rewrite is incremental, not a gate.

## Amendment — closure-window fixes and audit rework (2026-09-12)

Per ADR-0029 (undocumented incidental edits are the anti-pattern) this section records what changed after the ADR was first written, so the record matches the landed configuration. The merge landed as `731818417f424a6230ddca270c70bbf95a8a3af6` on `main`.

### A1. Test task now depends on build (F-11)

D1 recorded `test = { "dependsOn": ["^test"], "cache": false }`. The landed configuration is `{ "dependsOn": ["^test", "build"], "cache": false }`. Rationale: the `@anysearch/cli` e2e test spawns `apps/cli/dist/index.js`, so `turbo run test` on a clean tree failed 10 of 11 e2e cases. Making the dependency explicit fixes it at the task-graph level instead of by reordering CI steps. **Supersedes D1 on this point only.**

### A2. ship-gate no longer hardcodes `pnpm.cmd` (F-12)

`scripts/ship-gate.mjs` used `const PNPM = process.platform === "win32" ? "pnpm.cmd" : "pnpm"`. The standalone pnpm that `pnpm/setup@v2` installs on CI ships `pnpm.exe` (no `pnpm.cmd`), so ship-gate step 3 died on Windows with `'pnpm.cmd' is not recognized as an internal or external command`. Now `const PNPM = "pnpm"`; cmd resolves either via PATHEXT.

### A3. `ci.yml` step name quoted (F-10)

The `ci.yml` step `name:` contained an unquoted `: ` (`ADR-0057 D1/D2: node:test …`), which made the workflow file invalid YAML. GitHub Actions rejected it outright — a 0-job run titled *"This run likely failed because of a workflow file issue"* — so **`ci.yml` never executed** from the commit that introduced the change until the quoting fix. Zero semantic change.

### A4. plugin server-liveness test (F-14 / audit N-1)

`apps/plugin/test/plugin.test.ts` started the plugin server via `spawn("npx", ["tsx", …], { stdio: ["pipe","pipe","pipe"] })` and killed only the direct child. The `tsx`->`node` grandchild survived holding the stdio pipes, so the test process could never exit and `turbo run test` hung on Linux (>41 min on ubuntu CI). Now: `spawn(process.execPath, ["--import","tsx", …])`, `stdio[0] = "ignore"`, POSIX process group (`detached`) + `process.kill(-pid,"SIGKILL")`, Windows `taskkill /T /F`, and an `await` for the tree to exit. The closure audit then found the test was still load-sensitive (fixed port 33334 + fixed 2000 ms wait + a single `fetch` with no retry) — N-1 — so it now asks the OS for a free port and polls `/health` for readiness with a 30 s deadline.

### A5. Tautological assertion in the session-id migration test (audit N-2)

`packages/store/test/session-id-propagation.test.ts` compared `descB.indexes` with itself (always true). `descA` (fresh store) is now hoisted so the assertion actually compares migrated vs fresh indexes; it passes, so the migration genuinely converges.

### A6. Honest status of the carried-over AC5 closure (audit Spec #1)

The “Carried-over Acceptance Criteria Closure” section above states `Closes ADR-0056 AC5: pnpm -r check/test/build clean + ship-gate passes (CI green)`. As landed, `ci.yml` is green on ubuntu + windows and `native-smoke` is green, but **`ship-gate` is red on all three platforms**:

- **F-15** — the per-fingerprint OF look ledger `.ship-gate/eval-looks.json` is gitignored (`.gitignore:25-26`), so a fresh CI checkout always evaluates at `look=1`, where the preregistered alpha is ~5.4e-7 and `passAtLook` is false → `integrity.verdict=failed`. `ship-gate` is therefore **structurally un-passable on any fresh CI checkout** until the eval governance layer is addressed (this round’s cut 6).
- **F-16** — pre-existing better-sqlite3 exit-time crash on macOS (`libc++abi: … mutex lock failed`), present on every `ship-gate` macOS run to date.
- **F-17** — the memory-eval harness is environment-dependent: 126/128 on CI vs 128/128 locally (`mrr` 0.524 vs 0.548).

**AC5 is therefore only partially satisfied.** The residual is carried by round-58 tickets T-1..T-3 and is *not* claimed closed here.
