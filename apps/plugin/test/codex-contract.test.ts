// Codex CLI contract tests — R67 (T3 fix / ADR-0068).
// Live-verified against codex-cli 0.142.5 headless probes (evidence:
// .scratch/grill-round-67/evidence/t1-*, t2-*):
//   * Real stdin event field is hook_event_name (adapter falls back to event).
//   * Only the hookSpecificOutput envelope is honored — bare top-level
//     { additionalContext } is dropped ~80% (L2 legs: 1/8 stub + 1/3 real);
//     bare { permissionDecision } never blocks; exit code 2 does NOT block.
//   * configs/codex/hooks.json must use the official schema
//     { "<Event>": [{ matcher, hooks: [{ type, command, timeout }] }] } —
//     the shipped 0.0.4 {name,command,args} shape registered ZERO hooks
//     (silent no-op; no parse error).
//   * matcher is a FULL-MATCH regex: "mcp__anysearch__" does not match
//     "mcp__anysearch__search_web"; matchers must be suffix-anchored.
//   * Commands must resolve via global bin shims — ${CODEX_PLUGIN_DIR} does
//     not exist; -c injection cannot express hooks (value parsed as string).
//   * SessionStart needs --envelope (same bare-drop defect class).

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
const CODEX_ADAPTER = join(PLUGIN_ROOT, "dist", "hooks", "adapters", "codex.cjs");

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
    { title: "cx alpha", url: "https://example.com/a", snippet: "doc alpha", source: "synthetic" },
    { title: "cx beta", url: "https://example.com/b", snippet: "doc beta", source: "synthetic" },
  ],
});

// ==== shipped config: official Codex schema ====
test("configs/codex/hooks.json uses the official Codex hooks schema", () => {
  const cfg = JSON.parse(readFileSync(join(PLUGIN_ROOT, "configs", "codex", "hooks.json"), "utf8"));
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
        assert.ok(!("args" in h) && !("name" in h), event + ": name/args shape registers zero hooks on codex");
      }
    }
  }
});

test("codex config commands resolve via package bins (no absolute paths, no fake vars)", () => {
  const cfg = JSON.parse(readFileSync(join(PLUGIN_ROOT, "configs", "codex", "hooks.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, "package.json"), "utf8"));
  const cmds: string[] = [];
  for (const entries of Object.values(cfg.hooks) as Array<Array<{ hooks: Array<{ command: string }> }>>) {
    for (const e of entries) for (const h of e.hooks) cmds.push(h.command);
  }
  for (const c of cmds) {
    assert.ok(c.split(" ")[0] in pkg.bin, "command must be a package bin: " + c);
    assert.ok(!/[A-Za-z]:[\\/]/.test(c), "command must not embed an absolute path: " + c);
    assert.ok(!c.includes("CODEX_PLUGIN"), "must not use ${CODEX_PLUGIN_*} — the var does not exist: " + c);
  }
});

test("codex config matchers full-match ans tool names", () => {
  const cfg = JSON.parse(readFileSync(join(PLUGIN_ROOT, "configs", "codex", "hooks.json"), "utf8"));
  for (const event of ["PreToolUse", "PostToolUse"]) {
    for (const e of cfg.hooks[event] as Array<{ matcher: string }>) {
      const re = new RegExp(e.matcher);
      assert.ok(re.test("mcp__anysearch__search_web"), event + " matcher must match mcp__anysearch__search_web");
      assert.ok(re.test("mcp__custom__ans_chat"), event + " matcher must be namespace-agnostic");
      assert.ok(!re.test("shell"), event + " matcher must not match unrelated tools");
    }
  }
});

test("codex config SessionStart passes --envelope (bare shape is dropped by codex)", () => {
  const cfg = JSON.parse(readFileSync(join(PLUGIN_ROOT, "configs", "codex", "hooks.json"), "utf8"));
  for (const e of cfg.hooks.SessionStart as Array<{ hooks: Array<{ command: string }> }>) {
    for (const h of e.hooks) assert.ok(h.command.includes("--envelope"), "codex session-start must emit the envelope");
  }
});

test("bin entry ans-hook-codex exists and reads stdin", () => {
  const pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, "package.json"), "utf8"));
  const rel = pkg.bin["ans-hook-codex"];
  assert.ok(rel, "bin.ans-hook-codex missing");
  const p = join(PLUGIN_ROOT, rel);
  if (!existsSync(p)) return; // dist not built — covered after build
  assert.ok(readFileSync(p, "utf8").includes("process.stdin"), rel + " must read stdin");
});

test("single-source: regenerating configs is byte-identical (no drift)", () => {
  const files = ["configs/claude/hooks.json", "configs/codex/hooks.json", "hooks/hooks.json", ".claude-plugin/plugin.json", ".mcp.json"];
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

// ==== codex adapter: envelope contract ====
testAsync("codex PostToolUse: results response -> envelope additionalContext", async () => {
  if (!existsSync(CODEX_ADAPTER)) { console.log("    SKIP: codex adapter not built"); return; }
  const { stdout } = await runHook(CODEX_ADAPTER, JSON.stringify({
    hook_event_name: "PostToolUse", tool_name: "mcp__anysearch__search_web",
    tool_input: { query: "x" }, tool_response: TOOL_RESP, session_id: "s1", cwd: "/tmp/cx",
  }));
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.hookSpecificOutput?.hookEventName, "PostToolUse");
  assert.ok(parsed.hookSpecificOutput?.additionalContext);
  assert.equal(Object.keys(parsed).length, 1, "no keys may leak to top level (codex drops them)");
  const distilled = JSON.parse(parsed.hookSpecificOutput.additionalContext);
  assert.equal(distilled.resultCount, 2);
});

testAsync("codex PreToolUse: URL on unreachable server -> envelope ask (fail-closed)", async () => {
  if (!existsSync(CODEX_ADAPTER)) { console.log("    SKIP: not built"); return; }
  const { stdout } = await runHook(CODEX_ADAPTER, JSON.stringify({
    hook_event_name: "PreToolUse", tool_name: "mcp__anysearch__search_web",
    tool_input: { query: "check https://blocked.invalid/path" },
    session_id: "s1", cwd: mkdtempSync(join(tmpdir(), "ans-cx-")),
  }), { ANS_SERVER_URL: "http://127.0.0.1:9", ANS_SERVER_TOKEN: "contract-test" });
  const parsed = JSON.parse(stdout);
  const hso = parsed.hookSpecificOutput;
  assert.equal(hso?.hookEventName, "PreToolUse");
  assert.equal(hso?.permissionDecision, "ask", "unreachable policy must ask, not silently allow");
  assert.ok(hso?.permissionDecisionReason, "ask must carry a reason");
  assert.equal(Object.keys(parsed).length, 1, "no keys may leak to top level");
});

testAsync("codex adapter reads hook_event_name (real codex stdin field)", async () => {
  if (!existsSync(CODEX_ADAPTER)) { console.log("    SKIP: not built"); return; }
  // Real codex stdin uses hook_event_name — the legacy `event` field alone
  // must also work, and hook_event_name must take precedence.
  const { stdout: a } = await runHook(CODEX_ADAPTER, JSON.stringify({
    hook_event_name: "PostToolUse", tool_name: "mcp__anysearch__search_web",
    tool_input: { query: "x" }, tool_response: TOOL_RESP, session_id: "s1", cwd: "/tmp/cx",
  }));
  assert.ok(JSON.parse(a).hookSpecificOutput, "hook_event_name path must emit the envelope");
  const { stdout: b } = await runHook(CODEX_ADAPTER, JSON.stringify({
    event: "PostToolUse", tool_name: "mcp__anysearch__search_web",
    tool_input: { query: "x" }, tool_response: TOOL_RESP, session_id: "s1", cwd: "/tmp/cx",
  }));
  assert.ok(JSON.parse(b).hookSpecificOutput, "legacy event fallback must still work");
});

testAsync("codex PreToolUse: non-ans tool -> silent exit", async () => {
  if (!existsSync(CODEX_ADAPTER)) { console.log("    SKIP: not built"); return; }
  const { stdout } = await runHook(CODEX_ADAPTER, JSON.stringify({
    hook_event_name: "PreToolUse", tool_name: "shell", tool_input: { command: "ls" }, cwd: "/tmp/cx",
  }));
  assert.equal(stdout, "");
});

testAsync("codex adapter: malformed stdin -> silent exit 0 (fail-open)", async () => {
  if (!existsSync(CODEX_ADAPTER)) { console.log("    SKIP: not built"); return; }
  const { stdout, code } = await runHook(CODEX_ADAPTER, "not json{");
  assert.equal(code, 0);
  assert.equal(stdout, "");
});

process.on("exit", () => {
  console.log("  codex-contract: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exitCode = 1;
});
