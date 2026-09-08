// ADR-0051 D5: per-instance observability invariants.
import assert from "node:assert";
import {
  perInstanceReport,
  psiStat,
  ksStat,
  ece,
  brier,
  type InstanceReportItem,
} from "../src/eval/attribution-instance-report";

function makeItems(prefix: string, instance: "web" | "memory", n: number): InstanceReportItem[] {
  // Monotone calibration: score i/n, label 1 above the midpoint.
  return Array.from({ length: n }, (_, i) => ({
    claimId: prefix + i,
    instance,
    score: i / n,
    p: i / n,
    label: (i >= n / 2 ? 1 : 0) as 0 | 1,
  }));
}

// Single instance: no mixture marker, group computed.
const single = perInstanceReport(makeItems("w", "web", 40));
assert.equal(single.mixture, null, "single-instance line is not a mixture");
assert.equal(single.groups[0]!.status, "ok");
assert.equal(single.groups[0]!.eceDelta, null, "no rest population -> no delta");

// Mixed line with a small group: small group is insufficient, not gated.
const mixed = perInstanceReport([...makeItems("w", "web", 40), ...makeItems("m", "memory", 10)]);
assert.equal(mixed.mixture, "mixed-calibration-acknowledged", "known mixture is acknowledged");
const web = mixed.groups.find((g) => g.instance === "web")!;
const mem = mixed.groups.find((g) => g.instance === "memory")!;
assert.equal(web.status, "ok");
assert.equal(mem.status, "insufficient", "small group is insufficient, never forced");
assert.equal(mem.psi, null);
assert.equal(mem.ece, null);
assert.equal(web.coverage, 0.8, "coverage is the share of the binary-fit population");
assert.ok(web.eceDelta && web.eceDelta.ciLower <= web.eceDelta.value && web.eceDelta.value <= web.eceDelta.ciUpper, "bootstrap CI brackets the point estimate");

// Two sufficient groups get full signals.
const both = perInstanceReport([...makeItems("w", "web", 40), ...makeItems("m2", "memory", 40)]);
assert.ok(both.groups.every((g) => g.status === "ok"));
assert.ok(both.groups.every((g) => typeof g.psi === "number" && typeof g.ks === "number"));

// Metric sanity: identical distributions, degenerate edges.
assert.equal(psiStat([0.1, 0.2], [0.1, 0.2]), 0, "PSI zero on identical support");
assert.ok(ksStat([0.1, 0.2, 0.3], [0.7, 0.8, 0.9]) === 1, "KS = 1 on disjoint ranges");
assert.equal(ece([]), 0);
assert.equal(brier([]), 0);

console.log("attribution-instance-report.test: ok");
