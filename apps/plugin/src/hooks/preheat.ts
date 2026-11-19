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
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { isAnsTool, callServer, type HookInput, type HookDecision } from "./core.js";
import { resolveHookProject } from "./project-identity.js";
// the server never runs open; resolve the installation token and published address.
import { resolveServerEndpoint } from "../server/token.js";

interface PolicyCacheSource {
  path: string;
  version: string;
}

interface PolicyCache {
  allow: string[];
  deny: string[];
  policy_version: string;
  /** Present on a materialized cache; absent on a live server answer. */
  materialized_at?: string;
  project_root?: string;
  domain_name?: string;
  sources?: PolicyCacheSource[];
}

/** What the hook actually got, and where it came from. */
export interface ResolvedPolicy {
  allow: string[];
  deny: string[];
  policy_version: string;
  from: "server" | "cache";
  materialized_at?: string;
}

// A long-lived host (the dsh plugin) calls this once per tool call, so the
// cache notice below is worth saying once rather than on every call.
let warnedCacheFallback = false;

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

// Same identity the store's fileVersion() computes; mirrored here for the same
// reason as canonicalVersion above.
function fileVersion(path: string): string {
  try {
    const s = statSync(path);
    return s.mtimeMs + ":" + s.ctimeMs;
  } catch {
    return "-1";
  }
}

function realpathOrSelf(path: string): string {
  try { return realpathSync(path); } catch { return path; }
}

// #306: a cache is usable only when it can be shown to describe THIS project's
// CURRENT declaration. The hash self-check alone proves the file was not edited
// by hand; it says nothing about whether the policy it holds is still the one
// the TOML declares. So the envelope must name the project and the files it was
// materialized from, and every one of those files must still have the same
// version. Anything less is a guess, and a guess here is a URL decision.
function usableCache(parsed: Partial<PolicyCache>, projectRoot: string, domainName: string): PolicyCache | null {
  if (!Array.isArray(parsed.allow) || !Array.isArray(parsed.deny) || typeof parsed.policy_version !== "string") return null;
  if (canonicalVersion(parsed.allow, parsed.deny) !== parsed.policy_version) return null;
  if (typeof parsed.project_root !== "string" || !parsed.project_root) return null;
  if (realpathOrSelf(parsed.project_root) !== realpathOrSelf(projectRoot)) return null;
  // Same project, same files, a different Active Domain: the cached allowlist
  // describes a declaration this project no longer uses.
  if (parsed.domain_name !== domainName) return null;
  if (!Array.isArray(parsed.sources) || parsed.sources.length === 0) return null;
  for (const source of parsed.sources) {
    if (!source || typeof source.path !== "string" || typeof source.version !== "string") return null;
    if (fileVersion(source.path) !== source.version) return null;
  }
  return parsed as PolicyCache;
}

// D4 pull-through cache semantics: the live server is authoritative when reachable (it
// also rewrote the cache atomically). The cache is a fallback only, consumed only with
// the integrity self-check AND the applicability check above. Returns null when neither
// source is usable — the caller then asks instead of allowing. Both the request and the
// fallback are scoped to projectRoot, so one project's rules never answer another.
export async function readPolicy(serverUrl: string, token: string, projectRoot: string): Promise<ResolvedPolicy | null> {
  // The domain the hook is asking about is the one this host process would use.
  const domainName = process.env.ANS_DOMAIN?.trim() || "default";
  try {
    const res = await fetch(serverUrl + "/policy?project=" + encodeURIComponent(projectRoot), {
      headers: { Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const body = (await res.json()) as PolicyCache;
      return { allow: body.allow, deny: body.deny, policy_version: body.policy_version, from: "server" };
    }
    // Audit M3: a reachable-but-failing server is a distinct signal, not silent cache reuse.
    process.stderr.write("[anysearch] GET /policy returned HTTP " + res.status + "; falling back to cached policy\n");
  } catch { /* server unreachable -> cache fallback */ }
  let cached: PolicyCache | null = null;
  try {
    cached = usableCache(JSON.parse(readFileSync(policyCachePath(projectRoot), "utf8")) as Partial<PolicyCache>, projectRoot, domainName);
  } catch { /* no readable cache */ }
  if (!cached) return null;
  // Say it out loud: the rules in force come from a copy, not from the project's
  // current declaration. The caller puts this in front of the user too.
  if (!warnedCacheFallback) {
    warnedCacheFallback = true;
    process.stderr.write(
      "[anysearch] server unreachable; using this project's cached URL policy materialized_at=" +
      (cached.materialized_at ?? "unknown") + "\n",
    );
  }
  return {
    allow: cached.allow,
    deny: cached.deny,
    policy_version: cached.policy_version,
    from: "cache",
    ...(cached.materialized_at ? { materialized_at: cached.materialized_at } : {}),
  };
}

export async function makePreToolUseDecision(input: HookInput): Promise<HookDecision> {
  if (!isAnsTool(input.toolName)) {
    return {};
  }

  // Adapters pass the resolved project root, or "" when the host did not name
  // a single project. An empty value stays unknown: the hook process's own
  // start directory must not stand in for the request's project (S3).
  const project = input.projectPath.trim()
    ? resolveHookProject(input.projectPath)
    : { root: null, source: "unknown" as const, reason: "the host did not name a project" };
  const projectRoot = project.root;
  const projectReason = project.reason ?? "no Git root or .anysearch/config.toml";

  // +: any URL in the tool input is gated against the resolved
  // policy. D4 fail-closed: no cache AND server unreachable -> ask for every URL.
  // D2: deny is a first-class channel evaluated last; it overrides any allow match.
  // #306: "提示后使用" — when a cached policy is what answered, the decision is
  // allowed to stand, but the user is told it rests on a snapshot. On the allow
  // path nothing else would ever say it: there is no ask and no deny to carry
  // the note, so it rides additionalContext instead.
  let cachedPolicyNote: string | undefined;
  {
    const urls = JSON.stringify(input.toolInput ?? {}).match(/https?:\/\/[^\s"'<>\\)]+/g) ?? [];
    if (urls.length > 0) {
      if (!projectRoot) {
        return {
          permission: "ask",
          permissionReason: "URL policy unavailable: project identity unknown (" + projectReason + ")",
        };
      }
      const endpoint = resolveServerEndpoint();
      const policy = await readPolicy(endpoint.url, endpoint.token, projectRoot);
      // #306: when the answer came from the cache, the reason has to say so —
      // a user deciding whether to allow a URL needs to know the rules are a
      // snapshot, not this project's current declaration.
      const cacheNote = policy?.from === "cache"
        ? "（规则来自 " + (policy.materialized_at ?? "更早") + " 的缓存，服务没连上）"
        : "";
      if (cacheNote) cachedPolicyNote = "[anysearch] 这次判断网址规则用的是缓存" + cacheNote + "，不是当前项目的实时规则。";
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
          return { permission: "deny", permissionReason: "URL host on denylist: " + url + cacheNote };
        }
        const allowed = policy.allow.some((h) => host === h || host.endsWith("." + h));
        if (!allowed) {
          return {
            permission: "ask",
            permissionReason: "URL not on allowlist: " + url +
              " (persistent allow: ans hitl review --allow-url " + host + ")" + cacheNote,
          };
        }
      }
    }
  }

  const query = String(input.toolInput?.query || "");
  if (!query) return cachedPolicyNote ? { additionalContext: cachedPolicyNote } : {};

  // No project identity: say the project index is unavailable instead of
  // reading another project's rows or this process's start directory.
  if (!projectRoot) {
    return {
      additionalContext: [cachedPolicyNote, "[anysearch] project index unavailable: " + projectReason +
        " (run from a project root, or add .anysearch/config.toml)"].filter(Boolean).join("\n"),
    };
  }

  // Ask long-running server to recall from project index.
  // thread the host-supplied session_id into the outbound
  // callServer call so the server can link the /recall response to the same
  // logical session as the inbound hook invocation.
  const endpoint = resolveServerEndpoint();
  const result = await callServer(endpoint.url + "/recall", endpoint.token, {
    query,
    projectPath: projectRoot,
    limit: 3,
  }, { sessionId: input.sessionId });

  if (!result || !result.hits || !Array.isArray(result.hits) || result.hits.length === 0) {
    return cachedPolicyNote ? { additionalContext: cachedPolicyNote } : {};
  }

  // Inject as additional context for the host agent.
  const hits = (result.hits as Array<{ title: string; url: string; snippet: string }>);
  const contextLines = hits.map(h => "- " + h.title + ": " + (h.snippet || "").slice(0, 200));
  const additionalContext = "[anysearch preheat] Relevant prior results from project index:\n" + contextLines.join("\n");

  return {
    additionalContext: cachedPolicyNote
      ? cachedPolicyNote + "\n" + additionalContext
      : additionalContext,
  };
}
