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

async function run(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [DIST, ...args], { stdio: ["ignore", "pipe", "pipe"] });
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
    // ADR-0020 D3: version pinned to package.json (currently 0.1.0-rc.0);
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
    const r = await run(["chat", "hello"]);
    assert.equal(r.code, 3);
    assert.match(r.out, /LLM provider not configured|ANS_LLM_PROVIDER/);
  });

  await t("mcp --help exits 0 (mcp subcommand dependency smoke)", async () => {
    const r = await run(["mcp", "--help"]);
    assert.equal(r.code, 0);
  });

  console.log("---");
  console.log("CLI e2e: " + passed + " passed, " + failed + " failed");
  process.exit(failed === 0 ? 0 : 1);
})();
