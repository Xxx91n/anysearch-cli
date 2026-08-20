// Antigravity CLI hooks adapter (formerly Gemini CLI).
// ADR-0011 D8: Antigravity has no SessionStart equivalent.
// Like Cursor, use .mdc rule file fallback.
// hooks.json keeps SessionStart config for forward-compat.
//
// Atomcode research Q9: Antigravity has 5 events (simplified from Gemini's 11):
// PreToolUse/PostToolUse/PreInvocation/PostInvocation/Stop.
// JSON stdin/stdout, exit 0/2/other.

import { isAnsTool, callServer } from "../core.js";
import { makePostToolUseDecision } from "../distill.js";
import { makePreToolUseDecision } from "../preheat.js";
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

interface AntigravityHookStdin {
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
  // Antigravity uses .antigravity/rules/ (parallel to Cursor's .cursor/rules/).
  const rulesDir = join(cwd, ".antigravity", "rules");
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

  let stdin: AntigravityHookStdin;
  try { stdin = JSON.parse(input); }
  catch { process.exit(0); }

  const event = stdin.event || "";
  const toolName = stdin.tool_name || "";
  const cwd = stdin.cwd || process.cwd();

  // ADR-0011 D8: SessionStart config kept for forward-compat.
  // Current Antigravity has no SessionStart event, but if it fires, handle it.
  if (event === "SessionStart" || event === "session_start" || event === "sessionStart") {
    ensureMdc(cwd);
    process.stdout.write(JSON.stringify({ additionalContext: ROUTING_CARD }));
    process.exit(0);
  }

  // ADR-0011 D8: generate .mdc on any hook invocation as fallback
  // (since SessionStart doesn't fire in current Antigravity).
  ensureMdc(cwd);

  if (!isAnsTool(toolName)) process.exit(0);

  try {
    if (event === "PreToolUse" || event === "PreInvocation") {
      const decision = await makePreToolUseDecision({
        event: "PreToolUse",
        toolName,
        toolInput: stdin.tool_input || {},
        projectPath: cwd,
        sessionId: stdin.session_id || "",
      });
      if (decision.additionalContext) {
        process.stdout.write(JSON.stringify({ additionalContext: decision.additionalContext }));
      }
      process.exit(0);
    } else if (event === "PostToolUse" || event === "PostInvocation") {
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

      if (decision.distilledOutput) {
        process.stdout.write(JSON.stringify({ additionalContext: decision.distilledOutput }));
      }
      process.exit(0);
    }
  } catch (e) {
    process.stderr.write("[anysearch] hook error: " + (e instanceof Error ? e.message : String(e)) + "\n");
    process.exit(0);
  }
}

main();
