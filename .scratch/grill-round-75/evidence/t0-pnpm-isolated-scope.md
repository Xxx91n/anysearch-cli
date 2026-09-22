# R75 T0 — transformers ghost-dep runtime reproduction (pnpm isolated scope)

Date: 2026-09-21/22. Host: Windows 11, Git Bash, Node v24.11.0, pnpm 11.24.0.
Fixture: three throwaway pnpm projects in a machine temp dir (`$TEMP/r75-fixture`, <!-- machine-local: POSIX env-var 路径引用（存量合规化） @ 2026-09-22 -->
not committed — transcripts are the artifact). `hoist: false` in each fixture's
`pnpm-workspace.yaml` gives the isolated-scope layout (`node_modules/.pnpm/node_modules`
stays empty: verified 0 entries). Raw verbatim transcript:
`.scratch/grill-round-75/evidence/t0-pnpm-isolated-scope.log`.

## Verdict

| leg | shape | result |
|---|---|---|
| A | `@huggingface/transformers@4.3.0` alone, isolated scope | **RED** `Error: Cannot find module 'onnxruntime-common'` at `dist/transformers.node.cjs:13520:33`, `code: 'MODULE_NOT_FOUND'`, node-exit=1 |
| B | `@huggingface/transformers@3.8.1` alone, isolated scope, no patch (negative control) | **RED** identical `Cannot find module 'onnxruntime-common'` from `transformers.node.cjs`, node-exit=1 |
| C | `3.8.1` + fixture declares `onnxruntime-common@1.21.0` + verbatim CJS port of `patchOnnxruntimeCommonResolve` | **GREEN** `REQUIRE-SUCCEEDED`, specifier resolved to the fixture's `.pnpm/onnxruntime-common@1.21.0` copy, node-exit=0 |
| D | `4.3.0` alone, **default** pnpm config (virtual-store hoist active) | **GREEN** — `hoistPattern=*` hoists `onnxruntime-common` into `.pnpm/node_modules`, masking the ghost dep |

## Reads

- T0 acceptance anchors met: runtime reproduction (not just static dissection) of
  `require("onnxruntime-common")` failing on **4.3.0** under pnpm isolated scopes;
  the 3.8.1 negative control proves the fixture is honest (not masked by the
  default virtual-store hoist), and the 3.8.1 + patch control proves the shipped
  `packages/embedding/src/index.ts` mechanism still resolves the miss.
- Leg D nuance (honest scope for the upstream comment): pnpm's *default* config
  masks the defect via the `.pnpm/node_modules` virtual-store hoist. The break
  surfaces under `hoist: false` (strict/isolated monorepos), `pnpm dlx`
  (GitNexus#2069 repro by uwuclxdy), and global-style installs (R71 spike arm:
  `pnpm add -g` per-package roots). npm's flat hoisting likewise masks it until a
  version conflict (episodic-memory precedent).
- Deletion condition remains unmet: 4.3.0 still ships the top-level bare
  `require("onnxruntime-common")` (hit at `transformers.node.cjs:13520`) with no
  manifest declaration — Half-Fired Trigger: upstream declaring `onnxruntime-node`
  did not declare the specifier actually required.
