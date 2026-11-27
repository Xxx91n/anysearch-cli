// #649 — the terminal decides how long this one search may wait.
//
// What this pins:
//   - --deadline reaches the engine (a source slower than the deadline is cut
//     at the deadline, not at the 4s default);
//   - every malformed form exits 2 and names the range and the default;
//   - --deadline's value never leaks into the query text (the #635 trap).
//
// The "results that already arrived survive the cut" half lives in the engine
// deadline tests (packages/kernel/test/engine.test.ts): a CLI run against one
// slow stub has no second arm to land first.
//
// Run: pnpm --filter @anysearch-cli/cli test

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runSearch } from "../src/commands/search.js";
import { startFakeAnySearch } from "./helpers/fake-anysearch";

const dir = mkdtempSync(join(tmpdir(), "ans-649-deadline-"));
const domainsDir = join(dir, "domains");
const dbPath = join(dir, "cli.db");
mkdirSync(domainsDir, { recursive: true });
const ENV_KEYS = [
  "ANS_DB_PATH",
  "ANS_DOMAINS_DIR",
  "ANS_DOMAIN",
  "ANS_PROVIDERS",
  "ANS_ALLOW_ENV_OVERRIDE",
  "USERPROFILE",
  "HOME",
  "ANYSEARCH_ENDPOINT",
  "ANYSEARCH_API_KEY",
  "TAVILY_API_KEY",
  "EXA_API_KEY",
  "ANS_EVAL_REQUEST_TIMEOUT_MS",
];
const previousEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) previousEnv[key] = process.env[key];
process.env.ANS_DB_PATH = dbPath;
process.env.ANS_DOMAINS_DIR = domainsDir;
process.env.ANS_DOMAIN = "deadline";
process.env.ANS_PROVIDERS = "anysearch";
process.env.ANS_ALLOW_ENV_OVERRIDE = "0";
process.env.USERPROFILE = dir;
process.env.HOME = dir;
process.env.ANYSEARCH_API_KEY = "";
process.env.TAVILY_API_KEY = "";
process.env.EXA_API_KEY = "";

writeFileSync(join(domainsDir, "deadline.toml"), [
  'name = "deadline"',
  "[sources]",
  'enabled = ["anysearch"]',
  'urlAllowlist = ["example.com"]',
  "[rag]",
  'adapter = "none"',
  "",
].join("\n"), "utf8");

const MARKDOWN = [
  "## Search Results (1 results, 2ms)",
  "",
  "### 1. The only result",
  "- **URL**: https://example.com/one",
  "- a result the domain gate lets through",
  "",
].join("\n");

async function run(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  let out = "";
  let err = "";
  (process.stdout as any).write = (chunk: any) => { out += String(chunk); return true; };
  (process.stderr as any).write = (chunk: any) => { err += String(chunk); return true; };
  try {
    const code = await runSearch(argv);
    return { code, out, err };
  } finally {
    (process.stdout as any).write = realOut;
    (process.stderr as any).write = realErr;
  }
}

function spawnCli(args: string[]): Promise<{ code: number | null; out: string; err: string }> {
  // The package's pretest build produces dist; this is the same entrypoint a
  // user runs. Spawning also keeps the test runner's own writes out of the
  // captured output: an in-process stdout patch can pick up the reporter.
  const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...process.env, HOME: dir, USERPROFILE: dir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { out += chunk; });
    child.stderr.on("data", (chunk: string) => { err += chunk; });
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

test.after(() => {
  for (const key of ENV_KEYS) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
});

test("a slow arm is cut at --deadline, not at the 4s default", async () => {
  const stub = await startFakeAnySearch(MARKDOWN, { delayMs: 5000 });
  process.env.ANYSEARCH_ENDPOINT = stub.endpoint;
  try {
    const started = Date.now();
    const r = await run(["q", "--deadline", "500"]);
    const wallMs = Date.now() - started;
    assert.equal(r.code, 1, "a cancelled search with no results exits 1; got: " + r.err + r.out);
    assert.match(r.out, /Providers cancelled: anysearch/, "the cut arm is named; got: " + r.out.slice(-400));
    assert.match(r.out, /Results: 0/, "nothing arrived before the deadline; got: " + r.out.slice(-400));
    const elapsed = /Elapsed: (\d+)ms/.exec(r.out);
    assert.ok(elapsed, "the run prints its elapsed time; got: " + r.out.slice(-400));
    const engineMs = Number(elapsed![1]);
    assert.ok(engineMs >= 400, "the engine waited for the 500ms deadline; got " + engineMs + "ms");
    assert.ok(engineMs < 3000, "the engine did not fall back to the 4s default; got " + engineMs + "ms");
    assert.ok(wallMs < 4000, "the whole command returned near the deadline; got " + wallMs + "ms");
  } finally {
    await stub.close();
  }
});

test("ans --help names --deadline <ms>, its bounds, and the default", async () => {
  const r = await spawnCli(["--help"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /--deadline <ms>/, "the search options list the flag; got: " + r.out.slice(0, 1200));
  assert.match(r.out, /how long this one search waits/, "the help says what the flag does; got: " + r.out.slice(0, 1200));
  assert.match(r.out, /--deadline=<ms>/, "the help also names the equals form; got: " + r.out.slice(0, 1200));
  assert.match(r.out, /500\D+60000/, "the help names the range; got: " + r.out.slice(0, 1200));
  assert.match(r.out, /default 4000/, "the help names the default");
});

test("--deadline=500 cuts a slow arm too", async () => {
  const stub = await startFakeAnySearch(MARKDOWN, { delayMs: 5000 });
  process.env.ANYSEARCH_ENDPOINT = stub.endpoint;
  try {
    const started = Date.now();
    const r = await run(["q", "--deadline=500"]);
    const wallMs = Date.now() - started;
    assert.equal(r.code, 1, "a cancelled search with no results exits 1; got: " + r.err + r.out);
    assert.match(r.out, /Providers cancelled: anysearch/, "the equals form reached the engine; got: " + r.out.slice(-400));
    assert.ok(wallMs < 4000, "the equals form used the deadline, not the 4s default; got " + wallMs + "ms");
  } finally {
    await stub.close();
  }
});

test("--deadline wins over ANS_EVAL_REQUEST_TIMEOUT_MS and says so", async () => {
  const stub = await startFakeAnySearch(MARKDOWN);
  process.env.ANYSEARCH_ENDPOINT = stub.endpoint;
  process.env.ANS_EVAL_REQUEST_TIMEOUT_MS = "20000";
  try {
    const r = await spawnCli(["search", "q", "--deadline", "5000", "--json"]);
    assert.equal(r.code, 0, r.err + r.out);
    assert.match(r.err, /--deadline 5000 ms 优先/, "stderr names the winner; got: " + r.err);
    assert.match(r.err, /ANS_EVAL_REQUEST_TIMEOUT_MS="20000"/, "stderr names the ignored value; got: " + r.err);
    const doc = JSON.parse(r.out);
    assert.equal(doc.requestTimeoutMs, 5000, "the flag's 5000ms is what ran; got: " + doc.requestTimeoutMs);
  } finally {
    delete process.env.ANS_EVAL_REQUEST_TIMEOUT_MS;
    await stub.close();
  }
});

test("the last --deadline wins", async () => {
  const stub = await startFakeAnySearch(MARKDOWN, { delayMs: 5000 });
  process.env.ANYSEARCH_ENDPOINT = stub.endpoint;
  try {
    const started = Date.now();
    const r = await run(["q", "--deadline", "9000", "--deadline", "500"]);
    const wallMs = Date.now() - started;
    assert.equal(r.code, 1, "a cancelled search with no results exits 1; got: " + r.err + r.out);
    assert.ok(wallMs < 4000, "the later 500ms deadline overrode 9000; got " + wallMs + "ms");
  } finally {
    await stub.close();
  }
});

test("--deadline 60000 keeps its value out of the query and off the 15s eval cap", async () => {
  const stub = await startFakeAnySearch(MARKDOWN);
  process.env.ANYSEARCH_ENDPOINT = stub.endpoint;
  try {
    const r = await spawnCli(["search", "q", "--deadline", "60000", "--json"]);
    assert.equal(r.code, 0, r.err + r.out);
    const doc = JSON.parse(r.out);
    assert.equal(doc.query, "q", "the deadline value is consumed, not searched; got: " + doc.query);
    assert.ok(!doc.query.includes("60000"), "the query never carries the deadline value");
    assert.equal(doc.requestTimeoutMs, 60000, "the user ceiling wins over the eval 15s cap; got: " + doc.requestTimeoutMs);
  } finally {
    await stub.close();
  }
});

for (const [label, argv] of [
  ["missing value", ["q", "--deadline"]],
  ["not a number", ["q", "--deadline", "abc"]],
  ["zero", ["q", "--deadline", "0"]],
  ["below the floor", ["q", "--deadline", "499"]],
  ["above the ceiling", ["q", "--deadline", "60001"]],
  ["fraction", ["q", "--deadline", "1.5"]],
  ["negative", ["q", "--deadline", "-1"]],
  ["another flag", ["q", "--deadline", "--json"]],
  ["equals missing value", ["q", "--deadline="]],
  ["equals not a number", ["q", "--deadline=abc"]],
  ["equals below the floor", ["q", "--deadline=499"]],
  ["first duplicate bad", ["q", "--deadline=abc", "--deadline=500"]],
] as const) {
  test("--deadline " + label + " exits 2 and states the range and default", async () => {
    const r = await run([...argv]);
    assert.equal(r.code, 2, "malformed --deadline is a usage error; got: " + r.err + r.out);
    assert.match(r.err, /500/, "the message names the floor; got: " + r.err);
    assert.match(r.err, /60000/, "the message names the ceiling; got: " + r.err);
    assert.match(r.err, /4000/, "the message names the default; got: " + r.err);
    assert.equal(r.out, "", "nothing is searched on a usage error");
  });
}
