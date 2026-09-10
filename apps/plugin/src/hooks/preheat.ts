// PreToolUse: recall_memory preheating inject.
// ADR-0009 Q7=B: before ans_search/ans_research runs, inject relevant memories
// from project index so the agent has context before making the call.

import { isAnsTool, callServer, type HookInput, type HookDecision } from "./core.js";

export async function makePreToolUseDecision(input: HookInput): Promise<HookDecision> {
  if (!isAnsTool(input.toolName)) {
    return {};
  }

  // ADR-0054 D4: any URL in the tool input that is not on the persistent allowlist
  // (ANS_URL_ALLOWLIST, comma-separated hosts) is surfaced as Claude's "ask"
  // permission decision. Provenance: a hook cannot distinguish retrieved-derived from
  // user-typed URLs, and a model-controllable flag would be spoofable — gate all URLs.
  {
    const urls = JSON.stringify(input.toolInput ?? {}).match(/https?:\/\/[^\s"'<>\\)]+/g) ?? [];
    const allowlist = (process.env.ANS_URL_ALLOWLIST || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    for (const url of urls) {
      let host = "";
      try { host = new URL(url).hostname.toLowerCase(); } catch { continue; }
      const allowed = allowlist.some((h) => host === h || host.endsWith("." + h));
      if (!allowed) {
        return {
          permission: "ask",
          permissionReason: "URL not on allowlist: " + url +
            " (persistent allow for this hook: add host to ANS_URL_ALLOWLIST)",
        };
      }
    }
  }

  const query = String(input.toolInput?.query || "");
  if (!query) return {};

  // Ask long-running server to recall from project index.
  const serverUrl = process.env.ANS_SERVER_URL || "http://127.0.0.1:33333";
  const token = process.env.ANS_SERVER_TOKEN || "";

  const result = await callServer(serverUrl + "/recall", token, {
    query,
    projectPath: input.projectPath,
    limit: 3,
  });

  if (!result || !result.hits || !Array.isArray(result.hits) || result.hits.length === 0) {
    return {};
  }

  // Inject as additional context for the host agent.
  const hits = (result.hits as Array<{ title: string; url: string; snippet: string }>);
  const contextLines = hits.map(h => "- " + h.title + ": " + (h.snippet || "").slice(0, 200));
  const additionalContext = "[anysearch preheat] Relevant prior results from project index:\n" + contextLines.join("\n");

  return { additionalContext };
}
