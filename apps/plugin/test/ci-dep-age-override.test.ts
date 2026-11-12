// #260 — the temporary dependency-age bypass must not outlive its reason.
//
// The repo forbids relaxing the age gate (AGENTS.md, scripts/dep-age-status.mjs,
// ship-gate step E6). The owner asked to bypass it once so CI could run, so the
// bypass is written to expire by wall-clock rather than to wait for somebody to
// remember. These assertions are the guarantee that a merged bypass cannot
// quietly keep working after the window closes.
//
// Run: node --import tsx --test packages/kernel/test/... (this file is a script
// test, invoked directly by the package's test glob from apps/ or by hand).

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error("FAIL: " + msg); }
}

const here = fileURLToPath(new URL(".", import.meta.url));
const script = resolve(here, "../../../scripts/ci-dep-age-override.mjs");

function run(env: Record<string, string>): { code: number | null; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "dep-age-env-"));
  const envFile = join(dir, "github_env");
  try {
    const r = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, ...env, GITHUB_ENV: envFile },
    });
    let fileBody = "";
    try { fileBody = readFileSync(envFile, "utf8"); } catch { /* not written */ }
    return { code: r.status, out: String(r.stdout ?? "") + String(r.stderr ?? "") + "\n[envfile]" + fileBody };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- 1. inside the window: the bypass is exported, and the deadline is named ---
{
  const r = run({ ANS_DEP_AGE_OVERRIDE_UNTIL: "2099-01-01T00:00:00Z" });
  assert(r.code === 0, "the script exits 0 inside the window");
  assert(
    r.out.includes("PNPM_CONFIG_MINIMUM_RELEASE_AGE=0"),
    "inside the window it sets the override (got: " + r.out.slice(0, 200) + ")",
  );
  assert(
    r.out.includes("::warning::") && r.out.includes("2099-01-01T00:00:00Z"),
    "it warns and names the deadline so the bypass is visible in the run log",
  );
}

// --- 2. after the deadline: nothing is exported, so the strict gate returns ---
{
  const r = run({ ANS_DEP_AGE_OVERRIDE_UNTIL: "2000-01-01T00:00:00Z" });
  assert(r.code === 0, "closing the window is not an error");
  assert(
    !r.out.includes("[envfile]PNPM_CONFIG_MINIMUM_RELEASE_AGE"),
    "after the deadline it writes no override (got: " + r.out + ")",
  );
  assert(
    r.out.includes("strict gate applies"),
    "and says the strict gate is back",
  );
}

// --- 3. an unparseable deadline must not become a permanent bypass ---
{
  const r = run({ ANS_DEP_AGE_OVERRIDE_UNTIL: "not-a-date" });
  assert(r.code === 0, "a malformed deadline does not fail the job");
  assert(
    !r.out.includes("[envfile]PNPM_CONFIG_MINIMUM_RELEASE_AGE"),
    "a malformed deadline writes no override (fail-closed toward the strict gate)",
  );
}

// --- 4. the real default deadline is in the future only because it is dated ---
{
  // This is the guard that matters after merge: the committed default must be a
  // parseable timestamp, so expiry is a date and not an intention.
  const src = readFileSync(script, "utf8");
  const m = src.match(/ANS_DEP_AGE_OVERRIDE_UNTIL\s*\?\?\s*"([^"]+)"/);
  assert(m !== null, "the script carries a literal default deadline");
  assert(
    m !== null && Number.isFinite(Date.parse(m[1]!)),
    "that default deadline parses as a real timestamp (got " + JSON.stringify(m?.[1]) + ")",
  );
}

console.log("ci-dep-age-override: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
