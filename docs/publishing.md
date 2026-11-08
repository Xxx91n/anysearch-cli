# Publishing

## OIDC trusted publishing (0.0.4 and later)

`release.yml` has a `publish` job. It runs when a tag is pushed and after
`release-gate` is green. The job has `id-token: write`. npm ≥11.5.1 does the
OIDC handshake itself and emits sigstore provenance. **No `NPM_TOKEN` exists
anywhere.**

### Maintainer setup (one time, fill it in exactly)

Do this for EACH of the five publishable packages (`@anysearch-cli/cli`,
`@anysearch-cli/mcp`, `@anysearch-cli/plugin`, `@anysearch-cli/embedding`,
`@anysearch-cli/dsh-plugin`). Read "First publish of a NEW package" below
before you try to save its trusted-publisher row.

1. Go to npmjs.com, open the package page, then **Settings** →
   **Publishing access** → **Trusted Publisher** → **GitHub Actions**.
2. Fill in exactly:
   - Repository owner: `Xxx91n`
   - Repository name: `anysearch-cli`
   - Workflow filename: `release.yml`
   - Environment: *(leave empty — the job has no environment)*
3. Save. The package must already exist on npm. It does, because 0.0.3 was
   published by hand.

After the setup, the release sequence is:

```bash
# 1. run the pre-tag release gate (the check that decides the release)
gh workflow run release.yml -f runPurpose=pre-tag
# 2. when green: tag + push (authorized step)
git tag v0.0.4 && git push origin v0.0.4
# 3. tag push → gate re-asserts → publish job runs → npm + provenance
```

Check the result afterwards:

```bash
npm view @anysearch-cli/cli@0.0.4 --json | jq '{version,license,dist}'
npm view @anysearch-cli/cli@0.0.4 dist.attestations --json   # sigstore provenance
npm i -g @anysearch-cli/cli@0.0.4 && ans --version && ans doctor
```

If a publish goes wrong, do not reach for `npm unpublish`. First classify
the failure under "Publish failure classification" below (C1/C2a/C2b/C3),
then patch forward. Running `npm unpublish @anysearch-cli/<pkg>@<ver>` inside
the 72h window is only for catastrophic accidents.

## Manual first release (0.0.3 — historical, D-006)

npm `0.0.3` was a **manual** first release. No `release.yml` provenance was
emitted (D-006; this is a known consequence, not a defect. Provenance needs
a cloud-hosted runner, and a manual `pnpm publish` does not have one).

## Publish set

There are five packages, all with `publishConfig.access: "public"`
(`@anysearch-cli/dsh-plugin` also declares `provenance: true`):

| package | shape |
|---|---|
| `@anysearch-cli/cli` | bundled app — `@anysearch-cli/{kernel,store,retriever,plugin}` are devDependencies (bundled into `dist`), `@anysearch-cli/embedding` is an optional peer |
| `@anysearch-cli/mcp` | same |
| `@anysearch-cli/plugin` | same |
| `@anysearch-cli/embedding` | real dist build (`publishConfig.exports` swaps `src` → `dist/index.js` at pack) |
| `@anysearch-cli/dsh-plugin` | esbuild ESM bundle (`lib/index.js` + `cordis.patch.yml` + `AGENTS.md`; `@deepseek-ai/*` external — host-provided at runtime, never bundled) |

`kernel`, `store`, and `retriever` are never published. Bundling makes them
build-time only. `@anysearch-cli/embedding` is `peerDependencies` +
`peerDependenciesMeta.optional`: it is never installed automatically, there is
no warning when it is missing, and installing it by hand turns on the vector
path (FTS-only is a supported state).

## First publish of a NEW package (pre-publish path, D-003)

OIDC trusted publishing needs the package to EXIST on npm already. The
trusted-publisher row attaches to an existing package page. A brand-new
package therefore goes through four steps before the normal release. This
follows the 0.0.3 manual-first precedent and is now written down for
dsh-plugin@0.0.8:

1. **Manual first publish (user action).** Check out a commit where the
   package is ready to publish at the pre-bump version (for dsh-plugin:
   private:false + publishConfig + `version: 0.0.7`). Then run
   `cd apps/dsh-plugin && pnpm publish` (or `npm publish <packaged tgz>`
   against the verified tarball). The published artifact is the REAL
   package, never a placeholder shell. A local manual publish emits no
   provenance (the D-006 consequence class, recorded).
2. **Configure the Trusted Publisher on npmjs.** Package page → Settings →
   Publishing access → Trusted Publisher → GitHub Actions: repository owner
   `Xxx91n`, repository name `anysearch-cli`, workflow filename
   `release.yml`, environment *(empty)*. **Since 2026-05-20 npm also requires
   an explicit allowed-actions selection. Tick `npm publish`** or the OIDC
   exchange is rejected. (Trusted Publisher slots: up to 10 per package.)
3. **Tag the version.** Run `git tag v0.0.8 && git push origin v0.0.8` (user
   action) once steps 1 and 2 are confirmed. The publish job then ships all
   five packages through OIDC + sigstore provenance. dsh-plugin's provenance
   coverage starts at 0.0.8; the manual 0.0.7 has none.
4. **Verify.** Run `npm view @anysearch-cli/dsh-plugin dist.attestations`,
   then install the published version and run a smoke check.

**No-go branch — do NOT ship a partial manifest.** If step 1 or step 2 is
not ready, the v0.0.8 tag SLIPS (`顺延`). Do not drop dsh-plugin from the
pack list just to get the tag out. A tag whose OIDC step hits `ENEEDAUTH` on
a new package is a red release run, and editing the list by hand under time
pressure is exactly how manifests drift.

**What provenance proves, and what it does not.** Sigstore provenance attests
**origin** — which repo, workflow, and ref produced the artifact. It does
NOT attest **integrity**: it does not prove the source tree was unmodified,
or that the deployed artifact is bit-for-bit the one that was reviewed.
Treat provenance as a supply-chain **attribution** signal, not a tamper
seal. Integrity assurance still comes from review and the gates above.

## Sequence

1. `pnpm install && pnpm build` (turbo builds all; embedding's `prepack`
   rebuilds dist).
2. `pnpm -r publish` on the publish set — **user-authorized only**
   (irreversible: registry data cannot be changed; see the unpublish
   boundary below).
3. Post-tag checks run through `release.yml` after `git tag v0.0.3` (user-run).

## Publish failure classification (D-004)

The release workflow publishes five tarballs one after another. npm cannot
publish several packages atomically, so a failure in the middle leaves a
partially landed set. Classify the case before you act:

- **C1 — zero packages landed** (for example, the OIDC/trusted-publishing
  step fails on the first package). Fix the cause, then run `gh run rerun` on
  the same tag. The R1 idempotent skip makes a rerun a no-op for anything
  that already landed.
- **C2a — partial set, infrastructure cause** (runner or network failure
  after N packages). Fix the cause and rerun. Landed packages skip through
  R1, the rest publish, and the set heals itself.
- **C2b — partial set, published content is bad** (for example, a broken
  tarball landed). **Patch forward, never unpublish.** Fix in the tree, bump
  to the next patch version, tag, and republish. The bad version stays in
  registry history by design.
- **C3 — all five landed, but install/smoke fails.** Run `npm deprecate` on
  the bad version with a pointer message, then patch forward. Deprecation
  warns installers without rewriting history.

**Unpublish boundary** — `npm unpublish` is only for catastrophic accidents
(credential leak, wrong-package publish, license violation). It is never the
first response to a failed or partial release. It rewrites registry history,
breaks lockfiles that already resolved the version, and the 72h window makes
it fragile under pressure. The default is to patch forward.

## Install verification (within the 72h unpublish window)

The npm CLI has **no release-age gate**. `min-release-age` is unknown
project config to npm 11: npm warns about it and ignores it. So a freshly
published `@anysearch-cli/cli` can be installed right away. Check it yourself
inside the unpublish window by installing the exact version:

    npm i -g @anysearch-cli/cli@0.0.3          # exact version — there is no npm age gate to override
    npm i -g @anysearch-cli/embedding@0.0.3    # optional peer package

Or install the packed tarballs directly (ship-gate step 4b/4c does exactly
this). Then drive the same commands that install-smoke drives:

    ans --version && ans doctor && ans domain docs && ans doctor

Release-age gating exists only on the **pnpm side, for installs run inside
this repo**. `pnpm-workspace.yaml` pins `minimumReleaseAge: 2880` (minutes,
which is 2 days; verified through `pnpm config get minimum-release-age`). The
repo `.npmrc` still has `min-release-age=2`. It does nothing: npm treats it
as unknown config, and pnpm v11 reads `.npmrc` only for auth/registry keys
(`pnpm config get` returns `undefined` for it). It is kept as a record of
intent. The working gate is in `pnpm-workspace.yaml`. Registry consumers are
unaffected either way, because a repo `.npmrc`/`pnpm-workspace.yaml` never
reaches `npm i -g` users.

Registry manifest check (versions / dist-tags.latest / access / repository):

    npm view @anysearch-cli/cli@0.0.3 --json | jq '{version,license,repository}'
