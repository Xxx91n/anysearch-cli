#!/usr/bin/env node
// anysearch MCP server entry.
// dual transport — stdio + Streamable HTTP, factory pattern.
// independent package, CLI forwards via ans mcp subcommand.
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { buildServer, createDefaultEngine } from "./server.js";
import { createHttpApp } from "./http.js";
import { createMcpToolState } from "./tool-state.js";

// The /health version banner moved with the HTTP wiring into http.ts (#112),
// so this entry no longer needs the __PACKAGE_VERSION__ substitution.

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

async function main() {
  // #210: one process-level tool state for either transport. stdio already had
  // process-level behavior through its single long-lived server; HTTP now gets
  // the same scope even though it builds a fresh server per request.
  const toolState = createMcpToolState();
  if (transport === "stdio") {
    // stdio is process-wide: one server, one engine for the process lifetime.
    const server = buildServer(undefined, toolState);
    const t = new StdioServerTransport();
    await server.connect(t);
    // stdio: log to stderr only (stdout is protocol channel)
    process.stderr.write("anysearch MCP server: stdio transport ready\n");
  } else {
    // #112: HTTP is stateless per request, but the engine is per CONNECTION
    // (this process). Build it ONCE here and hand it to every request; before
    // this change each request called createEngine() and opened two fresh
    // better-sqlite3 handles, so connections grew with request count.
    const engine = createDefaultEngine();
    const app = createHttpApp(engine, toolState);

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
