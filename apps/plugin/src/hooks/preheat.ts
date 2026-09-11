// PreToolUse: recall_memory preheating inject.
// ADR-0009 Q7=B: before ans_search/ans_research runs, inject relevant memories
// from project index so the agent has context before making the call.
// ADR-0055 D4: URL authorization policy comes from the server's single parse point
// (GET /policy) or the materialized cache — hooks NEVER read ANS_URL_ALLOWLIST directly.

import { createHash } from "node:crypto";
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

// canonical hash mirror of packages/store/src/url-policy.ts canonicalVersion().
// Hook bundles must stay dependency-free (esbuild --bundle breaks on the store index's
// native deps), so this is an inlined copy; policy.test.ts guards drift by comparing
// the two implementations through the cache round-trip.
function canonicalVersion(allow: readonly string[], deny: readonly string[]): string {
  const canon = (h: readonly string[]) => [...new Set(h.map((x) => x.trim().toLowerCase()).filter(Boolean))].sort();
  return createHash("sha256").update(JSON.stringify({ allow: canon(allow), deny: canon(deny) })).digest("hex");
}

// ADR-0055 audit M4: cache integrity self-check — the sha256 of the content must match
// the self-declared policy_version before the cache is trusted (tampered drop-in rejected).
function usableCache(parsed: Partial<PolicyCache>): PolicyCache | null {
  if (!Array.isArray(parsed.allow) || !Array.isArray(parsed.deny) || typeof parsed.policy_version !== "string") return null;
  return canonicalVersion(parsed.allow, parsed.deny) === parsed.policy_version ? (parsed as PolicyCache) : null;
}

// D4 pull-through cache semantics: the live server is authoritative when reachable (it
// also rewrote the cache atomically). The cache is a fallback only, consumed only with
// the integrity self-check. Returns null when neither source is usable.
export async function readPolicy(serverUrl: string, token: string): Promise<PolicyCache | null> {
  try {
    const res = await fetch(serverUrl + "/policy", {
      headers: { Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) return (await res.json()) as PolicyCache;
    // Audit M3: a reachable-but-failing server is a distinct signal, not silent cache reuse.
    process.stderr.write("[anysearch] GET /policy returned HTTP " + res.status + "; falling back to cached policy\n");
  } catch { /* server unreachable -> cache fallback */ }
  try {
    return usableCache(JSON.parse(readFileSync(policyCachePath(), "utf8")) as Partial<PolicyCache>);
  } catch { /* no readable cache */ }
  return null;
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
  // ADR-0056 D-003: thread the host-supplied session_id into the outbound
  // callServer call so the server can link the /recall response to the same
  // logical session as the inbound hook invocation.
  const result = await callServer(serverUrl + "/recall", token, {
    query,
    projectPath: input.projectPath,
    limit: 3,
  }, { sessionId: input.sessionId });

  if (!result || !result.hits || !Array.isArray(result.hits) || result.hits.length === 0) {
    return {};
  }

  // Inject as additional context for the host agent.
  const hits = (result.hits as Array<{ title: string; url: string; snippet: string }>);
  const contextLines = hits.map(h => "- " + h.title + ": " + (h.snippet || "").slice(0, 200));
  const additionalContext = "[anysearch preheat] Relevant prior results from project index:\n" + contextLines.join("\n");

  return { additionalContext };
}
