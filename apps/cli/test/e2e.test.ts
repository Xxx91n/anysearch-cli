import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ADR-0018 R16-4: CLI exit-assertion e2e. Spawn the real dist/ bundle and
// assert process exit codes + minimal stdout invariants. No mocks — this is
// a public-contract surface. Run after 'build' (dist/index.js must exist).

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(here, "..", "dist", "index.js");

let passed = 0;
let failed = 0;

async function run(args: string[], env?: NodeJS.ProcessEnv): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [DIST, ...args], { stdio: ["ignore", "pipe", "pipe"], ...(env ? { env } : {}) });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code: code ?? 1, out }));
    p.on("error", reject);
    setTimeout(() => { p.kill(); reject(new Error("timeout " + args[0])); }, 15000);
  });
}

async function t(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log("ok - " + name);
  } catch (e: any) {
    failed++;
    console.error("FAIL - " + name + ": " + (e?.message || String(e)));
  }
}

(async () => {
  await t("--help exits 0 and lists all 9 commands", async () => {
    const r = await run(["--help"]);
    assert.equal(r.code, 0);
    for (const cmd of ["doctor", "auth", "llm", "skill", "search", "chat", "recommend", "domain", "mcp"]) {
      assert.ok(r.out.includes(cmd), "missing " + cmd);
    }
  });

  await t("--version prints pinned version (not 0.0.0)", async () => {
    const r = await run(["--version"]);
    assert.equal(r.code, 0);
    // ADR-0020 D3: version pinned to package.json (currently 0.0.1);
    // assert it is NOT the 0.0.0 placeholder and matches SemVer-ish shape.
    assert.doesNotMatch(r.out, /\b0\.0\.0\b/);
    assert.match(r.out, /\d+\.\d+\.\d+(-[\w.]+)?/);
  });

  await t("unknown command exits 2 with error message", async () => {
    const r = await run(["not-a-command"]);
    assert.equal(r.code, 2);
    assert.match(r.out, /unknown command/);
  });

  await t("doctor runs smoke suite and exits 0", async () => {
    const r = await run(["doctor"]);
    assert.equal(r.code, 0, "doctor stdout: " + r.out.slice(0, 500));
    for (const marker of ["[OK]", "Result:", "passed"]) {
      assert.ok(r.out.includes(marker), "missing " + marker);
    }
    // ADR-0061 B1: doctor surfaces the real domains section + the docs domain.
    assert.ok(r.out.includes("[5] Domains"), "missing domains section");
    assert.ok(r.out.includes("docs"), "docs domain not listed");
  });

  await t("llm (no args) prints provider list, exit 0", async () => {
    const r = await run(["llm"]);
    assert.equal(r.code, 0);
    for (const p of ["openai", "anthropic", "google"]) assert.ok(r.out.includes(p), "missing " + p);
  });

  await t("llm bogus subcommand exits 2", async () => {
    const r = await run(["llm", "bogus"]);
    assert.equal(r.code, 2);
  });

  await t("llm models openai lists models", async () => {
    const r = await run(["llm", "models", "openai"]);
    assert.equal(r.code, 0);
    assert.ok(r.out.includes("gpt-5"));
  });

  await t("chat without LLM env exits 3", async () => {
    // R83 nit fix: sanitize ambient ANS_LLM_* — the test asserts the
    // no-LLM-env behavior, so a developer machine with a configured provider
    // must not leak it into the child process.
    const cleanEnv = { ...process.env };
    for (const k of Object.keys(cleanEnv)) if (k.startsWith("ANS_LLM_")) delete cleanEnv[k];
    const r = await run(["chat", "hello"], cleanEnv);
    assert.equal(r.code, 3);
    assert.match(r.out, /LLM provider not configured|ANS_LLM_PROVIDER/);
  });

  await t("mcp --help exits 0 (mcp subcommand dependency smoke)", async () => {
    const r = await run(["mcp", "--help"]);
    assert.equal(r.code, 0);
  });

  await t("pref review lists quarantine state, exit 0", async () => {
    const r = await run(["pref", "review"]);
    assert.equal(r.code, 0);
    assert.ok(/quarantine|entity=/.test(r.out), "unexpected out: " + r.out.slice(0, 300));
  });

  await t("pref review --keep unknown id exits 1", async () => {
    const r = await run(["pref", "review", "--keep", "999999"]);
    assert.equal(r.code, 1);
  });

  // R84 T1 / A-02: malformed vertical input is fail-fast at the CLI boundary —
  // aligned with the MCP schema-rejection direction (ADR-0085 draft).
  await t("search --vertical-domain '' exits 2 (empty domain)", async () => {
    const r = await run(["search", "q", "--vertical-domain", ""]);
    assert.equal(r.code, 2);
    assert.match(r.out, /non-empty string/);
  });

  await t("search --vertical-domain (bare, no value) exits 2", async () => {
    const r = await run(["search", "q", "--vertical-domain"]);
    assert.equal(r.code, 2);
    assert.match(r.out, /requires a value/);
  });

  await t("search --vertical-domain --json exits 2 (flag-as-value)", async () => {
    const r = await run(["search", "q", "--vertical-domain", "--json"]);
    assert.equal(r.code, 2);
    assert.match(r.out, /requires a value/);
  });

  await t("search --vertical-sub-domain '' exits 2 (empty sub)", async () => {
    const r = await run(["search", "q", "--vertical-domain", "finance", "--vertical-sub-domain", ""]);
    assert.equal(r.code, 2);
    assert.match(r.out, /non-empty string/);
  });

  await t("search --vertical-params '[1]' exits 2 (non-Record)", async () => {
    const r = await run(["search", "q", "--vertical-domain", "finance", "--vertical-params", "[1]"]);
    assert.equal(r.code, 2);
    assert.match(r.out, /must be a JSON object/);
  });

  await t("search --vertical-params without --vertical-domain exits 2", async () => {
    const r = await run(["search", "q", "--vertical-params", "{\"type\":\"earnings\"}"]);
    assert.equal(r.code, 2);
    assert.match(r.out, /require --vertical-domain/);
  });

  // R84 rework (audit F1 / ADR-0085 D6 addendum): the TOML leg of A-02 —
  // a domain file with a malformed sources.vertical must fail fast at the
  // user surface (explicit error, non-zero exit), not silently fall back to
  // full-fanout with the whole domain dropped.
  await t("search with malformed sources.vertical TOML fails fast", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ans-e2e-badtoml-"));
    try {
      fs.writeFileSync(path.join(dir, "badvert.toml"), [
        'name = "badvert"',
        '[sources]',
        'enabled = ["anysearch"]',
        '[sources.vertical]',
        'domain = "finance"',
        'bogus_key = "x"',
        '[rag]',
        'adapter = "none"',
        "",
      ].join("\n"), "utf8");
      const r = await run(["search", "q", "--json"], { ...process.env, ANS_DOMAINS_DIR: dir, ANS_DOMAIN: "badvert" });
      assert.notEqual(r.code, 0);
      assert.match(r.out, /sources\.vertical|Domain schema/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  console.log("---");
  console.log("CLI e2e: " + passed + " passed, " + failed + " failed");
  process.exit(failed === 0 ? 0 : 1);
})();
