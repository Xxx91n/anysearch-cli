# Publishing

## OIDC trusted publishing (0.0.4+, ADR-0067 D4)

`release.yml` carries a `publish` job that runs on tag push after
`release-gate` is green. It holds `id-token: write`; npm ≥11.5.1 performs the
OIDC handshake itself and emits sigstore provenance — **no `NPM_TOKEN` exists
anywhere**.

### Maintainer setup (one-time, verbatim)

For EACH of the five publishable packages (`@anysearch-cli/cli`,
`@anysearch-cli/mcp`, `@anysearch-cli/plugin`, `@anysearch-cli/embedding`,
`@anysearch-cli/dsh-plugin` — see "First publish of a NEW package" below
before its trusted-publisher row can be saved):

1. npmjs.com → package page → **Settings** → **Publishing access** →
   **Trusted Publisher** → **GitHub Actions**.
2. Fill exactly:
   - Repository owner: `Xxx91n`
   - Repository name: `anysearch-cli`
   - Workflow filename: `release.yml`
   - Environment: *(leave empty — the job has no environment)*
3. Save. The package must exist already (it does — published manually at 0.0.3).

Then the release sequence is:

```bash
# 1. spend the OF look (decision-grade gate)
gh workflow run release.yml -f runPurpose=pre-tag
# 2. when green: tag + push (authorized step)
git tag v0.0.4 && git push origin v0.0.4
# 3. tag push → gate re-asserts → publish job runs → npm + provenance
```

Verify afterwards:

```bash
npm view @anysearch-cli/cli@0.0.4 --json | jq '{version,license,dist}'
npm view @anysearch-cli/cli@0.0.4 dist.attestations --json   # sigstore provenance
npm i -g @anysearch-cli/cli@0.0.4 && ans --version && ans doctor
```

If a publish goes wrong inside the 72h unpublish window:
`npm unpublish @anysearch-cli/<pkg>@0.0.4` per package.

## Manual first release (0.0.3 — historical, D-006)

npm `0.0.3` is a **manual** first release: no `release.yml` provenance is emitted
(ADR-0064 D-006; this is a known consequence, not a defect — provenance requires
a cloud-hosted runner which manual `pnpm publish` does not have).

## Publish set

Five packages, all `publishConfig.access: "public"`
(`@anysearch-cli/dsh-plugin` additionally declares `provenance: true`):

| package | shape |
|---|---|
| `@anysearch-cli/cli` | bundled app — `@anysearch-cli/{kernel,store,retriever,plugin}` are devDependencies (bundled into `dist`), `@anysearch-cli/embedding` is an optional peer |
| `@anysearch-cli/mcp` | same |
| `@anysearch-cli/plugin` | same |
| `@anysearch-cli/embedding` | real dist build (`publishConfig.exports` swaps `src` → `dist/index.js` at pack) |
| `@anysearch-cli/dsh-plugin` | esbuild ESM bundle (`lib/index.js` + `cordis.patch.yml` + `AGENTS.md`; `@deepseek-ai/*` external — host-provided at runtime, never bundled) |

`kernel`, `store`, `retriever` are never published — bundling makes them
build-time-only. `@anysearch-cli/embedding` is `peerDependencies` +
`peerDependenciesMeta.optional`: never auto-installed, no warning when absent,
explicit install enables the vector arm (FTS-only is a supported state).

## First publish of a NEW package (pre-publish path, ADR-0081 D-003)

OIDC trusted publishing requires the package to EXIST on npm already —
the trusted-publisher row attaches to an existing package page. A brand-new
package therefore takes a four-step pre-publish path (0.0.3 manual-first
precedent, now codified for dsh-plugin@0.0.8):

1. **Manual first publish (user action)** — check out a commit where the
   package is publish-ready at the pre-bump version (for dsh-plugin:
   private:false + publishConfig + `version: 0.0.7`), then
   `cd apps/dsh-plugin && pnpm publish` (or `npm publish <packaged tgz>`
   against the verified tarball). The published artifact is the REAL
   package — never a placeholder shell. No provenance is emitted by a
   local manual publish (ADR-0064 D-006 consequence class, recorded).
2. **Configure the Trusted Publisher on npmjs** — package page →
   Settings → Publishing access → Trusted Publisher → GitHub Actions:
   repository owner `Xxx91n`, repository name `anysearch-cli`,
   workflow filename `release.yml`, environment *(empty)*.
   **Since 2026-05-20 npm also requires an explicit allowed-actions
   selection — tick `npm publish`** or the OIDC exchange is rejected.
   (TP slots: up to 10 per package.)
3. **Tag the train** — `git tag v0.0.8 && git push origin v0.0.8` (user
   action) once steps 1–2 are confirmed. The publish job then ships all
   five packages via OIDC + sigstore provenance; dsh-plugin's provenance
   coverage starts at 0.0.8 (the manual 0.0.7 carries none).
4. **Verify** — `npm view @anysearch-cli/dsh-plugin dist.attestations`
   + install-and-run smoke on the published version.

**No-go branch — do NOT ship a partial manifest.** If step 1 or 2 is not
ready, the v0.0.8 tag SLIPS (`顺延`) rather than temporarily dropping
dsh-plugin from the pack list — a tag whose OIDC leg hits ENEEDAUTH on a
new package is a red release run, and ad-hoc list surgery under time
pressure is exactly how manifests drift.

**Provenance boundary note (Miasma lesson).** Sigstore provenance attests
**origin** — which repo/workflow/ref produced the artifact — NOT
**integrity**: it does not prove the source tree was unmodified or the
deployed artifact bit-identical to a reviewed one. Treat provenance as a
supply-chain *attribution* signal, not a tamper seal; integrity assurance
still lives in review + the gates above.

## Sequence

1. `pnpm install && pnpm build` (turbo builds all; embedding's `prepack` rebuilds dist).
2. `pnpm -r publish` on the publish set — **user-authorized only** (irreversible:
   registry data is immutable; see CONTEXT.md — Unpublish Window).
3. Post-tag checks run via `release.yml` after `git tag v0.0.3` (user-run).

## Publish failure classification (ADR-0082 D-004)

The release workflow publishes five tarballs sequentially; npm has no
multi-package atomic publish, so a mid-loop failure leaves a partially
landed set. Classify before acting:

- **C1 — zero packages landed** (e.g. OIDC/trusted-publishing failure on
  the first package): fix the cause, then `gh run rerun` on the same tag.
  The R1 idempotent skip makes rerun a no-op for anything already landed.
- **C2a — partial set, infrastructure cause** (runner/network failure
  after N packages): fix the cause, rerun — landed packages skip via R1,
  the remainder publishes; the set self-heals.
- **C2b — partial set, published content bad** (e.g. a broken tarball
  landed): **patch-forward, never unpublish** — fix in-tree, bump to the
  next patch version, tag, republish. The bad version stays in registry
  history by design.
- **C3 — all five landed, install/smoke fails**: `npm deprecate` the bad
  version with a pointer message, then patch-forward. Deprecation warns
  installers without rewriting history.

**Unpublish boundary** — `npm unpublish` is reserved for catastrophic
accidents only (credential leak, wrong-package publish, license
violation). It is never a first response to a failed or partial release:
it rewrites registry history, breaks lockfiles that already resolved the
version, and the 72h window makes it fragile under pressure. Default =
patch-forward.

## Install verification (within the 72h unpublish window)

The npm CLI has **no release-age gate**: `min-release-age` is unknown project
config to npm 11 (warned about and ignored), so a freshly published
`@anysearch-cli/cli` is installable immediately. Self-verify inside the unpublish
window by installing the exact version:

    npm i -g @anysearch-cli/cli@0.0.3          # exact version — there is no npm age gate to override
    npm i -g @anysearch-cli/embedding@0.0.3    # optional peer arm

or install the packed tarballs directly (ship-gate step 4b/4c does exactly this).
Then drive the same surface install-smoke drives:

    ans --version && ans doctor && ans domain docs && ans doctor

Release-age gating exists only on the **pnpm side, for installs run inside this
repo**: `pnpm-workspace.yaml` pins `minimumReleaseAge: 2880` (minutes = 2 days;
verified via `pnpm config get minimum-release-age`). The repo `.npmrc` still
carries `min-release-age=2` — it is inert: npm treats it as unknown config and
pnpm v11 reads `.npmrc` for auth/registry keys only (`pnpm config get` returns
`undefined` for it). It is kept as the record of intent; the working gate lives
in `pnpm-workspace.yaml`. Registry consumers are unaffected either way — a repo
`.npmrc`/`pnpm-workspace.yaml` never reaches `npm i -g` users.

Registry manifest check (versions / dist-tags.latest / access / repository):

    npm view @anysearch-cli/cli@0.0.3 --json | jq '{version,license,repository}'
