#!/usr/bin/env node
// anysearch MCP server entry.
// ADR-0008 D4: dual transport — stdio + Streamable HTTP, factory pattern.
// ADR-0008 D6: independent package, CLI forwards via ans mcp subcommand.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { randomUUID } from "node:crypto";
import { buildServer } from "./server.js";

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
        const t = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
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
      res.json({ status: "ok", server: "anysearch-mcp", version: "0.0.0" });
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
