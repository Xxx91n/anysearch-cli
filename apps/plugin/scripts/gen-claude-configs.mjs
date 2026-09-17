// Single-source generator for the Claude Code integration artifacts (R66 T3).
//
// Emits, from ONE spec:
//   configs/claude/hooks.json   — .claude/settings.json variant. Commands use
//                                 the package's global bin shims
//                                 (ans-hook-claude / ans-hook-session-start),
//                                 which resolve via PATH on every OS — no
//                                 absolute paths, no ${CLAUDE_PLUGIN_*} vars.
//   hooks/hooks.json            — plugin-skeleton variant. Commands reference
//                                 ${CLAUDE_PLUGIN_ROOT}/dist/... (experimental:
//                                 CLAUDE_PLUGIN_ROOT expansion is broken on
//                                 Windows — upstream issue #16116).
//   .claude-plugin/plugin.json  — plugin manifest (name required; hooks +
//                                 mcpServers point at the sibling files).
//   .mcp.json                   — plugin's MCP server wiring (ans-mcp bin).
//
// Regenerate after changing the spec:  node scripts/gen-claude-configs.mjs
// Drift is caught by test/claude-contract.test.ts (byte-identical regen).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, "package.json"), "utf8"));

// ---- single source of truth -----------------------------------------------
const HOOKS_SPEC = [
  { event: "PreToolUse", matcher: ".*", target: "dist/hooks/adapters/claude.cjs", bin: "ans-hook-claude", timeout: 5 },
  { event: "PostToolUse", matcher: ".*", target: "dist/hooks/adapters/claude.cjs", bin: "ans-hook-claude", timeout: 10 },
  // --envelope selects the hookSpecificOutput output shape in session-start.cjs
  // (Claude-only; the bare shape stays the default for codex/cursor/antigravity).
  { event: "SessionStart", matcher: "startup", target: "dist/hooks/session-start.cjs", bin: "ans-hook-session-start", args: "--envelope", timeout: 5 },
];
const MCP_SERVER_NAME = "anysearch";
const MCP_COMMAND = "ans-mcp"; // global bin of @anysearch-cli/mcp

// ---- emitters ---------------------------------------------------------------
function settingsHooks() {
  const hooks = {};
  for (const h of HOOKS_SPEC) {
    (hooks[h.event] ??= []).push({
      matcher: h.matcher,
      hooks: [{ type: "command", command: h.args ? `${h.bin} ${h.args}` : h.bin, timeout: h.timeout }],
    });
  }
  return { hooks };
}

function pluginHooks() {
  const hooks = {};
  for (const h of HOOKS_SPEC) {
    (hooks[h.event] ??= []).push({
      matcher: h.matcher,
      hooks: [{
        type: "command",
        command: `node "\${CLAUDE_PLUGIN_ROOT}/${h.target}"${h.args ? ` ${h.args}` : ""}`,
        timeout: h.timeout,
      }],
    });
  }
  return { hooks };
}

function pluginManifest() {
  return {
    name: "anysearch",
    version: pkg.version,
    description: "AnySearch hooks + MCP integration for Claude Code (experimental)",
    author: { name: "Xxx91n" },
    license: "Apache-2.0",
    // claude plugin validate requires a STRING here (npm's {type,url} object fails).
    repository: typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url,
    hooks: "./hooks/hooks.json",
    mcpServers: "./.mcp.json",
  };
}

function pluginMcp() {
  return { mcpServers: { [MCP_SERVER_NAME]: { command: MCP_COMMAND } } };
}

// ---- write -------------------------------------------------------------------
// ANS_GEN_OUT overrides the write root (used by the drift-guard contract test —
// it regenerates into a tmp dir and compares against the checked-in files
// without touching the source tree).
const OUT_ROOT = process.env.ANS_GEN_OUT || PLUGIN_ROOT;
const out = [
  ["configs/claude/hooks.json", settingsHooks()],
  ["hooks/hooks.json", pluginHooks()],
  [".claude-plugin/plugin.json", pluginManifest()],
  [".mcp.json", pluginMcp()],
];
for (const [rel, obj] of out) {
  const p = join(OUT_ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
  console.log("wrote " + rel);
}
