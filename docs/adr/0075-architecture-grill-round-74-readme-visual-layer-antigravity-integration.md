# ADR-0075: Grill Round 74 — README 视觉层 + Antigravity 集成专文（surgical 打磨）

## Status

Accepted (implementation round r74). Records the round-74 decisions per the
serial ticket plan T0–T3. Ledger:
`.scratch/grill-round-74/decision-ledger.md` (D-001~D-006, 无断号).
Evidence root: `.scratch/grill-round-74/evidence/`.

## Context

R68–R70 made the README bilingual and parity-gated, but the page carried
zero visual assets (only three shields badges), the `Verified agent hosts`
table carried paragraph-long cells (>400 chars per row), and `agy` — the
host adapted in ADR-0069 — was the only verified host without an
integration doc: its live-verified contract details lived only inside the
table cell and `.scratch` evidence. The round scope was a landing-page
upgrade that preserves the verified honest-copy spine — no wholesale
rewrite, no invented claims.

## Decision

### D1 Surgical scope over rewrite (ledger D-001)

Keep the information architecture and the evidence spine; only replace
weak or missing presentation (visual layer, proof block, table density).
The heading skeleton is preserved — parity leg (i) stays green by
construction; the single new section `## How it works` (Mermaid) is
inserted before `## Verified agent hosts` in both files.

### D2 Pure-SVG visual layer on a project-native motif (D-002/D-003)

The motif is the **domain gate** — derived from the real differentiator
(`urlAllowlist` kernel gate + abstain-first), not a generic search icon.
Every glyph element maps a real system module: three provider rays
(retriever fan-out), twin gate bars (pre-filter + post-filter), the
boundary frame (domain TOML border), the landing dot (fused result into
store), the amber cross (abstain stop). The repo-logo concept gate ran in
full: three written concepts with visual anatomy + element-module tables
were presented, and the user selected concept 1 (`logo-concepts.md`).

- `assets/readme/logo.svg` — 256² dark tile (own background → identical on
  light/dark GitHub themes), legible at 16px.
- `assets/readme/hero.svg` — `1200`-unit viewBox; left = wordmark +
  plain-language value + install metadata + the same mark; right = the
  domain-gate schematic (fan-out → `urlAllowlist` gate → landed rows
  inside + abstain card outside the boundary).
- Both are self-contained: no `foreignObject`, no scripts, no remote
  fonts/images, no GitHub-stripped CSS; system font stacks only.
- Render-verified via Playwright + Chromium at 900px GitHub width, 360px
  narrow width, dark and light page backgrounds, and 16px thumbnail
  (`evidence/t1-render-check.png`, `evidence/t1-render-verification.md`).

### D3 Evidence-migration precondition for table slimming (D-004)

`docs/antigravity-integration.md` was created and committed **before**
the table-slimming commit — a slimming commit must not carry net evidence
loss. The agy contract moved there from the table cell and r68 evidence:
named-hook map shape, camelCase stdin, strict protojson (`{}`=DENY on
PreToolUse, empty=allow, decision object fields), event-via-argv, five
events with no SessionStart, `call_mcp_tool` umbrella unwrap,
pending-staging → `injectSteps[].ephemeralMessage`, IDE-does-not-execute-
hooks → `.antigravity/rules/anysearch.mdc` fallback, and the isolated-`HOME`
probe method. The slimmed table keeps Host / Version / Verified scope /
Status (verdict phrase + per-host doc pointer); the Date column is
absorbed into the per-host docs.

### D4 Real-output proof block (D-003)

`ANS_DOMAIN=docs ans search "model context protocol"` was captured live
2026-09-20 (every returned URL inside the `urlAllowlist`) and placed with
the canonical abstain line immediately after the status paragraph —
evidence precedes claims in reading order. The fenced block is
byte-identical in both READMEs (parity leg ii).

### D5 Serial gates + lockstep bilingual (D-005/D-006)

T0 plan→confirmation → T1 concepts→selection→assets → T2 content →
T3 closeout, in order with two user gates observed. EN and zh-CN edits
land in the same commit; parity four legs green (12 headings 1:1 / 7
code blocks byte-identical / 14 links identical / limitations pointer
live); `audit_readme.py` passes both files; `ship-gate --quick` green
including step 1h parity and step 1i pathlint (263 docs clean).

## Consequences

- Positive: the README now answers in three seconds (domain-gate hero
  board), shows proof before promises (real transcript + abstain line),
  explains the mechanism in one diagram, and keeps a scannable hosts
  table; the agy contract gained a permanent doc home; zero claims
  drifted — every new line maps to repository evidence.
- Negative/cost: the proof block is a dated transcript — provider names
  and abstain wording can drift upstream; re-capture if the output
  contract changes. The SVG mark would be the source for any future
  bitmap matrix (see deferred entry).
- Watch items: the `origin/r71-grill` cleanup listing is moot —
  `git ls-remote` shows the remote branch no longer exists (only
  `main` remains); nothing was deleted this round.

## Closure evidence (ledger D-006 four segments)

- **(i) Plan artifact + confirmation**: `.scratch/grill-round-74/plan.md`
  (commit `plo`) — SCAN facts, 11-item diagnosis, section plan, asset
  job list.
- **(ii) SVG assets + selection record**: `logo-concepts.md` (3 concepts,
  user selected 概念1), `assets/readme/{logo,hero}.svg` (commit `ort`),
  render verification `evidence/t1-render-*`.
- **(iii) Bilingual diff + parity + docs**: README/README.zh-CN lockstep
  (commit `xst`), `docs/antigravity-integration.md` (commit `szz`,
  preceding the slimming commit), hard-compare matrix in the round
  report, `audit_readme.py` OK on both files, zero claim drift.
- **(iv) Closeout set**: this ADR + `gen-adr-index` regen (75 ADRs),
  CHANGELOG `Unreleased` entry, `deferred-registry.json` appended with
  `defer-r74-logo-bitmap-matrix` (12 entries), found/fixed/deferred
  triad in `.scratch/grill-round-74/reports/2026-09-20-report.md`,
  pathlint covers round-74 via the `.scratch/**/*.md` glob, `ship-gate
  --quick` green, working tree clean.
