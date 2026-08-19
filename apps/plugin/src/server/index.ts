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
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
mkdirSync(dirname(DB_PATH), { recursive: true });

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
