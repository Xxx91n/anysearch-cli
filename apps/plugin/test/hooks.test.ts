// Hooks integration tests — ADR-0011 D7 layer 2.
// Covers core/distill/preheat/session-start cross-component interactions.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isAnsTool, distillOutput, makePostToolUseDecision } from "../src/index.js";
import { spawn } from "node:child_process";

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

const tmpDir = mkdtempSync(join(tmpdir(), "ans-hooks-test-"));

// === Core: isAnsTool pattern matching ===
test("isAnsTool: matches all 5 ans tools", () => {
  assert.ok(isAnsTool("search_web"));
  assert.ok(isAnsTool("research_web"));
  assert.ok(isAnsTool("recall_memory"));
  assert.ok(isAnsTool("query_knowledge"));
  assert.ok(isAnsTool("ans_chat"));
});

test("isAnsTool: matches with platform prefixes", () => {
  assert.ok(isAnsTool("mcp__anysearch__search_web"));
  assert.ok(isAnsTool("ans__research_web"));
  assert.ok(isAnsTool("ans_recall_memory"));
  assert.ok(isAnsTool("ans_query_knowledge"));
  assert.ok(isAnsTool("ans_ans_chat"));
});

test("isAnsTool: rejects non-ans tools", () => {
  assert.ok(!isAnsTool("read_file"));
  assert.ok(!isAnsTool("write_file"));
  assert.ok(!isAnsTool("bash"));
  assert.ok(!isAnsTool("any_search"));
  assert.ok(!isAnsTool("web_search"));
});

// === Distill: structured summary extraction ===
test("distillOutput: extracts results array", () => {
  const result = distillOutput({
    event: "PostToolUse", toolName: "search_web",
    toolInput: { query: "test" },
    toolOutput: { results: [{ title: "A", url: "u1", snippet: "s1", source: "exa" }] },
    projectPath: "/test", sessionId: "s1",
  });
  assert.ok(result.shouldIndex);
  assert.equal(result.entries.length, 1);
  assert.ok(result.distilled.length > 0);
  const parsed = JSON.parse(result.distilled);
  assert.equal(parsed.tool, "search_web");
  assert.equal(parsed.resultCount, 1);
});

test("distillOutput: handles non-JSON output", () => {
  const result = distillOutput({
    event: "PostToolUse", toolName: "ans_chat",
    toolInput: { query: "test" },
    toolOutput: "plain text output" as any,
    projectPath: "/test", sessionId: "s1",
  });
  assert.ok(result.distilled.length > 0);
  assert.ok(result.distilled.length <= 500);
});

test("distillOutput: empty results not indexed", () => {
  const result = distillOutput({
    event: "PostToolUse", toolName: "search_web",
    toolInput: { query: "test" },
    toolOutput: { results: [] },
    projectPath: "/test", sessionId: "s1",
  });
  assert.ok(!result.shouldIndex);
  assert.equal(result.entries.length, 0);
});

// === makePostToolUseDecision: full decision pipeline ===
test("makePostToolUseDecision: returns indexEntries for indexing", () => {
  const decision = makePostToolUseDecision({
    event: "PostToolUse", toolName: "ans_research_web",
    toolInput: { query: "TypeScript" },
    toolOutput: { results: [
      { title: "TS", url: "https://ts.dev", snippet: "TypeScript guide", source: "tavily" },
      { title: "TS2", url: "https://ts2.dev", snippet: "Another guide", source: "anysearch" },
    ] },
    projectPath: "/test", sessionId: "s1",
  });
  assert.ok(decision.distilledOutput);
  assert.ok(decision.shouldIndex);
  assert.equal(decision.indexEntries?.length, 2);
  assert.ok(decision.indexEntries?.[0].contentHash.length > 0);
});

// === E2E: session-start.cjs stdin/stdout pipe ===
testAsync("E2E: session-start.cjs outputs valid JSON for SessionStart event", async () => {
  const cjsPath = join(process.cwd(), "dist", "hooks", "session-start.cjs");
  if (!existsSync(cjsPath)) {
    console.log("    SKIP: dist/hooks/session-start.cjs not built yet");
    return;
  }

  const stdinPayload = JSON.stringify({ event: "SessionStart", cwd: "/tmp/test" });
  const result = await new Promise<string>((resolve, reject) => {
    const proc = spawn("node", [cjsPath], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    proc.stdout.on("data", d => stdout += d);
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error("exit " + code));
      else resolve(stdout);
    });
    proc.stdin.write(stdinPayload);
    proc.stdin.end();
  });

  const parsed = JSON.parse(result);
  assert.ok(parsed.additionalContext, "should have additionalContext field");
  assert.ok(parsed.additionalContext.includes("anysearch plugin active"), "routing card should be present");
  assert.ok(parsed.additionalContext.includes("search_web"), "should mention search_web");
  assert.ok(parsed.additionalContext.includes("Fail-open"), "should mention fail-open");
});

testAsync("E2E: session-start.cjs exits silently for non-SessionStart events", async () => {
  const cjsPath = join(process.cwd(), "dist", "hooks", "session-start.cjs");
  if (!existsSync(cjsPath)) {
    console.log("    SKIP: dist/hooks/session-start.cjs not built yet");
    return;
  }

  const stdinPayload = JSON.stringify({ event: "PreToolUse", tool_name: "search_web" });
  const result = await new Promise<string>((resolve, reject) => {
    const proc = spawn("node", [cjsPath], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    proc.stdout.on("data", d => stdout += d);
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error("exit " + code));
      else resolve(stdout);
    });
    proc.stdin.write(stdinPayload);
    proc.stdin.end();
  });

  assert.equal(result, "", "non-SessionStart events should produce no stdout");
});

// === .mdc generation logic (session-start.cjs E2E) ===
testAsync("E2E: session-start.cjs generates .mdc file in cwd", async () => {
  const cjsPath = join(process.cwd(), "dist", "hooks", "session-start.cjs");
  if (!existsSync(cjsPath)) {
    console.log("    SKIP: dist/hooks/session-start.cjs not built yet");
    return;
  }

  const testCwd = mkdtempSync(join(tmpDir, "mdc-test-"));
  const stdinPayload = JSON.stringify({ event: "SessionStart", cwd: testCwd });

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("node", [cjsPath], { stdio: ["pipe", "pipe", "pipe"] });
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error("exit " + code));
      else resolve();
    });
    proc.stdin.write(stdinPayload);
    proc.stdin.end();
  });

  const mdcPath = join(testCwd, ".cursor", "rules", "anysearch.mdc");
  assert.ok(existsSync(mdcPath), ".cursor/rules/anysearch.mdc should be generated");
  const mdcContent = readFileSync(mdcPath, "utf8");
  assert.ok(mdcContent.includes("anysearch plugin active"), ".mdc should contain routing card");
  assert.ok(mdcContent.includes("alwaysApply: true"), ".mdc should have alwaysApply frontmatter");
  rmSync(testCwd, { recursive: true, force: true });
});

// Cleanup
process.on("exit", () => {
  rmSync(tmpDir, { recursive: true, force: true });
  console.log("\nHooks tests: " + passed + " passed, " + failed + " failed");
  process.exit(failed > 0 ? 1 : 0);
});
