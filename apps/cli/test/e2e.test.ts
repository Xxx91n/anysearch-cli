import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// CLI exit-assertion e2e. Spawn the real dist/ bundle and
// assert process exit codes + minimal stdout invariants. No mocks — this is
// a public-contract surface. Run after 'build' (dist/index.js must exist).

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(here, "..", "dist", "index.js");

let passed = 0;
let failed = 0;

async function run(args: string[], env?: NodeJS.ProcessEnv, cwd?: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [DIST, ...args], { stdio: ["ignore", "pipe", "pipe"], ...(env ? { env } : {}), ...(cwd ? { cwd } : {}) });
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
    // version pinned to package.json (currently 0.0.1);
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
    // B1: doctor surfaces the real domains section + the docs domain.
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
    // nit fix: sanitize ambient ANS_LLM_* — the test asserts the
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

  // malformed vertical input is fail-fast at the CLI boundary —
  // aligned with the MCP schema-rejection direction (draft).
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
    // ③: golden — the require-domain error line is
    // byte-identical across the a06 consolidation (assertion carrier for
    // the frozen error shape; exact line, not a regex window).
    assert.ok(
      r.out.split("\n").includes("ans search: --vertical-sub-domain/--vertical-params require --vertical-domain"),
      "byte-identical golden: require-domain stderr line",
    );
  });

  await t("search --vertical-sub-domain without --vertical-domain exits 2 (golden)", async () => {
    const r = await run(["search", "q", "--vertical-sub-domain", "earnings"]);
    assert.equal(r.code, 2);
    assert.ok(
      r.out.split("\n").includes("ans search: --vertical-sub-domain/--vertical-params require --vertical-domain"),
      "byte-identical golden: require-domain stderr line",
    );
  });

  // positional flag-value consumption — a query term
  // identical to a flag value must survive; the old flagValueSet heuristic
  // swallowed it via set-membership removal. --json echoes the cleaned query.
  await t("search q finance --vertical-domain finance keeps the query word (a03 no-swallow)", async () => {
    const r = await run(["search", "q", "finance", "--vertical-domain", "finance", "--json"]);
    assert.match(r.out, /"query": "q finance"/);
  });

  await t("search q deep --mode deep keeps the query word (a03 no-swallow)", async () => {
    const r = await run(["search", "q", "deep", "--mode", "deep", "--json"]);
    assert.match(r.out, /"query": "q deep"/);
    assert.match(r.out, /"mode": "deep"/);
  });

  // audit: the spec's literal case — lone word identical to the flag value
  // collapses under the old heuristic (query would be empty), survives now.
  await t("search --vertical-domain finance finance keeps the lone identical word (a03 spec case)", async () => {
    const r = await run(["search", "--vertical-domain", "finance", "finance", "--json"]);
    assert.match(r.out, /"query": "finance"/);
  });

  // rework: the TOML leg of —
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

  await t("skill install → validate → list → uninstall on the shipped bundle (#109)", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const { execFileSync } = await import("node:child_process");
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "ans-skill-e2e-"));
    const home = path.join(base, "home");
    const cwd = path.join(base, "project");
    const source = path.join(base, "source");
    try {
      for (const dir of [home, cwd, source]) fs.mkdirSync(dir, { recursive: true });
      const git = (args: string[]) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
      git(["init", "--quiet"]);
      git(["config", "user.name", "Skill E2E"]);
      git(["config", "user.email", "skill-e2e@example.invalid"]);
      git(["config", "commit.gpgsign", "false"]);
      fs.writeFileSync(path.join(source, "SKILL.md"), "---\nname: e2e-skill\ndescription: Bundled CLI test\n---\nInstructions.\n");
      git(["add", "SKILL.md"]);
      git(["commit", "--quiet", "-m", "skill"]);
      git(["tag", "v1.0.0"]);
      fs.mkdirSync(path.join(cwd, "domains"));
      const domainPath = path.join(cwd, "domains", "research.toml");
      const domain = '[skills]\nactive = ["existing"]\n';
      fs.writeFileSync(domainPath, domain);
      const env = { ...process.env, HOME: home, USERPROFILE: home };
      const installed = await run(["skill", "install", source, "--project"], env, cwd);
      assert.equal(installed.code, 0, installed.out);
      assert.equal(fs.readFileSync(domainPath, "utf8"), domain);
      const validated = await run(["skill", "validate", "--project"], env, cwd);
      assert.equal(validated.code, 0, validated.out);
      assert.match(validated.out, /\[OK\] e2e-skill/);
      const listed = await run(["skill", "list", "--project"], env, cwd);
      assert.equal(listed.code, 0, listed.out);
      assert.match(listed.out, /e2e-skill.*v1\.0\.0/);
      const manifestPath = path.join(cwd, ".anysearch", "skills", "synced", "installed.json");
      fs.writeFileSync(manifestPath, "{broken");
      const refused = await run(["skill", "uninstall", "e2e-skill", "--project"], env, cwd);
      assert.equal(refused.code, 1, refused.out);
      assert.ok(fs.existsSync(path.join(cwd, ".anysearch", "skills", "synced", "e2e-skill", "SKILL.md")));
      fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, skills: {
        "e2e-skill": { name: "e2e-skill", source, commit: git(["rev-parse", "HEAD"]), tag: "v1.0.0", dirty: false },
      } }));
      const removed = await run(["skill", "uninstall", "e2e-skill", "--project"], env, cwd);
      assert.equal(removed.code, 0, removed.out);
      assert.equal(fs.existsSync(path.join(cwd, ".anysearch", "skills", "synced", "e2e-skill")), false);
      assert.equal(fs.readFileSync(domainPath, "utf8"), domain);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  console.log("---");
  console.log("CLI e2e: " + passed + " passed, " + failed + " failed");
  process.exit(failed === 0 ? 0 : 1);
})();
