// PROTOTYPE (throwaway) — aggregate the calibration samples.
// Reads out/raw.jsonl, prints markdown tables, writes out/summary.json.
// Percentiles: linear interpolation (R type 7). n is small; treat p95 as a
// sample bound, not a population quantile.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = process.env.PROTO_OUT || join(HERE, "out", "raw.jsonl");
const OUT_DIR = join(HERE, "out");

function pct(sorted, p) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function stats(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const sum = v.reduce((a, b) => a + b, 0);
  return {
    n: v.length,
    min: v[0],
    p10: Math.round(pct(v, 0.1)),
    p50: Math.round(pct(v, 0.5)),
    mean: Math.round(sum / v.length),
    p90: Math.round(pct(v, 0.9)),
    p95: Math.round(pct(v, 0.95)),
    max: v[v.length - 1],
  };
}

const rows = existsSync(RAW)
  ? readFileSync(RAW, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
  : [];
const ok = rows.filter((r) => r.ok);
const failed = rows.filter((r) => !r.ok);

console.log(`# Samples: ${rows.length} total, ${ok.length} ok, ${failed.length} failed`);
if (failed.length) {
  console.log("\n## Failures");
  for (const f of failed) console.log(`- ${f.runId} ${f.rag}/${f.domain} exit=${f.exitCode} :: ${f.failTail}`);
}

function table(name, subset) {
  const out = stats(subset.map((r) => r.outputTokens));
  const inp = stats(subset.map((r) => r.inputTokens));
  if (!out) return null;
  console.log(`\n## ${name} (n=${out.n})`);
  console.log("| metric | min | p10 | p50 | mean | p90 | p95 | max |");
  console.log("|---|---|---|---|---|---|---|---|");
  console.log(`| output | ${out.min} | ${out.p10} | ${out.p50} | ${out.mean} | ${out.p90} | ${out.p95} | ${out.max} |`);
  console.log(`| input  | ${inp.min} | ${inp.p10} | ${inp.p50} | ${inp.mean} | ${inp.p90} | ${inp.p95} | ${inp.max} |`);
  return { output: out, input: inp };
}

const overall = table("ALL ok runs", ok);
const byCond = {};
for (const cond of [...new Set(ok.map((r) => `${r.rag}/${r.domain}`))]) {
  byCond[cond] = table(cond, ok.filter((r) => `${r.rag}/${r.domain}` === cond));
}

// Identical-task spread: same query, same condition, repeated runs.
console.log("\n## Repeat spread (same query, same condition)");
const spread = [];
for (const key of new Set(ok.map((r) => `${r.rag}/${r.domain}::${r.query}`))) {
  const g = ok.filter((r) => `${r.rag}/${r.domain}::${r.query}` === key);
  if (g.length < 2) continue;
  const outs = g.map((r) => r.outputTokens);
  const ratio = Math.max(...outs) / Math.min(...outs);
  spread.push({ key, outs, ratio: Number(ratio.toFixed(2)) });
  console.log(`- ${key} :: out=${outs.join(" vs ")} -> ${ratio.toFixed(2)}x`);
}
if (spread.length) {
  const ratios = spread.map((s) => s.ratio);
  console.log(`- median ratio ${pct([...ratios].sort((a, b) => a - b), 0.5).toFixed(2)}x, max ${Math.max(...ratios).toFixed(2)}x`);
}

// Candidate reserves: multiples of observed p95 / max, and implied exceedance.
if (overall) {
  console.log("\n## Candidate reserve vs observed output");
  const outs = ok.map((r) => r.outputTokens).sort((a, b) => a - b);
  console.log("| candidate | = basis | runs above | exceed % |");
  console.log("|---|---|---|---|");
  const cands = [
    ["p95", overall.output.p95],
    ["1.25 x p95", Math.ceil(overall.output.p95 * 1.25)],
    ["1.5 x p95", Math.ceil(overall.output.p95 * 1.5)],
    ["2 x p95", Math.ceil(overall.output.p95 * 2)],
    ["max", overall.output.max],
  ];
  for (const [label, value] of cands) {
    const above = outs.filter((x) => x > value).length;
    console.log(`| ${value} | ${label} | ${above} | ${((above / outs.length) * 100).toFixed(1)}% |`);
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  total: rows.length,
  ok: ok.length,
  failed: failed.length,
  overall,
  byCondition: byCond,
  repeatSpread: spread,
  rows,
};
writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
console.log(`\nsummary -> ${join(OUT_DIR, "summary.json")}`);
