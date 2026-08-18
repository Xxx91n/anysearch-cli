// ans mcp subcommand: forward to apps/mcp entry.
// ADR-0008 D6: CLI adds ans mcp subcommand that forwards to apps/mcp entry.
// Passes through --transport and --port flags.

import { spawn } from "node:child_process";
import { resolve } from "node:path";

export async function runMcp(args: string[]): Promise<number> {
  // Forward all args to apps/mcp entry.
  // ponytail: spawn the MCP server process, inherit stdio for stdio transport.
  const mcpEntry = resolve(__dirname, "../../mcp/dist/index.cjs");

  const child = spawn("node", [mcpEntry, ...args], {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  return new Promise<number>((resolve) => {
    child.on("exit", (code) => {
      resolve(code ?? 0);
    });
    child.on("error", (e) => {
      process.stderr.write("ans mcp: failed to start MCP server: " + (e instanceof Error ? e.message : String(e)) + "\n");
      resolve(1);
    });
  });
}
