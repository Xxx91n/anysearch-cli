// ADR-0027 D6: `pnpm -C packages/store eval` — writes .ship-gate/eval-report.{json,md},
// applies the gate, exits with the partitioned code contract. --write-baseline recalibrates
// (manual, review-then-commit; CI never writes baseline — ADR-0027 D9).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GOLDEN_CASES } from "./golden-cases";
import { runAll, type EvalReport } from "./runner";
import { evaluateGate, type EvalBaseline } from "./gate";

function repoRoot(): string {
  let d = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(d, "turbo.json"))) return d;
    const p = dirname(d);
    if (p === d) throw new Error("turbo.json not found walking up from " + d);
    d = p;
  }
}

function toMarkdown(report: EvalReport, baseline: EvalBaseline | null, failures: string[]): string {
  const m = report.metrics;
  const lines: string[] = [
    "# Memory Eval Report (ADR-0027)",
    "",
    `- generated: ${report.generatedAt}`,
    `- dataset fingerprint: ${report.datasetFingerprint}`,
    `- verdict: ${failures.length ? "FAIL" : "PASS"}`,
    "",
    "## Metrics",
    "",
    "| metric | value | gate |",
    "|---|---|---|",
    `| passRate | ${m.passRate.toFixed(3)} | == 1.000 |`,
    `| supersessionSuccess | ${m.supersessionSuccess.toFixed(3)} | >= ${baseline ? (baseline.metrics.supersessionSuccess - baseline.margin.supersession).toFixed(3) : "n/a"} |`,
    `| quarantineFalsePositiveRate | ${m.quarantineFalsePositiveRate.toFixed(3)} | <= ${baseline ? (baseline.metrics.quarantineFalsePositiveRate + baseline.margin.quarantineFp).toFixed(3) : "n/a"} |`,
    "",
    "## Stage attribution (failed cases)",
    "",
    `\`\`\`json`,
    JSON.stringify(report.stageBreakdown),
    `\`\`\``,
    "",
    "## Cases",
    "",
    "| case | group | stage | result |",
    "|---|---|---|---|",
    ...report.cases.map((c) => `| ${c.id} | ${c.group} | ${c.failedStage ?? "-"} | ${c.passed ? "PASS" : "FAIL"} |`),
  ];
  if (failures.length) {
    lines.push("", "## Gate failures", "", ...failures.map((f) => "- " + f));
  }
  return lines.join("\n") + "\n";
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const writeBaseline = args.includes("--write-baseline");
  const outIdx = args.indexOf("--out");
  const root = repoRoot();
  const outDir = outIdx >= 0 ? resolve(args[outIdx + 1]!) : join(root, ".ship-gate");

  const report = await runAll(GOLDEN_CASES);
  mkdirSync(outDir, { recursive: true });

  const baselinePath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "eval-baseline.json");
  let baseline: EvalBaseline | null = null;
  if (existsSync(baselinePath)) baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as EvalBaseline;

  let exitCode: number;
  let failures: string[] = [];
  if (writeBaseline) {
    const next: EvalBaseline = {
      schema: "anysearch/eval-baseline@1",
      fingerprint: report.datasetFingerprint,
      metrics: report.metrics,
      margin: baseline?.margin ?? { supersession: 0, quarantineFp: 0 },
      updatedAt: new Date().toISOString().slice(0, 10),
      note: "ADR-0027 calibration; review before commit. CI never auto-writes this file.",
    };
    writeFileSync(baselinePath, JSON.stringify(next, null, 2) + "\n", "utf8");
    baseline = next;
    exitCode = report.metrics.passRate === 1 ? 0 : 1;
    if (exitCode !== 0) failures = ["passRate < 1.0 during calibration — do NOT commit this baseline"];
  } else {
    const g = evaluateGate(report, baseline);
    exitCode = g.exitCode;
    failures = g.failures;
  }

  const enriched = { ...report, baselineFingerprint: baseline?.fingerprint ?? null, gate: { exitCode, failures } };
  writeFileSync(join(outDir, "eval-report.json"), JSON.stringify(enriched, null, 2) + "\n", "utf8");
  writeFileSync(join(outDir, "eval-report.md"), toMarkdown(report, baseline, failures), "utf8");

  console.log(
    `[eval] cases ${report.totals.passed}/${report.totals.cases} pass, fingerprint=${report.datasetFingerprint}, ` +
      `passRate=${report.metrics.passRate.toFixed(3)} supersession=${report.metrics.supersessionSuccess.toFixed(3)} qfp=${report.metrics.quarantineFalsePositiveRate.toFixed(3)} exit=${exitCode}`
  );
  for (const f of failures) console.error("[eval] gate: " + f);
  return exitCode;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error("[eval] internal error: " + String((e as Error)?.stack ?? e));
    process.exit(2);
  }
);
