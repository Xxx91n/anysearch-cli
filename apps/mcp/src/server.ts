// MCP Server factory: buildServer() registers 5 tools via Per-tool Barrel.
// ADR-0008 D1: context-management mental model (context-mode style).
// ADR-0008 D3: 5 MCP tools — search_web / research_web / recall_memory / query_knowledge / ans_chat.
// ADR-0008 D4: factory pattern, era-agnostic, entry selects transport.
// ADR-0008 D7: createEngine() from @anysearch-cli/kernel.
// ADR-0019 D1: inputSchema wrapped via fromJsonSchema(KernelToolSchemas[name]) — SDK v2 path.
// ADR-0019 D2: tools live in apps/mcp/src/tools/*, aggregated by tools/index.ts.

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
const PKG_VERSION: string =
  typeof __PACKAGE_VERSION__ !== "undefined" && __PACKAGE_VERSION__
    ? __PACKAGE_VERSION__
    : "0.0.0";

// buildServer: factory function. Each connection gets a fresh server instance.
// ADR-0008 D4: factory pattern, era-agnostic, entry selects transport.
export function buildServer(engine?: CompositionResult): McpServer {
  // ADR-0057 D3 (D-004): a cold HOME has no ~/.anysearch dir yet; create the DB
  // parent before better-sqlite3 opens it (mirrors apps/cli/src/db.ts:9).
  let eng: CompositionResult;
  if (engine) {
    eng = engine;
  } else {
    const dbPath = resolveDbPath();
    mkdirSync(dirname(dbPath), { recursive: true });
    // ADR-0062 D2/D3: ANS_DOMAIN flows into the engine (same env contract as the
    // CLI) so the domain post-filter + abstain contract is reachable on MCP.
    // Unset = full fanout, unchanged legacy behavior.
    // R65 F-10: mirror the CLI's domains-dir chain — an installed ans-mcp must
    // resolve the builtin TOMLs shipped inside its own package, not only
    // <cwd>/domains (a host project's cwd never has one).
    const self = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
    const domainsDirs = defaultDomainsDirs();
    domainsDirs.push(join(self, "..", "domains"));
    eng = createEngine(process.env.ANS_DOMAIN, { dbPath, domainsDirs });
  }
  const server = new McpServer(
    { name: "anysearch", version: PKG_VERSION },
    { capabilities: { tools: {} } }
  );

  for (const tool of TOOL_REGISTRY) {
    tool.register(server, eng);
  }

  return server;
}
