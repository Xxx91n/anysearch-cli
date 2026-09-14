// ADR-0062 D3 (T3): abstain presentation contract — one structured line,
// exit 0 by default, dedicated exit 3 under --fail-on-abstain. The pure helpers
// are asserted offline; a conditional live arm spawns the built CLI with a
// narrow-allowlist domain fixture to measure the real exit codes (skipped
// honestly when no provider key / dist bundle is available).
// ponytail: no test framework, assert-based demo.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { searchExitCode, formatAbstainLine } from "../src/commands/search-abstain";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

async function main() {
  // 1. Exit-code contract.
  assert(searchExitCode({ resultCount: 5, abstain: false, failOnAbstain: false }) === 0, "results -> 0");
  assert(searchExitCode({ resultCount: 0, abstain: false, failOnAbstain: false }) === 1, "empty non-domain -> 1 (legacy no-match)");
  assert(searchExitCode({ resultCount: 0, abstain: true, failOnAbstain: false }) === 0, "abstain -> 0 (first-class success)");
  assert(searchExitCode({ resultCount: 0, abstain: true, failOnAbstain: true }) === 3, "abstain + --fail-on-abstain -> 3 (dedicated)");
  assert(searchExitCode({ resultCount: 0, abstain: false, failOnAbstain: true }) === 1, "no abstain + flag -> still 1");

  // 2. One-line message contract: domain + pre/post counts + gate.
  const line = formatAbstainLine({ domain: "docs", preFiltered: 10, postFiltered: 0, gate: "post" });
  assert(line.split(String.fromCharCode(10)).length === 1, "abstain message is a single line");
  for (const tok of ["abstain", "docs", "pre-filtered 10", "post-filtered 0", "gate post"]) {
    assert(line.includes(tok), "abstain line missing token: " + tok);
  }
  const cold = formatAbstainLine({ domain: "cold", preFiltered: 0, postFiltered: 0, gate: "pre" });
  assert(cold.includes("gate pre"), "cold-domain line reports gate=pre");

  // 3. Conditional live arm: spawn the built CLI against a narrow-allowlist
  // domain — deterministic abstain whenever one keyed provider exists.
  const here = dirname(fileURLToPath(import.meta.url));
  const dist = join(here, "..", "dist", "index.js");
  const keyed = ["EXA_API_KEY", "TAVILY_API_KEY"].some((k) => process.env[k]);
  if (!existsSync(dist) || !keyed) {
    console.log("SKIP live arm: dist or provider key absent (run pnpm build + set EXA_API_KEY to enable)");
  } else {
    const d = mkdtempSync(join(tmpdir(), "ans-cold-domain-"));
    writeFileSync(join(d, "cold.toml"), [
      'name = "cold"', 'description = "r61 abstain fixture"', '[settings]', 'language = "TypeScript"', 'depth = "docs"', '[skills]', 'active = ["search"]', '[sources]', 'enabled = ["tavily", "exa"]', 'urlAllowlist = ["nonexistent.invalid"]', '[rag]', 'adapter = "none"',
    ].join(String.fromCharCode(10)));
    const env = { ...process.env, ANS_DOMAIN: "cold", ANS_DOMAINS_DIR: d };
    const run = (extra: string[]) => new Promise<{ code: number; out: string }>((resolve) => {
      const p = spawn(process.execPath, [dist, "search", "tokio JoinSet rust", ...extra], { env, stdio: ["ignore", "pipe", "pipe"] });
      let out = ""; p.stdout.on("data", (c) => (out += c)); p.stderr.on("data", (c) => (out += c));
      p.on("close", (code) => resolve({ code: code ?? -1, out }));
      setTimeout(() => { p.kill(); resolve({ code: -9, out: out + " TIMEOUT" }); }, 60000);
    });
    const def = await run([]);
    assert(def.code === 0, "live abstain default exit 0 (got " + def.code + ") out=" + def.out.slice(-200));
    assert(/abstain: no results within allowed cold domain/.test(def.out), "live abstain line printed");
    const strict = await run(["--fail-on-abstain"]);
    assert(strict.code === 3, "live abstain --fail-on-abstain exit 3 (got " + strict.code + ")");
  }

  console.log("--- cli abstain tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
