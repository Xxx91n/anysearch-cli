# Changelog

All notable changes to this project are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow
[SemVer](https://semver.org/).

## 2026-09-14 — ADR-0061 r60: 装到用链路 CI（T2/B2）

### Added

- `scripts/install-smoke.mjs`：真实安装到用链路——pack 全部 7 个 workspace 包 → npm 干净前缀安装 → 安装物 `ans` bin 走 --version/doctor/domain docs/doctor/search。online 有 key 时硬断言 ≥1 结果且命中 docs allowlist 主机；无 key 断言文档化离线行为（exit 1 / Results: 0），不造假覆盖。
- `.github/workflows/ci.yml` `install-smoke` job（ubuntu+windows 矩阵）：build 后跑 install-smoke；EXA/TAVILY key 走 secrets，缺失即离线断言路径。

## 2026-09-14 — ADR-0061 r60: docs 域 walking skeleton（T1/B1）

### Added

- `domains/docs.toml`：首个垂直域（技术文档检索）。语料一手 allowlist：modelcontextprotocol.io / typescriptlang.org / pnpm.io（D-004 首批实例化）。
- `eval-looks.json` 顶层 `golden` 集合（schema `anysearch/docs-golden@1`）：首批 11 条全真源提问（8 internal-dogfood + 3 external-community），逐条 provenance 可回访；OF 账本 looks[] 语义不变，读写路径保透传（looks-ledger.ts / eval cli calibrate）。
- `eval-looks.coverage.json`（schema `anysearch/eval-looks-coverage@1`）：八维切片 manifest，covered×7 + deferred×1（injection，entryTrigger 挂 B4）。
- `packages/store/src/eval/docs-golden.ts`：条目 schema + 八维词汇 + manifest/交叉校验器。
- `loadDomainByNameIn` + `defaultDomainsDirs`（domain-loader.ts）：多目录解析链；`createEngine` 新增 `opts.domainsDirs`；`domainTomlPath` 增可选附加目录。
- `apps/cli/src/config-env.ts`：config.env 共享读写 + 入口 rehydrate（`ans domain` 持久化从此对全命令生效，显式 env/空串不被覆盖）。
- `apps/cli/src/db.ts` `domainSearchDirs()`：ANS_DOMAINS_DIR → cwd/domains → 包内建 domains → 仓根 domains 的解析链。
- `ans doctor` 新增 `[5] Domains` 段：解析链逐目录发现 + 逐 TOML 校验 + 活动域五下游层（sources/skills/hooks/prompts/rag）可见。
- @anysearch/cli 打包 domains/（files + build 期 sync-domains.mjs 从仓根同步）；测试：eval-docs-golden.test.ts（27 断言）、domain-loader.test.ts 链路用例、e2e doctor [5] 断言。

### Fixed

- 安装后 `ans` 因 shebang `#!/usr/bin/env tsx` 无法启动（tsx 非运行依赖）——walking skeleton 首次实装暴露；改 `#!/usr/bin/env node`。

## 2026-09-02 — ADR-0043 r42: consumed/synthetic switch governance implemented

### Added

- Switch state machine S0-S4 (ADR-0043 D2-D6): pre-registered readiness trigger (C1-C4 wall-clock, k_max=10), SESOI-band reconcile + McNemar diagnostic (packages/store/src/eval/switch-machine.ts, pure core), graded rollback with Inconclusive hold (promote streak 3 > rollback streak 2 hysteresis), integrity lineage fail-closed, evidence-driven reversible freeze.
- Pre-registered thresholds as data (version + hash): packages/store/fixtures/switch-registration.json; every verdict records registrationHash.
- skip-ledger schema @3: state block (phase, since, transitionId, evidenceHash) + actions log (actions never touch the 3-streak); lossless @1/@2 upcast; unknown versions fail loud.
- access_events chain switch events (stage-transition/rollback/freeze) with sentinel-row FK and chain-first ledger write order; ledger rebuild from chain fallback.
- ans switch-state [--verify] [--db PATH] [--out DIR] read-only query.
- ship-gate step 7 reports the current switch phase (exit semantics unchanged).

### Fixed

- bgnbd/obs-fixtures/switch-run no longer evaluate fileURLToPath(import.meta.url) at module init — the CJS CLI bundle crashed every ans command at boot once @anysearch/store re-exported switch modules.
## [Unreleased]

### Added

- ADR-0059 D2 (T-1 / F-15, round 58): eval-grade layering. The merge gate (ship-gate step 7) now
  runs observational and never spends a preregistered OF look (ANS_EVAL_NO_LOOK=1); decision grade
  moved to a new `release` workflow (pre-tag dispatch = the only OF peek; post-tag asserts the
  recorded verdict is unexpired and spends nothing). The OF look ledger moved from the local
  `.ship-gate/eval-looks.json` to the git-committed repo-root `eval-looks.json`
  (`anysearch/eval-looks@2`, append-only with a 50-row compaction cap and a preserved
  pre-compaction SHA-256); a look is written only when ANS_EVAL_LOOKS_WRITE=1, so CI and local runs
  leave the tracked file untouched. ship-gate.yml Node 24 -> 22 to match ci.yml.
- ADR-0027 D8 / ADR-0059 D3 (T-2 / F-17, round 58): flaky-case quarantine ledger. A case that is
  environment-flaky is quarantined by POLICY MARK (`packages/store/eval-quarantine.json`,
  `anysearch/eval-quarantine@1`) — the golden set and the dataset fingerprint are untouched, so
  zero recalibration cost. The gate excludes ACTIVE quarantined cases from the passRate==1 hard
  assertion while disclosing them; 30-day TTL, weekly review, max 2 renewals, promote/retire
  paths. The eval CLI now names the failing cases on gate failure so a CI log identifies an
  environment flake without needing the report artifact.
- ADR-0059 D6 (T-5, round 58): the README ADR index is now a generated artifact.
  `scripts/gen-adr-index.mjs` (Node stdlib) owns the `BEGIN/END ADR-INDEX` block derived from
  `docs/adr/*.md`, and ship-gate step 1b runs it in `--check` mode (regenerate-and-diff) so the
  index can never silently lag again. The one-time catch-up replaces the stale "ADR-0001 through
  ADR-0046" claim with the real 0001-0059 range and the full 59-row index.
- ADR-0059 D7 (T-6, round 58): four hostile-review cuts.
  (1) engine dead config fixed BY DOCUMENTATION: CONTEXT.md no longer claims an implemented
  grace window, ADR-0005 gains an append-only r58 errata, and ship-gate step 1c asserts the honest
  engine debt note survives (ADR-0014). (2) `ans doctor` now prints the real version via the
  `__PACKAGE_VERSION__` tsup define instead of a runtime package.json read that resolved to the
  repo root after bundling. (3) plugin server trust boundary (highest priority): loopback Host
  whitelist, Origin check (no Origin = native client), auto-generated 256-bit token when
  ANS_SERVER_TOKEN is unset (persisted 0600 for the hooks), crypto.timingSafeEqual, 1MB body cap,
  and 403-before-401 ordering; wildcard CORS removed. (4) api.anysearch.com ownership deferred
  WITH deadline: named owner + quarterly review + CT/expiry monitoring in docs/deferred-registry.json
  and an annotation block in anysearch.ts.

### Removed

- due-chore (ADR-0029 channel, round 59): dropped the `t6-hostile-cuts.test.mjs` text-position assertion that `403` precedes `401` - it pinned source ordering, not behaviour; the behaviour is asserted end-to-end in `apps/plugin/test/plugin-security.test.mjs` (non-loopback Origin without token -> 403 before 401).
- due-chore (ADR-0029 channel, round 59): `apps/plugin/src/hooks/preheat.ts` comment no longer says the policy cache guards against a *tampered* drop-in (downgraded to a *damaged* drop-in - the sha256 self-check is a damage detector, not an adversary defence), and `canonicalVersion()` now names the store implementation as authoritative.
- ADR-0057 D-001/R1 (round 57): `.scratch/` is no longer tracked. The local-markdown
  issue tracker and round artifacts were tracked as 16 files while README.md:64 documents
  them as not committed to git; all 16 are now untracked (disk copies kept; `.gitignore`
  gained `.scratch/`). Commits `ykm` (first 8) + `rpz` (remaining 8, audit F-1).

### Fixed
- ADR-0042 r110 audit repair round (dual-axis review of the r109 implementation; all
  findings fixed in one round — SP-F-01..03 + SA-F-01..09):
  - SP-F-01/SA-F-05 (severe): the consumed track's AND-gate input was hardcoded zeros, fully
    disconnected from access_events, and the data-absent classifier only fired when NO events
    existed at all — so a healthy eval always logged gate-not-met and the 3-streak fired
    spuriously (ship-gate exit 1). Now the runner aggregates real unit-level stats
    (events/units/fittableUnits/access-time span) and D4 "structural data absence" covers
    "events exist but nothing is fit-eligible" — both empty-library and populated-but-
    immature forms record reasonCode=data-absent and never build the streak.
  - SA-F-01: non-finite PSI is fail-closed at the AND-gate (NaN can no longer slip past
    the >= comparison).
  - SA-F-02: skip-key identity excludes volatile numerics (normalized to '#') — the 3-streak
    now matches on WHICH gate clauses failed, so identical conditions across runs actually
    reach escalation.
  - SA-F-03: unknown/corrupt skip-ledgers are never silently cleared; reading fails loud
    (SkipLedgerError) and the eval CLI quarantines the file aside then restarts empty with a
    stderr notice.
  - SA-F-04: fixture definitionHash now pins generatorVersion + per-file SHA-256s (generator
    bumped to v2) — a generator-contract change flips the fingerprint (declared flip
    5be13f8abcfab1f9 -> re-baselined via --calibrate).
  - SA-F-05: the observational zone carries an explicit dataAbsent boolean; the report zone
    no longer presents structural absence as an unexplained gate-not-met.
  - SA-F-06: fixtureDefinitionHash is recorded in the observational zone (and thus in
    eval-baseline.json on calibration) — fingerprint flips are auditable from the artifact.
  - SA-F-07: tau-python.yml regenera guard triggers on day-buckets.ts, and the fixture loader
    hard-rejects a baselineHistogram whose keys drift from AGE_BUCKETS.
  - SA-F-08: skip-ledger writes are atomic (tmp + rename), so a concurrent/crashed eval
    cannot leave a half-written ledger.
  - SA-F-09: @2 entry-level validation (tier/track enums; green rows MUST omit reasonCode,
    warn/data-absent rows MUST carry one); @1 upcasts keep green rows reason-free.
  - SP-F-02/03 (nits): runtime SHA-256-vs-MANIFEST check now documented as an anti-miswire
    guard only (CI regenerate-and-diff is the tamper anchor); a missing MANIFEST yields the
    explicit "no-fixtures" marker in the report + a stderr warning instead of a silent
    fingerprint drift.
- r39 deferred items F-07 (staircase automation tests) and F-09 (report subject digest)
  remain deferred (tracked, r110 does not own them).

### Added
- ADR-0042 observational data feeding (r109 implementation): dual-track loader
  (consumed=real access_events preferred; synthetic=hash-pinned fixture fallback via
  `ANS_OBS_FIXTURE`, track marker enforced in-load so synthetic rows can never pose as
  consumed data) + pure-stdlib offline generator `scripts/tau/generate_fixtures.py`
  (mulberry32, byte-deterministic, --check exits 2 on drift) producing the four-fixture
  falsification matrix (`packages/store/fixtures/obs-feed/`: pass-stable / t1-fail 299 rows /
  t2-fail PSI>=0.25 / t3-fail 89d window) with SHA-256 MANIFEST + definition hash pinned in the
  eval baseline fingerprint — the initial flip 113be271869dbc54 -> re-baselined is the
  declared one-time ADR-0042 D6 fingerprint flip (definitionHash `f5c6c438f3696995` joined).
  skip-ledger schema @1 -> @2 (track + reason-code split; data-absent never builds the
  3-streak and resets an in-flight gate-not-met run; @1 ledgers upcast losslessly on read,
  closing r106 F-08; scripts/gain-ledger.mjs resolve tool accepts @2). Synthetic runs are
  labelled simulated-observation-window in the report. CI: regenerate-and-diff guard step in
  tau-python.yml. New test surface: obs-fixtures.test.ts (24 asserts, gate-ok -> ready-to-spawn
  via node stub) + eval-skip.test.ts ledger-semantics block.
- ADR-0040 access_events tamper-evidence layer (r102/r103 implementation): `prev_hash`
  SHA-256 hash chain (six-field canonical contract: fixed key order = RFC 8785 lexicographic for
  the closed ASCII scalar schema, NULL = JSON null, INTEGER/TEXT/NULL whitelist) + single-row
  `access_chain_anchor` sealing legacy history as a one-off digest snapshot (lazy IMMEDIATE
  constructor bootstrap, one defensive BUSY retry, busy/IO degrade = stderr WARN + telemetry bit)
  + independent zero-shared-code verifier `scripts/verify-access-events.mjs` (fork detection,
  legacy digest recompute, unknown schema_version = explicit error, exit 0/1/2) wired fail-closed
  into ship-gate step 1 (no-db -> explicit skip + `access-chain-skip-ledger.json`, 3-streak
  escalation) + alert-on-silence `eventWriteFailures` counter joined into the eval observational
  zone + `ans access-chain bootstrap [--dry-run default | --apply]`. Six zero-dependency test
  files (golden vectors 3+2 pinned, 4 tamper classes + seeded legacy, no-db exit 2, real-spawn
  dual-process concurrent bootstrap, telemetry/idempotency/legacy byte-stability, 100k-row perf
  smoke report-only + schema fwd/back + whitelist negatives). No dataset fingerprint flip —
  the chain never touches golden cases; baseline fp 113be271869dbc54 verified unchanged (ADR-0027 D9
  flip rule evaluated, not triggered).
- ADR-0039 tau observation layer (r100 implementation round): access_events append-only log
  joined into eval per-case observation; pre-registered day buckets (0-1/2-7/8-30/31-90/91+,
  [min,next-min) semantics + dayBucketFingerprint) folded into datasetFingerprint so any bucket
  change forces a recalibration; synthetic tau-scan (seeded mulberry32, kendall@2, shipped as
  node scripts/tau/tau-scan.mjs); BG/NBD out-of-process fit via scripts/tau/bgnbd_fit.py on the
  frozen lifetimes stack (numpy==1.26.4, autograd==1.7.0 pin below numpy 2 — see ADR-0039 r100
  amendment) reached through a hardened spawn wrapper (timeout SIGKILL, non-JSON/non-converged
  all map to explicit-skip); three-tier explicit-skip (gate-not-met / offline-deferred /
  infra-failure) with TAU_FIT_GATE T1+T2+T3 and a skip ledger (anysearch/gain-ledger@1 shape,
  resolve via gain-warn-resolve.mjs); eval report observational zone is a ship-gate contract.
  ADR-0038 r99 text errata physically applied (D2 full-sample rule failure is WARN not red;
  D6 single WARN ships with a ledger entry, three consecutive escalate).
- ADR-0038: relation-arm gain gate promoted to a three-tier GREEN/WARN/RED verdict — RED only on
  proven-negative evidence (BCa upper < 0 or harm-side sign-flip p below the look budget); unproven-
  positive is WARN, never RED. Dual-track holdout: 40-case frozen baseline slice (19 RoR pairs) with
  a second fingerprint plus a backflow slice family (inputHash dedup vs baseline, cross-slice,
  payload provenance). Preregistered Lan-DeMets OF alpha spending (0.025 per track, k_max=5,
  convergence clause past k_max) with a per-fingerprint look ledger (.ship-gate/eval-looks.json).
  ship-gate enforces the tier: RED hard-fails, GREEN passes, WARN is released but three consecutive
  WARNs force `node scripts/gain-warn-resolve.mjs`. Graded relevance labels (0-3) on 39 cases feed
  report-only nDCG@5/10/20 plus a dual-review record (relevance-review.json, kappa/AC1 = 1.0 on 610
  label pairs) as the judge-calibration baseline row.

- ADR-0037: `ans consolidate` and `ans memory forget --undo` CLI; durable maintenance DB
  via ANS_DB_PATH (default ~/.anysearch/anysearch.db); semantic_memories sixth RRF arm
  (serve, weight 0.5, conditional activation, fail-closed regression gate); three-protocol
  LLM endpoint config (ANS_LLM_BASE_URL + ANS_LLM_API=chat|messages|responses + ANS_LLM_API_KEY).

### Removed
- kernel llm-init residual env fallback (OPENAI_/ANTHROPIC_/GOOGLE_API_KEY): the kernel no longer
  reads provider env (ADR-0038 step 7); provider auth stays entirely inside pi-ai. r94-deferred
  hygiene, ships as its own refactor commit.

### Fixed
- r94 audit (ADR-0037, atomcode Spec-1): single-query searchMemory resolved the semantic arm
  through a byId map that was never populated with semantic hits — sixth arm silently dropped
  on that path (MCP recall_memory consumer). Fixed + regression test.
- r94 audit (ADR-0037, atomcode S1): kernel llm-init read ANS_LLM_API_KEY from the environment,
  violating its own "No env reads in kernel" contract; callers pass the key explicitly now.
- r94 audit (ADR-0037): applyArchive explicit-ids path now enforces pinned / closed /
  quarantined exclusions at the force point; LLM summarize moved out of the BEGIN IMMEDIATE
  write lock (plan/apply split; dry-run exact prediction unchanged); `ans consolidate`
  rejects unknown flags (exit 2).

## [0.1.0-rc.0] — 2026-08-22

### Fixed
- r90 audit (ADR-0036): D5 RoR delta sign convention corrected in ADR-0036 and CONTEXT.md
  (positive = relation arm pushed the memory earlier; sign was documented inverted while
  code/tests/baseline all used positive=helps — regression trap removed).
- r90 audit (ADR-0036 D6): backfill retry counter snapshot now also covers
  `relatedToWriteOnce` so a failed batch retry no longer double-counts that telemetry bit;
  busy-injection test now holds the foreign lock past busy_timeout (5200ms) so the
  exponential-backoff branch actually executes (a 150ms hold was absorbed by busy_timeout).

### Added
- ADR-0020 ship-gate pipeline: `scripts/ship-gate.mjs` (Node stdlib, single file)
  as the blocking Product Smoke Gate, plus a non-blocking
  `modelcontextprotocol/conformance` workflow as the Protocol Heartbeat.


### Added
- ADR-0030: fused freshness factor [0.3, 1.5] in store ranking — creation-age decay,
  `last_accessed` recency, and `access_count` frequency fused into ONE multiplicative band
  (`freshness_factor()` UDF replaces `time_decay()`). `access_count` column added via
  idempotent migration; every returned recall hit increments it exactly once, on both
  `searchMemory` and `searchMemoryMulti` paths.
- ADR-0030 D5: kernel `memory-pipeline.ts` now imports `isTimeSensitive`/`isEvergreen`
  from `@anysearch/store` (inline regex copy deleted; the QDF regex itself no longer
  carries year literals).

### Removed
- ADR-0029 D6: dropped `--write-baseline` from `packages/store eval` (the one-round alias for `--calibrate`).
- ADR-0030 D2: retired the `w` interpolation weight (0.25/0.4) and the
  `1 - w·(1-decay)` fusion form. Ranking is a direct multiplicative scaling band now.

### Infrastructure
- 16 prior ADRs landed across rounds 1–17 (MCP Phase2, Kernel Engine
  composition, dual-era SDK v1+v2 bridge, TypeBox source-of-truth, plugin
  hooks layer, SessionStart routing, L0/L1 memory pipeline).

### Added
- ADR-0035 KG-lite relation arm (fifth RRF arm, weight 0.5): closed 8-predicate table
  (`works_on/depends_on/uses/part_of/member_of/located_at/authored_by/related_to`) with EN+CN alias map,
  rule-first extraction (verb frames + url<->handle bridge + 2-preKnown co-occurrence), single-call
  LLM seam behind a strict post-filter (JSON degrade parse, never blocks the write path), edges table
  with partial-unique active index and episode provenance, merge redirects edges within the combine
  transaction with snapshot-driven bounded unmerge restore, `pendingEdges` gauge + relationTel counters,
  golden `relations` group (12 cases: 8 predicate positives incl. CJK quoted, fail-closed supersede,
  observational no_edge + 1-hop hit-rate), ship-gate 1j static + relation-zone metric assertions.
- ADR-0035 D7: `ans relation list` + `ans relation backfill-relations` (dry-run default, keyset
  pagination, `--reprocess` supersedes stale rules_version rows, exit codes 0/1/2).

[0.1.0-rc.0]: https://github.com/anysearch/anysearch-cli/releases/tag/v0.1.0-rc.0

### Added
- ADR-0036 relation-arm gain observance (Phase-1): single-run counterfactual ablation for the
  relation arm — SqliteSessionStore captures arm provenance per searchMemory call; the eval runner
  drops the relation list and recomputes RRF, producing paired rank deltas for every expectRankOf
  golden op. Gate statistics: paired BCa 95% CI (seeded mulberry32 bootstrap + jackknife), one-sided
  sign-flip permutation p, Sakai sample-size lock (cap 80), chi-square upper sigma_d. Decision rule
  (BCa lo > 0 AND mean >= minGain AND signFlip p < 0.05) fails closed; under-powered / degenerate /
  missing-baseline downgrade to WARN. Golden relations group expanded 12 -> 78 (30 EN + 8 CN RoR
  pairs with 14-memory distractor corpus, 14 EN + 8 CN alias edges, 6 no_edge negatives); baseline
  recalibrated over 50 seeded runs (sigmaDU=0.102, lockedN=17). New test eval-relation-gain.test.ts.

### Changed

- ADR-0036 D6 (Phase-2): `ans relation backfill-relations --apply` now commits one IMMEDIATE
  transaction per batch (was a single whole-run transaction), retries SQLITE_BUSY with exponential
  backoff (50ms base, 5s cap, <=8 tries, aligned with busy_timeout=5000), fails fast on
  SQLITE_BUSY_SNAPSHOT, and runs a passive WAL checkpoint after each committed batch. The dry-run
  path keeps the single rolled-back transaction, so counters remain exact predictions (ADR-0035 r87).
  The "no concurrent MCP traffic during backfill" constraint is relaxed to recommended-not-required;
  CLI help and ADR-0035 D7 wording updated. Regression coverage: per-batch exact-parity and
  live-writer contention cases in relation-edges.test.ts.

