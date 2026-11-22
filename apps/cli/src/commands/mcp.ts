// ans mcp subcommand: forward to the packaged MCP entry.
// CLI adds ans mcp subcommand that forwards to the packaged MCP entry.
// Passes every argument through unchanged; the entry's own flags are --transport and --port.

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function runMcp(args: string[]): Promise<number> {
  // Forward all args to the packaged MCP entry (the ESM build).
  // ponytail: spawn the MCP server process, inherit stdio for stdio transport.
  const selfFile = fileURLToPath(import.meta.url);
  const self = dirname(selfFile);
  // tsx runs this file in src/commands; the product bundle runs in dist.
  // Select the known layout, rather than falling back outside a broken install.
  const mcpEntry = resolve(self, selfFile.endsWith(".ts")
    ? "../../bin/ans-mcp.cjs"
    : "../bin/ans-mcp.cjs");

  const child = spawn(process.execPath, [mcpEntry, ...args], {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  return new Promise<number>((resolve) => {
    // Forward shutdown to the MCP child so a host closing `ans mcp` does not
    // leave an orphan server behind. Entry processes remain independent.
    const interrupt = () => child.kill("SIGINT");
    const terminate = () => child.kill("SIGTERM");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    const cleanup = () => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    };
    child.on("exit", (code, signal) => {
      cleanup();
      resolve(code ?? (signal ? 1 : 0));
    });
    child.on("error", (e) => {
      cleanup();
      process.stderr.write("ans mcp: failed to start MCP server: " + (e instanceof Error ? e.message : String(e)) + "\n");
      resolve(1);
    });
  });
}
