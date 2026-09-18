# ADR-0072: Grill Round 71 — 上架首航（路径治理门禁 + embedding 双臂可达 + 0.0.6 真发布）

## Status

Accepted (implementation round r71). Records the round-71 decisions per the
serial ticket plan T0–T3. Ledger:
`.scratch/grill-round-71/decision-ledger.md`
(D-001~D-004, 无断号). Evidence root:
`.scratch/grill-round-71/evidence/`.

## Context

R70 audit residue + the standing release-gate now exist to be exercised by a
real guest: 0.0.5 was published before the dual-layer gate existed, so no
release had ever passed through it. Three threads converged: (i) machine-local
absolute paths had accumulated across ~223 tracked markdown docs with no
governing doctrine (blanket bans were previously rejected as collateral-blind);
(ii) the embedding arm was an optional peer with no verified install path —
the audit's npm#8416 optional-peer finding meant `npm i -g` and `pnpm add -g`
could diverge silently; (iii) `devEngines` in root `package.json` emitted
EBADDEVENGINES on every in-repo npm command — suspected published-metadata
pollution. atomcode R71 research archives:
`.scratch/grill-round-71/q2-atomcode.md` (path governance Option A + 3
corrections) and `.scratch/grill-round-71/q3-atomcode.md` (dual-arm spike
requirement + EBADDEVENGINES adjudication).

## Decision

### D1 Usage-classified path doctrine + fail-closed lint (ledger D-002; T0)

- Three-way classification replaces any blanket rule: **locator/Stack lines**
  may cite bare absolute paths (they name places, not targets); **in-repo
  targets** must be repo-relative — a governed marker does NOT exempt them;
  **out-of-repo targets** keep absolute paths AND require a governed
  declaration `<!-- machine-local: <reason> @ <YYYY-MM-DD> -->` with non-empty
  reason + ISO date (bare/malformed declarations are violations — q2
  correction 1). A marker immediately before a fenced block covers the block.
- `scripts/ship-gate.mjs` step 1i/9 implements it fail-closed; the scan
  surface (roots + registered `.scratch` doc dirs) lives in
  `scripts/ship-gate-pathlint.config.json` — new doc types must be explicitly
  registered (q2 correction 3: `.scratch` is in scope, not exempt).
- Historical sweep with no grandfathering: 317 in-repo absolute refs →
  repo-relative; 93 governed declarations (2 fenced blocks); RED evidence
  (330 violations) captured before cleanup, GREEN after — 先红后绿.
- R70 audit Temp transcripts were archived into the repo
  (`.scratch/grill-round-70/evidence/r70-audit-temp/`) — q2 correction 2:
  default-commit evidence; hash-and-destroy only if proven worthless.
- release.yml assert-checks-green timeout 10→15 min (ADR-0071 quantile
  evidence: ship-gate windows p90=740s > 600s bound — the D3 trigger fired).

### D2 EBADDEVENGINES 根治 = delete root devEngines (ledger D-003; T1.1)

- Spike evidence rewrote the ticket's premise: published tarballs and the
  registry packument NEVER carried `devEngines` — `pnpm pack` strips it. The
  warning fires because npm validates the *current directory's* devEngines, so
  every npm command inside the repo warned. Published-artifact stripping was a
  no-op; the real fix is removal.
- `package.json` root `devEngines` deleted. The pin holds without it —
  empirical: `npx pnpm@11.7.0` in-repo fails `ERR_PNPM_BAD_PM_VERSION` via
  `packageManager` + `pmOnFail: error` (ADR-0026 D5's own design note: pnpm
  enforcement was always pmOnFail's job; devEngines existed for npm-facing
  declaration, with `onFail: warn` chosen because npm has no `download` mode).
- `pnpm-workspace.yaml` + `packageManager` retained untouched — corepack
  consumers read those, never devEngines.

### D3 Embedding verified-reachable: two in-tree break repairs (ledger D-003; T1.2/T1.3)

Dual-arm spike (npm + pnpm clean global installs, four assertions each;
transcript `.scratch/grill-round-71/evidence/t1-embedding-spike.md`) found the
pnpm arm broken twice over — both repaired at the break itself per the
ticket's "修断点本体" clause:

- **Sibling-root resolution fallback** (`packages/store/src/embedding-arm.ts`):
  `pnpm add -g` isolates each top-level package in its own
  `<prefix>/global/v11/<hash>/node_modules` tree — the bundled
  `import("@anysearch-cli/embedding")` cannot reach a sibling root (not even
  with `preserve-symlinks`: the package lives in a DIFFERENT hash root).
  On MODULE_NOT_FOUND only, the loader anchors at `argv[1]` (the bin shim
  target preserves the layout path) + the module file, walks ancestors, and
  scans `*/node_modules/@anysearch-cli/embedding`. Present-but-broken stays
  absent (fail-open contract preserved — the fallback fires only on
  not-found, never masks a load error).
- **Undeclared transitive external** (`packages/embedding/`):
  `transformers.node.cjs` executes `require("onnxruntime-common")` but
  `@huggingface/transformers@3.8.1` never declares it — npm's flat hoisting
  masks the bug; pnpm's isolated scopes expose it. Repair: declare
  `onnxruntime-common@1.21.0` in optionalDependencies (exact pin matching
  transformers' `onnxruntime-node@1.21.0`), switch the lazy load to
  `createRequire().require()` (the `.node.cjs` entry — the `.mjs` ESM resolver
  cannot be scoped without loader hooks), and install a scoped
  `Module._resolveFilename` patch — only that specifier, only from
  `@huggingface/transformers` parents (Windows separator-normalized) —
  aliasing the miss to our copy. Upstream-defect workaround, documented here.
- Reachability closure per spike evidence: doctor SKIP text → executable
  enable path; `backfill-vectors` failure → actionable hint (reachability /
  `ANYSEARCH_MODEL_CACHE` pre-seed / doctor); README `## Post-install` in both
  languages; install-smoke leg 3c junction-simulates the pnpm layout under
  `--preserve-symlinks(-main)`.
- Assertion (d) honest finding: `HF_HUB_OFFLINE`/`HF_ENDPOINT`/`HTTP(S)_PROXY`
  are all inert for transformers.js first-use (Python-Hub conventions; Node
  fetch ignores proxy env vars) — the shipped guidance names only the verified
  knobs (cache dir + connectivity), not env flags that don't work.

### D4 0.0.6 real release through the dual-layer gate (ledger D-001/D-004; T2)

- Version bump: all seven workspace packages + private root → 0.0.6
  (unpublished packages follow — 票内裁: consistency over staleness); the
  ship-gate release pin moved in the same commit (R66 F-01 discipline).
- Real flow executed: `workflow_dispatch runPurpose=pre-tag` on main → OF
  look spent (eval-looks.json ledger commit, verdict warn + integrity pass)
  → layer-1 wait for CI+ship-gate → tag v0.0.6 → push → post-tag assert +
  npm OIDC publish.
- **First-guest gate defect found + repaired in-release**: the pre-tag wait
  targets the ledger commit pushed by the job's own GITHUB_TOKEN — and
  GITHUB_TOKEN pushes never cascade-trigger workflow runs, so the ledger sha
  carries zero check-runs and `FAIL_ON_NO_CHECKS` fails discovery every time
  (run 35385345425; the step postdates v0.0.5 and had never been exercised).
  Repair: release-gate self-dispatches `ci`+`ship-gate` on a temp ref
  (`release-gate-ledger`) pinned at the ledger sha — real check-runs on the
  asserted sha, no weakening of the allowed-conclusions contract; the ref is
  cleaned after the wait. Requires `actions: write` on the job.
- Four-part machine-verifiable closeout (ledger D-004) is the report
  contract: fix evidence, gate evidence, product/host evidence, doc/closeout
  evidence — each claim citing a transcript or run URL.

## Consequences

- npm and pnpm global consumers both reach the vector arm — the first
  verified-reachable optional-peer path in the project's history.
- `Module._resolveFilename` is patched process-wide but scoped to a single
  (specifier, parent-package) pair; the patch is load-order safe (idempotent,
  first-miss-wins) and invisible under npm where it never fires.
- Path doctrine is now enforced, not aspirational — new docs must register
  their dir or write compliant paths from the start.
- The release tag is the first commit ever to pass the dual-layer gate; the
  ledger's look-4 entry is a production spend, not a drill.

## Closure

Evidence anchors (all machine-verifiable; transcripts under
`.scratch/grill-round-71/evidence/`):

- **Gate evidence**: `ship-gate-t1-green-transcript.log` +
  `ship-gate-t2-pretag-transcript.log` — 58×pass / 0×fail exit 0, including
  the new step 1i/9 path-lint (224 registered docs clean) and the README
  parity leg. T0 RED transcript `path-lint-red-transcript.log` (330
  violations) precedes the sweep.
- **Fix evidence**: `t1-embedding-spike.md` — dual-arm spike, four
  assertions per arm; pre-fix pnpm arm red (arm absent + `0/1 failed`),
  post-fix both arms green (`backfilled 3/3` npm, `backfilled 2/2` pnpm).
- **Release evidence (run URLs)**:
  - pre-tag wait (green): https://github.com/Xxx91n/anysearch-cli/actions/runs/35386495456
  - post-tag assert + publish (green): https://github.com/Xxx91n/anysearch-cli/actions/runs/35387286412
  - gate-defect evidence run (red, pre-repair): https://github.com/Xxx91n/anysearch-cli/actions/runs/35385345425
  - OF looks burned: look 4 (ledger `114da320`, verdict warn+integrity pass)
    + look 5 (ledger `6c289397`, same verdict — the pre-tag retry after the
    gate repair). Tag `v0.0.6` = `6c289397`.
- **Product evidence**: `npm view @anysearch-cli/{cli,mcp,plugin,embedding}
  version` = 0.0.6 ×4 (registry propagation confirmed); clean `npm i -g
  @anysearch-cli/cli@0.0.6 @anysearch-cli/embedding@0.0.6` — 220 pkgs, exit 0,
  zero EBADDEVENGINES; registry tarball LICENSE = canonical Apache-2.0;
  installed `ans doctor` → `[OK] vector arm (present ...)`.
- **found/fixed/deferred**: found 4 (devEngines warn-source, pnpm
  sibling-root break, transformers undeclared external, release-gate
  GITHUB_TOKEN cascade defect) — fixed 4 — deferred per D-001 scope list
  (1g coverage gap, macOS spillover, provider server-side, deferred pool).
