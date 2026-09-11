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
import { createHash } from "node:crypto";

const PORT = Number(process.env.ANS_SERVER_PORT || 33333);
const HOST = process.env.ANS_SERVER_HOST || "127.0.0.1";
const TOKEN = process.env.ANS_SERVER_TOKEN || "";
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

function authed(req: IncomingMessage): boolean {
  if (!TOKEN) return true; // No token configured = open (dev mode).
  const auth = req.headers.authorization;
  return auth === "Bearer " + TOKEN;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", chunk => data += chunk);
    req.on("end", () => resolve(data));
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // CORS for local dev.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
    // ADR-0009 D6: fail-open.
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  }
});

server.listen(PORT, HOST, () => {
  process.stderr.write("[anysearch] Plugin server listening on http://" + HOST + ":" + PORT + "\n");
});

// Graceful shutdown.
process.on("SIGINT", () => { store.close(); server.close(); process.exit(0); });
process.on("SIGTERM", () => { store.close(); server.close(); process.exit(0); });
