// #493: the release-gate script restates the [compaction] rules because it has
// no TS dependency, so nothing but review kept the two sides agreeing. This
// drives both entry points over the same TOML and requires the same verdict —
// a drift now fails the suite instead of surfacing when someone writes a domain.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDomainFromString } from "../src/domain-loader";

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, "../../../scripts/validate-domains.mjs");

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

const cases: Array<{ label: string; rule: string; accepted: boolean }> = [
  { label: "3 is legal", rule: "sufficiencyMaxRerounds = 3\n", accepted: true },
  { label: "0 turns it off and is legal", rule: "sufficiencyMaxRerounds = 0\n", accepted: true },
  { label: 'string "3" is rejected', rule: 'sufficiencyMaxRerounds = "3"\n', accepted: false },
  { label: "out-of-range 4 is rejected", rule: "sufficiencyMaxRerounds = 4\n", accepted: false },
  { label: "a misspelled key is rejected", rule: "sufficiencyMaxReround = 3\n", accepted: false },
];

const dir = mkdtempSync(join(tmpdir(), "ans-compaction-sync-"));
try {
  for (const c of cases) {
    const toml = 'name = "sync"\n[rag]\nadapter = "none"\n[compaction]\n' + c.rule;
    writeFileSync(join(dir, "sync.toml"), toml, "utf8");

    let storeAccepted = true;
    try { loadDomainFromString(toml); } catch { storeAccepted = false; }

    const run = spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
    const scriptAccepted = run.status === 0;

    assert(storeAccepted === c.accepted, "store: " + c.label + " (got " + storeAccepted + ")");
    assert(scriptAccepted === c.accepted, "script: " + c.label + " (got exit " + run.status + ")");
    assert(storeAccepted === scriptAccepted, "both entry points agree: " + c.label);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`compaction rule sync: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
