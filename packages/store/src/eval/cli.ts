// ADR-0027 D6: `pnpm -C packages/store eval` — writes .ship-gate/eval-report.{json,md},
// applies the gate, exits with the partitioned code contract.
// ADR-0028 D1: --write-baseline replaced by --calibrate (50-run hard floor; CI never rewrites).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GOLDEN_CASES } from "./golden-cases";
import { runAll, type EvalReport } from "./runner";
import { evaluateGate, mdeFor, wilson95, GATE_FAMILY_SIZE, type EvalBaseline } from "./gate";

function repoRoot(): string {
  let d = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(d, "turbo.json"))) return d;
    const p = dirname(d);
    if (p === d) throw new Error("turbo.json not found walking up from " + d);
    d = p;
  }
}

function toMarkdown(report: EvalReport, baseline: EvalBaseline | null, failures: string[], warnings: string[]): string {
  const m = report.metrics;
  const verdict = failures.length ? "FAIL" : warnings.length ? "WARN" : "PASS";
  const lines: string[] = [
    "# Memory Eval Report (ADR-0027 / ADR-0028)",
    "",
    `- generated: ${report.generatedAt}`,
    `- dataset fingerprint: ${report.datasetFingerprint}`,
    `- verdict: ${verdict}`,
    `- note: allowance band is advisory at current sample sizes (allowance/n < MDE); the only hard gate is passRate == 1 (ADR-0028 D1; r66 audit F-03)`,
    "",
    "## Metrics (gate)",
    "",
    "| metric | value | gate |",
    "|---|---|---|",
    `| passRate | ${m.passRate.toFixed(3)} | == 1.000 (hard) |`,
    `| supersessionFails | ${m.counts.supExpected - m.counts.supPassed}/${m.counts.supExpected} | <= allowance ${baseline ? baseline.allowance.supersessionFails : "n/a"} |`,
    `| quarantineFp | ${m.counts.fpCount}/${m.counts.fpEligible} | <= allowance ${baseline ? baseline.allowance.quarantineFp : "n/a"} |`,
    "",
    "## Observational (never gated)",
    "",
    "| metric | value |",
    "|---|---|",
    `| mrr (rank-of-relevant) | ${m.mrr.toFixed(3)} |`,
    `| answerableFalseRefusalRate | ${m.answerableFalseRefusalRate.toFixed(3)} |`,
    "",
    "## Statistical power (ADR-0028 D1)",
    "",
    `- preregistered gated family size: ${GATE_FAMILY_SIZE} fraction metrics + hard passRate (aievals.co reporting discipline)`,
  ];
  for (const [label, k, n, allowance] of [
    ["supersession", m.counts.supPassed, m.counts.supExpected, baseline?.allowance.supersessionFails ?? null],
    ["quarantineFp", m.counts.fpEligible - m.counts.fpCount, m.counts.fpEligible, baseline?.allowance.quarantineFp ?? null],
  ] as Array<[string, number, number, number | null]>) {
    const [lo, hi] = wilson95(k, n);
    const mde = mdeFor(n);
    const frac = allowance !== null && n > 0 ? allowance / n : null;
    lines.push(`- ${label}: Wilson95 [${lo.toFixed(3)}, ${hi.toFixed(3)}], MDE ${mde.toFixed(3)}` + (frac === null ? "" : `, allowance fraction ${frac.toFixed(3)}` + (frac < mde ? " (UNDER-POWERED: FAILs downgrade to WARN)" : "")));
  }
  lines.push("", "## Rank gate (ADR-0028 D2)", "", "| case | op | rank | max |", "|---|---|---|---|");
  for (const c of report.cases) {
    for (const r of c.ops) {
      if (r.rank !== undefined) lines.push(`| ${c.id} | ${r.op} | ${r.rank === 0 ? "absent" : r.rank} | gate |`);
    }
  }
  lines.push("", "## Difficulty tiers (ADR-0028 D4, report-only)", "", "| tier | cases | passed | passRate |", "|---|---|---|---|");
  for (const [tier, t] of Object.entries(report.tierBreakdown)) lines.push(`| ${tier} | ${t.cases} | ${t.passed} | ${t.passRate.toFixed(3)} |`);
  lines.push("", "## Stage attribution (failed cases)", "", "```json", JSON.stringify(report.stageBreakdown), "```", "", "## Cases", "", "| case | group | tier | stage | result |", "|---|---|---|---|---|");
  for (const c of report.cases) lines.push(`| ${c.id} | ${c.group} | ${c.difficulty} | ${c.failedStage ?? "-"} | ${c.passed ? "PASS" : "FAIL"} |`);
  if (warnings.length) lines.push("", "## Gate warnings (non-blocking)", "", ...warnings.map((w) => "- " + w));
  if (failures.length) lines.push("", "## Gate failures", "", ...failures.map((x) => "- " + x));
  return lines.join("\n") + "\n";
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const calibrateIdx = args.findIndex((a) => a === "--calibrate" || a === "--write-baseline"); // write-baseline kept as alias for one round
  const outIdx = args.indexOf("--out");
  const root = repoRoot();
  const outDir = outIdx >= 0 ? resolve(args[outIdx + 1]!) : join(root, ".ship-gate");
  const baselinePath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "eval-baseline.json");

  if (calibrateIdx >= 0) {
    // ADR-0028 D1: 50-run hard floor. Any run with passRate < 1 aborts calibration (exit 2):
    // a flaky-case floor is a quarantine signal, not a baseline. Idempotent; safe to re-run.
    const nArg = args[calibrateIdx + 1];
    const runs = nArg && /^\d+$/.test(nArg) ? Number(nArg) : 50;
    console.log(`[eval:calibrate] running ${runs} seeded runs...`);
    let worstSupFails = 0;
    let worstFp = 0;
    let last: EvalReport | null = null;
    for (let i = 0; i < runs; i++) {
      const r = await runAll(GOLDEN_CASES);
      if (r.metrics.passRate < 1) {
        console.error(`[eval:calibrate] ABORT run ${i + 1}/${runs}: passRate ${r.metrics.passRate.toFixed(3)} < 1 — quarantine the flaky case before calibrating (ADR-0027 D7)`);
        return 2;
      }
      worstSupFails = Math.max(worstSupFails, r.metrics.counts.supExpected - r.metrics.counts.supPassed);
      worstFp = Math.max(worstFp, r.metrics.counts.fpCount);
      last = r;
    }
    const next: EvalBaseline = {
      schema: "anysearch/eval-baseline@1",
      fingerprint: last!.datasetFingerprint,
      metrics: last!.metrics,
      allowance: { supersessionFails: worstSupFails + 1, quarantineFp: worstFp + 1 },
      updatedAt: new Date().toISOString().slice(0, 10),
      note: "ADR-0028 D1 calibration (runs=" + runs + "); integer allowance = worst-observed failures + 1 op. CI never writes this file (ADR-0027 D9).",
    };
    writeFileSync(baselinePath, JSON.stringify(next, null, 2) + "\n", "utf8");
    console.log(`[eval:calibrate] baseline written: fingerprint=${next.fingerprint} allowance sup<=${next.allowance.supersessionFails} qfp<=${next.allowance.quarantineFp}`);
    return 0;
  }

  const report = await runAll(GOLDEN_CASES);
  mkdirSync(outDir, { recursive: true });

  let baseline: EvalBaseline | null = null;
  if (existsSync(baselinePath)) baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as EvalBaseline;

  const g = evaluateGate(report, baseline);
  const exitCode = g.exitCode;

  const enriched = { ...report, baselineFingerprint: baseline?.fingerprint ?? null, gate: { verdict: g.verdict, exitCode, failures: g.failures, warnings: g.warnings } };
  writeFileSync(join(outDir, "eval-report.json"), JSON.stringify(enriched, null, 2) + "\n", "utf8");
  writeFileSync(join(outDir, "eval-report.md"), toMarkdown(report, baseline, g.failures, g.warnings), "utf8");

  console.log(
    `[eval] cases ${report.totals.passed}/${report.totals.cases} pass, fingerprint=${report.datasetFingerprint}, ` +
      `passRate=${report.metrics.passRate.toFixed(3)} supFails=${report.metrics.counts.supExpected - report.metrics.counts.supPassed} qfp=${report.metrics.counts.fpCount} mrr=${report.metrics.mrr.toFixed(3)} verdict=${g.verdict} exit=${exitCode}`
  );
  console.log("[eval] note: allowance band advisory at current n (allowance/n < MDE) — hard gate is passRate==1 (ADR-0028 D1)");
  for (const w of g.warnings) console.warn("[eval] WARN: " + w);
  for (const x of g.failures) console.error("[eval] gate: " + x);
  return exitCode;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error("[eval] internal error: " + String((e as Error)?.stack ?? e));
    process.exit(2);
  }
);
