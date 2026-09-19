# ADR-0073: Grill Round 72 — DeepSeek Harness 宿主适配（两阶段 C：Phase-1 MCP 桥 + Phase-2 薄 bundle）

## Status

Accepted (implementation round r72). Records the round-72 decisions per the
serial ticket plan T0–T3. Ledger:
`.scratch/grill-round-72/decision-ledger.md`
(D-001~D-004, 无断号). Evidence root:
`.scratch/grill-round-72/evidence/`. Spike report:
`.scratch/grill-round-72/reports/spike-report.md` (9 probes, all PASS,
Phase-2 GO).

## Context

Five hosts are already verified via the `ans-hook-*` subprocess-bin pattern
(ADR-0066~0069): a host runs our hook binaries per event and they speak HTTP
to the anysearch server. DeepSeek Harness (`dsh`) is the first **in-process**
host: plugins are Cordis bundles that load into the host process and mount
listeners on an event waterfall (`tools/pre-execute` → `tools/post-execute`
→ `tools/result`) plus agent lifecycle events (`agent/session-start`).
Moving the adapter in-process is a trust boundary change: an installed plugin
runs OUTSIDE the workspace sandbox, so in-process surface must stay minimal.

Three open questions the grill framed: (i) how much of the host contract is
documented vs. discoverable only by spike — the waterfall's async-serialization
guarantee and `agent.inject()` durability were doc gaps; (ii) whether the
official `@deepseek-ai/dsh-mcp-client` bridge can be configured from a
bundle's own `cordis.patch.yml` (a bundle patching ANOTHER plugin's row —
the blocking probe #8); (iii) package shape for a `private` adapter whose
runtime deps must stay zero.

## Decision

### D1 Two-phase integration, hooks-only bundle (ledger D-001; T0–T2)

- **Phase 1 = documented MCP bridge row.** The official
  `@deepseek-ai/dsh-mcp-client` row (`serverName: anysearch`, stdio
  `ans-mcp`) is hand-inserted in the profile's user `cordis.patch.yml` —
  zero product code, all five `mcp__anysearch__*` tools bridged.
- **Phase 2 = `@anysearch-cli/dsh-plugin`** (`apps/dsh-plugin`): a Cordis
  bundle that mounts the anysearch hooks layer on five surfaces —
  `agent/session-start` (routing-card `agent.inject()`),
  `ctx.systemPrompt` (routing-card section), `tools/pre-execute`
  (URL-policy deny/ask + recall preheat), `tools/post-execute` (distilled
  `additionalContexts`), `tools/result` (`/index` IPC). The bundle's own
  patch also inserts the `mcp-anysearch` row, so one `dsh plugin add`
  delivers both phases.
- **All business logic stays outside the dsh process.** The bundle calls the
  same 127.0.0.1 HTTP IPC endpoints as the subprocess adapters (`GET /policy`,
  `POST /recall`, `POST /index`), re-uses the shared hook decision
  functions from `@anysearch-cli/plugin` (bundled at build time), and keeps
  fail-open semantics — a dead server never blocks the agent; URL gating stays
  fail-closed per ADR-0054/0055 (no approval channel in headless → the tool
  call surfaces `requires approval`).
- Native `ctx.tools` registration of the five tools → deferred backlog;
  revisit when the bridge shows insufficiency or the registration API
  stabilizes.

### D2 Zero-runtime-dep bundle + devDep churn alarm (ledger D-002; T1)

- `dependencies` must stay empty; every `@deepseek-ai/*` package is a
  TYPE-ONLY `devDependency` — the declared `import type` contract is the
  compile-time churn alarm (an upstream contract change breaks `tsc`, which
  is the point). ship-gate step-1 asserts it fail-closed (any
  `@deepseek-ai/*` in a runtime dep field → red).
- Shared hook logic is imported from `@anysearch-cli/plugin` hook modules
  and **bundled** into `lib/index.js` (esbuild ESM + `createRequire`
  banner — CJS dep modules carry `require()` calls that pure ESM rejects:
  `Dynamic require of "node:crypto" is not supported`, found on the real
  loader). Emitted bundle has zero package imports — `node:*` builtins only.
- `private: true` this round; verification follows the publish shape
  anyway: `pnpm pack` tarball → `dsh plugin add <tgz>` →
  `--dump-config` layer check. npm publish later = flip `private` +
  `publishConfig`, not archaeology.
- Version pinned at the repo release train (`0.0.6`) — ship-gate PKG_DIRS
  pin check treats private workspace packages the same as published ones.

### D3 Patch-layer semantics verified on the real loader (T0 probe 9 → T2)

- `config` on an `- id:` entry **replaces the row whole** (never merges) —
  overrides must restate every key.
- `- insert:` adds rows; an `- id:` entry on a missing row warns only.
  Two `insert` rows with the same `id` (bundle + user layer, or two
  bundles) = hard `duplicate loader entry id` loader error. Phase-1 manual
  rows and the Phase-2 bundle must not coexist under `mcp-anysearch` — the
  bundle owns the id; user overrides use `- id:`.
- `dsh plugin add` auto-registers the package under
  `dsh.profile.bundles` (link:, file:, and registry specs); `remove`
  cleans both fields. Re-add is idempotent.
- `patchReload: "startup"` (headless) vs `"live"` (web): all our
  registrations are fiber-scoped Cordis effects (`ctx.on`,
  `systemPrompt.section`) — they dispose automatically on plugin reload.

### D4 Verification classification — three buckets (ledger D-003; T2)

- **Host invariants**: five tools visible+callable, fail-open with server
  down, with/without-bundle contrast (Phase-1 row only = tools bridged, no
  hook side-effects — the documented degradation).
- **Host variables**: inject transcript, preheat marker, URL-deny end-to-end
  (model-requested call → `requires approval` tool error), distillation +
  `/index` accumulation, startup tax.
- **Host-new**: install/remove/re-add idempotence, patch-layer combination,
  duplicate-insert collision (real loader error), tarball install shape,
  upgrade-diff exercise (rc.2 → 0.1.6-alpha.2 type bump: `tsc` green,
  pin restored to the verified train), churn-lint red/green control,
  web-profile named probes (inject + preheat on the wire inside a web-profile
  composition).

### D5 Deferred / explicitly out of scope

- npm publish of `@anysearch-cli/dsh-plugin` (release track).
- Native `ctx.tools` registration of ans_* tools (bridge insufficiency or
  API stabilization are the revisit triggers).
- Full interactive web-UI matrix (the two named probes are this round's
  coverage; interactive turn + HMR live-edit remain preview-level).
- `ans_chat` / `research_web` beyond the bridge's 60 s
  `toolCallTimeoutMs` default (user-patch override documented).

## Consequences

- Positive: sixth verified host with the thinnest adapter yet (~200 LOC
  product code + shared hook reuse); the in-process trust surface is one
  bundled file; every hook contract was proven on the real loader before the
  implementation diffed anything.
- Negative/cost: the bundle inherits Cordis loader semantics wholesale —
  whole-row replacement, duplicate-insert collisions, and bundle-owned ids
  are now documented integration rules users must follow (integration doc
  §Layering rules).
- Watch items: upstream `@deepseek-ai/*` type churn fires our devDep alarm
  on `tsc`; a future dsh release shipping its own `mcp-anysearch` id
  collides with our insert (upgrade-diff via `--dump-config` is the check).
