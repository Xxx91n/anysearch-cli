// CodeBuddy hook contract tests — ADR-0066 (R65).
// Synthetic stdin per the real CodeBuddy Code 2.149.0 contract:
//   stdin  : hook_event_name (NOT event) + tool_name/tool_input/tool_response/session_id/cwd
//   stdout : hookSpecificOutput{permissionDecision|additionalContext|updatedToolOutput}
//   SessionStart: raw stdout text -> context verbatim.
// Spawns the BUILT dist adapters (same skip-if-unbuilt convention as hooks.test.ts).

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

let passed = 0;
let failed = 0;

async function testAsync(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log("  PASS " + name); }
  catch (e) { failed++; console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message : String(e))); }
}

const CB_ADAPTER = join(process.cwd(), "dist", "hooks", "adapters", "codebuddy.cjs");
const CLAUDE_ADAPTER = join(process.cwd(), "dist", "hooks", "adapters", "claude.cjs");

function runHook(cjsPath: string, stdinPayload: string): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [cjsPath], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    proc.stdout.on("data", d => stdout += d);
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error("exit " + code + " stdout=" + stdout.slice(0, 200)));
      else resolve({ code: code ?? -1, stdout });
    });
    proc.stdin.write(stdinPayload);
    proc.stdin.end();
  });
}

const TOOL_RESP = JSON.stringify({
  results: [
    { title: "cb alpha", url: "https://example.com/a", snippet: "doc alpha", source: "synthetic" },
    { title: "cb beta", url: "https://example.com/b", snippet: "doc beta", source: "synthetic" },
  ]
});

// === codebuddy.cjs: SessionStart raw-text contract ===
testAsync("codebuddy SessionStart: hook_event_name -> raw routing card on stdout", async () => {
  if (!existsSync(CB_ADAPTER)) { console.log("    SKIP: dist/hooks/adapters/codebuddy.cjs not built yet"); return; }
  const { stdout } = await runHook(CB_ADAPTER, JSON.stringify({
    hook_event_name: "SessionStart", cwd: "/tmp/cb", session_id: "s1",
  }));
  assert.ok(stdout.includes("[anysearch plugin active]"), "raw card text should be present");
  assert.ok(stdout.includes("search_web"), "card should mention search_web");
  assert.ok(!stdout.trim().startsWith("{"), "SessionStart must be raw text, not a JSON envelope");
});

testAsync("codebuddy SessionStart: legacy event field still works", async () => {
  if (!existsSync(CB_ADAPTER)) { console.log("    SKIP: not built"); return; }
  const { stdout } = await runHook(CB_ADAPTER, JSON.stringify({ event: "SessionStart", cwd: "/tmp/cb" }));
  assert.ok(stdout.includes("[anysearch plugin active]"));
});

// === codebuddy.cjs: PreToolUse ===
testAsync("codebuddy PreToolUse: non-ans tool -> silent exit 0", async () => {
  if (!existsSync(CB_ADAPTER)) { console.log("    SKIP: not built"); return; }
  const { stdout } = await runHook(CB_ADAPTER, JSON.stringify({
    hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" },
  }));
  assert.equal(stdout, "", "non-ans tools must pass through silently");
});

testAsync("codebuddy PreToolUse: ans tool -> envelope or silent (no index yet)", async () => {
  if (!existsSync(CB_ADAPTER)) { console.log("    SKIP: not built"); return; }
  const { stdout } = await runHook(CB_ADAPTER, JSON.stringify({
    hook_event_name: "PreToolUse", tool_name: "mcp__anysearch__search_web",
    tool_input: { query: "no-index-hit-probe" }, session_id: "s1", cwd: "/tmp/cb",
  }));
  if (stdout.trim() === "") return; // empty index -> silent allow
  const parsed = JSON.parse(stdout);
  assert.ok(parsed.hookSpecificOutput, "PreToolUse output must use hookSpecificOutput envelope");
  assert.ok(!("additionalContext" in parsed), "decision keys must NOT leak to top level");
});

// === codebuddy.cjs: PostToolUse ===
testAsync("codebuddy PostToolUse: hook_event_name -> hookSpecificOutput.updatedToolOutput", async () => {
  if (!existsSync(CB_ADAPTER)) { console.log("    SKIP: not built"); return; }
  const { stdout } = await runHook(CB_ADAPTER, JSON.stringify({
    hook_event_name: "PostToolUse", tool_name: "mcp__anysearch__search_web",
    tool_input: { query: "cb" }, tool_response: TOOL_RESP, session_id: "s1", cwd: "/tmp/cb",
  }));
  const parsed = JSON.parse(stdout);
  assert.ok(parsed.hookSpecificOutput?.updatedToolOutput, "distilled output must sit inside hookSpecificOutput");
  const distilled = JSON.parse(parsed.hookSpecificOutput.updatedToolOutput);
  assert.equal(distilled.resultCount, 2);
  assert.equal(distilled.topResults[0].url, "https://example.com/a");
});

testAsync("codebuddy PostToolUse: object-shaped tool_response also parsed", async () => {
  if (!existsSync(CB_ADAPTER)) { console.log("    SKIP: not built"); return; }
  const { stdout } = await runHook(CB_ADAPTER, JSON.stringify({
    hook_event_name: "PostToolUse", tool_name: "search_web",
    tool_input: { query: "cb" }, tool_response: { results: [{ title: "t", url: "https://x.dev", snippet: "s", source: "x" }] },
    session_id: "s1", cwd: "/tmp/cb",
  }));
  const parsed = JSON.parse(stdout);
  assert.ok(parsed.hookSpecificOutput?.updatedToolOutput, "object tool_response should distill too");
});

// R65 F-09: live CodeBuddy 2.151 sends tool_response as an ARRAY of content
// blocks — [{type:"text",text:"<json>"}] — not a string nor {content:[...]}.
// Before the fix this silently distilled to resultCount:0 and indexed nothing.
testAsync("codebuddy PostToolUse: array-of-content-blocks tool_response (live shape)", async () => {
  if (!existsSync(CB_ADAPTER)) { console.log("    SKIP: not built"); return; }
  const { stdout } = await runHook(CB_ADAPTER, JSON.stringify({
    hook_event_name: "PostToolUse", tool_name: "mcp__anysearch__search_web",
    tool_input: { query: "cb" },
    tool_response: [{ type: "text", text: TOOL_RESP }],
    session_id: "s1", cwd: "/tmp/cb",
  }));
  const parsed = JSON.parse(stdout);
  const distilled = JSON.parse(parsed.hookSpecificOutput?.updatedToolOutput || "{}");
  assert.equal(distilled.resultCount, 2, "array-of-blocks tool_response must unwrap to real results");
  assert.equal(distilled.topResults[0].url, "https://example.com/a");
});

testAsync("claude PostToolUse: array-of-blocks tool_response tolerated too", async () => {
  if (!existsSync(CLAUDE_ADAPTER)) { console.log("    SKIP: claude adapter not built"); return; }
  const { stdout } = await runHook(CLAUDE_ADAPTER, JSON.stringify({
    hook_event_name: "PostToolUse", tool_name: "search_web",
    tool_input: { query: "cb" }, tool_response: [{ type: "text", text: TOOL_RESP }], cwd: "/tmp/cb",
  }));
  const parsed = JSON.parse(stdout);
  const distilled = JSON.parse(parsed.hookSpecificOutput?.additionalContext || "{}");
  assert.equal(distilled.resultCount, 2);
});

testAsync("codebuddy PostToolUse: legacy event field fallback", async () => {
  if (!existsSync(CB_ADAPTER)) { console.log("    SKIP: not built"); return; }
  const { stdout } = await runHook(CB_ADAPTER, JSON.stringify({
    event: "PostToolUse", tool_name: "search_web",
    tool_input: { query: "cb" }, tool_response: TOOL_RESP, cwd: "/tmp/cb",
  }));
  const parsed = JSON.parse(stdout);
  assert.ok(parsed.hookSpecificOutput?.updatedToolOutput, "legacy event field must still work");
});

// === Fail-open paths ===
testAsync("codebuddy: unparseable stdin -> silent exit 0", async () => {
  if (!existsSync(CB_ADAPTER)) { console.log("    SKIP: not built"); return; }
  const { stdout } = await runHook(CB_ADAPTER, "not json {{{");
  assert.equal(stdout, "");
});

// === claude.cjs regression: hook_event_name fix lands on real Claude shape ===
// R66 ER-2 (live-verified on Claude Code 2.1.251): the host drops every bare
// top-level decision key — output MUST sit inside hookSpecificOutput.
testAsync("claude PostToolUse: hook_event_name -> hookSpecificOutput.additionalContext", async () => {
  if (!existsSync(CLAUDE_ADAPTER)) { console.log("    SKIP: dist/hooks/adapters/claude.cjs not built yet"); return; }
  const { stdout } = await runHook(CLAUDE_ADAPTER, JSON.stringify({
    hook_event_name: "PostToolUse", tool_name: "search_web",
    tool_input: { query: "cb" }, tool_response: TOOL_RESP, cwd: "/tmp/cb",
  }));
  const parsed = JSON.parse(stdout);
  assert.ok(parsed.hookSpecificOutput?.additionalContext, "claude adapter must emit the hookSpecificOutput envelope");
  assert.ok(!("updatedToolOutput" in parsed), "top-level updatedToolOutput is dropped by the host — must not be emitted");
  const distilled = JSON.parse(parsed.hookSpecificOutput.additionalContext);
  assert.equal(distilled.resultCount, 2);
});

testAsync("claude PostToolUse: legacy event field preserved", async () => {
  if (!existsSync(CLAUDE_ADAPTER)) { console.log("    SKIP: not built"); return; }
  const { stdout } = await runHook(CLAUDE_ADAPTER, JSON.stringify({
    event: "PostToolUse", tool_name: "search_web",
    tool_input: { query: "cb" }, tool_response: TOOL_RESP, cwd: "/tmp/cb",
  }));
  assert.ok(JSON.parse(stdout).hookSpecificOutput?.additionalContext);
});

// === Per-platform hook_event_name closure (ADR-0066 field fix, every adapter) ===
// Each adapter must honor hook_event_name on its own stdin/output shape.
testAsync("codex PostToolUse: hook_event_name -> top-level additionalContext", async () => {
  const p = join(process.cwd(), "dist", "hooks", "adapters", "codex.cjs");
  if (!existsSync(p)) { console.log("    SKIP: codex.cjs not built"); return; }
  const { stdout } = await runHook(p, JSON.stringify({
    hook_event_name: "PostToolUse", tool_name: "search_web",
    tool_input: { query: "cb" }, tool_response: { results: [{ title: "t", url: "https://x.dev", snippet: "s", source: "x" }] },
    cwd: "/tmp/cb",
  }));
  assert.ok(JSON.parse(stdout).additionalContext, "codex adapter must act on hook_event_name");
});

testAsync("cursor postToolUse: hook_event_name -> updated_mcp_tool_output (snake_case)", async () => {
  const p = join(process.cwd(), "dist", "hooks", "adapters", "cursor.cjs");
  if (!existsSync(p)) { console.log("    SKIP: cursor.cjs not built"); return; }
  const { stdout } = await runHook(p, JSON.stringify({
    hook_event_name: "postToolUse", tool_name: "search_web",
    tool_input: { query: "cb" }, tool_output: { results: [{ title: "t", url: "https://x.dev", snippet: "s", source: "x" }] },
    cwd: "/tmp/cb",
  }));
  assert.ok(JSON.parse(stdout).updated_mcp_tool_output, "cursor adapter must act on hook_event_name");
});

testAsync("antigravity PostToolUse: hook_event_name -> top-level additionalContext", async () => {
  const p = join(process.cwd(), "dist", "hooks", "adapters", "antigravity.cjs");
  if (!existsSync(p)) { console.log("    SKIP: antigravity.cjs not built"); return; }
  const { stdout } = await runHook(p, JSON.stringify({
    hook_event_name: "PostToolUse", tool_name: "search_web",
    tool_input: { query: "cb" }, tool_output: { results: [{ title: "t", url: "https://x.dev", snippet: "s", source: "x" }] },
    cwd: "/tmp/cb",
  }));
  assert.ok(JSON.parse(stdout).additionalContext, "antigravity adapter must act on hook_event_name");
});

testAsync("session-start: hook_event_name SessionStart honored", async () => {
  const p = join(process.cwd(), "dist", "hooks", "session-start.cjs");
  if (!existsSync(p)) { console.log("    SKIP: session-start.cjs not built"); return; }
  const { stdout } = await runHook(p, JSON.stringify({ hook_event_name: "SessionStart", cwd: "/tmp/cb" }));
  assert.ok(JSON.parse(stdout).hookSpecificOutput?.additionalContext?.includes("[anysearch plugin active]"));
});

// === R65 rework F-A5: array-of-blocks tolerance on the other adapters ===
// Same F-09 class: codex(tool_response)/cursor+antigravity(tool_output) now
// route through unwrapToolResponse — array shapes must distill, not zero out.
const BLOCKS = [{ type: "text", text: TOOL_RESP }];

testAsync("codex PostToolUse: array-of-blocks tool_response distills", async () => {
  const p = join(process.cwd(), "dist", "hooks", "adapters", "codex.cjs");
  if (!existsSync(p)) { console.log("    SKIP: codex.cjs not built"); return; }
  const { stdout } = await runHook(p, JSON.stringify({
    hook_event_name: "PostToolUse", tool_name: "search_web",
    tool_input: { query: "cb" }, tool_response: BLOCKS, cwd: "/tmp/cb",
  }));
  const d = JSON.parse(JSON.parse(stdout).additionalContext);
  assert.equal(d.resultCount, 2);
});

testAsync("cursor PostToolUse: array-of-blocks tool_output distills", async () => {
  const p = join(process.cwd(), "dist", "hooks", "adapters", "cursor.cjs");
  if (!existsSync(p)) { console.log("    SKIP: cursor.cjs not built"); return; }
  const { stdout } = await runHook(p, JSON.stringify({
    hook_event_name: "postToolUse", tool_name: "search_web",
    tool_input: { query: "cb" }, tool_output: BLOCKS, cwd: "/tmp/cb",
  }));
  const d = JSON.parse(JSON.parse(stdout).updated_mcp_tool_output);
  assert.equal(d.resultCount, 2);
});

testAsync("antigravity PostToolUse: array-of-blocks tool_output distills", async () => {
  const p = join(process.cwd(), "dist", "hooks", "adapters", "antigravity.cjs");
  if (!existsSync(p)) { console.log("    SKIP: antigravity.cjs not built"); return; }
  const { stdout } = await runHook(p, JSON.stringify({
    hook_event_name: "PostToolUse", tool_name: "search_web",
    tool_input: { query: "cb" }, tool_output: BLOCKS, cwd: "/tmp/cb",
  }));
  const d = JSON.parse(JSON.parse(stdout).additionalContext);
  assert.equal(d.resultCount, 2);
});

// === R65 rework F-A1: template-target executability ===
// Blind spot closed: earlier tests asserted templates merely HAVE preToolUse
// keys; nobody checked the target file is a real stdin-reading entrypoint —
// that's how configs/cursor/hooks.json kept pointing at library files
// (preheat.cjs/distill.cjs export functions, never read stdin) while three
// docs claimed "all four platforms fixed".
testAsync("all configs/*/hooks.json targets resolve to stdin-reading entrypoints", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const configsDir = join(process.cwd(), "configs");
  for (const host of readdirSync(configsDir)) {
    const cfgPath = join(configsDir, host, "hooks.json");
    if (!existsSync(cfgPath)) continue;
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    const targets: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === "string") {
        const m = v.match(/dist[\\/]hooks[\\/][\w./-]+\.cjs/);
        if (m) targets.push(m[0]);
        // R66: bin-named commands (ans-hook-*) resolve through package.json bin.
        else if (/^ans-[\w-]+$/.test(v) && pkg.bin?.[v]) targets.push(pkg.bin[v]);
      } else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(cfg);
    assert.ok(targets.length >= 3, host + ": expected >=3 dist/hooks targets, got " + targets.length);
    for (const t of targets) {
      const p = join(process.cwd(), ...t.split(/[\\/]/));
      assert.ok(existsSync(p), host + " target missing from dist build: " + t);
      const src = readFileSync(p, "utf8");
      assert.ok(
        src.includes("process.stdin"),
        host + " target is not a stdin-reading entrypoint (points at a library file): " + t,
      );
    }
  }
});

process.on("exit", () => {
  console.log("  codebuddy-contract: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exitCode = 1;
});
