// Search presentation contract — abstain: one structured line,
// exit 0 by default, dedicated exit 3 under --fail-on-abstain; provider
// build-failure absence: one golden line naming the absent arm + its safe
// category, undefined when the record is empty. The pure helpers
// are asserted offline; a conditional live arm spawns the built CLI with a
// narrow-allowlist domain fixture to measure the real exit codes (skipped
// honestly when no provider key / dist bundle is available).
// ponytail: no test framework, assert-based demo.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { providerErrorHints } from "@anysearch-cli/kernel";
import {
  searchExitCode,
  formatAbstainLine,
  formatFailedArmLines,
  formatProviderAbsentLine,
  formatProvidersCancelledLine,
  formatProvidersFailedLine,
  formatProviderHintLines,
  describeCredentialSource,
  describeUnconfiguredSource,
} from "../src/commands/search-abstain";
import { startFakeAnySearch } from "./helpers/fake-anysearch";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

async function main() {
  // 1. Exit-code contract: the table reads the engine's verdict, so the code
  //    and the reported outcome cannot disagree.
  assert(searchExitCode({ outcome: "answer", failOnAbstain: false }) === 0, "answer -> 0");
  assert(searchExitCode({ outcome: "empty", failOnAbstain: false }) === 1, "zero results outside a policy -> 1");
  assert(searchExitCode({ outcome: "failed", failOnAbstain: false }) === 1, "an outage -> 1");
  assert(searchExitCode({ outcome: "cancelled", failOnAbstain: false }) === 1, "nothing arrived and an arm was cut off -> 1");
  assert(searchExitCode({ outcome: "abstain", failOnAbstain: false }) === 0, "abstain -> 0 (first-class success)");
  assert(searchExitCode({ outcome: "abstain", failOnAbstain: true }) === 3, "abstain + --fail-on-abstain -> 3 (dedicated)");
  assert(searchExitCode({ outcome: "empty", failOnAbstain: true }) === 1, "no abstain + flag -> still 1");

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

  // 3c. The failed-arm block both render paths print (#514 / #476): the failed
  //     line, then the remedy of each class that has one. Empty when no arm
  //     failed, so the healthy path stays as quiet as before. This is the
  //     assertion the abstain branch could never get from a spawned CLI without
  //     a build: the branch's rendering is a function now.
  {
    const block = formatFailedArmLines({
      providersFailed: ["exa"],
      credentialSources: { status: "resolved", tavily: "none", exa: "env", anysearch: "none" },
      hints: { exa: "add a key for this provider" },
    });
    assert(block.length === 2, "one failed line plus one remedy line (got " + block.length + ")");
    assert(block[0] === "Providers failed: exa（key 来自环境变量）", "failed line first, with its key source; got: " + block[0]);
    assert(block[1] === "  exa: add a key for this provider", "remedy line second; got: " + block[1]);
    assert(formatFailedArmLines({ providersFailed: [], hints: {} }).length === 0, "no failed arms, no lines");
    const noRemedy = formatFailedArmLines({ providersFailed: ["anysearch"], hints: {} });
    assert(noRemedy.length === 1, "a class without a sentence adds no line (got " + noRemedy.length + ")");
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
      "Providers failed: exa（没配 key，用免费额度跑）",
    "exa's failed line promises the free quota, same as tavily",
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
  // reader would otherwise take "runs" for "stable". It also says the free-quota
  // path was not verified this run (#534): `--live` skips a source with no key.
  assert(
    describeUnconfiguredSource("tavily") ===
      "没配 key，用免费额度跑（有次数和速度上限）；免费额度这条路没验",
    "doctor's keyless row says the free quota is capped and unverified",
  );
  assert(
    describeUnconfiguredSource("exa") ===
      "没配 key，用免费额度跑（有次数和速度上限）；免费额度这条路没验",
    "every keyless arm gets the cap note, exa included",
  );
  // #533: when the credential file is why an arm has no key, "not configured"
  // names the wrong cause. The line says the file is broken instead, and keeps
  // the free-quota fact (the arm really does run on it).
  const brokenFileRecord = {
    status: "resolved" as const,
    tavily: "none" as const,
    exa: "none" as const,
    anysearch: "none" as const,
    credentialFileFault: { kind: "not-json" as const, notice: "not valid JSON" },
  };
  assert(
    formatProvidersFailedLine(["exa"], brokenFileRecord) ===
      "Providers failed: exa（凭据文件坏了，用免费额度跑）",
    "a broken file is named as the cause, not read as 'never configured'",
  );
  assert(
    formatProvidersFailedLine(["anysearch"], brokenFileRecord) ===
      "Providers failed: anysearch（凭据文件坏了）",
    "anysearch still states only its key state, now with the real cause",
  );
  assert(
    formatProvidersFailedLine(["exa"], { ...brokenFileRecord, exa: "env" }) ===
      "Providers failed: exa（key 来自环境变量）",
    "an env key is still used when the file is broken, and the line says so",
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

  // 5. Built-CLI arm: a narrow-allowlist domain plus a local stub endpoint, so
  //    the run is a real abstain (one arm answered with nothing, gate "pre")
  //    with no network and no key. Guarded on dist alone — the previous fixture
  //    needed a provider key, so CI skipped it and a keyed machine could turn
  //    it red (#476 §七).
  const here = dirname(fileURLToPath(import.meta.url));
  const dist = join(here, "..", "dist", "index.js");
  if (!existsSync(dist)) {
    console.log("SKIP stub arm: dist absent (run pnpm build)");
  } else {
    const d = mkdtempSync(join(tmpdir(), "ans-cold-domain-"));
    const stub = await startFakeAnySearch("## Search Results (0 results, 2ms)\n");
    try {
      writeFileSync(join(d, "cold.toml"), [
        'name = "cold"', 'description = "r61 abstain fixture"', '[settings]', 'language = "TypeScript"', 'depth = "docs"', '[skills]', 'active = ["search"]', '[sources]', 'enabled = ["anysearch"]', 'urlAllowlist = ["nonexistent.invalid"]', '[rag]', 'adapter = "none"',
      ].join(String.fromCharCode(10)));
      const env = {
        ...process.env,
        ANS_DOMAIN: "cold",
        ANS_DOMAINS_DIR: d,
        ANS_DB_PATH: join(d, "anysearch.db"),
        ANYSEARCH_ENDPOINT: stub.endpoint,
        ANS_ALLOW_ENV_OVERRIDE: "0",
        // "" means no filter; an ambient ANS_PROVIDERS=exa would cut the only arm.
        ANS_PROVIDERS: "",
      };
      const run = (extra: string[]) => new Promise<{ code: number; out: string }>((resolve) => {
        const p = spawn(process.execPath, [dist, "search", "tokio JoinSet rust", ...extra], { env, stdio: ["ignore", "pipe", "pipe"] });
        let out = ""; p.stdout.on("data", (c) => (out += c)); p.stderr.on("data", (c) => (out += c));
        p.on("close", (code) => resolve({ code: code ?? -1, out }));
        setTimeout(() => { p.kill(); resolve({ code: -9, out: out + " TIMEOUT" }); }, 60000);
      });
      const def = await run([]);
      assert(def.code === 0, "stub abstain default exit 0 (got " + def.code + ") out=" + def.out.slice(-300));
      assert(/abstain: no results within allowed cold domain/.test(def.out), "stub abstain line printed");
      const strict = await run(["--fail-on-abstain"]);
      assert(strict.code === 3, "stub abstain --fail-on-abstain exit 3 (got " + strict.code + ")");
    } finally {
      await stub.close();
      rmSync(d, { recursive: true, force: true });
    }
  }

  console.log("--- cli abstain tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
