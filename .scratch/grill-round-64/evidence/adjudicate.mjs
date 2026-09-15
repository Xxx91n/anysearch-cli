// R64 T3: adjudicate the 10 quarantined golden entries via the ledger API.
// Reads the evidence log for per-id verdict history and applies the ruling
// tiers from the task book (stable>=1 green; flaky>=5 runs flip<0.2 + watch;
// g0010 merged-paths needs >=2 green; g0008>=1 green post-downgrade).
// Usage: node .scratch/grill-round-64/evidence/adjudicate.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const NOW = new Date().toISOString();

const log = readFileSync(join(here, "evidence.log"), "utf8");
const byId = new Map();
for (const line of log.split("\n")) {
  const m = /^EVIDENCE (\S+) (pass|fail) (\S+) (\S+) p=(\d+) f=(\d+)/.exec(line);
  if (!m) continue;
  const arr = byId.get(m[1]) ?? [];
  arr.push({ verdict: m[2], at: m[3], ref: m[4], p: +m[5], f: +m[6] });
  byId.set(m[1], arr);
}

// Post-migration evidence = entries logged at/after the first post-migration
// run (run-02+). run-01 used the OLD assertions and is drift documentation only.
const MIN_TS = "2026-09-15T18:30"; // run-02 start (post-migration)
const post = (id) => (byId.get(id) ?? []).filter((r) => r.at >= MIN_TS);
const flips = (rs) => rs.slice(1).filter((r, i) => r.verdict !== rs[i].verdict).length;
const report = {};

for (const id of ["docs-g0002", "docs-g0003", "docs-g0005", "docs-g0011"]) {
  const rs = post(id);
  report[id] = { tier: "stable", runs: rs.length, green: rs.filter(r => r.verdict === "pass").length, ok: rs.some(r => r.verdict === "pass") };
}
for (const id of ["docs-g0004", "docs-g0006", "docs-g0009"]) {
  const rs = post(id);
  const f = rs.length > 1 ? flips(rs) / (rs.length - 1) : 1;
  report[id] = { tier: "flaky", runs: rs.length, green: rs.filter(r => r.verdict === "pass").length, flip: f, ok: rs.length >= 5 && f < 0.2 && rs.every(r => r.verdict === "pass") };
}
// g0001: stable tier; leg re-anchored after run-06 -> only runs >= run-07 count.
{
  const rs = post("docs-g0001").filter(r => r.at >= "2026-09-15T18:34");
  report["docs-g0001"] = { tier: "stable(re-anchored leg)", runs: rs.length, green: rs.filter(r => r.verdict === "pass").length, ok: rs.length >= 2 && rs.every(r => r.verdict === "pass") };
}
// g0008: >=1 green post-downgrade (all post runs are post-downgrade).
{
  const rs = post("docs-g0008");
  report["docs-g0008"] = { tier: "host-downgrade", runs: rs.length, green: rs.filter(r => r.verdict === "pass").length, ok: rs.some(r => r.verdict === "pass") };
}
// g0010: merged into mustHitPaths cluster (answer path) — >=2 stable green.
{
  const rs = post("docs-g0010");
  report["docs-g0010"] = { tier: "respec-fallback->paths", runs: rs.length, green: rs.filter(r => r.verdict === "pass").length, ok: rs.filter(r => r.verdict === "pass").length >= 2 };
}

console.log(JSON.stringify(report, null, 2));
writeFileSync(join(here, "adjudication.json"), JSON.stringify({ at: NOW, report }, null, 2) + "\n", "utf8");
