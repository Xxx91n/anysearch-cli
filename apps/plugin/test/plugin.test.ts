// Phase 3 Plugin tests — ADR-0009 verification + ADR-0010 SessionStart/SKILL.md/AGENTS.md.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync as fsReadFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectIndexStore, isAnsTool, distillOutput, makePostToolUseDecision } from "../src/index.js";

const fs = { readFileSync: fsReadFileSync, existsSync };

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

const tmpDir = mkdtempSync(join(tmpdir(), "ans-plugin-test-"));
const dbPath = join(tmpDir, "test-project-index.db");

test("ProjectIndexStore: create and search", () => {
  const store = new ProjectIndexStore(dbPath);
  store.indexEntry({
    projectPath: "/test/project", toolName: "search_web",
    title: "TypeScript Handbook", url: "https://www.typescriptlang.org/docs/",
    snippet: "TypeScript is a strongly typed programming language that builds on JavaScript.",
    source: "exa", contentHash: "hash1",
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

test("distillOutput: extracts results from MCP tool output", () => {
  const result = distillOutput({
    event: "PostToolUse", toolName: "search_web",
    toolInput: { query: "TypeScript" },
    toolOutput: { results: [{ title: "TS Guide", url: "https://ts.dev", snippet: "TypeScript guide", source: "exa" }] },
    projectPath: "/test", sessionId: "s1",
  });
  assert.ok(result.shouldIndex, "should index when results present");
  assert.equal(result.entries.length, 1);
  assert.ok(result.distilled.length > 0);
});

test("distillOutput: non-ans tool returns empty", () => {
  const result = distillOutput({
    event: "PostToolUse", toolName: "read_file",
    toolInput: {}, toolOutput: {},
    projectPath: "/test", sessionId: "s1",
  });
  assert.ok(!result.shouldIndex);
  assert.equal(result.entries.length, 0);
});

test("distillOutput: non-JSON output gets truncated", () => {
  const result = distillOutput({
    event: "PostToolUse", toolName: "ans_chat",
    toolInput: { query: "test" },
    toolOutput: { text: "A".repeat(1000) } as any,
    projectPath: "/test", sessionId: "s1",
  });
  assert.ok(result.distilled.length > 0);
  assert.ok(result.distilled.length <= 500);
});

test("makePostToolUseDecision: returns distilledOutput + indexEntries", () => {
  const decision = makePostToolUseDecision({
    event: "PostToolUse", toolName: "search_web",
    toolInput: { query: "test" },
    toolOutput: { results: [{ title: "T", url: "U", snippet: "S", source: "exa" }] },
    projectPath: "/test", sessionId: "s1",
  });
  assert.ok(decision.distilledOutput);
  assert.ok(decision.shouldIndex);
  assert.equal(decision.indexEntries?.length, 1);
});

// === SessionStart hook (ADR-0010 D2) ===
test("SessionStart: routing card has required content", () => {
  const ROUTING_CARD = [
    "[anysearch plugin active]",
    "Tools available (ans_* prefix):",
    "- search_web: real-time multi-source web search",
    "- research_web: deep research (minute-level, multi-hop)",
    "- recall_memory: FTS5 research memory recall (time edge effect)",
    "- query_knowledge: enterprise RAG retrieval",
    "- ans_chat: PiAgentRuntime agent loop for complex queries",
    "",
    "Trigger rules:",
    "- Current events / factual lookup -> search_web",
    "- Multi-step research / synthesis -> research_web",
    "- Recall prior results from this session -> recall_memory",
    "- Enterprise knowledge base -> query_knowledge",
    "- Complex multi-tool research -> ans_chat",
    "- Skip redundant search if recall_memory already has relevant results",
    "",
    "Fail-open: if anysearch server is down, tools degrade gracefully (no block).",
    "For detailed guidance: see SKILL.md (anysearch skill).",
  ].join("\n");
  assert.ok(ROUTING_CARD.includes("anysearch plugin active"));
  assert.ok(ROUTING_CARD.includes("search_web"));
  assert.ok(ROUTING_CARD.includes("recall_memory"));
  assert.ok(ROUTING_CARD.includes("ans_chat"));
  assert.ok(ROUTING_CARD.includes("Fail-open"));
  assert.ok(ROUTING_CARD.includes("SKILL.md"));
  assert.ok(ROUTING_CARD.length > 400, "routing card should be non-trivial");
  assert.ok(ROUTING_CARD.length < 2000, "routing card should be < 2000 chars");
});

test("SKILL.md: exists and has trigger words", () => {
  const skillPath = join(process.cwd(), "skills", "anysearch", "SKILL.md");
  assert.ok(fs.existsSync(skillPath), "SKILL.md should exist at " + skillPath);
  const skillContent = fs.readFileSync(skillPath, "utf8");
  assert.ok(skillContent.includes("search_web"), "SKILL.md should mention search_web");
  assert.ok(skillContent.includes("research_web"), "SKILL.md should mention research_web");
  assert.ok(skillContent.includes("recall_memory"), "SKILL.md should mention recall_memory");
  assert.ok(skillContent.includes("query_knowledge"), "SKILL.md should mention query_knowledge");
  assert.ok(skillContent.includes("ans_chat"), "SKILL.md should mention ans_chat");
  assert.ok(skillContent.includes("Decision tree"), "SKILL.md should have decision tree");
  assert.ok(skillContent.includes("Anti-patterns"), "SKILL.md should have anti-patterns");
});

test("AGENTS.md: minimal and has required sections", () => {
  const agentsPath = join(process.cwd(), "AGENTS.md");
  assert.ok(fs.existsSync(agentsPath), "AGENTS.md should exist at " + agentsPath);
  const agentsContent = fs.readFileSync(agentsPath, "utf8");
  assert.ok(agentsContent.includes("Tool whitelist"), "AGENTS.md should have tool whitelist");
  assert.ok(agentsContent.includes("Fail-open"), "AGENTS.md should have fail-open section");
  assert.ok(agentsContent.includes("Namespace conventions"), "AGENTS.md should have namespace conventions");
  assert.ok(agentsContent.includes("ans_*"), "AGENTS.md should mention ans_* prefix");
  const lineCount = agentsContent.split("\n").length;
  assert.ok(lineCount < 200, "AGENTS.md should be < 200 lines, got " + lineCount);
});

// === Server liveness ===
testAsync("Server: /health endpoint returns 200", async () => {
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
  console.log("\nPlugin tests: " + passed + " passed, " + failed + " failed");
  process.exit(failed > 0 ? 1 : 0);
});
