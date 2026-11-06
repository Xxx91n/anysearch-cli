// Native-handle teardown registry for the CLI composition root.
//
// #183 moved the registry itself into @anysearch-cli/store (a pure leaf at
// packages/store/src/teardown.ts) so store-side exit paths — the eval runner
// and store test processes — drain the SAME registry the CLI drains. Keeping a
// second CLI-private copy would have split the two handle sets: store engines
// opened through the tracked opener (packages/store/src/db.ts) register there,
// and the CLI exit path must close them too.
//
// This module stays the CLI's import seam (index.ts + test/teardown.test.ts),
// and stays import-free apart from that one re-export so it is CJS-reachable in
// the tsup bundle.
export { registerTeardown, runTeardown, unrefPendingHandles } from "@anysearch-cli/store";
