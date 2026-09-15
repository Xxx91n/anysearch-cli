# ADR-0064: Grill Round 63 — npm 0.0.1 Go/No-Go Release Adjudication（发布终审：阻塞清零/带病留痕/前置清障）

## Status

Accepted (document round r63). Records the round-63 grill decisions; source
changes landed per ticket plan T1–T8. Ledger:
`.scratch/grill-round-63/decision-ledger.md` (D-001..D-008, all current).

## Context

Round-62 (ADR-0063) made the product measurably usable and terminated in an
explicit npm 0.0.1 go/no-go adjudication. Its audit surfaced one blocker
(`con_add_then_noop` — consolidation dedup was inert without the embedding
arm), a publish-shape question (bundled CLI vs publish-everything), a
governance gap (the 10 quarantined live-drift entries had no ratchet), and
audit-rework tails (F-1..F-5). Round-63 runs the terminal review and clears
each item into one of three exits: release blocker (fixed first), carried
known-limitation (minuted with owner/due/criterion), or post-0.0.1 scheduling.

## Decision

### D1 Theme = npm 0.0.1 go/no-go 终审 + 前置清障逐项过堂 (ledger D-001)

Three-exit disposition per item; terminal state = machine-verifiable release
adjudication document + (on GO) a release execution ticket. `npm publish` is
irreversible past the 72h window — the grill adjudicates plan and gates only;
execution actions are separately authorized at run time.

### D2 con_add_then_noop: production fix as release blocker (ledger D-002; T1)

`decideOp` gains a no-embedding branch: when no cosine similarity is
computable (arm absent or stored embedding missing), `bestJac > θ_jac` with
**θ_jac = 0.80** returns `noop` — calibrated against the golden set (distinct
stubs 0.000 / identical rerun 1.000 / contradiction-pair ceiling ~0.714; the
existing `0.4` update threshold stays distinct). Degraded decisions are
counted in `ConsolidateReport.embeddingAbsent` (not silent, ADR-0060 D7).
Explicitly not done: no case moved into `OFFLINE_EXCLUDED_GROUPS`, no ship-gate
assertion relaxed, no stub of the embedding seam. The loss is honest:
paraphrase-level duplicates are not caught on FTS-only installs — recorded in
README Known Limitations + release notes.

### D3 Quarantine ratchet — shrink-only set + forced rulings (ledger D-003; T3/T6)

`scripts/quarantine-ratchet.mjs` asserts over `eval-quarantine.json` against
frozen baseline `eval-quarantine.baseline.json` (the ratified 10):
entries ⊆ baseline (new id = red), `renewals === 0` (renewal = red), an entry
past `expiresAt` without a promote/retire/longterm ruling = red. The ledger
gains a `longterm` decision — permanent known-issue conversion capped at
`QUARANTINE_MAX_LONGTERM = 1` (anti infinite-deferral). T6 pre-registers the
root-cause investigation (`.scratch/grill-round-63/t6-live-drift-investigation.md`):
single dominant cause = provider URL-shape drift vs byte-exact `urlHit`
assertion; RRF/www-normalization hypotheses rejected; ruling deadline
2026-10-14.

### D4 Audit rework merged into release prerequisites (ledger D-004; T4)

F-1 README Known Limitations (exit-time libc++abi rewrites abstain exit code
— empirically on Windows; macOS registration-segment red at probe #1). F-2
ship-gate ④ strengthened to job+step double assertion. F-3 probe OUT_DIR
retargeted to round-62 (r61 SKIPPED originals preserved). F-4 seven R61/R62
terms carry `_Avoid_` lines. F-5 optional abstain-path repro leg landed in
`macos-exit-probe.mjs`. Sharp-tool cuts: `.gitignore:41` comment now states
the D5c policy; `embedding-arm.ts` header documents the T1 degrade.

### D5 Bundled-CLI publish shape (ledger D-005; T2/T5)

Publish set = `@anysearch-cli/{cli,mcp,plugin}` + `@anysearch-cli/embedding`
(4 packages, `publishConfig.access: "public"`, `license: Apache-2.0`,
`repository` set). Bundled internals move `dependencies` → `devDependencies`
(honest build-time declarations; kernel/store/retriever never publish).
`@anysearch-cli/embedding` is `peerDependencies` + `peerDependenciesMeta.optional`
— never `optionalDependencies` (the auto-install bomb) — and is itself
published so the explicit-install channel exists; a real dist build is added
(`tsup` ESM) with `publishConfig.exports` rewriting `src` → `dist` at pack
(dev keeps resolving `src/index.ts`). ship-gate step 5 asserts packed
manifests carry no `@anysearch-cli/*` in `dependencies`, the peer-optional
declaration is present, and `dist` holds no bare `require/import` of bundled
internals (embedding excluded by design). install-smoke + ship-gate 4b/4c
verify the consumer-real shape: app tarballs only, internal packages absent
from the install closure, embedding NOT auto-installed, and the dual-install
leg (`npm i` cli tarball + embedding tarball) lands both at the shared
node_modules root with `import('@anysearch-cli/embedding')` resolvable from the
installed cli. Recorded measurement (T2 spec artifact): dev-mode `pnpm install`
auto-links the workspace peer (`@anysearch-cli/embedding: link:` under the app
importers in pnpm-lock.yaml) — no dev-experience remedy needed.

**Canonical-rewrite exemption criteria** (D-005/D-008): a tarball-vs-repo
manifest diff is exempt from drift-face review iff (a) the rewrite is a
package-manager canonical semantic (pnpm publish/pack rewriting
`workspace:*` → concrete version, `publishConfig` field overrides), and
(b) the result is deterministically derivable from the repo manifest. Custom
transformers are never exempt (getlang broken-package precedent).

### D6 Manual first release (ledger D-006)

0.0.1 publishes from the user's logged-in machine via `pnpm -r publish`
(3 apps + embedding). No npm provenance attestation — trusted-publisher setup
requires the packages to exist first; per-package OIDC is configured after
0.0.1 lands and CI carries provenance from 0.0.2. The absence is labeled
verbatim in release notes — a known D-006 consequence, not a defect.
Sequence: T1–T7 landed → main-tip ci+ship-gate double green → `release.yml`
pre-tag dispatch → `git tag v0.0.1` → post-tag checks → local publish →
clean-machine self-verify inside the 72h unpublish window
(`--min-release-age=0` or exact-version install; docs/publishing.md).

### D7 Serial ticket plan + license (ledger D-007)

T1 dedup → T2 publish shape → T3 ratchet → T4 rework → T5 release-verification
→ T6 drift investigation (non-blocking) → T7 release materials → T8 go/no-go +
execution. Dependencies honored: T5 needs T2; T7 needs T1–T5; T8 last.
License = **Apache-2.0** (user-selected; hard to retract post-publish).

### D8 Closure evidence — four-part structure (ledger D-008)

(i) main-tip `ci` + `ship-gate` green run URLs after T1–T7 land — labeled
honestly as *resolvable self-witness* (producer and adjudicated object share
origin; anchors independently replayable via `gh run list`), not external
witnessing — under a manual release the publish event itself has no witness.
(ii) the go/no-go adjudication document reconciles every D-xxx (blockers
cleared / carried items minuted / prerequisites landed). (iii) on GO:
`npm view` output + tag/release URL + clean-machine self-verification inside
the 72h window (registry pull, min-release-age override, FTS-only smoke) +
registry manifest re-check + the "no provenance" statement. (iv) on NO-GO:
explicit gap list + event-driven re-review trigger (blocker fixed + main-tip
double green) + 30-day calendar fallback. Each carried item gets owner + due
+ closure criterion + delegated adjudication authority. Options B (workflow
self-witness — circular) and C (no ADR — unanchored) rejected.

## Consequences

- Release-blocking defect cleared (T1); offline eval stays 126/126 green.
- npm publish set is exactly four packages; the install closure of
  `npm i -g @anysearch-cli/cli` contains no onnxruntime/transformers and no
  internal packages.
- Quarantine set is machine-governed (ratchet) — silent expansion, renewal,
  or unruled expiry all fail ship-gate.
- 0.0.1 carries no provenance; 0.0.2 restores it via trusted publishers.

## Closure evidence

Filled by T8 at adjudication time (four-part structure per D8):

| leg | anchor | status |
|---|---|---|
| T1–T7 landed + main-tip double green | main `48db4cf` — ci/ship-gate/native-smoke 全绿（gh run list）| done |
| go/no-go adjudication document | `.scratch/grill-round-63/go-no-go-0.0.1.md`（GO WITH CAVEATS）| done |
| GO: registry + tag + clean-install evidence | `npm view @anysearch-cli/*` latest=0.0.3 四包在册；tag `v0.0.3`→48db4cf post-tag assert 绿；净机 npm i -g → ans --version=0.0.3 / doctor 22p-0f / search 实返 | done |
| carried items minuted | owner/due/criterion table | done（provenance caveat 顺延 0.0.4）|

实际发布版本 0.0.3：0.0.1/0.0.2 因 npm publish <dir> 不改写 workspace:* peer 烧损作废（见 CHANGELOG）；scope 改 @anysearch-cli（anysearch org 被蹲占）；发布通道=pnpm pack tarball + npm publish <tgz>（passkey-2FA 下 pnpm 无 WebAuthn 通道）。
