// Search presentation contract — abstain: one structured line,
// exit 0 by default, dedicated exit 3 under --fail-on-abstain; provider
// build-failure absence: one golden line naming the absent arm + its safe
// category, undefined when the record is empty. The pure helpers
// are asserted offline; a conditional live arm spawns the built CLI with a
// narrow-allowlist domain fixture to measure the real exit codes (skipped
// honestly when no provider key / dist bundle is available).
// ponytail: no test framework, assert-based demo.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { providerErrorHints } from "@anysearch-cli/kernel";
import {
  searchExitCode,
  formatAbstainLine,
  formatProviderAbsentLine,
  formatProvidersCancelledLine,
  formatProvidersFailedLine,
  formatProviderHintLines,
  describeCredentialSource,
  describeUnconfiguredSource,
} from "../src/commands/search-abstain";

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

  // 3. Provider build-failure absence line (#180): id + safe category per
  // absent arm on one line, undefined when the record is empty (zero-noise
  // healthy path). The category text is the kernel's safe message verbatim.
  assert(formatProviderAbsentLine({}) === undefined, "empty record renders nothing (zero noise)");
  const absent = formatProviderAbsentLine({ exa: "permanent: missing/invalid credential — set the provider's API key env" });
  assert(absent !== undefined, "populated record renders a line");
  assert(absent!.split(String.fromCharCode(10)).length === 1, "absence message is a single line");
  assert(absent === "Providers absent (build failure): exa — permanent: missing/invalid credential — set the provider's API key env",
    "golden absence line shape");
  const multi = formatProviderAbsentLine({ tavily: "unexpected construction fault", exa: "permanent: missing/invalid credential — set the provider's API key env" });
  assert(multi !== undefined && multi!.includes("; "), "multiple absences render on one line");
  assert(multi!.includes("tavily — unexpected construction fault"), "each arm carries its own category");
  assert(multi!.includes("exa — permanent: missing/invalid credential"), "second arm keeps the credential category");

  // 3b. Remedy lines under the failed line: the class tag is machine language,
  //     the sentence is the action. The wait comes from the arm's retry-after,
  //     and a class without a sentence adds nothing, so the quiet path stays quiet.
  {
    const hints = providerErrorHints(
      ["tavily", "exa"],
      { tavily: "free-quota-exhausted", exa: "unknown" },
      { tavily: 3600 },
    );
    const lines = formatProviderHintLines(hints);
    assert(lines.length === 1, "only the arm whose class has a sentence gets a line");
    assert(
      lines[0] === "  tavily: the free quota is used up — wait 3600 seconds and retry, or add a key for this provider",
      "the hint line carries the retry-after as a number; got: " + lines[0],
    );
    assert(!lines[0].includes("{"), "the {wait} slot never reaches the reader");
    assert(formatProviderHintLines({}).length === 0, "no hints, no lines");

    // #502: permanent-auth gets a line through the same formatter the other
    // classes use. The wording belongs to PROVIDER_ERROR_HINTS in
    // packages/kernel/src/provider-error-hints.ts and is pinned by its own test.
    const authLines = formatProviderHintLines(providerErrorHints(["tavily"], { tavily: "permanent-auth" }));
    assert(authLines.length === 1, "the auth class gets a hint line");
    assert(authLines[0].startsWith("  tavily: "), "the hint line names the arm; got: " + authLines[0]);
  }

  // 4. Failed-provider line carries the arm's key source (#441). Same
  //    resolution the engine hands us; no source when resolution never ran.
  // #459: the engine writes all three arms, so the fixtures carry all three.
  assert(
    formatProvidersFailedLine(["exa"], { status: "resolved", tavily: "none", exa: "env", anysearch: "none" }) ===
      "Providers failed: exa（key 来自环境变量）",
    "env key is named on the failed line",
  );
  assert(
    formatProvidersFailedLine(["tavily"], { status: "resolved", tavily: "user", exa: "none", anysearch: "none" }) ===
      "Providers failed: tavily（key 来自用户凭据文件）",
    "user key is named on the failed line",
  );
  assert(
    formatProvidersFailedLine(["anysearch"], { status: "resolved", tavily: "none", exa: "none", anysearch: "none" }) ===
      "Providers failed: anysearch（没配 key）",
    "anysearch names only its key state: its endpoint can point anywhere",
  );
  assert(
    formatProvidersFailedLine(["exa"], { status: "failed", error: "unreadable" }) === "Providers failed: exa",
    "a failed resolution adds no invented source",
  );
  assert(
    formatProvidersFailedLine(["exa", "tavily"], { status: "resolved", tavily: "none", exa: "env", anysearch: "none" }) ===
      "Providers failed: exa（key 来自环境变量）, tavily（没配 key，用免费额度跑）",
    "each failed arm keeps its own note",
  );
  assert(
    formatProvidersFailedLine(["other"], { status: "resolved", tavily: "none", exa: "none", anysearch: "none" }) ===
      "Providers failed: other",
    "an arm the resolver never named gets no invented source",
  );
  assert(
    formatProvidersFailedLine(["exa"], { status: "resolved", tavily: "none", exa: "none", anysearch: "none" }) ===
      "Providers failed: exa（没配 key）",
    "a failed arm names only its key state; 'does not participate' belongs to doctor",
  );
  assert(
    describeCredentialSource("none", "exa") === "没配 key，用免费额度跑",
    "exa's keyless arm runs on the free quota too",
  );
  assert(
    describeCredentialSource("env", "tavily") === "key 来自环境变量" &&
      describeCredentialSource("none", "tavily") === "没配 key，用免费额度跑",
    "doctor and search share one source wording",
  );
  // doctor's own row adds the cap note, because it reports `unconfigured` and a
  // reader would otherwise take "runs" for "stable".
  assert(
    describeUnconfiguredSource("tavily") === "没配 key，用免费额度跑（有次数和速度上限）",
    "doctor's keyless row says the free quota is capped",
  );
  assert(
    describeUnconfiguredSource("exa") === "没配 key，用免费额度跑（有次数和速度上限）",
    "every keyless arm gets the cap note, exa included",
  );

  // 4b. Cancelled line (#454 / #475): an arm the grace window cut off is named
  //     on its own line — it was asked, just not waited for. An empty list
  //     prints nothing, so the healthy path stays as quiet as before.
  assert(formatProvidersCancelledLine([]) === undefined, "no cancelled arms, no line");
  const cancelled = formatProvidersCancelledLine(["anysearch"]);
  assert(cancelled !== undefined, "a cancelled arm renders a line");
  assert(cancelled!.split(String.fromCharCode(10)).length === 1, "cancelled line is a single line");
  assert(
    cancelled === "Providers cancelled: anysearch（结果够了，没等它回来）",
    "golden cancelled line shape; got: " + cancelled,
  );
  assert(
    formatProvidersCancelledLine(["exa", "anysearch"]) === "Providers cancelled: exa, anysearch（结果够了，没等它回来）",
    "several cut-off arms share the one reason",
  );

  // 5. Conditional live arm: spawn the built CLI against a narrow-allowlist
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
