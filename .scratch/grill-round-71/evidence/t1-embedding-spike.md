# R71 T1 — embedding dual-arm install spike (npm + pnpm)

Date: 2026-09-18/19. Host: Windows 11, Git Bash, Node v24.11.0, pnpm 11.24.0, npm 11.19.1.
Arms: `npm i -g --prefix <tmp>` and `pnpm add -g --dir <tmp>` (PNPM_HOME isolated), each with
`@anysearch-cli/cli@0.0.5` + `@anysearch-cli/embedding@0.0.5`, `ANS_DB_PATH` per arm, rows seeded
directly into `retrieval_results` (same shape as `SessionStore.saveResults`).

## Verdict

| assertion | npm arm | pnpm arm |
|---|---|---|
| (a) doctor reports vector arm | PASS `[OK] vector arm (present …)` | **RED → FIXED** `[SKIP] absent` → after fix `[OK] present` |
| (b) backfill-vectors on existing memory | PASS `backfilled 3/3` | **RED → FIXED** `0/1 failed` → after fix `backfilled 2/2` |
| (c) uninstall → FTS/Jaccard degrade, no regression | PASS `[SKIP]` + `ans search` exit 0 | PASS `[SKIP]` + `ans search` exit 0 |
| (d) first-use download failure → actionable guidance | **RED → FIXED** raw `ENOTDIR` + bare count → `hint:` line added | same fix |

## Break found (pnpm arm) and repair — D-003(iv) "修断点本体"

Two stacked upstream-layout breaks, both repaired in-tree:

1. **Sibling-root resolution.** `pnpm add -g` installs each top-level package in its own
   `<prefix>/global/v11/<hash>/node_modules` tree. The bundled `import("@anysearch-cli/embedding")`
   cannot reach across roots → arm absent. Fix: `packages/store/src/embedding-arm.ts` gains a
   fallback that anchors at `argv[1]` (the bin-shim target preserves the layout path) + the module
   file, walks ancestors, and scans `*/node_modules/@anysearch-cli/embedding` sibling roots.
   Unit test: synthetic `v11/<hashA>/<hashB>` layout in `packages/store/test/embedding-arm.test.ts`
   (16 assertions). Integration: `scripts/install-smoke.mjs` leg 3c junction-simulates the layout
   under `--preserve-symlinks --preserve-symlinks-main` (28/28 pass).

2. **Undeclared transitive external.** `transformers.node.cjs` does `require("onnxruntime-common")`
   but `@huggingface/transformers@3.8.1` never declares it — npm flat-hoisting masks it; pnpm's
   isolated scopes expose it (`Cannot find module 'onnxruntime-common'`). Fix:
   `packages/embedding/package.json` declares `onnxruntime-common@1.21.0` (optionalDependencies;
   matches the `onnxruntime-node@1.21.0` exact pin) and `packages/embedding/src/index.ts` (i)
   switches the lazy load to `createRequire(...).require(...)` so the CJS entry is used and (ii)
   installs a scoped `Module._resolveFilename` patch — only `onnxruntime-common`, only from
   `@huggingface/transformers` parents — aliasing the miss to our copy. Windows separator fix:
   `parent.filename` backslashes normalized before the scope check.

Post-fix arms: npm `backfilled 1/1` + doctor present; pnpm `backfilled 2/2` + doctor present.

## EBADDEVENGINES finding — T1.1

`npm view <pkg> devEngines` run **inside the repo** warned EBADDEVENGINES; run outside, clean.
Published 0.0.5 tarballs and freshly `pnpm pack`-ed tarballs contain no `devEngines` — the field
lived only in the private root `package.json` and warned every in-repo npm command. Removed:
`packageManager: "pnpm@11.24.0"` + `pmOnFail: error` keep the pin (empirical: `npx pnpm@11.7.0`
in-repo → ERR_PNPM_BAD_PM_VERSION). AGENTS.md pinning note updated.

## Raw command anchors

- npm arm install: `npm i -g --prefix $TMP/r71-arm-npm @anysearch-cli/cli@0.0.5 @anysearch-cli/embedding@0.0.5` → 220 pkgs, exit 0, no EBADDEVENGINES.
- pnpm arm install: `PNPM_HOME=$TMP/r71-arm-pnpm pnpm add -g --dir $TMP/r71-arm-pnpm …` → +54 pkgs, exit 0.
- Pre-fix pnpm doctor: `[SKIP] vector arm (@anysearch-cli/embedding absent — FTS-only (optional peer))`.
- Pre-fix pnpm backfill: `backfilled 0/1 vector(s) (1 failed)` exit 1.
- Failure sim: `ANYSEARCH_MODEL_CACHE=<file-not-dir>` → `Unable to add response to browser cache: ENOTDIR` → `backfilled 0/1 (1 failed)` exit 1. (Node fetch ignores `HTTP(S)_PROXY`; `HF_HUB_OFFLINE`/`HF_ENDPOINT` are Python-Hub env vars, ignored by transformers.js — dead-proxy and env-flag sims were inert; cache-dir fault injection is the honest first-use failure.)
- Post-fix pnpm: `backfilled 2/2 vector(s)` exit 0; post-fix npm: `backfilled 1/1` exit 0.
- Hint renders: `hint: embedding failed — the model downloads on first use; check huggingface.co reachability …`.

## Verification

- `pnpm -C packages/store test` → 62/62 (embedding-arm 16 assertions).
- `pnpm -C apps/plugin test` → 10/10.
- `pnpm build` → 4/4.
- `node scripts/install-smoke.mjs` → 28/28 incl. `pnpm-layout:` legs.
