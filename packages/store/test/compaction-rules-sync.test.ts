// #493: the release-gate script restates the [compaction] rules because it has
// no TS dependency, so nothing but review kept the two sides agreeing. This
// drives both entry points over the same TOML and requires the same verdict —
// a drift now fails the suite instead of surfacing when someone writes a domain.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDomainFromString } from "../src/domain-loader";
import { COMPACTION_CONFIG_KEYS } from "../src/domain-schema";

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
const write = (toml: string) => writeFileSync(join(dir, "sync.toml"), toml, "utf8");

try {
  for (const c of cases) {
    const toml = 'name = "sync"\n[rag]\nadapter = "none"\n[compaction]\n' + c.rule;
    write(toml);

    let storeAccepted = true;
    try { loadDomainFromString(toml); } catch { storeAccepted = false; }

    const run = spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
    const scriptAccepted = run.status === 0;

    assert(storeAccepted === c.accepted, "store: " + c.label + " (got " + storeAccepted + ")");
    assert(scriptAccepted === c.accepted, "script: " + c.label + " (got exit " + run.status + ")");
    assert(storeAccepted === scriptAccepted, "both entry points agree: " + c.label);
  }

  // The key list carries the same drift risk as the bound: a field added to the
  // store type but not the script would be rejected as unknown by the gate only.
  {
    const src = readFileSync(script, "utf8");
    const match = src.match(/const COMPACTION_KEYS = \[([^\]]*)\]/);
    assert(match !== null, "script declares its compaction key list (a rewrite of that line means updating this test)");
    const scriptKeys = (match?.[1] ?? "")
      .split(",")
      .map((k) => k.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
    assert(
      JSON.stringify([...scriptKeys].sort()) === JSON.stringify([...COMPACTION_CONFIG_KEYS].sort()),
      "script and store name the same keys (script: " + scriptKeys.join(", ") + ")",
    );
  }

  // Both sides name every unknown key in one message, not just the first.
  {
    const toml = 'name = "sync"\n[rag]\nadapter = "none"\n[compaction]\nmysteryOne = 1\nmysteryTwo = 2\n';
    write(toml);
    let storeMessage = "";
    try { loadDomainFromString(toml); } catch (e) { storeMessage = (e as Error).message; }
    const run = spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
    const out = String(run.stdout ?? "");
    assert(storeMessage.includes('"mysteryOne"') && storeMessage.includes('"mysteryTwo"'),
      "store names every unknown key");
    assert(out.includes('"mysteryOne"') && out.includes('"mysteryTwo"'),
      "script names every unknown key");
    assert(run.status === 1, "script fails the multi-key case (got exit " + run.status + ")");
  }

  // An explicit directory that does not exist must fail, not skip: this script
  // is a blocking gate and a typo used to read as "nothing to check".
  {
    const missing = join(dir, "no-such-dir");
    const run = spawnSync(process.execPath, [script, missing], { encoding: "utf8" });
    const out = String(run.stdout ?? "");
    assert(run.status === 1, "missing directory exits 1 (got " + run.status + ")");
    assert(out.includes("domains path not found"), "missing directory names the problem");
    assert(out.includes(missing), "missing directory names the path");
  }

  // A real directory with nothing to check in it must fail for the same reason
  // a misspelled path does: an explicit target that yields no work is a caller
  // mistake, not a green gate.
  {
    const empty = mkdtempSync(join(tmpdir(), "ans-compaction-empty-"));
    try {
      const run = spawnSync(process.execPath, [script, empty], { encoding: "utf8" });
      const out = String(run.stdout ?? "");
      assert(run.status === 1, "empty directory exits 1 (got " + run.status + ")");
      assert(out.includes("no *.toml files in"), "empty directory names the problem");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  }

  // A file where a directory belongs must fail too, not throw a raw ENOTDIR.
  {
    const file = join(dir, "sync.toml");
    const run = spawnSync(process.execPath, [script, file], { encoding: "utf8" });
    const out = String(run.stdout ?? "");
    assert(run.status === 1, "file-as-directory exits 1 (got " + run.status + ")");
    assert(out.includes("not a directory"), "file-as-directory says what is wrong");
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`compaction rule sync: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
