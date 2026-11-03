#!/usr/bin/env node
// anysearch MCP server entry.
// dual transport — stdio + Streamable HTTP, factory pattern.
// independent package, CLI forwards via ans mcp subcommand.
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { buildServer, createMcpEngine } from "./server.js";
import { createHttpApp } from "./http-app.js";

// ponytail: tsup define substituites __PACKAGE_VERSION__ at build time (see
// tsup.config.ts). Dev-mode tsx fallthrough reads "0.0.0" — fine for doctor.
declare const __PACKAGE_VERSION__: string | undefined;
const PKG_VERSION: string =
  typeof __PACKAGE_VERSION__ !== "undefined" && __PACKAGE_VERSION__
    ? __PACKAGE_VERSION__
    : "0.0.0";

const argv = process.argv.slice(2);

// Parse --transport stdio|http and --port <n>
let transport: "stdio" | "http" = "stdio";
let port = 3001;

for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--transport" && argv[i + 1]) {
    transport = argv[i + 1] === "http" ? "http" : "stdio";
    i++;
  } else if (argv[i] === "--port" && argv[i + 1]) {
    port = parseInt(argv[i + 1], 10) || 3001;
    i++;
  } else if (argv[i] === "--help" || argv[i] === "-h") {
    process.stderr.write("Usage: ans-mcp [options]\n\nOptions:\n  --transport stdio|http  Transport mode (default: stdio)\n  --port <n>             HTTP port (default: 3001)\n");
    process.exit(0);
  }
}

/**
 * Starts the MCP server in the transport selected by the CLI flags.
 *
 * stdio keeps stdout protocol-pure (logs go to stderr); http binds to
 * localhost only and reuses one composition for the whole process.
 */
async function main() {
  if (transport === "stdio") {
    const server = buildServer();
    const t = new StdioServerTransport();
    await server.connect(t);
    // stdio: log to stderr only (stdout is protocol channel)
    process.stderr.write("anysearch MCP server: stdio transport ready\n");
  } else {
    // HTTP transport is stateless, but the composition is per-CONNECTION
    // (#40/#112): build the engine once here and reuse it for every request;
    // only the cheap McpServer + transport instances stay per-request.
    const engine = createMcpEngine();
    const app = createHttpApp({
      engine,
      version: PKG_VERSION,
      mcpKey: process.env.ANS_MCP_KEY,
    });

    // SECURITY: localhost-only binding — no remote access (CWE-306).
    app.listen(port, "127.0.0.1", () => {
      process.stderr.write("anysearch MCP server: HTTP transport on port " + port + "\n");
    });
  }
}

main().catch((e) => {
  process.stderr.write("anysearch MCP server error: " + (e instanceof Error ? e.message : String(e)) + "\n");
  process.exit(1);
});
