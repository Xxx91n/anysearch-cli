// Anysearch Plugin Server: long-running process for hooks IPC.
// ADR-0009 Decision 1: hooks core handler不碰SQLite. 写库收敛到长驻server进程.
// Endpoints:
//   POST /recall — search project index (for preheat)
//   POST /index — write entries to project index (for PostToolUse distill)
//   GET  /health — liveness check
//   POST /purge — purge project index for a project path
// Bearer token auth on all endpoints.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ProjectIndexStore } from "../store/project-index-store.js";
import { createHash, timingSafeEqual } from "node:crypto";
import { resolveServerToken } from "./token.js";

const PORT = Number(process.env.ANS_SERVER_PORT || 33333);
const HOST = process.env.ANS_SERVER_HOST || "127.0.0.1";
// ADR-0059 D7 (T-6.3): the server never runs open. ANS_SERVER_TOKEN wins; when unset a 256-bit
// token is generated and persisted to .anysearch-cli/server-token (0600) for the local hooks.
const RESOLVED_TOKEN = resolveServerToken();
const TOKEN = RESOLVED_TOKEN.token;
const MAX_BODY_BYTES = 1024 * 1024;
const DB_PATH = process.env.ANS_PROJECT_DB || join(process.cwd(), ".anysearch", "project-index.db");

// Ensure .anysearch dir exists.
import { mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { domainTomlPath, emitConfigChangeAudit, loadPolicyFromToml, resolveUrlPolicy, writePolicyCache, readPolicyCacheEnvelope, type UrlPolicy } from "@anysearch/store";
// ADR-0056 D-003: parseAndValidateHeaders lives in the hook bundle module so
// the wire format stays single-source across hook outbound and server inbound.
import { parseAndValidateHeaders } from "../hooks/propagation.js";
mkdirSync(dirname(DB_PATH), { recursive: true });

// ADR-0055: startup policy parse. D3/D7 fail-closed: TOML parse failure or a misset
// ANS_ALLOW_ENV_OVERRIDE throws here and refuses to start, naming variable + value.
const DOMAIN_TOML = domainTomlPath();
const POLICY_CACHE = join(process.cwd(), ".anysearch-cli", "policy.json");
const OBS_DB = process.env.ANS_DB_PATH ||
  join(process.env.USERPROFILE || process.env.HOME || ".", ".anysearch", "anysearch.db");

// ADR-0056 D-007 / ADR-0055 D6 supplement: on startup, if the policy server is
// unreachable (TOML missing/unreadable), boot from the disk cache and WARN
// rather than refusing to start. The materialized_at timestamp on the cache
// lets operators audit staleness; the policy itself remains in effect.
function readCurrentPolicy(): UrlPolicy {
  if (existsSync(DOMAIN_TOML)) {
    try {
      return loadPolicyFromToml(DOMAIN_TOML);
    } catch (e) {
      // OPA pattern: keep last known good, signal it.
      const cached = readPolicyCacheEnvelope(POLICY_CACHE);
      if (cached) {
        process.stderr.write("[anysearch] WARN: domain TOML parse failed at startup; using cached policy materialized_at=" + cached.materialized_at + ": " + (e instanceof Error ? e.message : String(e)) + "\n");
        return resolveUrlPolicy({ tomlHosts: cached.allow, denyHosts: cached.deny });
      }
      throw e; // no cache -> fail-closed (D3)
    }
  }
  // No TOML -> cached fallback path (same WARN semantics).
  const cached = readPolicyCacheEnvelope(POLICY_CACHE);
  if (cached) {
    process.stderr.write("[anysearch] WARN: domain TOML absent; using cached policy materialized_at=" + cached.materialized_at + "\n");
    return resolveUrlPolicy({ tomlHosts: cached.allow, denyHosts: cached.deny });
  }
  return resolveUrlPolicy({ tomlHosts: [] });
}
let currentPolicyVersion = readCurrentPolicy().policyVersion;
let envIgnoredAudited = false; // D7: config:env_override_ignored once per session

const store = new ProjectIndexStore(DB_PATH);

// ADR-0059 D7 (T-6.3): constant-time bearer compare. A wrong-length token is rejected without
// walking the bytes, so a caller cannot learn a prefix from response timing.
function authed(req: IncomingMessage): boolean {
  const auth = req.headers.authorization;
  if (typeof auth !== "string" || !auth.startsWith("Bearer ")) return false;
  const presented = Buffer.from(auth.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(TOKEN, "utf8");
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

// ADR-0059 D7 (T-6.3): a browser page on any origin can reach 127.0.0.1, so the server refuses a
// non-loopback Host (DNS-rebinding) or a non-loopback Origin (cross-site). A native client sends
// no Origin - those stay allowed.
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
function hostIsLoopback(host: string | undefined): boolean {
  if (!host) return false;
  const bare = host.replace(/^\[/, "[").replace(/\]:\d+$/, "]").replace(/:\d+$/, "").toLowerCase();
  return LOOPBACK_HOSTNAMES.has(bare);
}
function originIsLoopback(origin: string | undefined): boolean {
  if (!origin) return true; // no Origin = native client (allow)
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}

// ADR-0059 D7 (T-6.3): hard body cap - refuse rather than buffer an unbounded body.
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    let bytes = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        // ADR-0059 D7: stop buffering but keep draining so the 413 can still be written.
        tooLarge = true;
        data = "";
        return;
      }
      if (!tooLarge) data += chunk;
    });
    req.on("end", () => {
      if (tooLarge) reject(new Error("request body exceeds " + MAX_BODY_BYTES + " bytes"));
      else resolve(data);
    });
    req.on("error", (e) => reject(e));
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // ADR-0059 D7 (T-6.3): 403-before-401. Host/Origin rejection is a trust-boundary decision and
  // must precede the auth challenge (Resilio model), so a cross-site caller never learns whether a
  // token would have been accepted. CORS is reflected for loopback origins only - never "*".
  const reqOrigin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  const reqHost = typeof req.headers.host === "string" ? req.headers.host : undefined;
  if (!hostIsLoopback(reqHost) || !originIsLoopback(reqOrigin)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "forbidden: non-loopback host/origin" }));
    return;
  }
  if (reqOrigin) {
    res.setHeader("Access-Control-Allow-Origin", reqOrigin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (!authed(req)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  try {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", timestamp: Date.now() }));
      return;
    }

    if (req.url === "/policy" && req.method === "GET") {
      // ADR-0055 D4: single-point parse + push-down. Re-parses TOML per request (event-driven,
      // no TTL); deny channel + policy_version; atomically materializes policy.json for hooks.
      const policy = readCurrentPolicy();
      if (policy.envHostsIgnored) {
        process.stderr.write("[anysearch] WARN: ANS_URL_ALLOWLIST set but ANS_ALLOW_ENV_OVERRIDE not enabled; env hosts ignored\n");
        if (!envIgnoredAudited) {
          envIgnoredAudited = true;
          const incoming2 = parseAndValidateHeaders(req);
          void emitConfigChangeAudit(OBS_DB, {
            actor: "server", source: "env", path: DOMAIN_TOML,
            change: { before: null, after: "config:env_override_ignored" },
            policyVersion: policy.policyVersion,
            traceId: incoming2.traceId,
            sessionId: incoming2.sessionId,
          });
        }
      }
      if (policy.envHostsApplied > 0) {
        process.stderr.write("[anysearch] info: env override active: " + policy.envHostsApplied + " hosts\n");
      }
      if (policy.policyVersion !== currentPolicyVersion) {
        const before = currentPolicyVersion;
        currentPolicyVersion = policy.policyVersion;
        // ADR-0056 D-003 server path: extract traceId/sessionId from inbound
        // headers so the audit row links back to the same logical request the
        // caller initiated. traceparentValid=false means the client sent garbage;
        // parseAndValidateHeaders already substituted a fresh random traceId.
        const incoming = parseAndValidateHeaders(req);
        void emitConfigChangeAudit(OBS_DB, {
          actor: "server", source: "toml", path: DOMAIN_TOML,
          change: { before, after: policy.policyVersion },
          policyVersion: policy.policyVersion,
          traceId: incoming.traceId,
          sessionId: incoming.sessionId,
        });
      }
      const body = { allow: policy.allow, deny: policy.deny, policy_version: policy.policyVersion };
      // ADR-0056 D-007: writePolicyCache stamps materialized_at alongside the
      // policy body so the hook fallback can surface staleness.
      writePolicyCache(POLICY_CACHE, policy);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }

    if (req.url === "/recall" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const query = String(body.query || "");
      const limit = Number(body.limit) || 10;
      if (!query) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "query required" }));
        return;
      }
      const hits = store.search(query, limit);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ hits, provenance: "project-index" }));
      return;
    }

    if (req.url === "/index" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const projectPath = String(body.projectPath || "");
      const toolName = String(body.toolName || "");
      const entries = Array.isArray(body.entries) ? body.entries : [];
      let indexed = 0;
      for (const entry of entries) {
        try {
          store.indexEntry({
            projectPath,
            toolName,
            title: String(entry.title || ""),
            url: String(entry.url || ""),
            snippet: String(entry.snippet || ""),
            source: String(entry.source || "unknown"),
            contentHash: entry.contentHash || createHash("sha256").update(entry.url + entry.title).digest("hex").slice(0, 16),
          });
          indexed++;
        } catch { /* fail-open per entry */ }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ indexed, total: entries.length }));
      return;
    }

    if (req.url === "/purge" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const projectPath = String(body.projectPath || "");
      const deleted = store.purgeProject(projectPath);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ deleted }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // ADR-0059 D7: an oversized body is a client error, not a server fault.
    if (msg.includes("exceeds")) {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: msg }));
      return;
    }
    // ADR-0009 D6: fail-open.
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: msg }));
  }
});

server.listen(PORT, HOST, () => {
  process.stderr.write("[anysearch] Plugin server listening on http://" + HOST + ":" + PORT + "\n");
  if (RESOLVED_TOKEN.generated) {
    process.stderr.write("[anysearch] generated a 256-bit server token at " + RESOLVED_TOKEN.path + " (set ANS_SERVER_TOKEN to pin it)\n");
  }
});

// Graceful shutdown.
process.on("SIGINT", () => { store.close(); server.close(); process.exit(0); });
process.on("SIGTERM", () => { store.close(); server.close(); process.exit(0); });
