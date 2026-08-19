// Cursor hooks adapter.
// Atomcode research Q9 verified: Cursor can load .claude/settings.json hooks directly.
// Event mapping: PreToolUse→preToolUse, UserPromptSubmit→beforeSubmitPrompt.
// Cursor hook stdin/stdout contract: JSON in, JSON out, exit 0/2/other (fail-open default).
// Cursor postToolUse supports updated_mcp_tool_output for MCP tools.

import { isAnsTool, callServer } from "../core.js";
import { makePostToolUseDecision } from "../distill.js";
import { makePreToolUseDecision } from "../preheat.js";

interface CursorHookStdin {
  event?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: Record<string, unknown>;
  cwd?: string;
  session_id?: string;
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

  if (!isAnsTool(toolName)) process.exit(0);

  // Cursor uses lowercase event names (preToolUse/postToolUse).
  // Mapping verified from atomcode Q9: PreToolUse→preToolUse.
  try {
    if (event === "pretooluse" || event === "pretooluse") {
      const decision = await makePreToolUseDecision({
        event: "PreToolUse",
        toolName,
        toolInput: stdin.tool_input || {},
        projectPath: cwd,
        sessionId: stdin.session_id || "",
      });
      if (decision.additionalContext) {
        process.stdout.write(JSON.stringify({ additional_context: decision.additionalContext }));
      }
      process.exit(0);
    } else if (event === "posttooluse" || event === "posttooluse") {
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
