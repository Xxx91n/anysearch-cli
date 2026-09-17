// Claude Code contract tests — R66 (ADR-0066 / T3).
// Live-verified against Claude Code 2.1.251 headless probes:
//   * Pre/PostToolUse hooks RUN headless but emit no stream-json events —
//     observability is side-effect only (marker files, /index deltas).
//   * Only the hookSpecificOutput envelope (or legacy decision:block) is
//     honored; bare top-level decision keys are silently dropped (ER-2).
//   * configs/claude/hooks.json must use the official settings schema:
//     { "<Event>": [{ matcher, hooks: [{ type: "command", command, timeout }] }] }
//     — the old { name, command, args } shape silently poisons the event.
//   * Plugin skeleton (.claude-plugin/plugin.json + hooks/hooks.json +
//     .mcp.json) is generated single-source by scripts/gen-claude-configs.mjs;
//     ${CLAUDE_PLUGIN_ROOT} expansion remains experimental on Windows (#16116).

import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";

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

const PLUGIN_ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const CLAUDE_ADAPTER = join(PLUGIN_ROOT, "dist", "hooks", "adapters", "claude.cjs");
const SESSION_START = join(PLUGIN_ROOT, "dist", "hooks", "session-start.cjs");

function runHook(cjsPath: string, stdinPayload: string, env?: Record<string, string>, args: string[] = []): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [cjsPath, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...(env ?? {}) },
    });
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
    { title: "cl alpha", url: "https://example.com/a", snippet: "doc alpha", source: "synthetic" },
    { title: "cl beta", url: "https://example.com/b", snippet: "doc beta", source: "synthetic" },
  ],
});
// R66-B04: abstain/slim shape — claims extraction empty -> sufficiency only.
const SLIM_RESP = JSON.stringify({
  sufficiency: { verdict: "ambiguous", volume: { uniqueResults: 19, uniqueDomains: 1 } },
  attribution: { claims: [] },
});

// ==== settings template: official schema (ER-1 fix) ====
test("configs/claude/hooks.json uses the official settings schema", () => {
  const cfg = JSON.parse(readFileSync(join(PLUGIN_ROOT, "configs", "claude", "hooks.json"), "utf8"));
  assert.ok(cfg.hooks && typeof cfg.hooks === "object", "needs top-level hooks object");
  for (const event of ["PreToolUse", "PostToolUse", "SessionStart"]) {
    const entries = cfg.hooks[event];
    assert.ok(Array.isArray(entries) && entries.length > 0, event + ": missing entries");
    for (const e of entries) {
      assert.equal(typeof e.matcher, "string", event + ": matcher must be a string");
      assert.ok(Array.isArray(e.hooks) && e.hooks.length > 0, event + ": hooks[] required");
      for (const h of e.hooks) {
        assert.equal(h.type, "command", event + ": hook.type must be 'command'");
        assert.equal(typeof h.command, "string", event + ": hook.command must be a single string");
        assert.ok(!("args" in h) && !("name" in h), event + ": name/args shape is the broken template (ER-1)");
      }
    }
  }
});

test("settings template commands resolve via package bins (no absolute paths)", () => {
  const cfg = JSON.parse(readFileSync(join(PLUGIN_ROOT, "configs", "claude", "hooks.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, "package.json"), "utf8"));
  const cmds: string[] = [];
  for (const entries of Object.values(cfg.hooks) as Array<Array<{ hooks: Array<{ command: string }> }>>) {
    for (const e of entries) for (const h of e.hooks) cmds.push(h.command);
  }
  for (const c of cmds) {
    assert.ok(c.split(" ")[0] in pkg.bin, "command must be a package bin: " + c);
    assert.ok(!/[A-Za-z]:[\\/]/.test(c), "command must not embed an absolute path: " + c);
    assert.ok(!c.includes("CLAUDE_PLUGIN"), "settings variant must not use CLAUDE_PLUGIN_* vars: " + c);
  }
});

test("bin entries point at stdin-reading hook entrypoints", () => {
  const pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, "package.json"), "utf8"));
  for (const rel of [pkg.bin["ans-hook-claude"], pkg.bin["ans-hook-session-start"]]) {
    assert.ok(rel, "bin entry missing");
    const p = join(PLUGIN_ROOT, rel);
    if (!existsSync(p)) continue; // dist not built — covered by build-dependent tests
    assert.ok(readFileSync(p, "utf8").includes("process.stdin"), rel + " must read stdin");
  }
});

// ==== plugin skeleton (ER-3 fix) ====
test("plugin skeleton: .claude-plugin/plugin.json + hooks/hooks.json + .mcp.json", () => {
  const manifest = JSON.parse(readFileSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf8"));
  assert.equal(typeof manifest.name, "string", "plugin.json requires name");
  assert.ok(/^[a-z0-9-]+$/.test(manifest.name), "name must be kebab-case");
  assert.equal(manifest.hooks, "./hooks/hooks.json");
  assert.equal(manifest.mcpServers, "./.mcp.json");

  const ph = JSON.parse(readFileSync(join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf8"));
  for (const event of ["PreToolUse", "PostToolUse", "SessionStart"]) {
    const entries = ph.hooks?.[event];
    assert.ok(Array.isArray(entries), "plugin hooks.json missing " + event);
    for (const e of entries) for (const h of e.hooks) {
      assert.equal(h.type, "command");
      assert.ok(h.command.includes("${CLAUDE_PLUGIN_ROOT}"), "plugin hooks must be plugin-root relative");
    }
  }

  const mcp = JSON.parse(readFileSync(join(PLUGIN_ROOT, ".mcp.json"), "utf8"));
  assert.ok(mcp.mcpServers?.anysearch?.command, ".mcp.json must wire the anysearch server");
});

test("single-source: regenerating configs is byte-identical (no drift)", () => {
  // Snapshot the checked-in files FIRST, then regenerate into a scratch dir
  // (ANS_GEN_OUT) — a hand-edit to the source tree must surface as a diff.
  const files = ["configs/claude/hooks.json", "hooks/hooks.json", ".claude-plugin/plugin.json", ".mcp.json"];
  const before = files.map(f => readFileSync(join(PLUGIN_ROOT, f), "utf8"));
  const tmp = mkdtempSync(join(tmpdir(), "ans-gen-"));
  try {
    const r = spawnSync(process.execPath, [join(PLUGIN_ROOT, "scripts", "gen-claude-configs.mjs")], {
      encoding: "utf8",
      env: { ...process.env, ANS_GEN_OUT: tmp },
    });
    assert.equal(r.status, 0, "generator must run clean: " + r.stderr.slice(0, 200));
    const after = files.map(f => readFileSync(join(tmp, f), "utf8"));
    assert.deepEqual(after, before, "generated files drifted — run pnpm gen:configs");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ==== claude adapter: envelope contract (ER-2 fix) ====
testAsync("claude PostToolUse: results response -> envelope additionalContext", async () => {
  if (!existsSync(CLAUDE_ADAPTER)) { console.log("    SKIP: claude adapter not built"); return; }
  const { stdout } = await runHook(CLAUDE_ADAPTER, JSON.stringify({
    hook_event_name: "PostToolUse", tool_name: "mcp__anysearch__search_web",
    tool_input: { query: "x" }, tool_response: TOOL_RESP, session_id: "s1", cwd: "/tmp/cl",
  }));
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.hookSpecificOutput?.hookEventName, "PostToolUse");
  assert.ok(parsed.hookSpecificOutput?.additionalContext);
  assert.equal(Object.keys(parsed).length, 1, "no keys may leak to top level");
  const distilled = JSON.parse(parsed.hookSpecificOutput.additionalContext);
  assert.equal(distilled.resultCount, 2);
});

testAsync("claude PostToolUse: slim abstain response -> silent (nothing indexable)", async () => {
  if (!existsSync(CLAUDE_ADAPTER)) { console.log("    SKIP: not built"); return; }
  const { stdout } = await runHook(CLAUDE_ADAPTER, JSON.stringify({
    hook_event_name: "PostToolUse", tool_name: "mcp__anysearch__search_web",
    tool_input: { query: "x" }, tool_response: SLIM_RESP, session_id: "s1", cwd: "/tmp/cl",
  }));
  const parsed = JSON.parse(stdout);
  // Slim responses carry a distilled note but zero index entries.
  assert.equal(parsed.hookSpecificOutput?.hookEventName, "PostToolUse");
  const distilled = JSON.parse(parsed.hookSpecificOutput?.additionalContext ?? "{}");
  assert.equal(distilled.resultCount, 0);
});

testAsync("claude PreToolUse: URL on unreachable server -> hookSpecificOutput ask (fail-closed)", async () => {
  if (!existsSync(CLAUDE_ADAPTER)) { console.log("    SKIP: not built"); return; }
  const { stdout } = await runHook(CLAUDE_ADAPTER, JSON.stringify({
    hook_event_name: "PreToolUse", tool_name: "mcp__anysearch__search_web",
    tool_input: { query: "check https://blocked.invalid/path" },
    session_id: "s1", cwd: mkdtempSync(join(tmpdir(), "ans-cl-")),
  }), { ANS_SERVER_URL: "http://127.0.0.1:9", ANS_SERVER_TOKEN: "contract-test" });
  const parsed = JSON.parse(stdout);
  const hso = parsed.hookSpecificOutput;
  assert.equal(hso?.hookEventName, "PreToolUse");
  assert.equal(hso?.permissionDecision, "ask", "unreachable policy must ask, not silently allow");
  assert.ok(hso?.permissionDecisionReason, "ask must carry a reason");
  assert.equal(Object.keys(parsed).length, 1, "no keys may leak to top level");
});

testAsync("claude PreToolUse: non-ans tool -> silent exit", async () => {
  if (!existsSync(CLAUDE_ADAPTER)) { console.log("    SKIP: not built"); return; }
  const { stdout } = await runHook(CLAUDE_ADAPTER, JSON.stringify({
    hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" }, cwd: "/tmp/cl",
  }));
  assert.equal(stdout, "");
});

testAsync("session-start --envelope: additionalContext inside hookSpecificOutput", async () => {
  if (!existsSync(SESSION_START)) { console.log("    SKIP: session-start.cjs not built"); return; }
  const { stdout } = await runHook(SESSION_START, JSON.stringify({
    hook_event_name: "SessionStart", cwd: "/tmp/cl", session_id: "s1",
  }), undefined, ["--envelope"]);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.hookSpecificOutput?.hookEventName, "SessionStart");
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes("[anysearch plugin active]"));
  assert.ok(!("additionalContext" in parsed), "bare top-level additionalContext is dropped by the host");
});

process.on("exit", () => {
  console.log("  claude-contract: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exitCode = 1;
});
