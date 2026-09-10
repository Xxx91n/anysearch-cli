// PreToolUse: recall_memory preheating inject.
// ADR-0009 Q7=B: before ans_search/ans_research runs, inject relevant memories
// from project index so the agent has context before making the call.
// ADR-0055 D4: URL authorization policy comes from the server's single parse point
// (GET /policy) or the materialized cache — hooks NEVER read ANS_URL_ALLOWLIST directly.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isAnsTool, callServer, type HookInput, type HookDecision } from "./core.js";

interface PolicyCache {
  allow: string[];
  deny: string[];
  policy_version: string;
}

function policyCachePath(): string {
  return join(process.cwd(), ".anysearch-cli", "policy.json");
}

// D4 pull-through cache semantics: try the live server first (which also rewrites the
// cache atomically and only when reachable+changed); fall back to the materialized cache.
// Returns null only when no cache exists AND the server is unreachable.
export async function readPolicy(serverUrl: string, token: string): Promise<PolicyCache | null> {
  let cached: PolicyCache | null = null;
  try {
    const parsed = JSON.parse(readFileSync(policyCachePath(), "utf8")) as Partial<PolicyCache>;
    if (Array.isArray(parsed.allow) && Array.isArray(parsed.deny) && typeof parsed.policy_version === "string") {
      cached = parsed as PolicyCache;
    }
  } catch { /* no usable cache */ }
  try {
    const res = await fetch(serverUrl + "/policy", {
      headers: { Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const fresh = (await res.json()) as PolicyCache;
      // Version comparison is the drift signal; server already rewrote the cache file.
      if (!cached || fresh.policy_version !== cached.policy_version) return fresh;
      return cached;
    }
  } catch { /* server unreachable -> use cache below */ }
  return cached;
}

export async function makePreToolUseDecision(input: HookInput): Promise<HookDecision> {
  if (!isAnsTool(input.toolName)) {
    return {};
  }

  const serverUrl = process.env.ANS_SERVER_URL || "http://127.0.0.1:33333";
  const token = process.env.ANS_SERVER_TOKEN || "";

  // ADR-0054 D4 + ADR-0055: any URL in the tool input is gated against the resolved
  // policy. D4 fail-closed: no cache AND server unreachable -> ask for every URL.
  // D2: deny is a first-class channel evaluated last; it overrides any allow match.
  {
    const urls = JSON.stringify(input.toolInput ?? {}).match(/https?:\/\/[^\s"'<>\\)]+/g) ?? [];
    if (urls.length > 0) {
      const policy = await readPolicy(serverUrl, token);
      for (const url of urls) {
        let host = "";
        try { host = new URL(url).hostname.toLowerCase(); } catch { continue; }
        if (policy === null) {
          return {
            permission: "ask",
            permissionReason: "URL policy unavailable (server unreachable, no cache) — asking for: " + url,
          };
        }
        const denied = policy.deny.some((h) => host === h || host.endsWith("." + h));
        if (denied) {
          return { permission: "deny", permissionReason: "URL host on denylist: " + url };
        }
        const allowed = policy.allow.some((h) => host === h || host.endsWith("." + h));
        if (!allowed) {
          return {
            permission: "ask",
            permissionReason: "URL not on allowlist: " + url +
              " (persistent allow: ans hitl review --allow-url " + host + ")",
          };
        }
      }
    }
  }

  const query = String(input.toolInput?.query || "");
  if (!query) return {};

  // Ask long-running server to recall from project index.
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
