// MCP Server factory: buildServer() registers 5 tools via Per-tool Barrel.
// context-management mental model (context-mode style).
// 5 MCP tools — search_web / research_web / recall_memory / query_knowledge / ans_chat.
// factory pattern, era-agnostic, entry selects transport.
// createEngine from @anysearch-cli/kernel.
// inputSchema wrapped via fromJsonSchema(KernelToolSchemas[name]) — SDK v2 path.
// tools live in apps/mcp/src/tools/*, aggregated by tools/index.ts.

import { McpServer } from "@modelcontextprotocol/server";
import { createEngine, resolveDbPath, type CompositionResult } from "@anysearch-cli/kernel";
import { defaultDomainsDirs } from "@anysearch-cli/store";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_REGISTRY } from "./tools/index.js";

// ponytail: single source of truth for server version. Tsup substitutes
// __PACKAGE_VERSION__ at build time (see tsup.config.ts `define`); dev-mode
// tsx runs read it from the nearest package.json via a small helper.
declare const __PACKAGE_VERSION__: string | undefined;
export const PKG_VERSION: string =
  typeof __PACKAGE_VERSION__ !== "undefined" && __PACKAGE_VERSION__
    ? __PACKAGE_VERSION__
    : "0.0.0";

// Design: the engine is a per-CONNECTION resource, built once at startup and
// reused — not a per-request one. Before #112, every HTTP request reached
// buildServer() -> createEngine() and opened two fresh better-sqlite3 handles
// (SessionStore + ObservationStore), so the open-connection count grew with the
// request count; stdio stays process-wide, unchanged.
// createDefaultEngine: wraps the createEngine composition root (GLOSSARY) with
// the MCP-side env/db/domainsDirs resolution, split out of buildServer so a
// long-lived transport can run it ONCE and reuse the result (#112).
export function createDefaultEngine(): CompositionResult {
  // a cold HOME has no ~/.anysearch dir yet; create the DB
  // parent before better-sqlite3 opens it (mirrors apps/cli/src/db.ts:9).
  const dbPath = resolveDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  // ANS_DOMAIN flows into the engine (same env contract as the
  // CLI) so the domain post-filter + abstain contract is reachable on MCP.
  // Unset = full fanout, unchanged legacy behavior.
  // mirror the CLI's domains-dir chain — an installed ans-mcp must
  // resolve the builtin TOMLs shipped inside its own package, not only
  // <cwd>/domains (a host project's cwd never has one).
  const self = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
  const domainsDirs = defaultDomainsDirs();
  domainsDirs.push(join(self, "..", "domains"));
  return createEngine(process.env.ANS_DOMAIN, { dbPath, domainsDirs });
}

// buildServer: factory function. Each connection gets a fresh server instance.
// factory pattern, era-agnostic, entry selects transport.
// #112: an injected engine is reused exactly as given — the HTTP transport
// passes its one startup engine on every request. Omitting it keeps stdio and
// the cold-HOME boot path on a freshly built default composition root.
export function buildServer(engine?: CompositionResult): McpServer {
  const eng: CompositionResult = engine ?? createDefaultEngine();
  const server = new McpServer(
    { name: "anysearch", version: PKG_VERSION },
    { capabilities: { tools: {} } }
  );

  for (const tool of TOOL_REGISTRY) {
    tool.register(server, eng);
  }

  return server;
}
