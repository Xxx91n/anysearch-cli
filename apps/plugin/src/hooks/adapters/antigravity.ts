// Antigravity CLI (agy) hooks adapter.
// ADR-0011 D8: Antigravity has no SessionStart equivalent; .mdc rule file
// fallback still runs on every invocation.
//
// ADR-0069 D4 / R68 T3: contract verified live against agy 1.2.5 headless
// (evidence: .scratch/grill-round-68/evidence/t3-*):
//   * hooks.json = named-hook map { "<name>": { "<Event>": [
//     { matcher, hooks: [{type:"command", command, timeout}] }] } };
//     the Gemini-legacy {hooks:{...}} wrapper FAILS to parse
//     ("command hook must specify 'command'").
//   * stdin is camelCase: conversationId (not session_id),
//     toolCall{name,args} (not tool_name/tool_input), workspacePaths,
//     transcriptPath, artifactDirectoryPath, modelName, stepIdx.
//     No hook_event_name field exists — the event travels via argv
//     (`ans-hook-antigravity <Event>`), stdin fields are kept as fallback.
//   * PostToolUse carries NO tool output — only toolCall + error.
//   * stdout is strict protojson:
//     - PreToolUse: {} = DENY (decision is required); empty stdout = allow;
//       {decision: allow|deny|ask|force_ask|deny_unless_prior_grant, reason?,
//        permissionOverrides?}. Unknown fields reject (protojson strict).
//     - PostToolUse: must emit {} (only compliant shape).
//     - PreInvocation/PostInvocation: {injectSteps:[{ephemeralMessage|
//       userMessage|toolCall}]} is the context-injection channel; PostInvocation
//       also accepts terminationBehavior.
//     - Stop: {decision:"continue", reason} re-enters the loop; {} stops.
//   * Pending-context staging: Pre/PostToolUse cannot inject context, so
//     preheat/distill text is staged to
//     <artifactDirectoryPath>/anysearch-pending.jsonl and flushed as
//     ephemeralMessage injectSteps by the next invocation event.

import { isAnsTool, callServer, unwrapToolResponse } from "../core.js";
// ADR-0059 D7 (T-6.3): resolve the shared server token (env or the 0600 token file).
import { resolveServerToken } from "../../server/token.js";
import { makePostToolUseDecision } from "../distill.js";
import { makePreToolUseDecision } from "../preheat.js";
import { existsSync, readFileSync, mkdirSync, appendFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";

// ADR-0012 D14: routing card + MDC content imported from shared routing-card.ts module.
import { DEFAULT_ROUTING_CARD as ROUTING_CARD, ensureMdc } from "../routing-card.js";

interface AntigravityToolCall {
  name?: string;
  args?: Record<string, unknown>;
}

interface AntigravityHookStdin {
  // Verified agy 1.2.5 camelCase fields.
  conversationId?: string;
  toolCall?: AntigravityToolCall;
  stepIdx?: number;
  invocationNum?: number;
  initialNumSteps?: number;
  executionNum?: number;
  terminationReason?: string;
  fullyIdle?: boolean;
  error?: string;
  workspacePaths?: string[];
  transcriptPath?: string;
  artifactDirectoryPath?: string;
  modelName?: string;
  // Legacy/cross-host fallbacks (kept so the adapter still tolerates
  // Gemini-shaped or harness-injected payloads).
  hook_event_name?: string;
  event?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: Record<string, unknown>;
  cwd?: string;
  session_id?: string;
}

// Pending-context staging: tool-event hooks cannot inject context on this
// host (PreToolUse {} = deny; PostToolUse allows only {}), so preheat/distill
// output is staged per-conversation and flushed by the next invocation hook
// as ephemeralMessage injectSteps.
function pendingPath(stdin: AntigravityHookStdin, cwd: string): string {
  const dir = stdin.artifactDirectoryPath || join(cwd, ".antigravity");
  return join(dir, "anysearch-pending.jsonl");
}

function stagePending(stdin: AntigravityHookStdin, cwd: string, text: string): void {
  try {
    const p = pendingPath(stdin, cwd);
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, JSON.stringify({ text }) + "\n", "utf8");
  } catch {
    // Fail-open.
  }
}

function flushPending(stdin: AntigravityHookStdin, cwd: string): string[] {
  const p = pendingPath(stdin, cwd);
  try {
    if (!existsSync(p)) return [];
    const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
    unlinkSync(p);
    const out: string[] = [];
    for (const l of lines) {
      try { const j = JSON.parse(l); if (typeof j.text === "string" && j.text) out.push(j.text); }
      catch { /* skip malformed */ }
    }
    return out;
  } catch {
    return [];
  }
}

// Emit helpers — protojson-strict per event (verified legs).
function emit(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj));
}

// MCP umbrella: agy dispatches MCP calls as toolCall.name="call_mcp_tool"
// with the real tool name inside args. Unwrap before isAnsTool.
function effectiveToolName(name: string, args: Record<string, unknown>): string {
  if (name !== "call_mcp_tool") return name;
  const inner = args.toolName ?? args.tool_name ?? args.name ?? args.tool;
  return typeof inner === "string" ? inner : name;
}

async function main(): Promise<void> {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;

  let stdin: AntigravityHookStdin;
  try { stdin = JSON.parse(input); }
  catch { process.exit(0); }

  // Event via argv on the real host (stdin carries no hook_event_name).
  const event = process.argv[2] || stdin.hook_event_name || stdin.event || "";
  const toolName = effectiveToolName(stdin.toolCall?.name || stdin.tool_name || "", stdin.toolCall?.args || stdin.tool_input || {});
  const toolInput = stdin.toolCall?.args || stdin.tool_input || {};
  const sessionId = stdin.conversationId || stdin.session_id || "";
  const cwd = stdin.workspacePaths?.[0] || stdin.cwd || process.cwd();

  // ADR-0011 D8: generate .mdc on any hook invocation as fallback
  // (SessionStart does not exist on this host). Antigravity rules live under
  // .antigravity/rules/ (parallel to Cursor's .cursor/rules/).
  ensureMdc(cwd, ".antigravity");

  try {
    if (event === "PreToolUse") {
      // Verified: {} = deny, empty = allow, {decision:"allow"} = allow.
      // Always emit an explicit allow — this adapter never gates tools.
      if (isAnsTool(toolName)) {
        const decision = await makePreToolUseDecision({
          event: "PreToolUse",
          toolName,
          toolInput,
          projectPath: cwd,
          sessionId,
        });
        if (decision.additionalContext) stagePending(stdin, cwd, decision.additionalContext);
      }
      emit({ decision: "allow" });
      process.exit(0);
    }

    if (event === "PostToolUse") {
      // Verified: PostToolUse stdin carries toolCall{name,args}+error but NO
      // tool output — distill/index run on args only.
      if (isAnsTool(toolName)) {
        const un = unwrapToolResponse(stdin.tool_output);
        let toolOutput: Record<string, unknown> = {};
        if (un.kind === "string") {
          try { toolOutput = JSON.parse(un.text!); } catch { toolOutput = { text: un.text }; }
        } else if (un.kind === "object") {
          toolOutput = un.object!;
        }
        const decision = makePostToolUseDecision({
          event: "PostToolUse",
          toolName,
          toolInput,
          toolOutput,
          projectPath: cwd,
          sessionId,
        });

        const serverUrl = process.env.ANS_SERVER_URL || "http://127.0.0.1:33333";
        const token = resolveServerToken().token;
        if (decision.shouldIndex && decision.indexEntries) {
          await callServer(serverUrl + "/index", token, {
            projectPath: cwd, toolName, entries: decision.indexEntries,
          }, { sessionId }).catch(() => null);
        }

        if (decision.distilledOutput) stagePending(stdin, cwd, decision.distilledOutput);
      }
      // Only compliant shape.
      emit({});
      process.exit(0);
    }

    if (event === "PreInvocation" || event === "PostInvocation") {
      // Context-injection channel: injectSteps.ephemeralMessage reaches the
      // model (verified). Routing card rides the first invocation only —
      // session-start equivalent on a host with no SessionStart event.
      const steps: Array<{ ephemeralMessage: string }> = [];
      if (event === "PreInvocation" && stdin.invocationNum === 0) {
        steps.push({ ephemeralMessage: ROUTING_CARD });
      }
      for (const text of flushPending(stdin, cwd)) steps.push({ ephemeralMessage: text });
      emit(steps.length ? { injectSteps: steps } : {});
      process.exit(0);
    }

    // Stop / SessionStart (forward-compat) / unknown — emit {}.
    emit({});
    process.exit(0);
  } catch (e) {
    process.stderr.write("[anysearch] hook error: " + (e instanceof Error ? e.message : String(e)) + "\n");
    // Fail-open must not block a tool call: PreToolUse {} would deny, so the
    // error path emits an explicit allow there and {} elsewhere.
    emit(event === "PreToolUse" ? { decision: "allow" } : {});
    process.exit(0);
  }
}

main();
