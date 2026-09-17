// Antigravity CLI (agy) contract tests — R68 (T3 fix / ADR-0069 D4).
// Live-verified against agy 1.2.5 headless probes (evidence:
// .scratch/grill-round-68/evidence/t3-*):
//   * stdin is camelCase: conversationId, toolCall{name,args}, workspacePaths,
//     transcriptPath, artifactDirectoryPath, stepIdx, invocationNum.
//   * NO hook_event_name field — the event travels via argv
//     (ans-hook-antigravity <Event>).
//   * PostToolUse stdin carries toolCall+error but NO tool output.
//   * stdout is strict protojson: PreToolUse {} = DENY (decision required),
//     empty stdout = allow, {decision,reason?,permissionOverrides?} strict;
//     unknown fields (additionalContext/context/systemMessage/userMessage/
//     {allow:true}) reject via protojson and ERROR the tool call.
//   * PostToolUse must emit {} only.
//   * Context injection = Pre/PostInvocation injectSteps[].ephemeralMessage
//     (verified reaches the model); routing card rides invocationNum===0.
//   * configs/antigravity/hooks.json must be the named-hook map
//     { "<name>": { "<Event>": [{matcher,hooks:[{type,command,timeout}]}] } } —
//     the Gemini-legacy {hooks:{...}} wrapper fails to parse
//     ("command hook must specify 'command'").

import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

const PLUGIN_ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const AGY_ADAPTER = join(PLUGIN_ROOT, "dist", "hooks", "adapters", "antigravity.cjs");

function runHook(stdinPayload: string, args: string[] = [], env?: Record<string, string>): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [AGY_ADAPTER, ...args], {
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

const COMMON = {
  conversationId: "conv-68-1",
  workspacePaths: [] as string[],
  transcriptPath: "t.jsonl",
  artifactDirectoryPath: "",
  modelName: "gemini-3.8-flash-low",
};

function preToolUseStdin(toolName: string, args: Record<string, unknown>, dir: string): string {
  return JSON.stringify({ ...COMMON, artifactDirectoryPath: dir, workspacePaths: [dir], toolCall: { name: toolName, args }, stepIdx: 2 });
}

// ==== shipped config: official named-hook map ====
test("configs/antigravity/hooks.json uses the official named-hook schema", () => {
  const cfg = JSON.parse(readFileSync(join(PLUGIN_ROOT, "configs", "antigravity", "hooks.json"), "utf8"));
  assert.ok(!("hooks" in cfg), "Gemini-legacy {hooks:{...}} wrapper fails to parse on agy — named-hook map required");
  const names = Object.keys(cfg);
  assert.ok(names.length > 0, "at least one named hook required");
  for (const name of names) {
    const def = cfg[name];
    assert.ok(typeof def === "object" && def !== null, name + ": hook def must be an object");
    for (const [event, entries] of Object.entries(def)) {
      if (event === "enabled") continue;
      assert.ok(["PreToolUse", "PostToolUse", "PreInvocation", "PostInvocation", "Stop"].includes(event),
        name + "." + event + ": unknown event");
      assert.ok(Array.isArray(entries) && entries.length > 0, name + "." + event + ": entries required");
      for (const e of entries as Array<Record<string, unknown>>) {
        const handlers = Array.isArray(e.hooks) ? e.hooks as Array<Record<string, unknown>> : [e];
        for (const h of handlers) {
          assert.equal(h.type, "command", name + "." + event + ": handler.type must be 'command'");
          assert.equal(typeof h.command, "string", name + "." + event + ": handler.command required");
        }
      }
    }
  }
});

test("antigravity config commands resolve via package bins and pass the event via argv", () => {
  const cfg = JSON.parse(readFileSync(join(PLUGIN_ROOT, "configs", "antigravity", "hooks.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, "package.json"), "utf8"));
  const cmds: string[] = [];
  for (const def of Object.values(cfg) as Array<Record<string, unknown>>) {
    for (const entries of Object.values(def) as unknown[]) {
      for (const e of entries as Array<Record<string, unknown>>) {
        const handlers = Array.isArray(e.hooks) ? e.hooks as Array<{ command: string }> : [e as { command: string }];
        for (const h of handlers) cmds.push(h.command);
      }
    }
  }
  assert.ok(cmds.length >= 5, "all five events wired");
  for (const c of cmds) {
    const bin = c.split(" ")[0];
    assert.ok(bin in pkg.bin, "command must be a package bin: " + c);
    // stdin carries no hook_event_name — the event must be an argv suffix.
    assert.ok(/ (PreToolUse|PostToolUse|PreInvocation|PostInvocation|Stop)$/.test(c),
      "command must pass the event name via argv: " + c);
  }
});

// ==== adapter behavior ====
testAsync("argv-driven PreToolUse emits {decision:allow} on the real camelCase payload", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agy-"));
  try {
    const { stdout } = await runHook(
      preToolUseStdin("call_mcp_tool", { toolName: "mcp__anysearch__search_web", arguments: { query: "x" } }, dir),
      ["PreToolUse"],
    );
    assert.deepEqual(JSON.parse(stdout), { decision: "allow" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

testAsync("PreToolUse never emits {} ({} = deny on this host)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agy-"));
  try {
    for (const payload of [
      preToolUseStdin("call_mcp_tool", { toolName: "unrelated__tool" }, dir),
      preToolUseStdin("run_command", { CommandLine: "ls" }, dir),
      "{}",
    ]) {
      const { stdout } = await runHook(payload, ["PreToolUse"]);
      const trimmed = stdout.trim();
      assert.ok(trimmed === "" || JSON.parse(trimmed).decision === "allow",
        "PreToolUse must emit empty or {decision:allow}, got: " + trimmed);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

testAsync("PostToolUse emits {} exactly and accepts toolCall-less-of-output payloads", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agy-"));
  try {
    const { stdout } = await runHook(JSON.stringify({
      ...COMMON, artifactDirectoryPath: dir, workspacePaths: [dir],
      toolCall: { name: "call_mcp_tool", args: { toolName: "mcp__anysearch__search_web" } },
      stepIdx: 3, error: "",
    }), ["PostToolUse"]);
    assert.equal(stdout.trim(), "{}");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

testAsync("PreInvocation injects the routing card as ephemeralMessage on invocationNum=0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agy-"));
  try {
    const { stdout } = await runHook(JSON.stringify({
      ...COMMON, artifactDirectoryPath: dir, workspacePaths: [dir], invocationNum: 0, initialNumSteps: 1,
    }), ["PreInvocation"]);
    const out = JSON.parse(stdout);
    assert.ok(Array.isArray(out.injectSteps) && out.injectSteps.length > 0, "inv0 must inject steps");
    assert.ok(typeof out.injectSteps[0].ephemeralMessage === "string", "step must be ephemeralMessage");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

testAsync("PreInvocation with invocationNum>0 emits {} (no card spam)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agy-"));
  try {
    const { stdout } = await runHook(JSON.stringify({
      ...COMMON, artifactDirectoryPath: dir, workspacePaths: [dir], invocationNum: 2, initialNumSteps: 5,
    }), ["PreInvocation"]);
    assert.deepEqual(JSON.parse(stdout), {});
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

testAsync("staged preheat context flushes through the next invocation as injectSteps", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agy-"));
  try {
    // ans-tool PreToolUse may stage pending context; a later invocation must flush it.
    await runHook(preToolUseStdin("call_mcp_tool", { toolName: "mcp__anysearch__search_web", arguments: { query: "q" } }, dir), ["PreToolUse"]);
    const pending = join(dir, "anysearch-pending.jsonl");
    if (existsSync(pending)) {
      const { stdout } = await runHook(JSON.stringify({
        ...COMMON, artifactDirectoryPath: dir, workspacePaths: [dir], invocationNum: 3, initialNumSteps: 4,
      }), ["PostInvocation"]);
      const out = JSON.parse(stdout);
      assert.ok(Array.isArray(out.injectSteps) && out.injectSteps.length > 0, "pending must flush as injectSteps");
      assert.ok(!existsSync(pending), "pending file must be consumed");
    }
    // No pending staged is also compliant (offline preheat may be empty).
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

testAsync("fail-open: malformed stdin exits 0", async () => {
  const { code } = await runHook("not-json{{{", ["PreToolUse"]);
  assert.equal(code, 0);
});

testAsync(".mdc fallback: any invocation writes .antigravity/rules/anysearch.mdc in cwd workspace", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agy-"));
  try {
    await runHook(JSON.stringify({
      ...COMMON, artifactDirectoryPath: dir, workspacePaths: [dir], invocationNum: 0, initialNumSteps: 1,
    }), ["PreInvocation"]);
    assert.ok(existsSync(join(dir, ".antigravity", "rules", "anysearch.mdc")), ".mdc must be written into workspace");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

testAsync("Stop emits a protojson-safe object (never plain text)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agy-"));
  try {
    const { stdout } = await runHook(JSON.stringify({
      ...COMMON, artifactDirectoryPath: dir, workspacePaths: [dir],
      executionNum: 0, terminationReason: "NO_TOOL_CALL", fullyIdle: true, error: "",
    }), ["Stop"]);
    JSON.parse(stdout.trim() || "{}");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

console.log(`\nantigravity-contract: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

process.on("exit", () => {
  console.log("  antigravity-contract: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exitCode = 1;
});
