# Publishing (manual first release — D-006)

npm `0.0.2` is a **manual** first release: no `release.yml` provenance is emitted
(ADR-0064 D-006; this is a known consequence, not a defect — provenance requires
a cloud-hosted runner which manual `pnpm publish` does not have).

## Publish set

Four packages, all `publishConfig.access: "public"`:

| package | shape |
|---|---|
| `@anysearch-cli/cli` | bundled app — `@anysearch-cli/{kernel,store,retriever,plugin}` are devDependencies (bundled into `dist`), `@anysearch-cli/embedding` is an optional peer |
| `@anysearch-cli/mcp` | same |
| `@anysearch-cli/plugin` | same |
| `@anysearch-cli/embedding` | real dist build (`publishConfig.exports` swaps `src` → `dist/index.js` at pack) |

`kernel`, `store`, `retriever` are never published — bundling makes them
build-time-only. `@anysearch-cli/embedding` is `peerDependencies` +
`peerDependenciesMeta.optional`: never auto-installed, no warning when absent,
explicit install enables the vector arm (FTS-only is a supported state).

## Sequence

1. `pnpm install && pnpm build` (turbo builds all; embedding's `prepack` rebuilds dist).
2. `pnpm -r publish` on the publish set — **user-authorized only** (irreversible:
   registry data is immutable; see CONTEXT.md — Unpublish Window).
3. Post-tag checks run via `release.yml` after `git tag v0.0.2` (user-run).

## Install verification (within the 72h unpublish window)

The npm CLI has **no release-age gate**: `min-release-age` is unknown project
config to npm 11 (warned about and ignored), so a freshly published
`@anysearch-cli/cli` is installable immediately. Self-verify inside the unpublish
window by installing the exact version:

    npm i -g @anysearch-cli/cli@0.0.2          # exact version — there is no npm age gate to override
    npm i -g @anysearch-cli/embedding@0.0.2    # optional peer arm

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

    npm view @anysearch-cli/cli@0.0.2 --json | jq '{version,license,repository}'
