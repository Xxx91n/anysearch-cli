#!/usr/bin/env node
// Anysearch plugin server: long-running process for hooks IPC.
// hooks core handler不碰SQLite. 写库收敛到长驻server进程.
// Endpoints:
// POST /recall — search project index (for preheat); requires the project scope
// POST /index — write entries to project index (for PostToolUse distill); requires a project
// GET /health — liveness check
// POST /purge — purge project index for one project path
// GET /policy?project=<root> — URL policy for that explicit project
// Bearer token auth on all endpoints.
//
// #307: the index write, the policy audit and the purge are this service's
// POST-WORK. Each runs under a follow-up task row (role=business,
// origin=follow-up, entry=server) in the shared durable DB, and the response
// waits for the row's end. That is what lets upgrade admission (#309) see a
// hook's tail instead of reading an idle service, and it replaces the old
// fire-and-forget audit writes whose completion nothing could observe.
//
// Design: every project-scoped request names its project and the server
// refuses one that cannot — a shared long-running process cannot tell the
// caller's workspace from its own start directory, and guessing would put one
// project's rules or records into another project's answers (S3).
// The bearer token and the published address belong to the installation.
//
// The token and the published address belong to the installation (see
// server/token.ts). The project index is one user-level database; isolation
// comes from the project_path column on every read and write. A request that
// cannot name its project is refused instead of falling back to another
// project's rows or to the directory this process happened to start in.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ProjectIndexStore } from "../store/project-index-store.js";
import { createHash, timingSafeEqual } from "node:crypto";
import { clearServerRegistry, installDataDir, projectIndexDbPath, resolveServerToken, writeServerRegistry } from "./token.js";
import { createPostWorkTracker, openPostWorkRegistry } from "./post-work.js";

const REQUESTED_PORT = Number(process.env.ANS_SERVER_PORT || 33333);
const HOST = process.env.ANS_SERVER_HOST || "127.0.0.1";
// the server never runs open. ANS_SERVER_TOKEN wins; otherwise the installation
// token is generated once under the user config root and shared by every hook.
const RESOLVED_TOKEN = resolveServerToken();
const TOKEN = RESOLVED_TOKEN.token;
const MAX_BODY_BYTES = 1024 * 1024;
const DB_PATH = projectIndexDbPath();

// Ensure the data dir exists.
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { existsSync } from "node:fs";
import { domainTomlPath, emitConfigChangeAudit, ensureOwnerOnlyDb, loadPolicyFromToml, resolveProjectContext, resolveUrlPolicy, writePolicyCache, readPolicyCacheEnvelope, type UrlPolicy } from "@anysearch-cli/store";
// parseAndValidateHeaders lives in the hook bundle module so
// the wire format stays single-source across hook outbound and server inbound.
import { parseAndValidateHeaders } from "../hooks/propagation.js";
// The index holds retrieved snippets; keep its directory and file owner-only
// before the store creates them, then pass again after WAL turns on so the
// sidecars get the same treatment.
try { ensureOwnerOnlyDb(DB_PATH); } catch { mkdirSync(dirname(DB_PATH), { recursive: true }); }
const store = new ProjectIndexStore(DB_PATH);
try { ensureOwnerOnlyDb(DB_PATH); } catch { /* best-effort */ }

const OBS_DB = process.env.ANS_DB_PATH || join(installDataDir(), "anysearch.db");

// #307: this service's post-work runs under task records like every other
// entry. The registry is opened once, on its own connection to the same
// durable DB (the one the policy audit writes), and the service's own lifetime
// is a process record — not a task. A broken registry degrades to "work runs,
// nothing recorded" and says so once; it never stops the service.
const postWork = createPostWorkTracker(openPostWorkRegistry(OBS_DB));
postWork.start();

// CWE-732: tighten OBS_DB to owner-only before emitConfigChangeAudit opens it.
// Lazy: only needed when /policy writes an audit row, not for /recall or /index.
let obsDbEnsured = false;

interface ProjectPolicy {
  policy: UrlPolicy;
  tomlPath: string;
  cachePath: string;
}

// A project's URL policy is read from that project's own domains TOML. The
// parse is per request (event-driven, no TTL), and the materialized cache sits
// inside the same project so a hook in project B never consumes A's rules.
// Missing TOML falls back to the project's own cached copy (with a WARN);
// unreadable TOML with no cache throws and the request fails closed.
function readProjectPolicy(projectRoot: string): ProjectPolicy {
  const tomlPath = domainTomlPath(projectRoot);
  const cachePath = join(projectRoot, ".anysearch-cli", "policy.json");
  if (existsSync(tomlPath)) {
    try {
      return { policy: loadPolicyFromToml(tomlPath), tomlPath, cachePath };
    } catch (e) {
      // OPA pattern: keep last known good, signal it.
      const cached = readPolicyCacheEnvelope(cachePath);
      if (cached) {
        process.stderr.write("[anysearch] WARN: domain TOML parse failed at startup; using cached policy materialized_at=" + cached.materialized_at + ": " + (e instanceof Error ? e.message : String(e)) + "\n");
        return { policy: resolveUrlPolicy({ tomlHosts: cached.allow, denyHosts: cached.deny }), tomlPath, cachePath };
      }
      throw e; // no cache -> fail-closed (D3)
    }
  }
  // No TOML -> cached fallback path (same WARN semantics).
  const cached = readPolicyCacheEnvelope(cachePath);
  if (cached) {
    process.stderr.write("[anysearch] WARN: domain TOML absent; using cached policy materialized_at=" + cached.materialized_at + "\n");
    return { policy: resolveUrlPolicy({ tomlHosts: cached.allow, denyHosts: cached.deny }), tomlPath, cachePath };
  }
  return { policy: resolveUrlPolicy({ tomlHosts: [] }), tomlPath, cachePath };
}
// Last policy version seen per project, so the audit row names the project
// whose rules changed.
const policyVersions = new Map<string, string>();
let envIgnoredAudited = false; // D7: config:env_override_ignored once per session

// T2 #177: this process is intentionally NOT an engine composition entry point. The
// hooks/server surface only touches the project-index store and the policy
// cache; it has no resumable chat/agent session to key a budget ledger row or a
// resume anchor on. Not injecting sessionId/BudgetLedger is therefore the
// declared fail-open path (the engine gates stay closed), not an oversight.
// The wired-session paths are `ans chat` (CLI) and `ans_chat` (MCP).

// constant-time bearer compare. A wrong-length token is rejected without
// walking the bytes, so a caller cannot learn a prefix from response timing.
function authed(req: IncomingMessage): boolean {
  const auth = req.headers.authorization;
  if (typeof auth !== "string" || !auth.startsWith("Bearer ")) return false;
  const presented = Buffer.from(auth.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(TOKEN, "utf8");
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

// a browser page on any origin can reach 127.0.0.1, so the server refuses a
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

// hard body cap - refuse rather than buffer an unbounded body.
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    let bytes = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        // stop buffering but keep draining so the 413 can still be written.
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

type ProjectResolution = { ok: true; root: string } | { ok: false; error: string };

// A client-supplied string is a project only after it resolves to a real
// project root on this machine. An unknown identity is reported, never
// replaced with "some other project" or with this process's start directory.
// The bearer token is the authorization boundary; this check stops accidental
// cross-project use, not a local process that already holds the token.
function resolveProject(raw: unknown): ProjectResolution {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return { ok: false, error: "project identity required" };
  if (!isAbsolute(value)) return { ok: false, error: "project path must be absolute: " + value };
  const context = resolveProjectContext(value);
  if ("reason" in context) return { ok: false, error: "project identity unavailable: " + context.reason };
  return { ok: true, root: context.root };
}

// /recall accepts one project (the normal scoped read) or an explicit list
// (the cross-project read the caller asked for). Both at once is ambiguous.
function resolveRecallScope(body: Record<string, unknown>): { ok: true; roots: string[] } | { ok: false; error: string } {
  const singleRaw = body.projectPath;
  const single = typeof singleRaw === "string" ? singleRaw.trim() : "";
  const many: unknown[] = Array.isArray(body.projects) ? body.projects : [];
  if (single && many.length > 0) return { ok: false, error: "pass either projectPath or projects, not both" };
  if (!single && many.length === 0) return { ok: false, error: "project identity required: pass projectPath (or an explicit projects list)" };
  const raw: unknown[] = single ? [single] : many;
  const roots: string[] = [];
  for (const item of raw) {
    const resolved = resolveProject(item);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    if (!roots.includes(resolved.root)) roots.push(resolved.root);
  }
  if (roots.length === 0) return { ok: false, error: "project identity required" };
  if (roots.length > 10) return { ok: false, error: "too many projects in one recall (max 10)" };
  return { ok: true, roots };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * #307: run one request's post-work under a follow-up task and wait for it.
 *
 * The wait is the point: a response sent before the write settled is exactly
 * the "hook service has nothing running" reading this ticket removes. A
 * failure inside the work ends the row with exit 1 and propagates, so the
 * caller answers with a real error status instead of a success it cannot
 * support. An id that cannot be named is passed as undefined — the registry
 * records "no link" rather than an invented parent.
 */
function runPostWork<T>(
  kind: string,
  sessionId: string,
  work: () => T | Promise<T>,
  parentTaskId?: string,
): Promise<T> {
  return postWork.run(kind, { sessionId, ...(parentTaskId ? { parentTaskId } : {}) }, work)
    .then(({ result }) => result);
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // 403-before-401. Host/Origin rejection is a trust-boundary decision and
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
    // Parsing stays inside the try: a malformed request target is one bad
    // request (400), never an uncaught throw that takes the server down.
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/health" && req.method === "GET") {
      sendJson(res, 200, { status: "ok", timestamp: Date.now() });
      return;
    }

    if (url.pathname === "/policy" && req.method === "GET") {
      // The policy belongs to the project the caller names, not to this
      // process's start directory. No project = no policy answer.
      const project = resolveProject(url.searchParams.get("project"));
      if (!project.ok) { sendJson(res, 400, { error: project.error }); return; }
      const { policy, tomlPath, cachePath } = readProjectPolicy(project.root);
      // Ensure OBS_DB permissions before any audit write (best-effort, once).
      if (!obsDbEnsured) {
        obsDbEnsured = true;
        try { ensureOwnerOnlyDb(OBS_DB); } catch { /* best-effort */ }
      }
      // #307: the audit rows are this request's post-work. They used to be
      // fire-and-forget, so the response could return while the write was still
      // in flight and an upgrade could not see the tail at all. Now each audit
      // runs inside a follow-up task and the response waits for its end.
      const incoming = parseAndValidateHeaders(req);
      if (policy.envHostsIgnored) {
        process.stderr.write("[anysearch] WARN: ANS_URL_ALLOWLIST set but ANS_ALLOW_ENV_OVERRIDE not enabled; env hosts ignored\n");
        if (!envIgnoredAudited) {
          envIgnoredAudited = true;
          await runPostWork("server.policy_audit", incoming.sessionId, () =>
            emitConfigChangeAudit(OBS_DB, {
              actor: "server", source: "env", path: tomlPath,
              change: { before: null, after: "config:env_override_ignored" },
              policyVersion: policy.policyVersion,
              traceId: incoming.traceId,
              sessionId: incoming.sessionId,
            }),
          );
        }
      }
      if (policy.envHostsApplied > 0) {
        process.stderr.write("[anysearch] info: env override active: " + policy.envHostsApplied + " hosts\n");
      }
      const before = policyVersions.get(project.root);
      policyVersions.set(project.root, policy.policyVersion);
      // First sight of a project is the baseline, not a change; only a later
      // version difference is recorded as an audit row.
      if (before !== undefined && policy.policyVersion !== before) {
        // server path: extract traceId/sessionId from inbound
        // headers so the audit row links back to the same logical request the
        // caller initiated. traceparentValid=false means the client sent garbage;
        // parseAndValidateHeaders already substituted a fresh random traceId.
        await runPostWork("server.policy_audit", incoming.sessionId, () =>
          emitConfigChangeAudit(OBS_DB, {
            actor: "server", source: "toml", path: tomlPath,
            change: { before, after: policy.policyVersion },
            policyVersion: policy.policyVersion,
            traceId: incoming.traceId,
            sessionId: incoming.sessionId,
          }),
        );
      }
      const body = { allow: policy.allow, deny: policy.deny, policy_version: policy.policyVersion, project: project.root };
      // writePolicyCache stamps materialized_at alongside the
      // policy body so the hook fallback can surface staleness.
      writePolicyCache(cachePath, policy);
      sendJson(res, 200, body);
      return;
    }

    if (url.pathname === "/recall" && req.method === "POST") {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      const query = String(body.query || "");
      const limit = Number(body.limit) || 10;
      if (!query) { sendJson(res, 400, { error: "query required" }); return; }
      const scope = resolveRecallScope(body);
      if (!scope.ok) { sendJson(res, 400, { error: scope.error }); return; }
      const hits = store.search(query, scope.roots, limit);
      sendJson(res, 200, { hits, provenance: "project-index", projects: scope.roots });
      return;
    }

    if (url.pathname === "/index" && req.method === "POST") {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      const project = resolveProject(body.projectPath);
      if (!project.ok) { sendJson(res, 400, { error: project.error }); return; }
      const toolName = String(body.toolName || "");
      const entries: Array<Record<string, unknown>> = Array.isArray(body.entries)
        ? (body.entries as Array<Record<string, unknown>>)
        : [];
      // #307: the write is this hook's post-work. The response is sent after
      // the follow-up task ends, so a hook that received 200 can rely on the
      // rows being durable, and an upgrade see the task while it runs.
      // The parent id is whatever the caller could name (dsh passes its own
      // tool-call task); the registry verifies it and records "unknown" instead
      // of a dangling link when the row is not here.
      const incoming = parseAndValidateHeaders(req);
      const parentTaskId = typeof body.parentTaskId === "string" && body.parentTaskId.trim()
        ? body.parentTaskId.trim()
        : undefined;
      let indexed = 0;
      await runPostWork("server.project_index", incoming.sessionId, () => {
        for (const entry of entries) {
          try {
            const title = String(entry.title || "");
            const entryUrl = String(entry.url || "");
            store.indexEntry({
              projectPath: project.root,
              toolName,
              title,
              url: entryUrl,
              snippet: String(entry.snippet || ""),
              source: String(entry.source || "unknown"),
              contentHash: typeof entry.contentHash === "string" && entry.contentHash.trim()
                ? entry.contentHash
                : createHash("sha256").update(entryUrl + title).digest("hex").slice(0, 16),
            });
            indexed++;
          } catch { /* fail-open per entry */ }
        }
      }, parentTaskId);
      sendJson(res, 200, { indexed, total: entries.length, project: project.root });
      return;
    }

    if (url.pathname === "/purge" && req.method === "POST") {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      const project = resolveProject(body.projectPath);
      if (!project.ok) { sendJson(res, 400, { error: project.error }); return; }
      // #307: a purge is a write too — same lifecycle, same rule that the
      // response waits for the row's end.
      const incoming = parseAndValidateHeaders(req);
      const deleted = await runPostWork("server.project_purge", incoming.sessionId,
        () => store.purgeProject(project.root));
      sendJson(res, 200, { deleted, project: project.root });
      return;
    }

    sendJson(res, 404, { error: "not found" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // an oversized body is a client error, not a server fault.
    if (msg.includes("exceeds")) {
      sendJson(res, 413, { error: msg });
      return;
    }
    // A malformed request target is the caller's fault, not a server fault.
    if ((e as NodeJS.ErrnoException)?.code === "ERR_INVALID_URL") {
      sendJson(res, 400, { error: "invalid request URL" });
      return;
    }
    // fail-open.
    sendJson(res, 500, { error: msg });
  }
});

function announce(): void {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : REQUESTED_PORT;
  const bareHost = HOST.includes(":") && !HOST.startsWith("[") ? "[" + HOST + "]" : HOST;
  const url = "http://" + bareHost + ":" + port;
  try {
    writeServerRegistry(url);
  } catch (e) {
    // A failed publication only means hooks fall back to the documented
    // default; the server itself is still reachable at the printed address.
    process.stderr.write("[anysearch] WARN: could not publish the server address: " + (e instanceof Error ? e.message : String(e)) + "\n");
  }
  process.stderr.write("[anysearch] Plugin server listening on " + url + "\n");
  if (RESOLVED_TOKEN.generated) {
    process.stderr.write("[anysearch] generated a 256-bit server token at " + RESOLVED_TOKEN.path + " (set ANS_SERVER_TOKEN to pin it)\n");
  }
}

function bind(port: number, allowFallback: boolean): void {
  const onError = (error: NodeJS.ErrnoException) => {
    server.off("error", onError);
    if (allowFallback && error.code === "EADDRINUSE" && !process.env.ANS_SERVER_PORT) {
      // The documented default port was taken. Bind an ephemeral port and
      // publish the address, so callers read it instead of guessing.
      process.stderr.write("[anysearch] port " + port + " is taken; trying an ephemeral port\n");
      bind(0, false);
      return;
    }
    process.stderr.write("[anysearch] plugin server could not listen: " + error.message + "\n");
    process.exit(1);
  };
  server.once("error", onError);
  server.listen(port, HOST, () => { server.off("error", onError); announce(); });
}
bind(REQUESTED_PORT, true);

// Graceful shutdown.
// #307: this service now owns post-work, so a stop signal must not cut a write
// in half. The order is: stop accepting new connections, wait for the units
// already running (bounded), then close resources and write the process end.
// A wait that times out says so on stderr and leaves the rows open — an
// unfinished post-work row is a blocker an upgrade reads (#309), which is the
// honest outcome; closing the DB under a live write would corrupt the file
// instead.
const SHUTDOWN_DRAIN_MS = Number(process.env.ANS_SHUTDOWN_DRAIN_MS || 10000);
let shuttingDown = false;
const shutdown = (signal: string): void => {
  if (shuttingDown) return; // a second signal must not restart the teardown
  shuttingDown = true;
  server.close();
  void postWork.drain(SHUTDOWN_DRAIN_MS).then((drained) => {
    if (!drained) {
      process.stderr.write(
        "[anysearch] " + signal + ": " + postWork.pending() + " post-work unit(s) still running after " +
        SHUTDOWN_DRAIN_MS + "ms — leaving their task rows open (an upgrade reports them as blockers)\n",
      );
    }
    store.close();
    clearServerRegistry();
    postWork.stop();
    process.exit(drained ? 0 : 1);
  });
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
