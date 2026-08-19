// Phase 3 Plugin tests — ADR-0009 verification.
// Test: ProjectIndexStore CRUD, hooks core logic, distill, preheat, server liveness.

import assert from "node:assert/strict";
import { ProjectIndexStore, isAnsTool, distillOutput, makePostToolUseDecision } from "../src/index.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("  PASS " + name); }
  catch (e) { failed++; console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message : String(e))); }
}

async function testAsync(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log("  PASS " + name); }
  catch (e) { failed++; console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message : String(e))); }
}

// === ProjectIndexStore ===
const tmpDir = mkdtempSync(join(tmpdir(), "ans-plugin-test-"));
const dbPath = join(tmpDir, "test-project-index.db");

test("ProjectIndexStore: create and search", () => {
  const store = new ProjectIndexStore(dbPath);
  store.indexEntry({
    projectPath: "/test/project",
    toolName: "search_web",
    title: "TypeScript Handbook",
    url: "https://www.typescriptlang.org/docs/",
    snippet: "TypeScript is a strongly typed programming language that builds on JavaScript.",
    source: "exa",
    contentHash: "hash1",
  });
  const hits = store.search("TypeScript Handbook", 5);
  assert.ok(hits.length > 0, "should find indexed entry");
  assert.equal(hits[0].title, "TypeScript Handbook");
  store.close();
});

test("ProjectIndexStore: dedup by content_hash", () => {
  const store = new ProjectIndexStore(join(tmpDir, "dedup-test.db"));
  store.indexEntry({ projectPath: "/test", toolName: "t", title: "A", url: "u1", snippet: "s", source: "x", contentHash: "dup" });
  store.indexEntry({ projectPath: "/test", toolName: "t", title: "A", url: "u1", snippet: "s", source: "x", contentHash: "dup" });
  const hits = store.search("A", 10);
  assert.equal(hits.length, 1, "dedup should prevent duplicate");
  store.close();
});

test("ProjectIndexStore: purge project", () => {
  const store = new ProjectIndexStore(dbPath);
  const deleted = store.purgeProject("/test/project");
  assert.ok(deleted >= 1, "should delete entries");
  store.close();
});

// === isAnsTool ===
test("isAnsTool: matches ans_* tools with various prefixes", () => {
  assert.ok(isAnsTool("search_web"));
  assert.ok(isAnsTool("ans_search_web"));
  assert.ok(isAnsTool("mcp__anysearch__search_web"));
  assert.ok(isAnsTool("ans__research_web"));
  assert.ok(isAnsTool("ans_recall_memory"));
  assert.ok(isAnsTool("ans_chat"));
  assert.ok(isAnsTool("query_knowledge"));
  assert.ok(!isAnsTool("any_search"));
  assert.ok(!isAnsTool("read_file"));
  assert.ok(!isAnsTool("bash"));
  assert.ok(!isAnsTool("write_file"));
});

// === distillOutput ===
test("distillOutput: extracts results from MCP tool output", () => {
  const result = distillOutput({
    event: "PostToolUse",
    toolName: "search_web",
    toolInput: { query: "TypeScript" },
    toolOutput: { results: [{ title: "TS Guide", url: "https://ts.dev", snippet: "TypeScript guide", source: "exa" }] },
    projectPath: "/test",
    sessionId: "s1",
  });
  assert.ok(result.shouldIndex, "should index when results present");
  assert.equal(result.entries.length, 1);
  assert.ok(result.distilled.length > 0);
});

test("distillOutput: non-ans tool returns empty", () => {
  const result = distillOutput({
    event: "PostToolUse",
    toolName: "read_file",
    toolInput: {},
    toolOutput: {},
    projectPath: "/test",
    sessionId: "s1",
  });
  assert.ok(!result.shouldIndex);
  assert.equal(result.entries.length, 0);
});

test("distillOutput: non-JSON output gets truncated", () => {
  const result = distillOutput({
    event: "PostToolUse",
    toolName: "ans_chat",
    toolInput: { query: "test" },
    toolOutput: { text: "A".repeat(1000) } as any,
    projectPath: "/test",
    sessionId: "s1",
  });
  // Non-JSON string output: distilled to first 500 chars, not indexed.
  assert.ok(result.distilled.length > 0);
  assert.ok(result.distilled.length <= 500);
});

// === makePostToolUseDecision ===
test("makePostToolUseDecision: returns distilledOutput + indexEntries", () => {
  const decision = makePostToolUseDecision({
    event: "PostToolUse",
    toolName: "search_web",
    toolInput: { query: "test" },
    toolOutput: { results: [{ title: "T", url: "U", snippet: "S", source: "exa" }] },
    projectPath: "/test",
    sessionId: "s1",
  });
  assert.ok(decision.distilledOutput);
  assert.ok(decision.shouldIndex);
  assert.equal(decision.indexEntries?.length, 1);
});

// === Server liveness ===
testAsync("Server: /health endpoint returns 200", async () => {
  // Start server in subprocess to avoid blocking test exit.
  const { spawn } = await import("node:child_process");
  const proc = spawn("npx", ["tsx", "src/server/index.ts"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ANS_SERVER_PORT: "33334" },
  });
  await new Promise(r => setTimeout(r, 2000));
  try {
    const response = await fetch("http://127.0.0.1:33334/health");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "ok");
  } finally {
    proc.kill("SIGTERM");
  }
});

// Cleanup
process.on("exit", () => {
  rmSync(tmpDir, { recursive: true, force: true });
  console.log("\nPhase 3 Plugin tests: " + passed + " passed, " + failed + " failed");
  process.exit(failed > 0 ? 1 : 0);
});
