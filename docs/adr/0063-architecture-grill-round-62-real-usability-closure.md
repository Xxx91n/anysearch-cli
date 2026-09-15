# ADR-0063: Grill Round 62 — Real-Usability Closure（产品真实可用性收口：安装炸弹拆除 + main tip 止血 + golden 执行器 + 观测第三面）

## Status

Accepted (document round r62). This ADR records the round-62 grill decisions
only; source changes landed in the fixer round per ticket plan T1–T9. Ledger:
`.scratch/grill-round-62/decision-ledger.md` (D-001..D-011, all current).

## Context

Round-61 (ADR-0062) closed the abstain gap and shipped the user-facing README,
but its own audit handoff exposed that "the artifacts exist" ≠ "the product is
provably usable": main tip had three simultaneous CI reds (check-build
provenance, install-smoke offline leg, macOS libc++abi exit-time crash); the
install closure pulled `onnxruntime-node` (~728 MB) through store's static
import of `@anysearch/embedding`; `eval-looks.json` golden entries were
ledger-verified but never executed (audit F4/F5); the `ans_chat` retrieval
surface lacked the `retrieval.domain_filter.*` audit events (F3); the Tavily
domain-filter probe waited on a key (F2). Round-62 turns "artifacts exist"
into "product measurably works" — terminating at an explicit npm 0.0.1
go/no-go adjudication.

## Decision

### D1 Theme = real-usability closure, end state = npm 0.0.1 go/no-go (ledger D-001)

Scope A in full — onnxruntime install-bomb removal, main-tip triple-red
stop-bleeding, provenance repair, F1/F2 adjudication, Actions-green written
into the closure definition — plus golden executor (F4) and third-surface span
injection (F3) as same-round cohesive items (ADR-0029).

### D2 Embedding → optionalDependencies, fail-open vector arm (ledger D-002; supersedes ADR-0033 D2)

`@anysearch/embedding` and `@huggingface/transformers` move to
`optionalDependencies` across store/embedding/cli/mcp/plugin. Store's two
static imports become a guarded dynamic import in the new leaf module
`embedding-arm.ts`: absent arm ⇒ `embedText ≡ null`, `cosineSimilarity` inlined
(~11 lines pure math), telemetry carries an `absent` bit; three bundler configs
externalize the package. `doctor` reports `[SKIP] vector arm … FTS-only
(optionalDependency)`. install-smoke runs a lean install (`--omit=optional`)
and asserts the closure contains none of `onnxruntime-node`,
`@huggingface/transformers`, `@anysearch/embedding`. ADR-0033 D2 is marked
**revised** (amendment D9 appended in-place; the document is not superseded —
D1/D3–D8 survive).

### D3 F1 teardown = explicit close + drain-before-exit (ledger D-003)

New pure leaf `apps/cli/src/teardown.ts` (registerTeardown / runTeardown /
unrefPendingHandles, CJS-reachable and testable); `createPersistentEngine`
auto-registers store.close + observation.close; `index.ts` exit path becomes
explicit close → `process.exitCode` → unref backstop with a 5 s watchdog,
replacing the `process.exit()` race that let libuv teardown intermittently
rewrite the abstain exit code (F1, libc++abi family).

### D4 macOS = spillover probe lane, not a blocking matrix leg (ledger D-007)

ship-gate blocking matrix drops `macos-latest` (aligns with ci.yml
ubuntu+windows). A non-blocking `macos-spillover-probe` job (explicitly named
experiment, `continue-on-error` scoped to that job only) runs a minimal repro
— install + build + node baseline + `new Database(":memory:")` registration
check + `scripts/macos-exit-probe.mjs` — classifying crash signatures
(registration-time segfault vs exit-time mutex abort) into the step summary.
Promotion rule: ≥5 consecutive green probes restore the lane and re-open the
onnxruntime≥1.24.1 evaluation (ADR-0059 D4③); continued crashes renew
defer-f16-macos-native-crash with experiment evidence attached.

### D5 Offline install-smoke = structured abstention contract (ledger D-004; contract replacement vs ADR-0062 D-003)

`ANYSEARCH_ENDPOINT` env wires through the anysearch provider (constructor arg
still wins). The offline leg injects a dead endpoint (`http://127.0.0.1:9`)
inside a probe domain whose `sources.enabled=["anysearch"]` (env-injected, no
persistent state), then asserts on `ans search --json`: `abstain:true &&
providersFailed∋anysearch && results.length===0`. The retired `exit 1` /
`Results: 0` contract is deleted — **the offline leg's abstain exit-0
replaces exit-1** (this is the explicit contract-replacement record vs
ADR-0062 D-003). Discovered en route: tavily/exa constructors are keyless-
tolerant — no-key ≠ single-provider, hence the explicit probe-domain narrow.

### D6 OFFLINE_EXCLUDED_GROUPS governed by static ship-gate assertions (ledger D-005)

Four compile-time assertions in ship-gate step 1: constant exists;
`VECTOR_ARM_GROUP === "semantic"` and the exclusion set is exactly
`[VECTOR_ARM_GROUP]` (any widening fails red — a self-aware review gate);
offline coverage floor `offlineCases()/GOLDEN_CASES ≥ 0.75` (measured 0.984);
`ci.yml` must contain a `test-online` job running `test:online` (closes the
"excluded coverage nobody runs" backdoor). All static/source assertions — no
runtime NODATA sentinel (rejected: layer mismatch, no precedent).

### D7 Golden executor = two layers + explicit scope (ledger D-006; closes F4/F5)

`eval-looks.json` gains `golden.scopes` — an explicit entry-id →
`stub|live|both` sidecar map (no default; answer+mustHit* entries must be
live-capable; g0007/g0013 marked `stub`). The offline blocking layer is
`packages/kernel/test/eval-looks-stub.test.ts` (kernel because store→kernel is
circular): it replays the OBSERVED badcase scene — fixtures come from
`eval-badcases.json observed.*` and documented scenes, never from `expected.*`
(self-fulfilling-prophecy ban) — through `RetroaererdEngine` + the real domain
policy, asserting abstain marker structure and gate counters. The online layer
is `packages/store/test/online/eval-looks-live.online.ts`, driving the real
bundled `ans` bin (`search --json`) with hard verdict/mustHitHosts/
mustHitUrls/minResults assertions; discovered only by `test:online`, never on
the `ship-gate --offline` path. Live provider drift quarantines via
`packages/store/eval-quarantine.json` (30-day TTL, strict assertions kept) —
10 entries recorded this round (dated spec paths, versioned/localized doc
URLs, terse-query verdict flips).

### D8 Third retrieval surface gets the span (ledger D-011; closes F3)

`PiAgentRuntimeOptions.span?: RetrievalObservationSink`; `createSearchTool`
(exported as a pure builder seam) threads it into every `Query` — single span,
multi-event, no sub-spans per agent-loop turn. MCP `ans_chat` wires
`observeTool`'s `(span)` through one line. `pi-runtime-span.test.ts` asserts
the same event shape as `domain-filter.test.ts §4`:`
`retrieval.domain_filter.pre/post` on the caller span with
`anysearch.policy_version` + `anysearch.outcome` (abstain and answer paths),
and zero ambient emission without a span.

### D9 Tavily probe live-verified (ledger D-008; closes ADR-0062 criterion 5)

Probe ran with `PROBE_TAVILY_RESEARCH=1`; the key traveled via process env
only — never printed, written, or committed (ledger records `key: set`).
Arms A/B/C PASS: `include_domains` honored in default and filter modes
(0/10 leaks each), subdomain directionality bidirectional. Arm D is
INCONCLUSIVE — `/research` returns an async request handle with no url
fields; the probe script now marks 0-source responses INCONCLUSIVE instead of
a vacuous PASS (honesty fix absorbed into the probe's owning commit).
Evidence: `.scratch/grill-round-62/tavily-probe-ledger.{json,md}`; the r61
ledger keeps its SKIPPED rows as honest history.

### D10 Ticket order = serial T1→T9 (ledger D-010)

T1 provenance first (one line kills the all-OS red); T3/T4 never parallel
(same exit path); T9 last. Per-ticket acceptance anchors; off-ledger findings
are reported, not silently fixed.

### D11 Closure criteria = Actions green on main tip (ledger D-009)

Green means: `ci` workflow ALL jobs (check-build / test×2OS / install-smoke×
2OS / test-online) AND `ship-gate` ubuntu+windows blocking legs — as workflow
runs on main tip, verifiable via `gh run list`. The macOS lane counts per
D4's probe semantics (probe-green counts; still-crashing does not block but
its experiment evidence must land). Ship-gate cannot witness its own green;
the evidence is the run URLs, recorded in §Closure evidence below and required
in every future handoff (docs/agents/handoff-template.md).

## Out of scope (explicit, with reasons)

- **npm publish** — the go/no-go adjudication is the END of this round
  (presented to the user with the evidence table), not a ticket; no preset
  verdict.
- **onnxruntime version bump** — gated on the macOS probe going green per
  D4 (ADR-0059 D4③), not bundled into the teardown fix.
- **Live-layer assertion relaxation** — provider-drift is quarantined with
  TTL, never absorbed into looser mustHit semantics (D7 negative constraint).
- **VCR/recording middleware** — banned explicitly by D-006; the stub layer
  uses observed-scene fixtures only.
- **better-sqlite3 / allowBuilds** — prebuilt path unchanged (D-002 negative).

## Errata

- **E1 outcome dimension wording converged.** The r61 report claimed
  `anysearch.outcome` ∈ {answer, abstain, error}; reality is {answer, abstain}
  and only when the domain gate is active (audit F4, wording overstatement).
  The dimension stays a two-value, domain-gated signal; abstain never folds
  into error counts.
- **E2 root-JSON dual schema reconciled.** `eval-looks.json` keeps TWO schema
  fields deliberately — root `anysearch/eval-looks@2` (ledger) +
  `golden.schema = anysearch/docs-golden@1` (golden set, versioned
  independently). The `golden.scopes` sidecar is an additive field under the
  golden schema; the T6 change was reconciled so both fields stay consistent
  (due-chore: root-JSON double-schema cleanup).
- **E3 T6 scope form = sidecar map, not per-entry field.** GitButler hunk-
  locking on r61-owned entry lines made per-entry `scope` fields uncommittable;
  `golden.scopes` (entry-id → scope) carries the same explicit contract with
  zero overlap into r61 hunks. Semantics unchanged: explicit, no default.
- **E4 absorb-into-owner notes.** Three fixes were folded into their owning
  commits via `but absorb` (r61 lines are hunk-locked to their commits):
  probe-script D-arm honesty fix → nmo; README Known-Limitations refresh →
  lsk; eval-looks dual-schema restore → zzk (T6). Owning-commit messages carry
  `[R62-T8/T9 absorb: …]` annotations; SHAs of nmo/lsk changed — cite but-ids,
  not SHAs (docs/agents/handoff-template.md).

## Consequences

Lean installs lose the ~728 MB onnxruntime closure while the vector arm
degrades honestly to FTS-only. Abstention is now contract-verified offline
(dead-endpoint fault injection), executed by the golden runner in both stub
and live layers, and observable on all three retrieval surfaces (cli search,
mcp search_web/research_web, ans_chat). The remaining open items are all
time-bounded: macOS probe TTL (≥5 greens to promote), quarantine TTL (30 days),
and the npm 0.0.1 go/no-go adjudication that this ADR's closure section
frames.

## Closure evidence (green run URLs — D11)

| workflow | run URL | status |
|---|---|---|
| ci (all jobs) | https://github.com/Xxx91n/anysearch-cli/actions/runs/34926366576 | green (main tip 38a1489) |
| ship-gate (ubuntu+windows blocking) | https://github.com/Xxx91n/anysearch-cli/actions/runs/34926366596 | green (main tip 38a1489) |
| native-smoke | https://github.com/Xxx91n/anysearch-cli/actions/runs/34926366564 | green (main tip 38a1489) |
| ship-gate macos-spillover-probe (non-blocking) | run 34926366596, job conclusion=failure | probe data point #1 (red; TTL streak 0/5, see D4) |

Landing note: the r62 stack was landed to main on 2026-09-15 (16 parallel
stacks, `but land` serial; first integrated run on adf2559 surfaced a real
T5 defect — the D-005 coverage spawn resolved `tsx` from ROOT where it is
not declared (`ERR_MODULE_NOT_FOUND` under clean CI install; local green had
been masked by a stale root `node_modules/tsx` symlink). Fixed in 38a1489 by
running the spawn under `packages/store` (the same pattern as the
chain-gate fixture spawn). The macOS probe's first data point is red —
still-crashing signature, non-blocking by design; the ≥5-green TTL streak
for matrix promotion starts counting from probe run #1.

Local verification standing in until the runs exist (each re-runnable):
`pnpm --filter @anysearch/kernel --filter @anysearch/store --filter @anysearch/mcp check`
green; kernel `eval-looks-stub.test.ts` 41/41; `pi-runtime-span.test.ts` 8/8;
store `eval-docs-golden.test.ts` 44/44; `eval-quarantine-sla.test.ts` +
`eval-quarantine.test.ts` green; `test:online` live executor 8/8 on non-
quarantined entries; `install-smoke` 20/20 incl. lean-closure asserts.
