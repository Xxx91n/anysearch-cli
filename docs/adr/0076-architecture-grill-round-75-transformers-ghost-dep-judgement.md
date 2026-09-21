# ADR-0076: Grill Round 75 — transformers ghost-dep 判定性清算（半响触发器 + 在飞修复倡导 + 静态护栏）

## Status

Accepted (implementation round r75). Records the round-75 decisions per the
serial ticket plan T0–T3. Ledger:
`.scratch/grill-round-75/decision-ledger.md` (D-001~D-006, 无断号).
Evidence root: `.scratch/grill-round-75/evidence/`; upstream-submission drafts
(user-gated, not posted by the agent): `.scratch/grill-round-75/drafts/`.

## Context

ADR-0072 shipped the workaround for transformers.js's undeclared external:
`@huggingface/transformers` ships `dist/transformers.node.cjs` with a top-level
bare `require("onnxruntime-common")` that its manifest never declares — npm's
flat hoisting masks it, pnpm isolated scopes expose it. The suspension carried a
deletion condition: *an upstream release that declares the dep*. R75 was opened
because the trigger looked half-fired: transformers 4.x moved
`onnxruntime-node`/`onnxruntime-web` into direct deps — "upstream moved" is not
"the condition fired"; the judgement had to land on the actual specifier.

## Decision

### D1 Half-Fired Trigger → deletion condition still unmet (ledger D-001/D-002)

4.3.0 tarball dissection: the top-level `require("onnxruntime-common")` is still
in `dist/transformers.node.cjs` (~line 13520) and the manifest still does not
declare it. R75 T0 upgraded the static dissection to a runtime reproduction:
under a pnpm isolated-scope fixture (`hoist: false`), `require()` of
`@huggingface/transformers@4.3.0` throws `Cannot find module 'onnxruntime-common'`
at `transformers.node.cjs:13520:33`; `3.8.1` fails identically without the patch
and loads green through the shipped patch + self-declared copy
(`evidence/t0-pnpm-isolated-scope.log`). Honest nuance recorded: pnpm's *default*
virtual-store hoist masks the defect — the break surfaces under `hoist: false`,
`pnpm dlx`, and global-style installs; npm masks until a version conflict.
Verdict: **condition not met — the patch stays** (fail-open design auto no-ops
once upstream declares; a runtime patch is the only mechanism that travels inside
the published tarball — `packageExtensions`/`patchedDependencies` are
consumer-side workspace config, a fork is the end of the road).

### D2 Advocate the in-flight fix instead of re-submitting (D-004)

Upstream battlefield (gh-verified 2026-09-21/22): issue #1087 CLOSED unresolved
(maintainer's `publicHoistPattern` fix covers only the upstream repo's own
build); one-line community PRs #1088/#1089 CLOSED unmerged; maintainer knip PR
#1701 CLOSED unmerged; **PR #1764 (nico-martin, OPEN since 2026-09-03) still
carries the `"onnxruntime-common": "1.24.3"` declaration**. The highest-leverage
contribution is a comment on #1764 landing the 4.3.0 pnpm repro + the
downstream-reinvention ledger (episodic-memory#105, mastra packageExtensions,
GitNexus#2069, our scoped patch — ≥4 independent wheel rebuilds), plus an
optional short #1087 pointer for searchers. Drafts live in
`.scratch/grill-round-75/drafts/`; **posting is a user gate** — the agent does
not perform outbound GitHub actions. Filing success ≠ condition met: the defer
entry stays `open` until #1764 merges AND a release ships the declaration.

### D3 Static invariant guards, not an ESM runtime arm (D-003)

The patch only covers the CJS entry; an ESM consumer (`import`/`import()` of
`transformers.node.mjs`) would bypass it, and the ESM resolver cannot be scoped
without `module.registerHooks` (Stability 1.2, process-global, Node ≥22.15,
inert under jest/vitest loaders). With zero reachable ESM surface, runtime
defense code is negative value — so the invariant is asserted statically in
`packages/embedding/test/transformers-ghost-dep.test.ts`:

- **(a) no-bare-specifier**: no `import`/`from`/`export … from`/dynamic
  `import()` of `@huggingface/transformers` anywhere under `src/` (comments and
  `typeof import(…)` type queries excluded) — the only legal entry is
  `createRequire().require()`. Violation self-proven red (probe file) — plus a
  permanent in-test violation corpus (9 flagged / 5 legal) hardened against the
  three escape paths found by the r75 audit (template-literal specifier, subpath
  specifier, `//`-in-string comment-strip blind spot — the last one documented
  as an accepted limitation: separating `//` from a `/regex/` opener needs a
  real tokenizer, and the guard catches the footgun, not an adversary).
- **(b) version-pairing contract**: `optionalDependencies["onnxruntime-common"]`
  must equal the version embedded by the *effective* `onnxruntime-node`
  (resolved from transformers' own install scope; `.pnpm` store scan fallback
  because pnpm 11 does not materialize a workspace package's optional deps into
  its own `node_modules`). Violation self-proven red (manifest probe).
  (`evidence/t2-guardrails-selfproof.log`)

`registerHooks` is the named return ticket `defer-r75-registerhooks-esm-arm`
with three re-entry triggers: guard red on an ESM load path; #1764 merged +
released (retire wholesale); Node floor ≥22.15 with a real ESM consumer.

### D4 No release, no version bump (D-002/D-006)

This round ships no published-code delta — the runtime patch is untouched, and
the guards are repo-side controls. Therefore no version bump and no release; a
`CHANGELOG.md` `Unreleased` section entry does land (repo convention since r74
logs docs/test-level round artifacts there without bumping) — the no-release
judgement itself is recorded here explicitly rather than left implicit.

## Consequences

- Positive: the defer now rests on runtime-verified evidence for the *current*
  upstream release (not just a tarball read); the upstream comment is drafted
  with a four-project reinvention ledger; two formerly-implicit invariants are
  CI facts; the ESM gap has a named ticket with concrete triggers.
- Negative/cost: guard (b) reads installed state — under `--no-optional`
  installs it reports an explicit SKIP (fail-open, consistent with the arm).
- Watch items: PR #1764 merge status; releases >4.3.0 declaring
  `onnxruntime-common`; the `origin/r71-grill` remote branch is confirmed gone
  (`git ls-remote` 2026-09-22 shows only `main` + PR refs) — carried-over
  listing from r74 closed without action.

## Closure evidence (ledger D-006 four segments)

- **(i) 实证段**: `evidence/t0-pnpm-isolated-scope.{log,md}` — 4.3.0 isolated-scope
  `MODULE_NOT_FOUND` verbatim + 3.8.1 negative control + 3.8.1 patched green +
  default-hoist masking leg.
- **(ii) 申报段**: `drafts/pr-1764-comment.md` (+ optional
  `drafts/issue-1087-comment.md`) — status `待用户发` is the legal terminal
  state; posting link backfilled by the user.
- **(iii) 护栏段**: `packages/embedding/test/transformers-ghost-dep.test.ts` —
  both guards green, both violations self-proven red
  (`evidence/t2-guardrails-selfproof.log`); `turbo check`/`turbo test` green.
- **(iv) 文书段**: this ADR + `gen-adr-index` regen, `deferred-registry.json`
  (entry evidence refresh + `defer-r75-registerhooks-esm-arm`), CONTEXT.md R75
  term block (landed at grill time), pathlint `drafts` dir registration,
  losing-debt explicit continuation in the round report/handoff, `but` commit,
  clean tree.
