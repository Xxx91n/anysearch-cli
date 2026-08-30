// ADR-0039 D3: standalone tau sensitivity scan CLI. Zero look-ledger contact — this
// entrypoint never imports golden-cases, the eval runner, or the OF ledger.
// Usage: tsx src/eval/tau-scan-cli.ts [--input rows.json] [--seed 42] [--rows 60] [--grid 0.5,0.75,1,1.5,2] [--out report.json]
import { writeFileSync, readFileSync } from "node:fs";
import { scanTau, syntheticRows, type TauScanRow } from "./tau-scan";

const args = process.argv.slice(2);
const get = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

let rows: TauScanRow[];
let now = Date.now();
if (get("--input")) {
  // Input schema anysearch/tau-scan-input@1: { rows: TauScanRow[], queries: string[], nowMs?: number }
  const j = JSON.parse(readFileSync(get("--input")!, "utf8"));
  rows = j.rows;
  if (typeof j.nowMs === "number") now = j.nowMs;
  var queries: string[] = j.queries;
} else {
  const seed = Number(get("--seed") ?? 42);
  rows = syntheticRows(seed, Number(get("--rows") ?? 60));
  var queries = ["latest release notes", "how does the fusion engine work", "architecture docs reference"];
}
const grid = (get("--grid") ?? "0.5,0.75,1,1.5,2").split(",").map(Number);
const report = scanTau(rows, queries, grid, now);
if (get("--out")) writeFileSync(get("--out")!, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify(report));
