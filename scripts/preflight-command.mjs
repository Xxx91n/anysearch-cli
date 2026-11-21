// The pnpm command a preflight plan runs: the repo's `pnpm test` for the full
// suite, or turbo with one --filter per selected package. Kept out of the
// runner so the command shape has a test.
//
// Design: the incremental command mirrors the root test script's turbo flags
// and adds filters. A test compares the two, so a flag added to the root script
// cannot silently go missing here.

export function commandArgs(plan) {
  if (plan.mode !== "incremental") return ["test"];
  return ["exec", "turbo", "run", "test", "--concurrency=2", ...plan.packages.map((pkg) => `--filter=${pkg}`)];
}
