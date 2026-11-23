// The pnpm command a preflight run uses: the root "test" script for the whole
// suite, or turbo with one filter per selected package. The flags mirror the
// root script.

// Design: ask whether the plan carries a package list, not which mode it is —
// every narrowed mode names its packages and "full" names none, so a new
// narrowed mode needs no edit here, and anything unexpected still runs the whole
// suite, the safe direction to be wrong in: running everything never fakes a
// pass.
export function commandArgs(plan) {
  if (!plan.packages?.length) return ["test"];
  return ["exec", "turbo", "run", "test", "--concurrency=2", ...plan.packages.map((pkg) => `--filter=${pkg}`)];
}
