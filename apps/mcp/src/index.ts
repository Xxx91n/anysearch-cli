#!/usr/bin/env node
// anysearch MCP server entry.
// ADR-0008 D4: dual transport — stdio + Streamable HTTP, factory pattern.
// ADR-0008 D6: independent package, CLI forwards via ans mcp subcommand.
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import express from "express";
import { buildServer } from "./server.js";

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

async function main() {
  if (transport === "stdio") {
    const server = buildServer();
    const t = new StdioServerTransport();
    await server.connect(t);
    // stdio: log to stderr only (stdout is protocol channel)
    process.stderr.write("anysearch MCP server: stdio transport ready\n");
  } else {
    // ponytail: HTTP transport uses stateless factory pattern (ADR-0008 D4).
    // Each request gets a fresh server instance via buildServer().
    const app = express();
    app.use(express.json());

    // SECURITY: bind to 127.0.0.1 only — prevent network exposure (CWE-306).
    // SECURITY: optional bearer token auth via ANS_MCP_KEY env var (CWE-306).
    const mcpKey = process.env.ANS_MCP_KEY;
    if (mcpKey) {
      app.use((req, _res, next) => {
        const auth = req.headers.authorization || "";
        if (auth !== "Bearer " + mcpKey) {
          _res.status(401).json({ error: { code: -32001, message: "Unauthorized" } });
          return;
        }
        next();
      });
    }

    app.post("/mcp", async (req, res) => {
      try {
        const server = buildServer();
        // ADR-0008 D4: stateless mode — sessionIdGenerator: undefined, enableJsonResponse, keepAliveMs: 0
        const t = new NodeStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
          keepAliveMs: 0,
        });
        await server.connect(t);
        await t.handleRequest(req, res, req.body);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        res.status(500).json({ error: { code: -32603, message: "Internal error: " + msg } });
      }
    });

    // Health check endpoint
    app.get("/health", (_req, res) => {
      res.json({ status: "ok", server: "anysearch-mcp", version: PKG_VERSION });
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
