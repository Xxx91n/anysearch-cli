# Round 57 Fixer Handoff — Test Truthfulness & CI Credibility

Ledger of record: .scratch/grill-round-57/decision-ledger.md (D-001..D-007). ADR: docs/adr/0057. This handoff is the fixer agent's standing charter; implement in order, commit via GitButler on a dedicated branch parallel to main.

## suggested skills
- ponytail (full mode; no hallucinated completions)
- tdd (regression test for D3 before/with the fix)
- but / gitbutler (all version control)
- sqlite-utils not needed; no new dependencies at all

## Tasks

### T1 (D-002) Runner migration — every package
- packages/{store,kernel,retriever,embedding} and apps/{cli,mcp,plugin}: replace test script with `node --import tsx --test "test/**/*.test.ts" "test/**/*.test.mjs" --test-timeout=30000`. Delete all `&&` chains. Do NOT rewrite hand-rolled counters in this task.
- Verify: each package `pnpm test` lists all on-disk test files (store must execute 53, including eval-switch-state-fixes.test.ts).

### T2 (D-002) turbo.json
- `"test": { "dependsOn": ["^test"], "cache": false }`.

### T3 (D-002/D-003) CI
- ci.yml + ship-gate.yml: replace `pnpm --filter @anysearch/kernel test` with `pnpm -w turbo run test --continue=dependencies-successful`; add `--test-reporter=spec` where applicable. Keep ubuntu+windows matrix, fail-fast:false.

### T4 (D-004) Enabling fix
- apps/mcp/src/server.ts:25 region: mkdir recursive for resolveDbPath parent (mirror apps/cli/src/db.ts:9 behavior). Add/extend regression in apps/mcp/test/server.test.ts Test 4 proving boot works with a cold HOME (no ~/.anysearch).

### T5 (D-002) Hardcoded paths
- domain-loader.test.ts L140/150/163: replace "D:/Aworker/anysearch-cli" with a repo-root derivation (import.meta or process.cwd()-relative fixture). Grep repo-wide for any other D:/Aworker occurrence in tests; none may remain.

### T6 (D-003) Red-test triage
- Run full suite on both OSes. Every red test: fix if cheap; else `{ todo: '<issue reference>' }` (file per-package issue files under .scratch/grill-round-57/issues/); delete only if provably superseded, one deletion per commit with justification. No unconditional skip.

### T7 (D-005) Embedding sealing
- Default suite: all 5 tests stubbed via __setExtractorForTest.
- Real-model path: gate behind `test:online` (node:test tags --test-tag-filter if available on Node 22; else separate script + env gate). Default CI must pass with network disabled. Verify: disconnect-network run of `turbo test` is green.

### T8 (D-001) Drift cleanup
- Untrack the 6 committed .scratch/ files (README already says not committed). Single hygiene commit.

### T9 (D-006) AC5 closure on merge
- Confirm ADR-0057 contains the Closure section, ADR-0056 has the pointer line, deferred-registry gains the closed-by entry — all in the same PR.

## Acceptance (D-007)
73/73 executed in CI (both OSes); zero unregistered red; ci.yml & ship-gate.yml green; offline turbo test green; T4 regression green; .scratch/ tracking consistent; ADR links atomic. Out of scope: review cuts 2–6 (engine dead config, doctor version, CORS/token, api.anysearch.com ownership, eval freeze) — do not touch.
