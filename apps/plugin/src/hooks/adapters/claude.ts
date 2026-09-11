// Claude Code hooks adapter.
// Claude Code hooks: stdin JSON, stdout JSON, exit 0/2/other.
// PreToolUse: event=PreToolUse, tool_name, tool_input, cwd, session_id
// PostToolUse: event=PostToolUse, tool_name, tool_input, tool_response, cwd, session_id
// JSON output: { permissionDecision: "allow"|"deny"|"ask", additionalContext, updatedInput }
// PostToolUse: { updatedToolOutput } or distilled summary
// ADR-0009 Q5: only intercept ans_* tools.

import { isAnsTool, callServer, type HookDecision } from "../core.js";
import { makePostToolUseDecision } from "../distill.js";
import { makePreToolUseDecision } from "../preheat.js";

interface ClaudeHookStdin {
  event: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: { content?: Array<{ text?: string }> } | string;
  cwd?: string;
  session_id?: string;
}

async function main(): Promise<void> {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let stdin: ClaudeHookStdin;
  try {
    stdin = JSON.parse(input);
  } catch {
    // Fail-open: unparseable stdin = pass through.
    process.exit(0);
  }

  const event = stdin.event || "";
  const toolName = stdin.tool_name || "";
  const cwd = stdin.cwd || process.cwd();

  // Q5: only intercept our tools.
  if (!isAnsTool(toolName)) {
    process.exit(0);
  }

  try {
    if (event === "PreToolUse") {
      const decision = await makePreToolUseDecision({
        event: "PreToolUse",
        toolName,
        toolInput: stdin.tool_input || {},
        projectPath: cwd,
        sessionId: stdin.session_id || "",
      });
      const output: Record<string, unknown> = {};
      if (decision.additionalContext) output.additionalContext = decision.additionalContext;
      if (decision.updatedInput) output.updatedInput = decision.updatedInput;
      // ADR-0054 D4: surface ask/allow/deny through Claude's hookSpecificOutput envelope.
      if (decision.permission) {
        output.hookSpecificOutput = {
          hookEventName: "PreToolUse",
          permissionDecision: decision.permission,
          ...(decision.permissionReason ? { permissionDecisionReason: decision.permissionReason } : {}),
        };
      }
      if (Object.keys(output).length > 0) {
        process.stdout.write(JSON.stringify(output));
      }
      process.exit(0);
    } else if (event === "PostToolUse") {
      // Parse tool response from Claude format.
      let toolOutput: Record<string, unknown> = {};
      if (typeof stdin.tool_response === "string") {
        try { toolOutput = JSON.parse(stdin.tool_response); } catch { toolOutput = { text: stdin.tool_response }; }
      } else if (stdin.tool_response?.content?.[0]?.text) {
        try { toolOutput = JSON.parse(stdin.tool_response.content[0].text); } catch { toolOutput = { text: stdin.tool_response.content[0].text }; }
      }

      const decision = makePostToolUseDecision({
        event: "PostToolUse",
        toolName,
        toolInput: stdin.tool_input || {},
        toolOutput,
        projectPath: cwd,
        sessionId: stdin.session_id || "",
      });

      // Send to server for indexing (fail-open).
      const serverUrl = process.env.ANS_SERVER_URL || "http://127.0.0.1:33333";
      const token = process.env.ANS_SERVER_TOKEN || "";
      if (decision.shouldIndex && decision.indexEntries && decision.indexEntries.length > 0) {
        await callServer(serverUrl + "/index", token, {
          projectPath: cwd,
          toolName,
          entries: decision.indexEntries,
        }, { sessionId: stdin.session_id || "" }).catch(() => null);
      }

      // Return distilled output to Claude.
      if (decision.distilledOutput) {
        process.stdout.write(JSON.stringify({ updatedToolOutput: decision.distilledOutput }));
      }
      process.exit(0);
    }
  } catch (e) {
    // ADR-0009 D6: fail-open. stderr warn, exit 0, raw output passes through.
    process.stderr.write("[anysearch] hook error: " + (e instanceof Error ? e.message : String(e)) + "\n");
    process.exit(0);
  }
}

main();
