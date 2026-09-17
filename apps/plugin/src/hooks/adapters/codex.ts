// Codex CLI hooks adapter.
// Verified on codex-cli 0.142.5 (R67 T1): Codex only honors the
// hookSpecificOutput envelope — bare top-level { additionalContext } is dropped
// ~80% of the time, bare { permissionDecision } never blocks, and exit code 2
// does NOT block tool calls. Deny must go through the envelope.
// PreToolUse and PostToolUse supported; SessionStart is session-start.ts with
// the --envelope flag (generated codex config passes it).

import { isAnsTool, callServer, unwrapToolResponse } from "../core.js";
// ADR-0059 D7 (T-6.3): resolve the shared server token (env or the 0600 token file).
import { resolveServerToken } from "../../server/token.js";
import { makePostToolUseDecision } from "../distill.js";
import { makePreToolUseDecision } from "../preheat.js";

interface CodexHookStdin {
  // ADR-0066: prefer the real host field hook_event_name; event kept as fallback.
  hook_event_name?: string;
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

  const event = stdin.hook_event_name ?? stdin.event ?? "";
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
      // R67 T1: single envelope carrying every PreToolUse key — Codex honors
      // hookSpecificOutput.{additionalContext, permissionDecision,
      // permissionDecisionReason}; bare top-level fields are ignored.
      const hookSpecificOutput: Record<string, unknown> = { hookEventName: "PreToolUse" };
      if (decision.additionalContext) hookSpecificOutput.additionalContext = decision.additionalContext;
      if (decision.permission) {
        // Envelope deny verified on codex 0.142.5 (T1-B); bare fields and
        // exit code 2 do not block. ask passes through; codex resolves it.
        hookSpecificOutput.permissionDecision = decision.permission;
        if (decision.permissionReason) hookSpecificOutput.permissionDecisionReason = decision.permissionReason;
      }
      if (decision.additionalContext || decision.permission) {
        process.stdout.write(JSON.stringify({ hookSpecificOutput }));
      }
      process.exit(0);
    } else if (event === "PostToolUse") {
      // R65 F-A5: same array-of-blocks tolerance as CodeBuddy/Claude — unwrap
      // content-block envelopes before distilling (F-09 class defect).
      const un = unwrapToolResponse(stdin.tool_response);
      let toolOutput: Record<string, unknown> = {};
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

      const serverUrl = process.env.ANS_SERVER_URL || "http://127.0.0.1:33333";
      const token = resolveServerToken().token;
      if (decision.shouldIndex && decision.indexEntries) {
        await callServer(serverUrl + "/index", token, {
          projectPath: cwd, toolName, entries: decision.indexEntries,
        }, { sessionId: stdin.session_id || "" }).catch(() => null);
      }

      // R67 T1: PostToolUse context injection requires the envelope too —
      // bare { additionalContext } was dropped on the real host.
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
    process.stderr.write("[anysearch] hook error: " + (e instanceof Error ? e.message : String(e)) + "\n");
    process.exit(0);
  }
}

main();
