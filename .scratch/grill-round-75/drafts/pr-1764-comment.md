# DRAFT — comment for huggingface/transformers.js PR #1764 ("Added knip to the test pipeline")

> Status: drafted 2026-09-22, pending user review. To be posted by the user under their own GitHub account. Do NOT post via agent/gh.

---

This PR's `packages/transformers/package.json` hunk (`"onnxruntime-common": "1.24.3"`) is the actual fix for the ghost dependency reported in #1087 — and it's still needed. Confirming with a runtime repro that the published `4.3.0` tarball still carries a top-level bare `require("onnxruntime-common")` with no manifest declaration.

## Reproduction (published 4.3.0, pnpm isolated scopes)

Fixture: a consumer package whose only dependency is `@huggingface/transformers@4.3.0`, installed with pnpm's isolated layout (`hoist: false` in `pnpm-workspace.yaml` — `node_modules/.pnpm/node_modules` stays empty). Then:

```
$ node -e "require('@huggingface/transformers')"

Error: Cannot find module 'onnxruntime-common'
Require stack:
- …/node_modules/.pnpm/@huggingface+transformers@4.3.0_@types+node@26.6.2/node_modules/@huggingface/transformers/dist/transformers.node.cjs
    at Module._resolveFilename (node:internal/modules/cjs/loader:1420:15)
    …
    at Object.<anonymous> (…/transformers.node.cjs:13520:33)
  code: 'MODULE_NOT_FOUND'
```

Same result on `3.8.1` — the eager require predates the 4.x line. Node v24.11.0, pnpm 11.24.0, Windows 11.

One nuance worth stating precisely: pnpm's **default** config masks this — the virtual-store hoist (`hoistPattern: *` → `.pnpm/node_modules`) makes `onnxruntime-common` reachable anyway. The break surfaces wherever no shared hoist dir is reachable: isolated/strict scopes (`hoist: false`), `pnpm dlx` contexts (where `packageExtensions` can't apply either), and global-style installs. npm's flat hoisting likewise only *masks* it — and stops masking as soon as dependency resolution lands a conflicting copy.

## Why downstream can't absorb this

Every consumer-side fix fails to travel with a published package:

- `pnpm` `packageExtensions` / `patchedDependencies` live in the consumer's workspace config — they repair your own monorepo, not your users' installs, and are inapplicable under `pnpm dlx`.
- A consumer declaring `onnxruntime-common` in *their own* deps lands it in the wrong scope (see abhigyanpatwari/GitNexus#2069 — shipped exactly that, didn't help).
- Forking the package is the end of the road for maintenance.

So each downstream project has independently reinvented the same workaround:

- **obra/episodic-memory#105** — npm case where a version conflict made even flat hoisting fail; three-layer fix (pinned dep / overrides / `require.resolve` sentinel) with an explicit note that the real fix belongs upstream.
- **mastra-ai/mastra** — `packageExtensions` entry plus a comment: *"transformers.js imports onnxruntime-common without declaring it; with the global virtual store there is no fallback hoist"*.
- **abhigyanpatwari/GitNexus#2069** — a ~300-line runtime fallback: `Module._resolveFilename` patch for CJS plus `module.registerHooks` for the ESM path, with version-pairing against the effective `onnxruntime-node`.
- **us (@anysearch-cli/embedding)** — a scoped `_resolveFilename` patch (only `onnxruntime-common`, only from `@huggingface/transformers` parents) plus a self-declared `optionalDependencies` copy pinned to the `onnxruntime-node` embedded version.

That's at least four independent implementations of the same one-line manifest declaration — plus whatever private forks exist that never showed up in search.

## Ask

Could this PR (or just the `package.json` declaration hunk) get merge priority? The declaration matches what `src/backends/onnx.js` actually imports, it's what `onnxruntime-node`/`onnxruntime-web` already do for their own dependency, and it would let every downstream workaround retire. Happy to re-verify against the merge result and report back on #1087.
