// CodeBuddy Code hooks adapter.
// CodeBuddy hook contract (R65 grill-verified, CodeBuddy Code 2.149.0):
//   stdin:  hook_event_name (NOT event) + tool_name/tool_input/tool_response/session_id/cwd
//   stdout: decisions via hookSpecificOutput envelope
//           { permissionDecision | additionalContext | updatedToolOutput }
//   SessionStart: raw stdout text is injected into context verbatim (no envelope).
//   settings schema: { matcher, hooks: [{ type: "command", command: <bash string> }] }
//   Windows: hook commands are forced through Git Bash.
// ADR-0009 Q5: only intercept ans_* tools. ADR-0009 D6: fail-open — exit 0 on any error.
// ADR-0066: `hook_event_name ?? event` fallback so a legacy `event`-shaped host still works.

import { isAnsTool, callServer, unwrapToolResponse } from "../core.js";
// ADR-0059 D7 (T-6.3): resolve the shared server token (env or the 0600 token file).
import { resolveServerToken } from "../../server/token.js";
import { makePostToolUseDecision } from "../distill.js";
import { makePreToolUseDecision } from "../preheat.js";
// ADR-0012 D14: routing card imported from the shared module (one source, two outputs).
import { DEFAULT_ROUTING_CARD as ROUTING_CARD } from "../routing-card.js";

interface CodeBuddyHookStdin {
  hook_event_name?: string;
  event?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: { content?: Array<{ text?: string }> } | Record<string, unknown> | string;
  cwd?: string;
  session_id?: string;
}

async function main(): Promise<void> {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let stdin: CodeBuddyHookStdin;
  try {
    stdin = JSON.parse(input);
  } catch {
    // Fail-open: unparseable stdin = pass through.
    process.exit(0);
  }

  const event = stdin.hook_event_name ?? stdin.event ?? "";
  const toolName = stdin.tool_name || "";
  const cwd = stdin.cwd || process.cwd();

  // SessionStart: raw stdout goes straight into the host context (no envelope).
  // ponytail: no .mdc fallback here — CodeBuddy reads CODEBUDDY.md, and ADR-0011 D6
  // forbids writing host rule files; the routing card text is the injection channel.
  if (event === "SessionStart") {
    process.stdout.write(ROUTING_CARD);
    process.exit(0);
  }

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
      // ponytail: the envelope carries only the three CodeBuddy-documented keys;
      // Claude's hookEventName is deliberately omitted pending live-host verification
      // (documented CodeBuddy shape is {permissionDecision|additionalContext|updatedToolOutput}).
      const hookSpecificOutput: Record<string, unknown> = {};
      if (decision.additionalContext) hookSpecificOutput.additionalContext = decision.additionalContext;
      if (decision.updatedInput) hookSpecificOutput.updatedInput = decision.updatedInput;
      if (decision.permission) {
        hookSpecificOutput.permissionDecision = decision.permission;
        if (decision.permissionReason) hookSpecificOutput.permissionDecisionReason = decision.permissionReason;
      }
      if (Object.keys(hookSpecificOutput).length > 0) {
        process.stdout.write(JSON.stringify({ hookSpecificOutput }));
      }
      process.exit(0);
    } else if (event === "PostToolUse") {
      // CodeBuddy sends tool_response as an ARRAY of content blocks
      // [{type:"text",text:"<json>"}] (verified live, R65 F-09); accept the
      // Claude object/string shapes too via the shared unwrapper.
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

      // Return distilled output inside the envelope.
      if (decision.distilledOutput) {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: { updatedToolOutput: decision.distilledOutput },
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
