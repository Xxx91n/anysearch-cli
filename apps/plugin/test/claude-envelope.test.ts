// Claude Code PreToolUse return value: the key names are the host's, not ours.
//
// This locks down the seam the adapter calls to build that return value. The
// bug behind it: the rewrite was written to `hookSpecificOutput.updatedToolInput`,
// a key Claude Code does not have — the hooks reference spells the field
// `updatedInput`, so the host dropped the rewrite without a word.
//
// Run: npx tsx apps/plugin/test/claude-envelope.test.ts

import assert from "node:assert/strict";
import { claudePreToolUseOutput } from "../src/hooks/adapters/claude-envelope.js";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("  PASS " + name); } catch (e) {
    failed++;
    console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message : String(e)));
  }
}

test("rewrite rides on hookSpecificOutput.updatedInput", () => {
  const out = claudePreToolUseOutput({ updatedInput: { query: "narrowed", limit: 5 } });
  assert.deepEqual(out, {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: { query: "narrowed", limit: 5 },
    },
  });
});

test("updatedToolInput is never a key, at any depth", () => {
  const out = claudePreToolUseOutput({
    updatedInput: { query: "narrowed" },
    permission: "ask",
    permissionReason: "URL not on allowlist",
    additionalContext: "recall hit",
  });
  const json = JSON.stringify(out);
  assert.ok(!json.includes("updatedToolInput"), "host has no such field: " + json);
  assert.deepEqual(Object.keys(out!.hookSpecificOutput).sort(), [
    "additionalContext", "hookEventName", "permissionDecision", "permissionDecisionReason", "updatedInput",
  ]);
});

test("a rewrite needs no permission decision to be emitted", () => {
  const out = claudePreToolUseOutput({ updatedInput: { query: "only this" } });
  assert.ok(out, "a lone updatedInput must still produce output");
  assert.equal(out.hookSpecificOutput.permissionDecision, undefined, "auto mode judges the changed call itself");
  assert.equal(Object.keys(out.hookSpecificOutput).length, 2, "hookEventName + updatedInput, nothing else");
});

test("decision with nothing to say -> no output at all", () => {
  assert.equal(claudePreToolUseOutput({}), null);
  // A rewrite of `{}` is a real rewrite; it must not be mistaken for silence.
  assert.ok(claudePreToolUseOutput({ updatedInput: {} }));
});

test("permission without a reason leaves the reason key out", () => {
  const out = claudePreToolUseOutput({ permission: "deny" });
  assert.deepEqual(out, { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } });
});

test("no decision key leaks to the top level", () => {
  const out = claudePreToolUseOutput({ additionalContext: "x", permission: "allow", permissionReason: "y", updatedInput: { a: 1 } });
  assert.deepEqual(Object.keys(out!), ["hookSpecificOutput"]);
});

process.on("exit", () => {
  console.log("  claude-envelope: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exitCode = 1;
});
