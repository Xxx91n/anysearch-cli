// Phase 3 Plugin tests — ADR-0009 verification + ADR-0010 SessionStart/SKILL.md/AGENTS.md.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync as fsReadFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectIndexStore, isAnsTool, distillOutput, makePostToolUseDecision } from "../src/index.js";

const fs = { readFileSync: fsReadFileSync, existsSync };

// ponytail: pnpm runs test from apps/plugin/. Use import.meta.url so cwd doesn't break paths.
const PLUGIN_ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

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



// === ADR-0011: Cursor dual channel + .mdc generation ===
test("ADR-0011: cursor.ts uses additional_context (snake_case)", () => {
  const cursorSrc = fs.readFileSync(join(PLUGIN_ROOT, "src", "hooks", "adapters", "cursor.ts"), "utf8");
  assert.ok(cursorSrc.includes("additional_context"), "cursor.ts should use additional_context (snake_case)");
  assert.ok(cursorSrc.includes("ensureMdc"), "cursor.ts should have ensureMdc function for .mdc generation");
  assert.ok(cursorSrc.includes(".cursor"), "cursor.ts should write to .cursor/rules/");
  // Verify it handles sessionStart event
  assert.ok(cursorSrc.includes("sessionstart"), "cursor.ts should handle sessionStart event");
});

test("ADR-0011: antigravity.ts has .mdc fallback", () => {
  const antigravitySrc = fs.readFileSync(join(PLUGIN_ROOT, "src", "hooks", "adapters", "antigravity.ts"), "utf8");
  assert.ok(antigravitySrc.includes("ensureMdc"), "antigravity.ts should have ensureMdc for .mdc fallback");
  assert.ok(antigravitySrc.includes(".antigravity"), "antigravity.ts should write to .antigravity/rules/");
  assert.ok(antigravitySrc.includes("SessionStart"), "antigravity.ts should keep SessionStart for forward-compat");
});

test("ADR-0011: session-start.ts has .mdc generation logic", () => {
  const sessionStartSrc = fs.readFileSync(join(PLUGIN_ROOT, "src", "hooks", "session-start.ts"), "utf8");
  assert.ok(sessionStartSrc.includes("ensureMdc"), "session-start.ts should have ensureMdc function");
  assert.ok(sessionStartSrc.includes("routing-card"), "session-start.ts should import from routing-card.ts");
  assert.ok(sessionStartSrc.includes("MDC_CONTENT"), "session-start.ts should use MDC_CONTENT");
  assert.ok(sessionStartSrc.includes("ROUTING_CARD"), "session-start.ts should use ROUTING_CARD");
  assert.ok(sessionStartSrc.includes("writeFileSync"), "session-start.ts should write .mdc file");
  assert.ok(sessionStartSrc.includes("existsSync"), "session-start.ts should check if .mdc exists before writing");
});

test("ADR-0011: cursor hooks.json has no _degradation_note", () => {
  const hooksPath = join(PLUGIN_ROOT, "configs", "cursor", "hooks.json");
  const hooksContent = fs.readFileSync(hooksPath, "utf8");
  const parsed = JSON.parse(hooksContent);
  assert.ok(!parsed._degradation_note, "cursor hooks.json should NOT have _degradation_note");
  assert.ok(parsed.hooks.sessionStart, "cursor hooks.json should have sessionStart config");
  assert.ok(parsed.hooks.preToolUse, "cursor hooks.json should have preToolUse config");
  assert.ok(parsed.hooks.postToolUse, "cursor hooks.json should have postToolUse config");
});

test("ADR-0012: routing card 4-block structure in shared module", () => {
  // ADR-0012 D14: routing card extracted to routing-card.ts shared module.
  // Verify 4 blocks: plugin declaration, tools, trigger rules, fail-open.
  const rcSrc = fs.readFileSync(join(PLUGIN_ROOT, "src", "hooks", "routing-card.ts"), "utf8");
  assert.ok(rcSrc.includes("[anysearch plugin active]"), "routing-card.ts has block 1");
  assert.ok(rcSrc.includes("Tools available"), "routing-card.ts has block 2");
  assert.ok(rcSrc.includes("Trigger rules"), "routing-card.ts has block 3");
  assert.ok(rcSrc.includes("Fail-open"), "routing-card.ts has block 4");
});

// === Server liveness ===
testAsync("Server: /health endpoint returns 200", async () => {
  const { spawn } = await import("node:child_process");
  const net = await import("node:net");
  // F-14 + N-1 (audit rework): start the server with the same node + tsx loader
  // the runner uses - never via `npx` (registry fallback) and never with a stdin
  // pipe. Also never on a FIXED port with a FIXED startup sleep: a fixed port +
  // fixed 2000 ms wait is load-sensitive, and under a loaded machine (ship-gate
  // step 3 runs every package in parallel) the server may not be listening yet
  // and a single fetch fails. Ask the OS for a free port and poll for readiness.
  const port = await new Promise<number>((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const addr = probe.address();
      const p = addr && typeof addr === "object" ? addr.port : 0;
      probe.close(() => resolve(p));
    });
  });
  const proc = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
    cwd: PLUGIN_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    // ADR-0059 D7 (T-6.3): the server is never open; pin a token so the liveness probe authenticates.
    env: { ...process.env, ANS_SERVER_PORT: String(port), ANS_SERVER_TOKEN: "plugin-test-token" },
  });
  const exited = new Promise<void>((r) => proc.once("exit", () => r()));
  try {
    let ready = false;
    let lastErr: unknown;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch("http://127.0.0.1:" + port + "/health", { headers: { Authorization: "Bearer plugin-test-token" } });
        if (response.status === 200) {
          const body = await response.json();
          assert.equal(body.status, "ok");
          ready = true;
          break;
        }
        lastErr = new Error("status " + response.status);
      } catch (e) { lastErr = e; }
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(ready, "server did not become ready within 30s on port " + port + ": " + String(lastErr));
  } finally {
    // F-14: kill the WHOLE tree, then wait for it to be gone so no handle
    // outlives the test (POSIX: process group; Windows: taskkill /T /F).
    const pid = proc.pid;
    if (pid) {
      if (process.platform === "win32") {
        const { spawnSync } = await import("node:child_process");
        try { spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* already gone */ }
      } else {
        try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ }
      }
    }
    await Promise.race([exited, new Promise(r => setTimeout(r, 3000))]);
  }
});

// Cleanup
process.on("exit", () => {
  rmSync(tmpDir, { recursive: true, force: true });
  console.log("\nPlugin tests: " + passed + " passed, " + failed + " failed");
  process.exit(failed > 0 ? 1 : 0);
});
