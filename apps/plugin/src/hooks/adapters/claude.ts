// Claude Code hooks adapter.
// Claude Code hooks: stdin JSON, stdout JSON, exit 0/2/other.
// PreToolUse: hook_event_name=PreToolUse, tool_name, tool_input, cwd, session_id
// PostToolUse: hook_event_name=PostToolUse, tool_name, tool_input, tool_response, cwd, session_id
// JSON output (ADR-0066 R66, verified on Claude Code 2.1.251): ALL decision keys
// must sit inside the hookSpecificOutput envelope — bare top-level
// additionalContext/updatedToolOutput/permissionDecision are silently dropped
// by the host (proven by deny-sentinels: envelope + legacy decision:block both
// block, top-level permissionDecision executes anyway).
// ADR-0009 Q5: only intercept ans_* tools.

import { isAnsTool, callServer, unwrapToolResponse, type HookDecision } from "../core.js";
// ADR-0059 D7 (T-6.3): resolve the shared server token (env or the 0600 token file).
import { resolveServerToken } from "../../server/token.js";
import { makePostToolUseDecision } from "../distill.js";
import { makePreToolUseDecision } from "../preheat.js";

interface ClaudeHookStdin {
  // ADR-0066: real Claude Code injects hook_event_name; keep event as legacy fallback.
  hook_event_name?: string;
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

  const event = stdin.hook_event_name ?? stdin.event ?? "";
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
      // ADR-0054 D4 + R66 ER-2: every PreToolUse decision key goes inside the
      // hookSpecificOutput envelope (official names: additionalContext,
      // updatedToolInput, permissionDecision, permissionDecisionReason).
      const hookSpecificOutput: Record<string, unknown> = { hookEventName: "PreToolUse" };
      if (decision.additionalContext) hookSpecificOutput.additionalContext = decision.additionalContext;
      if (decision.updatedInput) hookSpecificOutput.updatedToolInput = decision.updatedInput;
      if (decision.permission) {
        hookSpecificOutput.permissionDecision = decision.permission;
        if (decision.permissionReason) hookSpecificOutput.permissionDecisionReason = decision.permissionReason;
      }
      if (Object.keys(hookSpecificOutput).length > 1) {
        process.stdout.write(JSON.stringify({ hookSpecificOutput }));
      }
      process.exit(0);
    } else if (event === "PostToolUse") {
      // Parse tool response — unwrap content-block envelopes (shared with
      // CodeBuddy's array-of-blocks shape, R65 F-09).
      let toolOutput: Record<string, unknown> = {};
      const un = unwrapToolResponse(stdin.tool_response);
      if (un.kind === "string") {
        try { toolOutput = JSON.parse(un.text!); } catch { toolOutput = { text: un.text }; }
      } else if (un.kind === "object") {
        toolOutput = un.object!;
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
      const token = resolveServerToken().token;
      if (decision.shouldIndex && decision.indexEntries && decision.indexEntries.length > 0) {
        await callServer(serverUrl + "/index", token, {
          projectPath: cwd,
          toolName,
          entries: decision.indexEntries,
        }, { sessionId: stdin.session_id || "" }).catch(() => null);
      }

      // Return distilled output to Claude. PostToolUse has no output-rewrite
      // field on Claude — the only honored channel is
      // hookSpecificOutput.additionalContext (R66 ER-2: top-level
      // updatedToolOutput is dropped), so the distilled summary goes there.
      if (decision.distilledOutput) {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PostToolUse",
            additionalContext: decision.distilledOutput,
          },
        }));
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
