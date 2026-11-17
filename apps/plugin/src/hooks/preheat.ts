// PreToolUse: recall_memory preheating inject.
// Q7=B: before ans_search/ans_research runs, inject relevant memories
// from project index so the agent has context before making the call.
// URL authorization policy comes from the server's single parse point
// (GET /policy) or the materialized cache — hooks NEVER read ANS_URL_ALLOWLIST directly.
//
// Both the policy and the recall belong to the explicit project this hook runs
// in. When that project cannot be identified, the hook says the project-scoped
// capability is unavailable: URL calls ask (fail-closed) and no recall runs.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isAnsTool, callServer, type HookInput, type HookDecision } from "./core.js";
import { resolveHookProject } from "./project-identity.js";
// the server never runs open; resolve the installation token and published address.
import { resolveServerEndpoint } from "../server/token.js";

interface PolicyCache {
  allow: string[];
  deny: string[];
  policy_version: string;
}

function policyCachePath(projectRoot: string): string {
  return join(projectRoot, ".anysearch-cli", "policy.json");
}

// canonical hash mirror of packages/store/src/url-policy.ts canonicalVersion() - the STORE
// implementation is authoritative for this digest; this inlined copy exists only because hook
// bundles must stay dependency-free (esbuild --bundle breaks on the store index's native deps),
// and policy.test.ts guards drift by comparing the two implementations through the cache
// round-trip. Change the store version first, then mirror it here.
function canonicalVersion(allow: readonly string[], deny: readonly string[]): string {
  const canon = (h: readonly string[]) => [...new Set(h.map((x) => x.trim().toLowerCase()).filter(Boolean))].sort();
  return createHash("sha256").update(JSON.stringify({ allow: canon(allow), deny: canon(deny) })).digest("hex");
}

// cache integrity self-check — the sha256 of the content must match
// the self-declared policy_version before the cache is trusted (a damaged drop-in is rejected).
function usableCache(parsed: Partial<PolicyCache>): PolicyCache | null {
  if (!Array.isArray(parsed.allow) || !Array.isArray(parsed.deny) || typeof parsed.policy_version !== "string") return null;
  return canonicalVersion(parsed.allow, parsed.deny) === parsed.policy_version ? (parsed as PolicyCache) : null;
}

// D4 pull-through cache semantics: the live server is authoritative when reachable (it
// also rewrote the cache atomically). The cache is a fallback only, consumed only with
// the integrity self-check. Returns null when neither source is usable. Both the request
// and the fallback are scoped to projectRoot, so one project's rules never answer another.
export async function readPolicy(serverUrl: string, token: string, projectRoot: string): Promise<PolicyCache | null> {
  try {
    const res = await fetch(serverUrl + "/policy?project=" + encodeURIComponent(projectRoot), {
      headers: { Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) return (await res.json()) as PolicyCache;
    // Audit M3: a reachable-but-failing server is a distinct signal, not silent cache reuse.
    process.stderr.write("[anysearch] GET /policy returned HTTP " + res.status + "; falling back to cached policy\n");
  } catch { /* server unreachable -> cache fallback */ }
  try {
    return usableCache(JSON.parse(readFileSync(policyCachePath(projectRoot), "utf8")) as Partial<PolicyCache>);
  } catch { /* no readable cache */ }
  return null;
}

export async function makePreToolUseDecision(input: HookInput): Promise<HookDecision> {
  if (!isAnsTool(input.toolName)) {
    return {};
  }

  const project = resolveHookProject(input.projectPath || process.cwd());

  // +: any URL in the tool input is gated against the resolved
  // policy. D4 fail-closed: no cache AND server unreachable -> ask for every URL.
  // D2: deny is a first-class channel evaluated last; it overrides any allow match.
  {
    const urls = JSON.stringify(input.toolInput ?? {}).match(/https?:\/\/[^\s"'<>\\)]+/g) ?? [];
    if (urls.length > 0) {
      if (!project.root) {
        return {
          permission: "ask",
          permissionReason: "URL policy unavailable: project identity unknown (" + (project.reason ?? "no Git root or .anysearch/config.toml") + ")",
        };
      }
      const endpoint = resolveServerEndpoint();
      const policy = await readPolicy(endpoint.url, endpoint.token, project.root);
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

  // No project identity: say the project index is unavailable instead of
  // reading another project's rows or this process's start directory.
  if (!project.root) {
    return {
      additionalContext: "[anysearch] project index unavailable: " + (project.reason ?? "no Git root or .anysearch/config.toml") +
        " (run from a project root, or add .anysearch/config.toml)",
    };
  }

  // Ask long-running server to recall from project index.
  // thread the host-supplied session_id into the outbound
  // callServer call so the server can link the /recall response to the same
  // logical session as the inbound hook invocation.
  const endpoint = resolveServerEndpoint();
  const result = await callServer(endpoint.url + "/recall", endpoint.token, {
    query,
    projectPath: project.root,
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
