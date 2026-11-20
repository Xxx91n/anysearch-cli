#!/usr/bin/env node
// anysearch MCP server entry.
// dual transport — stdio + Streamable HTTP, factory pattern.
// independent package, CLI forwards via ans mcp subcommand.
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { buildServer, createDefaultEngine } from "./server.js";
import { createHttpApp } from "./http.js";
import { createMcpToolState } from "./tool-state.js";
import { markHttpTransport } from "./transport-mode.js";
import { ansDurableDbPath, ensureAnsLayoutOrExit, resolveConfigHome } from "@anysearch-cli/store";
import { registerMcpProcess, type McpProcessRecord } from "./mcp-process.js";

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

/** This process's record in the task registry; registered in main(), closed on exit. */
let processRecord: McpProcessRecord | undefined;

async function main() {
  // Move the old directories into ~/.ans before the first read. An HTTP server
  // serves several workspaces and its startup directory is nobody's project
  // (see transport-mode.ts), so it passes the user root and the project pass
  // skips itself.
  ensureAnsLayoutOrExit("ans-mcp", process.env, transport === "http" ? resolveConfigHome() : process.cwd());
  // #311: this entry's lifetime is a process record, so an upgrade can see that a
  // resident server is still executing the build it started on. Registration
  // failures only warn — a broken registry must not cost the host its MCP server.
  processRecord = registerMcpProcess(ansDurableDbPath(), (message) => {
    process.stderr.write("[warn] " + message + "\n");
  });
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
    // This process serves many callers, so its cwd is not their project (S3).
    markHttpTransport();
    const engine = createDefaultEngine();
    const app = createHttpApp(engine, toolState);

    // SECURITY: localhost-only binding — no remote access (CWE-306).
    app.listen(port, "127.0.0.1", () => {
      process.stderr.write("anysearch MCP server: HTTP transport on port " + port + "\n");
    });
  }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  // 写下结束，然后把这个信号重新发给自己：`once` 已经把处理函数摘掉了，所以这次
  // 走的是默认行为——该被信号杀掉就还是被信号杀掉，退出码和以前一样。
  //
  // `end()` 是一次同步的 SQLite UPDATE，库被别的进程锁住时要等到 busy_timeout
  //（5 秒）才会放弃：这段时间进程不会退出。换来的是这一行不会永远挂着——"没写
  // 结束"在升级报告里会被读成"这个入口还在跑"。
  process.once(signal, () => {
    processRecord?.end();
    try {
      process.kill(process.pid, signal);
    } catch {
      // Windows 上 SIGHUP 之类 re-raise 会抛 ENOSYS（没有这个默认行为）。结束已经
      // 写下了，就按正常退出收场，别把一个干净结束变成失败退出。
      process.exit(0);
    }
  });
}

// 信号之外还有正常退出：stdin 关了（宿主收回连接）、main() 跑完、被
// TerminateProcess 之外的任何路径结束。少这一条，那些行会一直挂着没写结束，
// 而"没写结束"在升级报告里会被读成"这个入口还在跑"。
process.once("exit", () => { processRecord?.end(); });

main().catch((e) => {
  processRecord?.end();
  process.stderr.write("anysearch MCP server error: " + (e instanceof Error ? e.message : String(e)) + "\n");
  process.exit(1);
});
