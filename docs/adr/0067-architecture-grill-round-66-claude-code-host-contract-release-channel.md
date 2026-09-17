# ADR-0067: Grill Round 66 — Claude Code 真宿主契约对齐 + Plugin 骨架 + OIDC 发布通道

## Status

Accepted (implementation round r66). Records the round-66 decisions per the
serial ticket plan T1–T7. Ledger:
`.scratch/grill-round-66/decision-ledger.md` (D-001..D-007, all current).
Evidence root: `.scratch/grill-round-66/evidence/`.

## Context

Round 65 opened real-host deployment on CodeBuddy. Round 66 is the dual-theme
round: (B) prove the same stack on **real Claude Code 2.1.251** — the host the
adapters were originally written for but never live-verified — and (A) close
the R63 D-006 release debt with an OIDC trusted-publishing channel for `0.0.4`.

The Claude grill surfaced defects the CodeBuddy round could not see — the two
hosts' hook contracts differ materially:

1. **Top-level decision keys are dead on Claude.** R65's claude adapter (and
   `session-start.ts`) emitted `additionalContext` / `updatedToolOutput` at the
   top level — valid-ish on the assumed contract, but Claude Code 2.1.251
   silently drops every bare top-level key. Deny sentinels proved the live
   contract: `hookSpecificOutput.permissionDecision:"deny"` blocks the tool
   call, legacy `{decision:"block"}` blocks it, top-level `permissionDecision`
   is ignored (the tool executes). Everything the adapter wants the host to see
   must sit inside `hookSpecificOutput{hookEventName,...}`.
2. **The shipped `configs/claude/hooks.json` was in a non-schema shape**
   (`{name,command,args}` per hook entry instead of
   `{matcher,hooks:[{type:"command",command}]}`). Claude accepts the file
   silently, then drops the *entire event column* — a sentinel hook mixed into
   the same event stops firing too. Wiring per the shipped template = zero
   hooks, no error.
3. **Pre/PostToolUse hooks run headless but emit zero stream-json events** —
   `hook_started`/`hook_response` appear only for SessionStart. The earlier
   probes misread "no hook events" as "hooks don't run"; marker-file sentinels
   proved they run (and confirmed input-validation failure precedes hook
   dispatch). `type:"http"` hooks in settings are silently dropped — command
   is the only viable hook transport on 2.1.251.
4. **No plugin skeleton existed** — `claude plugin validate <pkg>` failed
   with "No manifest found". `--plugin-dir` / `--plugin-url` exist and work
   as session-scoped loaders.

## Decision

### D1 Dual-theme serial round (ledger D-001; T1–T7)

Theme B (Claude host verification + fixes) must be fully green before Theme A
(release engineering) opens. Measured objects stay honest: published `0.0.3`
for the baseline leg, `pnpm pack` tarballs for the candidate leg — repo build
output never stands in for shipped behavior.

### D2 Envelope + schema + skeleton fix set (ledger D-003/D-004; T3)

- `adapters/claude.ts`: **all** decision keys move inside
  `hookSpecificOutput` — PreToolUse `{additionalContext, updatedToolInput,
  permissionDecision, permissionDecisionReason}`; PostToolUse distilled output
  goes to `hookSpecificOutput.additionalContext` (Claude's PostToolUse has no
  output-rewrite field — `updatedToolOutput` is a CodeBuddy-ism).
- `session-start.ts`: host-split via `--envelope` flag (R66 audit F-03 rework) —
  the generated Claude configs pass it and get
  `hookSpecificOutput{hookEventName:"SessionStart",additionalContext}`; the
  default stays bare `{additionalContext}` for codex/cursor/antigravity.
- `configs/claude/hooks.json`: rewritten to the official settings schema;
  commands are the package's own global bins `ans-hook-claude` /
  `ans-hook-session-start` (new `bin` entries) — resolvable via PATH on every
  OS, no absolute paths, no `${CLAUDE_PLUGIN_*}` vars in the settings path.
- Plugin skeleton: `.claude-plugin/plugin.json` + `hooks/hooks.json` +
  `.mcp.json`, all emitted by `scripts/gen-claude-configs.mjs` from one spec
  (drift guarded by a regen-identical contract test).
  `claude plugin validate` passes on the installed package. Marked
  **experimental**: `hooks/hooks.json` uses `${CLAUDE_PLUGIN_ROOT}` whose
  expansion is broken on Windows (upstream #16116 chain) — settings.json is
  the supported wiring until upstream lands the fix.
- `test/claude-contract.test.ts` (10 tests): envelope shape, official schema,
  bin resolution, skeleton presence, generator drift guard, fail-closed ask,
  both tool-response shapes (full `results[]` vs slim `sufficiency`).

### D3 Host-contract facts pinned by sentinel, not assumption (ledger D-002/D-004; T2/T4)

Deny sentinels (envelope/legacy/top-level), file-marker sentinels
(Pre/PostToolUse on Bash and `mcp__anysearch__.*` matchers), and a synthetic
PostToolUse `/index` round-trip stand in for events Claude does not emit.
P9 A/B is observational: the host model can route around our tools (Bash
`npm view`, WebFetch, built-in browse) — the differential claim is scoped to
queries where the ans_* path is the materially better one.

### D4 Release channel = OIDC trusted publishing (ledger D-005/D-006; T6/T7)

`release.yml` gains a publish job using npm OIDC trusted publishing
(`id-token: write`, `npm publish --provenance`), no long-lived npm token.
The maintainer configures the trusted-publisher link on npmjs.com with the
exact values printed by T6; tag `v0.0.4` + push + publish happen only on
explicit authorization (T7), inside the 72-hour unpublish window with
post-publish `npm view` + provenance + clean-machine smoke verification.

## Closure (回填位 — completed at T7)

(i) Baseline evidence: published `0.0.3` on real Claude Code 2.1.251 —
    `anysearch:connected`, 5 tools listed, live `search_web` call, hooks
    template no-op + synthetic red pair (`hook_event_name` in → silent;
    `event` in → legacy top-level output). F-10 domain defect reproduced.
(ii) Candidate rerun: tarball matrix on the fixed artifacts — shipped
    template (official schema + `ans-hook-*` bins) fires SessionStart with
    the envelope shape; the model quotes the injected routing card verbatim
    (injection→awareness closed loop). `claude plugin validate` passes on the
    installed package; `--plugin-dir` loads the plugin live
    (`plugin:anysearch:anysearch:connected`, plugin SessionStart hook fires,
    `CLAUDE_PLUGIN_ROOT` expands on this machine). PostToolUse→index delta
    is host-variable: the engine's sufficiency gate returned `ambiguous`
    (cross-engine agreement 0) → slim response without `results[]` → the
    adapter legitimately skips indexing; the index path is proven by the
    synthetic `/index` round-trip + contract tests. P9 second run: tools leg
    invoked `search_web`+`ans_chat` and answered 0.0.3 correctly. Live
    PreToolUse enforcement proven by an `URL not on allowlist` deny on a
    host WebFetch call.
(iii) Defect ledger: `.scratch/grill-round-66/evidence/defect-ledger.md` —
    ER-1 (template schema) fixed+validated; ER-2 (envelope) fixed+sentinel-
    proven; ER-3 (skeleton) fixed+`plugin validate` passed; R66-B04..B07
    recorded as contract/observability facts.
(iv) Product surface: `docs/claude-integration.md`, README verified-hosts
    row, `0.0.4` **published via OIDC trusted publishing** — tag `v0.0.4`
    pushed → `release-gate` post-tag assert green → `publish` job
    (id-token:write, no NPM_TOKEN) packed+published all four packages with
    sigstore provenance (`dist.attestations` → slsa.dev/provenance/v1,
    transparency log index 2871163168+). Clean-install smoke:
    `npm i -g @anysearch-cli/{cli,mcp,plugin,embedding}@0.0.4` →
    `ans --version`=0.0.4, `ans doctor` 25/0/0.

## Consequences

- The settings-path hook story on Claude Code is now real: shipped template +
  global bins + envelope-correct adapters, verified end to end.
- The plugin path is packaged and validates, but stays **experimental** until
  `CLAUDE_PLUGIN_ROOT` expansion works on Windows.
- `ans-hook-*` bins make hook commands PATH-resolvable — no per-machine path
  materialization step.
- PostToolUse on Claude surfaces the distilled summary as `additionalContext`
  (there is no sanctioned way to rewrite tool output) — a semantic difference
  from CodeBuddy, documented.
- Future hook work on Claude must not reintroduce bare top-level decision
  keys; `claude-contract.test.ts` + the marker/deny sentinel scripts are the
  regression net.
