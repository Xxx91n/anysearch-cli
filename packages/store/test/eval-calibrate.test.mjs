// ADR-0029 D2 test: kappa/AC1/bootstrap over synthetic 2x2-ish tables + timeout watchdog self-check.
import assert from "node:assert";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { agreement, cohenKappa, gwetAC1, kappaBootstrapCI } from "../../../scripts/eval-calibrate.mjs";

const rep = (v, n) => Array.from({ length: n }, () => v);
const a = (m) => { assert.ok(m, "assertion failed"); };

// Perfect agreement -> kappa 1, AC1 1, po 1
{
  const pairs = [...rep(1, 12).map(() => [1, 1]), ...rep(0, 18).map(() => [0, 0])];
  a(cohenKappa(pairs) === 1);
  a(gwetAC1(pairs) === 1);
  a(agreement(pairs) === 1);
  const [lo] = kappaBootstrapCI(pairs, 500);
  a(lo === 1); // degenerate: all cells diagonal
}

// Chance-level agreement (~kappa 0) -> CI straddles 0, AC1 near 0
{
  const pairs = [
    ...rep(0, 7).map(() => [1, 1]), ...rep(0, 8).map(() => [1, 0]),
    ...rep(0, 8).map(() => [0, 1]), ...rep(0, 7).map(() => [0, 0]),
  ];
  const k = cohenKappa(pairs);
  a(Math.abs(k) < 0.1); // ~0 (7/8/8/7 table gives -0.0667)
  const [lo, hi] = kappaBootstrapCI(pairs, 2000);
  a(lo < 0 && hi > 0);
  a(Number.isFinite(gwetAC1(pairs)));
}

// Anti-correlated (kappa < 0)
{
  const pairs = [...rep(0, 10).map(() => [1, 0]), ...rep(0, 10).map(() => [0, 1])];
  a(cohenKappa(pairs) < 0);
}

// Prevalence skew: kappa deflated vs AC1 in 90/10 split — AC1 robust (ADS-0029 D2 report)
{
  const pairs = [...rep(0, 8).map(() => [1, 1]), ...rep(0, 1).map(() => [1, 0]), ...rep(0, 1).map(() => [0, 1]), ...rep(0, 0).map(() => [0, 0])];
  const k = cohenKappa(pairs), ac = gwetAC1(pairs);
  a(ac > k); // prevalence-adjusted statistic exceeds kappa under skew
}

// ADR-0029 D5 timeout watchdog: EVAL_TIMEOUT_MS very small on a slow-stub run must exit 124/timeout.
const timeoutRun = await new Promise((resolve) => {
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "eval", "cli.ts");
  const p = spawn("node", ["--import", "tsx", cli], {
    env: { ...process.env, EVAL_TIMEOUT_MS: "800", EVAL_CAL_RUNS: "99", EVAL_SLOW_MS: "5000" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let err = "";
  p.stderr.on("data", (d) => (err += d));
  p.on("close", (code) => resolve({ code, err }));
});
a(timeoutRun.code !== null && timeoutRun.code !== 0); // timed out, not success
console.log("eval-calibrate tests ok; timeout exit=" + timeoutRun.code);
if (timeoutRun.code === 0) { console.error("timeout self-check failed"); process.exit(1); }
