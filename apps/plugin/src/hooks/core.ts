// Hook core handler: platform-agnostic. Does 3 things only (ADR-0009 Decision 2):
// 1. Read-only project感知 (project path from cwd/env)
// 2. IPC to long-running MCP server (HTTP 127.0.0.1 + Bearer token)
// 3. Decision output JSON to host
// No SQLite, no file write, no network (except server IPC), no spawn.

export interface HookInput {
  event: "PreToolUse" | "PostToolUse";
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput?: Record<string, unknown>;
  projectPath: string;
  sessionId: string;
}

export interface HookDecision {
  permission?: "allow" | "deny" | "ask";
  // ADR-0054 D4: reason text for Claude hookSpecificOutput.permissionDecisionReason.
  permissionReason?: string;
  updatedInput?: Record<string, unknown>;
  additionalContext?: string;
  // PostToolUse: distilled summary for host agent
  distilledOutput?: string;
  // Whether to index this tool output to project index
  shouldIndex?: boolean;
  indexEntries?: Array<{
    title: string;
    url: string;
    snippet: string;
    source: string;
    contentHash: string;
  }>;
}

// Pattern: matches any tool name ending with one of our ans_* tool names (handles platform prefixes).
const ANS_TOOL_PATTERN = /(?:^|_|__)(?:search_web|research_web|recall_memory|query_knowledge|ans_chat)$/;

export function isAnsTool(toolName: string): boolean {
  return ANS_TOOL_PATTERN.test(toolName);
}

export async function callServer(
  serverUrl: string,
  bearerToken: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  // ADR-0009 D2: single narrow IPC channel to long-running MCP server.
  // Fail-open: server unreachable = return null, caller放行 raw output.
  try {
    const response = await fetch(serverUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + bearerToken,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    return await response.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

export { ANS_TOOL_PATTERN };
