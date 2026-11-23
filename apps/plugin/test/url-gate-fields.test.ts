// Which tool fields the URL policy actually looks at.
//
// The policy is a gate for text that leaves the machine. `search_web` sends its
// query to providers, so a host written there — bare or not — has to be judged.
// `recall_memory` and `query_knowledge` read the local index: nothing leaves, and
// rewriting or even widening those queries changes which rows match.
//
// Run: npx tsx apps/plugin/test/url-gate-fields.test.ts

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePreToolUseDecision } from "../src/hooks/preheat.js";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log("  PASS " + name); } catch (e) {
    failed++;
    console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message : String(e)));
  }
}

const DEAD = "http://127.0.0.1:9"; // nothing listens; connection refused fast
const prevEnv = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  ANS_SERVER_URL: process.env.ANS_SERVER_URL,
  ANS_SERVER_TOKEN: process.env.ANS_SERVER_TOKEN,
};
const dir = mkdtempSync(join(tmpdir(), "ans-url-fields-"));
mkdirSync(join(dir, ".ans"), { recursive: true });
writeFileSync(join(dir, ".ans", "config.toml"), "", "utf8");
const fakeHome = join(dir, "home");
mkdirSync(fakeHome, { recursive: true });
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome;
process.env.ANS_SERVER_URL = DEAD;
process.env.ANS_SERVER_TOKEN = "url-fields-test";
delete process.env.ANS_SERVER_REGISTRY;

/** A server that is down and a project with no cached policy: every host must be asked about. */
async function decide(toolName: string, toolInput: Record<string, unknown>) {
  return makePreToolUseDecision({
    event: "PreToolUse",
    toolName,
    toolInput,
    projectPath: dir,
    sessionId: "s1",
  });
}

async function main() {
  await test("search_web: a bare domain in the query is judged (used to slip through)", async () => {
    const d = await decide("mcp__anysearch__search_web", { query: "查一下 example.com/a" });
    assert.equal(d.permission, "ask", "unreachable policy must ask about the host");
    assert.ok(d.permissionReason?.includes("example.com"), d.permissionReason);
  });

  await test("search_web: an explicit URL in the query is judged as before", async () => {
    const d = await decide("mcp__anysearch__search_web", { query: "看 https://example.com/a" });
    assert.equal(d.permission, "ask");
  });

  await test("ans_chat: a bare domain in the message is judged", async () => {
    const d = await decide("mcp__anysearch__ans_chat", { message: "总结 example.com/a" });
    assert.equal(d.permission, "ask");
  });

  await test("search_web: a file name in the query is still not a host", async () => {
    const d = await decide("mcp__anysearch__search_web", { query: "main.py 里的 main 函数" });
    assert.equal(d.permission, undefined, "no host, nothing to judge");
  });

  await test("recall_memory: a URL in the query is not judged — it never leaves the machine", async () => {
    const d = await decide("mcp__anysearch__recall_memory", { query: "https://example.com/a" });
    assert.equal(d.permission, undefined);
  });

  await test("query_knowledge: a bare domain in the query is not judged", async () => {
    const d = await decide("mcp__anysearch__query_knowledge", { query: "example.com/a" });
    assert.equal(d.permission, undefined);
  });

  rmSync(dir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(prevEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

process.on("exit", () => {
  console.log("  url-gate-fields: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exitCode = 1;
});

main();
