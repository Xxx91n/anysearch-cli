// Claude Code hooks adapter.
// Claude Code hooks: stdin JSON, stdout JSON, exit 0/2/other.
// PreToolUse: hook_event_name=PreToolUse, tool_name, tool_input, cwd, session_id
// PostToolUse: hook_event_name=PostToolUse, tool_name, tool_input, tool_response, cwd, session_id
// JSON output (verified on Claude Code 2.1.251): ALL decision keys
// must sit inside the hookSpecificOutput envelope — bare top-level
// additionalContext/updatedToolOutput/permissionDecision are silently dropped
// by the host (proven by deny-sentinels: envelope + legacy decision:block both
// block, top-level permissionDecision executes anyway).
// Q5: only intercept ans_* tools.

import { isAnsTool, unwrapToolResponse } from "../core.js";
import { resolveHookProject } from "../project-identity.js";
import { indexToProject } from "../index-entries.js";
import { makePostToolUseDecision } from "../distill.js";
import { makePreToolUseDecision } from "../preheat.js";
import { claudePreToolUseOutput } from "./claude-envelope.js";

interface ClaudeHookStdin {
  // real Claude Code injects hook_event_name; keep event as legacy fallback.
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
  // The project is resolved once; an unknown identity stays empty so the hook
  // reports the capability as unavailable instead of borrowing another scope.
  const projectRoot = resolveHookProject(cwd).root;

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
        projectPath: projectRoot ?? "",
        sessionId: stdin.session_id || "",
      });
      // ER-2: every PreToolUse decision key goes inside the hookSpecificOutput
      // envelope. The names are the host's; claude-envelope.ts holds them and
      // its test pins them.
      const output = claudePreToolUseOutput(decision);
      if (output) process.stdout.write(JSON.stringify(output));
      process.exit(0);
    } else if (event === "PostToolUse") {
      // Parse tool response — unwrap content-block envelopes (shared with
      // CodeBuddy's array-of-blocks shape).
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
        projectPath: projectRoot ?? "",
        sessionId: stdin.session_id || "",
      });

      // Send to server for indexing (fail-open). A project-less hook does not index.
      await indexToProject(projectRoot, toolName, decision.indexEntries, stdin.session_id || "");

      // Return distilled output to Claude. PostToolUse has no output-rewrite
      // field on Claude — the only honored channel is
      // hookSpecificOutput.additionalContext (ER-2: top-level
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
    // fail-open. stderr warn, exit 0, raw output passes through.
    process.stderr.write("[anysearch] hook error: " + (e instanceof Error ? e.message : String(e)) + "\n");
    process.exit(0);
  }
}

main();
