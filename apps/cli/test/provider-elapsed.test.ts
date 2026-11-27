// #653 — `ans search --json` tells you what each answered arm took.
//
// What this pins:
//   - providerElapsedMs is keyed by provider id and carries the number the
//     provider itself reported (the stub's own "2ms"), not a re-measured guess;
//   - an arm cut at --deadline has no key at all — not 0, not null.
//
// The engine half (answered / cut / failed / arrival order) lives in
// packages/kernel/test/engine.test.ts; this file only proves the --json exit.
//
// Run: pnpm --filter @anysearch-cli/cli test

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSearch } from "../src/commands/search.js";
import { startFakeAnySearch } from "./helpers/fake-anysearch";

const dir = mkdtempSync(join(tmpdir(), "ans-653-elapsed-"));
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
process.env.ANS_DOMAIN = "elapsed";
process.env.ANS_PROVIDERS = "anysearch";
process.env.ANS_ALLOW_ENV_OVERRIDE = "0";
process.env.USERPROFILE = dir;
process.env.HOME = dir;
process.env.ANYSEARCH_API_KEY = "";
process.env.TAVILY_API_KEY = "";
process.env.EXA_API_KEY = "";

writeFileSync(join(domainsDir, "elapsed.toml"), [
  'name = "elapsed"',
  "[sources]",
  'enabled = ["anysearch"]',
  'urlAllowlist = ["example.com"]',
  "[rag]",
  'adapter = "none"',
  "",
].join("\n"), "utf8");

// The provider reads this header and reports it as its own elapsedMs, so the
// number the test asserts is exactly the one the arm said it took.
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

test.after(() => {
  for (const key of ENV_KEYS) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
});

test("an answered arm's own elapsedMs reaches --json", async () => {
  const stub = await startFakeAnySearch(MARKDOWN);
  process.env.ANYSEARCH_ENDPOINT = stub.endpoint;
  try {
    const r = await run(["q", "--json"]);
    assert.equal(r.code, 0, r.err + r.out);
    const doc = JSON.parse(r.out);
    assert.deepEqual(doc.providerElapsedMs, { anysearch: 2 },
      "the arm's own 2ms is what the JSON carries; got " + JSON.stringify(doc.providerElapsedMs));
  } finally {
    await stub.close();
  }
});

test("a cut arm has no key in providerElapsedMs", async () => {
  const stub = await startFakeAnySearch(MARKDOWN, { delayMs: 5000 });
  process.env.ANYSEARCH_ENDPOINT = stub.endpoint;
  try {
    const r = await run(["q", "--json", "--deadline", "500"]);
    assert.equal(r.code, 1, r.err + r.out);
    const doc = JSON.parse(r.out);
    assert.deepEqual(doc.providersCancelled, ["anysearch"],
      "the cut arm is named; got " + JSON.stringify(doc.providersCancelled));
    assert.deepEqual(doc.providerElapsedMs, {},
      "a cut arm has no elapsed entry; got " + JSON.stringify(doc.providerElapsedMs));
    assert.ok(!Object.hasOwn(doc.providerElapsedMs, "anysearch"),
      "the key is absent outright — not 0, not null");
  } finally {
    await stub.close();
  }
});
