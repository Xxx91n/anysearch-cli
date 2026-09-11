// Codex CLI hooks adapter.
// Codex CLI hooks: similar JSON stdin/stdout contract.
// Exit 0=pass, 2=block (stderr as reason), other=fail-open.
// PreToolUse and PostToolUse supported.

import { isAnsTool, callServer } from "../core.js";
import { makePostToolUseDecision } from "../distill.js";
import { makePreToolUseDecision } from "../preheat.js";

interface CodexHookStdin {
  event?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: Record<string, unknown>;
  cwd?: string;
  session_id?: string;
}

async function main(): Promise<void> {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;

  let stdin: CodexHookStdin;
  try { stdin = JSON.parse(input); }
  catch { process.exit(0); }

  const event = stdin.event || "";
  const toolName = stdin.tool_name || "";
  const cwd = stdin.cwd || process.cwd();

  if (!isAnsTool(toolName)) process.exit(0);

  try {
    if (event === "PreToolUse") {
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
    } else if (event === "PostToolUse") {
      const decision = makePostToolUseDecision({
        event: "PostToolUse",
        toolName,
        toolInput: stdin.tool_input || {},
        toolOutput: stdin.tool_response || {},
        projectPath: cwd,
        sessionId: stdin.session_id || "",
      });

      const serverUrl = process.env.ANS_SERVER_URL || "http://127.0.0.1:33333";
      const token = process.env.ANS_SERVER_TOKEN || "";
      if (decision.shouldIndex && decision.indexEntries) {
        await callServer(serverUrl + "/index", token, {
          projectPath: cwd, toolName, entries: decision.indexEntries,
        }, { sessionId: stdin.session_id || "" }).catch(() => null);
      }

      // Codex: updatedMCPToolOutput parsed but not yet effective per atomcode research.
      // Use distilled output as context injection instead.
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
