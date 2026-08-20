// Cursor hooks adapter.
// ADR-0011 D4: Cursor dual channel — emit additional_context (snake_case) + .mdc fallback.
// Cursor sessionStart has a known race condition bug (2026-04~2026-08, no ETA).
// Best practice (context-mode 20k, Hindsight, superpowers): emit hook field for
// forward-compat + .mdc rules file for reliability.
// ADR-0011 D6: do NOT modify host AGENTS.md.
//
// Event mapping: PreToolUse→preToolUse, PostToolUse→postToolUse.
// Cursor hook stdin/stdout contract: JSON in, JSON out, exit 0/2/other (fail-open default).
// Cursor postToolUse supports updated_mcp_tool_output for MCP tools.

import { isAnsTool, callServer } from "../core.js";
import { makePostToolUseDecision } from "../distill.js";
import { makePreToolUseDecision } from "../preheat.js";
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

interface CursorHookStdin {
  event?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: Record<string, unknown>;
  cwd?: string;
  session_id?: string;
}

// ADR-0012 D14: routing card + MDC content imported from shared routing-card.ts module.
import { DEFAULT_ROUTING_CARD as ROUTING_CARD, MDC_CONTENT, loadRoutingCard } from "../routing-card.js";

function ensureMdc(cwd: string): void {
  const rulesDir = join(cwd, ".cursor", "rules");
  const mdcPath = join(rulesDir, "anysearch.mdc");
  try {
    if (existsSync(mdcPath)) {
      const existing = readFileSync(mdcPath, "utf8");
      if (existing === MDC_CONTENT) return;
    }
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(mdcPath, MDC_CONTENT, "utf8");
  } catch {
    // Fail-open: .mdc write failure is non-fatal.
  }
}

async function main(): Promise<void> {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;

  let stdin: CursorHookStdin;
  try { stdin = JSON.parse(input); }
  catch { process.exit(0); }

  const event = (stdin.event || "").toLowerCase();
  const toolName = stdin.tool_name || "";
  const cwd = stdin.cwd || process.cwd();

  // ADR-0011 D4: Cursor sessionStart — emit additional_context (snake_case) + ensure .mdc.
  if (event === "sessionstart" || event === "session_start") {
    ensureMdc(cwd);
    // ADR-0011 D4: snake_case field name (official confirmation).
    process.stdout.write(JSON.stringify({ additional_context: ROUTING_CARD }));
    process.exit(0);
  }

  if (!isAnsTool(toolName)) process.exit(0);

  // Cursor uses lowercase event names (preToolUse/postToolUse).
  try {
    if (event === "pretooluse") {
      const decision = await makePreToolUseDecision({
        event: "PreToolUse",
        toolName,
        toolInput: stdin.tool_input || {},
        projectPath: cwd,
        sessionId: stdin.session_id || "",
      });
      if (decision.additionalContext) {
        // ADR-0011 D4: snake_case for Cursor.
        process.stdout.write(JSON.stringify({ additional_context: decision.additionalContext }));
      }
      process.exit(0);
    } else if (event === "posttooluse") {
      const decision = makePostToolUseDecision({
        event: "PostToolUse",
        toolName,
        toolInput: stdin.tool_input || {},
        toolOutput: stdin.tool_output || {},
        projectPath: cwd,
        sessionId: stdin.session_id || "",
      });

      const serverUrl = process.env.ANS_SERVER_URL || "http://127.0.0.1:33333";
      const token = process.env.ANS_SERVER_TOKEN || "";
      if (decision.shouldIndex && decision.indexEntries) {
        await callServer(serverUrl + "/index", token, {
          projectPath: cwd, toolName, entries: decision.indexEntries,
        }).catch(() => null);
      }

      // Cursor: updated_mcp_tool_output (MCP tools only).
      if (decision.distilledOutput) {
        process.stdout.write(JSON.stringify({ updated_mcp_tool_output: decision.distilledOutput }));
      }
      process.exit(0);
    }
  } catch (e) {
    process.stderr.write("[anysearch] hook error: " + (e instanceof Error ? e.message : String(e)) + "\n");
    process.exit(0);
  }
}

main();
