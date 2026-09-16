# anysearch-cli

A vertical-domain information-specialist CLI: search + research + memory +
knowledge in one agent, with time-edge-effect FTS5 recall, multi-source RRF
fusion, an MCP server that auto-indexes results — and (as of ADR-0062) a
domain allowlist that actually gates what you get back.

**Status: 0.0.3 on npm** — `npm i -g @anysearch-cli/cli`（首个公开版本；0.0.1/0.0.2 因 workspace:* peer 逃逸作废，详见 CHANGELOG）。

## Requirements

- Node.js >= 22 (Node 24 verified)
- pnpm 11.24.0 exactly (pinned; corepack reads `packageManager` automatically)
- At least one provider API key for real searches:
  - `EXA_API_KEY` — Exa (supports domain filtering)
  - `TAVILY_API_KEY` — Tavily (supports domain filtering)
  - `ANYSEARCH_API_KEY` — anysearch REST (optional; anonymous tier works, no domain filter)

## Quickstart

```bash
npm i -g @anysearch-cli/cli
ans doctor                                          # self-check: keys, DB path, domain resolution, provider readiness
ans search "tokio JoinSet rust"                     # first search (full fanout across keyed providers)
ANS_DOMAIN=docs ans search "tokio JoinSet rust"     # domain-scoped search

# optional vector arm (peer-optional — never auto-installed):
npm i -g @anysearch-cli/embedding
```

From source (contributors):

```bash
git clone <this repo> && cd anysearch-cli
pnpm install --node-linker=hoisted   # Windows: hoisted avoids better-sqlite3 EPERM
pnpm build
node apps/cli/dist/index.js doctor
ANS_DOMAIN=docs node apps/cli/dist/index.js search "tokio JoinSet rust"

# machine-readable output (includes sufficiency / attribution / abstain)
node apps/cli/dist/index.js search "..." --json
```

The CLI resolves as `ans` when the package is installed globally or linked; in
repo form, `node apps/cli/dist/index.js` is the same entry point.

## Domains & abstain (ADR-0062)

A *domain* is a TOML file under `domains/` (or `ANS_DOMAINS_DIR`) naming its
providers and an authoritative `urlAllowlist`. `ANS_DOMAIN` selects it.

Domain filtering runs as two gates:

1. **Pre-filter (capability-negotiated)** — providers that declare domain-
   filter support receive the allowlist directly (`tavily` gets
   `include_domains` in hard filter mode; `exa` gets `includeDomains`).
   Providers without support (e.g. `anysearch`) degrade honestly to
   post-filter-only — the engine never fakes a filter for them.
2. **Post-filter (authoritative)** — after providers return, the kernel drops
   every result whose URL is not in the allowlist *before* fusion/attribution.
   Deny rules take precedence; allow entries match a host and its subdomains.

When the gate leaves zero results, `ans` **abstains** — a first-class result,
not an error:

```text
abstain: no results within allowed cold domain(s) (pre-filtered 0, post-filtered 0, gate pre)
```

- Default exit code is **0** (abstention is a successful policy outcome).
- `--fail-on-abstain` returns dedicated exit **3** for automation.
- `--json` output carries `abstain: { reason, domain, preFiltered, postFiltered, gate }`.
- MCP `search_web`/`research_web` surface the same marker as
  `structuredContent.abstain` with `isError: false`.
- Two audit events land in the observation trace on every domain-scoped
  search: `retrieval.domain_filter.pre` (capability + sent/degraded lists)
  and `retrieval.domain_filter.post` (arrivals, survivors, dropped).

Exit codes: `0` ok/abstain · `1` generic failure or zero results without a
domain policy · `2` usage error · `3` abstain under `--fail-on-abstain`.

## Provider domain-filter matrix

| provider | pre-filter sent | degrade mode |
|----------|-----------------|--------------|
| tavily   | yes (`include_domains`, hard filter mode) | — |
| exa      | yes (`includeDomains`) | — |
| anysearch| no (REST API has no domain parameter) | post-filter only |

Provider selection comes from the domain TOML’s `sources.enabled`. Missing
keys skip that provider instead of crashing (fail-open); if *no* provider can
register, the search is an error, not an abstain.

## MCP server

```bash
node apps/mcp/dist/index.cjs                    # stdio transport (default)
node apps/mcp/dist/index.cjs --transport http --port 3099   # HTTP
```

Five tools: `search_web`, `research_web`, `recall_memory`, `query_knowledge`,
`ans_chat`. `ANS_DOMAIN` scopes the server the same way it scopes the CLI.
Tools never print to stdout; the server keeps the protocol channel pure.

## Verified agent hosts

| Host | Version | Date | Scope | Status |
|------|---------|------|-------|--------|
| CodeBuddy Code | 2.149.0 | 2026-09-16 | `mcp.json` registration (`ans-mcp`, 5 tools via tools/list) · `.codebuddy/settings.json` hooks (`hook_event_name` contract, `hookSpecificOutput` envelope) · `ans-plugin-server` bin | contract-verified; live headless probe pending |

"Verified" means an end-to-end transcript captured on the real host
(`stream-json`), not contract isomorphism. See
`docs/codebuddy-integration.md` for the CodeBuddy wiring and ADR-0066 for
the round-65 evidence set.

## Known limitations

- **0.0.3 plugin server needs a manual launch** — `@anysearch-cli/plugin@0.0.3`
  ships no bin; run
  `node "$(npm root -g)/@anysearch-cli/plugin/dist/server/index.cjs"` once per
  machine (fixed in-tree as `ans-plugin-server`, lands with the next
  release — ADR-0066).
- **0.0.3 hook templates point at library files** — `configs/*/hooks.json`
  Pre/PostToolUse entries reference `dist/hooks/{preheat,distill}.cjs`
  (decision libraries, no stdin main) instead of `adapters/<host>.cjs`; wire
  hooks per `docs/codebuddy-integration.md` / the fixed templates in the
  next release (ADR-0066).
- **Hook adapters before this fix read `stdin.event`** — real hosts inject
  `hook_event_name`; on ≤0.0.3 the hooks deploy but silently no-op
  (false-green). Fixed in-tree via `hook_event_name ?? event` on all four
  adapters + session-start (ADR-0066).
- **`anysearch` provider cannot pre-filter** — its REST surface has no domain
  parameter; under a domain allowlist it is post-filter-only (honest degrade,
  recorded in the `retrieval.domain_filter.pre` audit event).
- **Tavily does not forward `AbortSignal`** — provider-side timeouts are not
  cancelable through the SDK (recorded limitation; the kernel budget guard
  still bounds wall time).
- **macOS is outside the blocking matrix** — an exit-time `libc++abi` crash
  remains unresolved, so `ship-gate` gates on ubuntu+windows while a
  non-blocking `macos-spillover-probe` job replays a minimal repro each push
  (promotion rule: ≥5 consecutive green probes before restoring the lane).
- **Exit-time `libc++abi` can overwrite the abstain exit code** — observed on
  Windows: the teardown crash may replace the `3` that `--fail-on-abstain`
  produced. Automation must read the structured abstain marker (`--json`
  `abstain` field / MCP `structuredContent.abstain`), not the exit code alone.
- **macOS probe data point #1 is a registration-segment red** — the first
  non-blocking probe run (34927388026) failed at the `better-sqlite3`
  registration check (load-time family, distinct from the exit-time family
  under probe). The ≥5-consecutive-green promotion clock counts from #1.
- **Page-level assertions sit at page-family granularity** — providers
  rotate URL paths (`/zh/` locale, `/10.x` version, dated
  `/specification/<date>/` variants), so live golden entries assert
  `mustHitPaths` (pathname substring + explicit `tolerate` classes +
  `mustNotHitPaths` negative pins) rather than byte-exact paths (ADR-0065).
  Three byte-exact `mustHitUrls` legs survive on frozen dated MCP spec
  snapshots; the 10 drift-quarantined entries were adjudicated to promote in
  R64 with `migration` provenance on each golden entry (ledger
  `packages/store/eval-quarantine.json` is empty; watch-marked entries
  re-enter quarantine through the same TTL path on a CI flip).
- **FTS-only installs dedupe lexically** — without the optional
  `@anysearch-cli/embedding` peer, memory consolidation falls back to a Jaccard
  similarity floor (θ=0.80): near-verbatim duplicates still noop, but
  paraphrase-level duplicates are not caught (degraded, counted in
  `ConsolidateReport.embeddingAbsent` — ADR-0064 T1).
- **Tavily domain-filter probe: live-verified** — `include_domains` held in
  default + filter modes and subdomain direction is bidirectional
  (`scripts/probe-tavily-domains.mjs`, ledger in `.scratch/grill-round-62/`;
  the `/research` endpoint arm is INCONCLUSIVE — async handle, no URL fields).
- **`ans chat` / `ans llm` need an LLM key** (`OPENAI_API_KEY` etc. via
  `ans llm`); retrieval itself only needs provider keys.

## For contributors

- `CONTEXT.md` — canonical domain glossary (read first).
- `docs/adr/` — numbered decision record; the index below is generated by
  `scripts/gen-adr-index.mjs` (do not edit by hand).
- `docs/agents/` — domain-doc + local-markdown issue tracker conventions.
- Repo layout: `packages/kernel` (engine) · `packages/store` (FTS5 memory,
  observation, URL policy) · `packages/retriever` (provider adapters + RRF) ·
  `apps/cli` · `apps/mcp` · `apps/plugin` (host hooks).
- Per-package tests run under `node --import tsx --test`; the full gate is
  `node scripts/ship-gate.mjs` (clean tree, tests, pack, install verify, MCP
  initialize, fail-open boot).
- Governance: `docs/ponytail-debt-ledger.md`, `.scratch/<slug>/` issues,
  `AGENTS.md`.

## Architecture decisions

<!-- BEGIN ADR-INDEX (generated by scripts/gen-adr-index.mjs — do not edit by hand) -->
The complete numbered record lives in `docs/adr/` — ADR-0001 through ADR-0066.

| ADR | Title |
|-----|-------|
| [0001](docs/adr/0001-typescript-pi-skeleton.md) | TypeScript 内核 + @earendil-works/pi-* 骨架 |
| [0002](docs/adr/0002-domain-authority-cc-persona-toml.md) | 领域权威 = cc-persona TOML 联动模式（不等 MCP Contexts/分组原语） |
| [0003](docs/adr/0003-code-mode-soft-depends-context-mode-and-codegraph.md) | Code Mode MVP 软依赖已装 context-mode / codegraph |
| [0004](docs/adr/0004-kernel-split-seam-architecture.md) | Kernel Split Seam Architecture (Three Packages + Ports) |
| [0005](docs/adr/0005-architecture-grill-round-2.md) | Architecture Grill Round 2 — Implementation Selections |
| [0006](docs/adr/0006-architecture-grill-round-3-seam-wiring.md) | Architecture Grill Round 3 — Seam Wiring |
| [0007](docs/adr/0007-architecture-grill-round-4-pi-agent-core-integration.md) | Architecture Grill Round 4 — pi-agent-core Integration |
| [0008](docs/adr/0008-architecture-grill-round-5-mcp-phase2-design.md) | Architecture Grill Round 5 — MCP Phase 2 Design |
| [0009](docs/adr/0009-architecture-grill-round-6-phase3-plugin-design.md) | Architecture Grill Round 6 — Phase 3 Anysearch Plugin Design |
| [0010](docs/adr/0010-architecture-grill-round-7-post-phase3-evolution.md) | Architecture Grill Round 7 — Post-Phase-3 Evolution Design |
| [0011](docs/adr/0011-architecture-grill-round-8-sessionstart-progressive-disclosure.md) | Architecture Grill Round 8 — SessionStart Hook + Progressive Disclosure Implementation |
| [0012](docs/adr/0012-architecture-grill-round-9-l0l1-memory-pipeline-per-platform.md) | Architecture Grill Round 9 — L0/L1 记忆管道升级 + Per-Platform 验证 (A→B→D) |
| [0013](docs/adr/0013-architecture-grill-round-10-reuse-compress-noop-adjudication.md) | Architecture Grill Round 10 — REUSE/COMPRESS NOOP 裁决算法设计 |
| [0014](docs/adr/0014-architecture-grill-round-11-sufficiency-gate-deepening.md) | Architecture Grill Round 11 — Sufficiency Gate 深化 |
| [0015](docs/adr/0015-architecture-grill-round-12-memory-pipeline-extraction.md) | architecture grill round 12 memory pipeline extraction |
| [0016](docs/adr/0016-architecture-grill-round-13-temporal-decoupling-pure-function.md) | Architecture Grill Round 13 — Temporal Decoupling & Pure Function-ization |
| [0017](docs/adr/0017-architecture-grill-round-14-production-pipeline-mcp-dual-era.md) | Architecture Grill Round 14 — Production Pipeline & MCP Dual Era |
| [0018](docs/adr/0018-architecture-grill-round-15-mcp-sdk-v2-migration.md) | Architecture Grill Round 15 — MCP SDK v2 Migration Strategy |
| [0019](docs/adr/0019-architecture-grill-round-16-typebox-bridge-operationalization.md) | Architecture Grill Round 16 — TypeBox Bridge Operationalization & Validation Consolidation |
| [0020](docs/adr/0020-architecture-grill-round-17-release-readiness-ship-gate.md) | Architecture Grill Round 17 — Release Readiness & Ship-Gate Pipeline |
| [0021](docs/adr/0021-architecture-grill-round-18-memorypipeline-deepen-threshold-injection-ship-evidence.md) | Architecture Grill Round 18 — MemoryPipeline Deepen + Threshold Injection + Ship-Gate Evidence Persistence |
| [0022](docs/adr/0022-architecture-grill-round-19-consumer-answer-mode-exposure.md) | Architecture Grill Round 19 — Consumer-Layer Answer Mode Exposure |
| [0023](docs/adr/0023-architecture-grill-round-20-memory-retrieval-deepening.md) | Architecture Grill Round 20 — Memory Retrieval Deepening (Query Rewrite + Transactional Adjudication) |
| [0024](docs/adr/0024-architecture-grill-round-21-t0-memory-md-durable-preference-layer.md) | Architecture Grill Round 21 — T0 Hot Zone MEMORY.md Durable Preference Layer |
| [0025](docs/adr/0025-architecture-grill-round-22-native-smoke-ci-and-pref-review.md) | — 架构 grill round 22：ship-gate 双段拆分 + 等权冲突裁决暴露（Native Smoke CI + pref review） |
| [0026](docs/adr/0026-architecture-grill-round-23-pnpm-version-pinning-v11-pmonfail-error.md) | Architecture Grill Round 23 — pnpm 版本根治：v11 双写钉死 + pmOnFail error |
| [0027](docs/adr/0027-architecture-grill-round-24-memory-eval-harness.md) | Architecture Grill Round 24 — 记忆 Eval Harness：golden dataset + 门禁 + 本地 judge 报告通道 |
| [0028](docs/adr/0028-architecture-grill-round-25-eval-hardening-secret-guard-and-parity.md) | Architecture Grill Round 25 — eval 硬化三连：margin 整数化 / 检索 rank gate / read 侧 secret 防线 + 难度分层 + task parity |
| [0029](docs/adr/0029-architecture-grill-round-26-judge-calibration-eval-budget-guard.md) | Architecture Grill Round 26 — LLM-as-judge 人工标注校准 + eval 运行预算守卫 |
| [0030](docs/adr/0030-architecture-grill-round-27-memory-lifecycle-fused-freshness-factor.md) | (grill r27): Memory Lifecycle Governance — Fused Freshness Factor + Explicit Invalidation |
| [0031](docs/adr/0031-architecture-grill-round-28-entity-link-layer.md) | (grill r28): Entity Link Layer — Two-Table Entity Index + RRF Third Arm + FSL-Style Three-Tier Dedup |
| [0032](docs/adr/0032-architecture-grill-round-29-entity-merge-execution.md) | (grill r29): Entity Merge Execution - Destructive Redirect with Snapshot Log, Bounded Unmerge, Review Belt, Report-Only Merge Telemetry |
| [0033](docs/adr/0033-architecture-grill-round-30-vector-semantic-arm.md) | Grill Round 30 — Vector Semantic Arm (transformers.js local embedding + 4th RRF arm) |
| [0034](docs/adr/0034-architecture-grill-round-31-answer-attribution-layer.md) | Grill Round 31 — Answer Attribution Layer (claim-level evidence linkage + cascading verification) |
| [0035](docs/adr/0035-architecture-grill-round-32-entity-relation-layer-kg-lite.md) | Grill Round 32 — Entity Relation Layer (KG-lite fifth arm over a closed predicate table) |
| [0036](docs/adr/0036-architecture-grill-round-33-relation-arm-gain-observation.md) | Grill Round 33 — Relation-Arm Gain Observation (preregistered gain gate over expanded golden) + chunked backfill |
| [0037](docs/adr/0037-architecture-grill-round-34-consolidation-and-forgetting.md) | Grill Round 34 — Episodic-to-Semantic Memory Consolidation (sixth RRF arm) + Reversible Active Forgetting (G019 closure) |
| [0038](docs/adr/0038-architecture-grill-round-35-relation-gate-promotion-holdout-dual-track.md) | Grill Round 35 — Relation-Arm Gain Gate Promotion (three-tier) + Dual-Track Holdout + Preregistered OF Alpha Spending + Graded-Label Skeleton |
| [0039](docs/adr/0039-architecture-grill-round-36-tau-observation-layer.md) | Grill Round 36 — Tau Observation Layer (access-age histogram + tau sensitivity scan + BG/NBD readout, no fitting this round) |
| [0040](docs/adr/0040-architecture-grill-round-37-access-events-tamper-evidence.md) | Grill Round 37 — Access Events Tamper-Evidence Layer (prev_hash chain + independent verifier + alert-on-silence) |
| [0041](docs/adr/0041-architecture-grill-round-38-gate-verification-object-layering.md) | Grill Round 38 — Gate-Built Verification Object (verify-what-you-build) |
| [0042](docs/adr/0042-architecture-grill-round-39-observational-data-feeding.md) | Grill Round 39 — Observational Data Feeding (dual-track synthetic fixtures + skip-ledger reason codes) |
| [0043](docs/adr/0043-architecture-grill-round-40-consumed-synthetic-switch-governance.md) | Grill Round 40 — Consumed/Synthetic Switch Governance (five-stage state machine + pre-registered triggers + TOST reconcile) |
| [0044](docs/adr/0044-architecture-grill-round-41-adr0043-audit-remediation.md) | Grill Round 41 - ADR-0043 Audit Remediation Governance |
| [0045](docs/adr/0045-architecture-grill-round-42-multi-arm-rrf-fusion-governance.md) | Grill Round 42 — Multi-Arm RRF Fusion Governance |
| [0046](docs/adr/0046-architecture-grill-round-43-multi-arm-rrf-fusion-gain-observation.md) | Grill Round 43 — Multi-Arm RRF Fusion Gain Observation |
| [0047](docs/adr/0047-architecture-grill-round-44-emergency-ship-override-lifecycle.md) | Architecture Grill Round 44 — Emergency Ship Override Lifecycle |
| [0048](docs/adr/0048-architecture-grill-round-45-local-eval-gate-calibration-contract.md) | Architecture Grill Round 45 — Local Eval-Gate Calibration Contract |
| [0049](docs/adr/0049-architecture-grill-round-46-calibration-revision-lifecycle.md) | Architecture Grill Round 46 — Calibration Revision Lifecycle |
| [0050](docs/adr/0050-architecture-grill-round-47-fused-score-calibration-threshold-propagation.md) | Architecture Grill Round 47 — Fused Score Calibration and Threshold Propagation |
| [0051](docs/adr/0051-architecture-grill-round-48-attribution-calibration-runtime-injection-segment-audit.md) | Architecture Grill Round 48 — Attribution Calibration Runtime Injection and Segment Audit |
| [0052](docs/adr/0052-architecture-grill-round-49-observability-closed-loop-context-engineering.md) | Architecture Grill Round 49 - Observability Closed Loop and Context Engineering |
| [0053](docs/adr/0053-architecture-grill-round-50-content-trust-boundary-indirect-prompt-injection-defense.md) | Architecture Grill Round 50 - Content Trust Boundary and Indirect Prompt Injection Defense |
| [0054](docs/adr/0054-architecture-grill-round-51-adr0053-behavioral-loop-closure.md) | Architecture Grill Round 51 - ADR-0053 Behavioral Loop Closure |
| [0055](docs/adr/0055-architecture-grill-round-52-authorization-policy-single-source.md) | Architecture Grill Round 52 - Authorization Policy Single Source Unification |
| [0056](docs/adr/0056-architecture-grill-round-56-session-id-propagation-protocol.md) | Architecture Grill Round 56 — Session ID Propagation Protocol |
| [0057](docs/adr/0057-architecture-grill-round-57-test-truthfulness-ci-credibility.md) | Architecture Grill Round 57 — Test Truthfulness and CI Credibility (node:test migration + expectations governance) |
| [0058](docs/adr/0058-ci-test-job-independence-and-gate-layer-entrypoint-narrowing.md) | CI Test-Job Independence, Always() Success-Only Aggregation, and Gate-Layer Entrypoint Narrowing |
| [0059](docs/adr/0059-architecture-grill-round-58-ci-shipgate-full-green-closure-multiticket.md) | Architecture Grill Round 58 — CI/Ship-Gate Full-Green Closure (multi-ticket override of ADR-0029, eval governance thaw) |
| [0060](docs/adr/0060-architecture-grill-round-59-archive-truthfulness-closure.md) | Grill Round 59 — Archive Truthfulness Closure（档案真实性收口） |
| [0061](docs/adr/0061-architecture-grill-round-60-product-vertical-domain-closure.md) | Grill Round 60 — Product Body Round: Vertical Domain Delivery Closure（产品正文轮：垂直领域可交付闭环） |
| [0062](docs/adr/0062-architecture-grill-round-61-out-of-domain-abstain-closure-readme.md) | Grill Round 61 — Out-of-Domain Abstain Closure + User-Facing README（docs 域外拒答收口 + 用户向 README 治理） |
| [0063](docs/adr/0063-architecture-grill-round-62-real-usability-closure.md) | Grill Round 62 — Real-Usability Closure（产品真实可用性收口：安装炸弹拆除 + main tip 止血 + golden 执行器 + 观测第三面） |
| [0064](docs/adr/0064-architecture-grill-round-63-npm-001-go-no-go-release-adjudication.md) | Grill Round 63 — npm 0.0.1 Go/No-Go Release Adjudication（发布终审：阻塞清零/带病留痕/前置清障） |
| [0065](docs/adr/0065-architecture-grill-round-64-quarantine-ttl-adjudication-assertion-granularity.md) | Grill Round 64 — Quarantined Golden TTL Adjudication + Assertion-Granularity Re-anchor（隔离金案例裁决收口/页族断言层/证据模式） |
| [0066](docs/adr/0066-architecture-grill-round-65-real-host-deployment-codebuddy-hooks-contract.md) | Grill Round 65 — Real-Host Deployment: CodeBuddy 全栈三件套 + Hooks 契约对齐（开门轮） |
<!-- END ADR-INDEX -->
