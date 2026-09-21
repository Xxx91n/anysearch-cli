# DRAFT — optional short comment for huggingface/transformers.js issue #1087 ("Ghost dependency onnxruntime-common", CLOSED)

> Status: drafted 2026-09-22, pending user review. Purpose: signpost for future searchers landing on the closed issue. To be posted by the user under their own GitHub account. Do NOT post via agent/gh.

---

For anyone landing here: the fix is in flight — PR #1764 (knip pipeline follow-up) adds the missing `"onnxruntime-common"` declaration to `packages/transformers/package.json`. As of published `4.3.0` the top-level `require("onnxruntime-common")` in `dist/transformers.node.cjs` is still undeclared and still breaks under pnpm isolated scopes (`hoist: false`), `pnpm dlx`, and global-style installs; the default virtual-store hoist is what masks it in plain `pnpm add` cases. Downstream workarounds that travel with a published package essentially reduce to a scoped `Module._resolveFilename` patch + a self-declared pinned copy (version must match the embedded `onnxruntime-node` dep). Repro + downstream cost summary posted on #1764.
