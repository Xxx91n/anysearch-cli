// The pnpm command a preflight run uses: the root "test" script for the whole
// suite, or turbo with one filter per selected package. The flags mirror the root script.

export function commandArgs(plan) {
  if (plan.mode !== "incremental") return ["test"];
  return ["exec", "turbo", "run", "test", "--concurrency=2", ...plan.packages.map((pkg) => `--filter=${pkg}`)];
}
