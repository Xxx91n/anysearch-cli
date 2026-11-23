// The pnpm command a preflight run uses: the root "test" script for the whole
// suite, or turbo with one filter per selected package. The flags mirror the
// root script.

// Only "full", "incremental" and "readers" reach here: the gate exits on "none"
// and "docs" before it starts a child. Anything else asks for the full suite,
// which is the safe direction to be wrong in — running everything never fakes a
// pass.
export function commandArgs(plan) {
  if (plan.mode !== "incremental" && plan.mode !== "readers") return ["test"];
  return ["exec", "turbo", "run", "test", "--concurrency=2", ...plan.packages.map((pkg) => `--filter=${pkg}`)];
}
