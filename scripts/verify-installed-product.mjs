// #298 / #297 S1, T2, N1: use only installed public commands and the existing
// MCP protocol smoke. The caller owns the temporary prefix and cleanup.
import { spawn, spawnSync } from "node:child_process";
import { runProbeProcess } from "./probe-process.mjs";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createServer } from "node:net";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const protocolSmoke = fileURLToPath(new URL("./mcp-smoke.mjs", import.meta.url));

/** Verify command ownership, resources, both MCP launch paths, and hook startup. */
export async function verifyInstalledProduct(prefix, check) {
  const nm = join(prefix, "node_modules");
  // macOS temporary paths can use /var while Node resolves /private/var.
  // Compare the actual directory, not two spellings of the same installation.
  const product = realpathSync(join(nm, "@anysearch-cli/cli"));
  const manifest = JSON.parse(readFileSync(join(product, "package.json"), "utf8"));
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/^(ANS_|ANYSEARCH_|EXA_|TAVILY_)/i.test(key)));
  Object.assign(env, {
    HOME: prefix, USERPROFILE: prefix,
    ANS_DB_PATH: join(prefix, "product.db"),
    ANS_PROJECT_DB: join(prefix, "project.db"),
  });
  const run = (name, args, options = {}) => {
    const bin = join(nm, ".bin", name + (process.platform === "win32" ? ".cmd" : ""));
    return spawnSync(process.platform === "win32" ? '"' + bin + '"' : bin, args, {
      cwd: prefix, env, encoding: "utf8", timeout: 30000,
      shell: process.platform === "win32", ...options,
    });
  };
  for (const name of Object.keys(manifest.bin)) {
    const result = run(name, ["--installation"]);
    let info;
    try { info = JSON.parse(result.stdout); } catch { /* asserted below */ }
    check(name + " comes from the complete product", result.status === 0 &&
      info?.packageName === manifest.name && info?.version === manifest.version &&
      info?.packageRoot === product && info?.entryRole === name &&
      typeof info?.executable === "string" &&
      info.executable.startsWith(product + sep) && existsSync(info.executable) &&
      /^[0-9a-f]{40}$/.test(info?.commit) && info?.dirty === false,
    result.stderr || result.stdout);
  }
  check("runtime floor matches PI 1.5.1", manifest.engines?.node === ">=22.19.0");
  for (const path of ["domains/docs.toml", "mcp/domains/docs.toml", "plugin/configs/claude/hooks.json",
    "plugin/configs/codex/hooks.json", "plugin/hooks/hooks.json", "plugin/.mcp.json",
    "plugin/.claude-plugin/plugin.json", "plugin/skills"]) {
    check("product ships " + path, existsSync(join(product, path)));
  }
  for (const name of ["mcp", "plugin", "kernel", "store", "retriever", "embedding"]) {
    check(name + " is not a separate required installation", !existsSync(join(nm, "@anysearch-cli", name)));
  }
  for (const name of ["onnxruntime-node", "@huggingface/transformers"]) {
    check(name + " is not installed by default", !existsSync(join(nm, name)));
  }
  // The established smoke checks initialize, all five tools and schema
  // descriptions over stdio and HTTP, including protocol negotiation.
  for (const [name, viaCli] of [["ans-mcp", false], ["ans", true]]) {
    const result = await runProbeProcess(protocolSmoke, [], {
      cwd: prefix, timeoutMs: 90000,
      env: { ...env, ANS_MCP_ENTRY: join(product, manifest.bin[name]), ANS_MCP_VIA_CLI: viaCli ? "1" : "0" },
    });
    check(name + (viaCli ? " mcp" : "") + " passes stdio and HTTP protocol smoke",
      result.status === 0, result.error?.message || result.stderr || result.stdout);
  }
  const session = run("ans-hook-session-start", ["--envelope"], {
    input: JSON.stringify({ hook_event_name: "SessionStart", cwd: prefix, session_id: "install-smoke" }),
  });
  let hook;
  try { hook = JSON.parse(session.stdout); } catch { /* asserted below */ }
  check("installed SessionStart hook returns the host envelope", session.status === 0 &&
    hook?.hookSpecificOutput?.hookEventName === "SessionStart" &&
    typeof hook?.hookSpecificOutput?.additionalContext === "string", session.stderr || session.stdout);
  for (const name of ["ans-hook-claude", "ans-hook-codex", "ans-hook-antigravity", "ans-hook-codebuddy"]) {
    const result = run(name, [], { input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "unrelated", cwd: prefix }) });
    check(name + " loads and handles host input", result.status === 0 && !result.stderr, result.stderr);
  }

  const port = await new Promise((accept, reject) => {
    const socket = createServer();
    socket.on("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const chosen = socket.address().port;
      socket.close((error) => error ? reject(error) : accept(chosen));
    });
  });
  const child = spawn(process.execPath, [join(product, manifest.bin["ans-plugin-server"])], {
    cwd: prefix, env: { ...env, ANS_SERVER_PORT: String(port), ANS_SERVER_TOKEN: "test-token" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const closed = new Promise((accept) => child.once("close", accept));
  try {
    await new Promise((accept, reject) => {
      const timer = setTimeout(() => reject(new Error("plugin server startup timed out")), 15000);
      let output = "";
      const finish = (error) => { clearTimeout(timer); error ? reject(error) : accept(); };
      child.once("error", finish);
      child.once("exit", (code) => finish(new Error("plugin server exited " + code + ": " + output)));
      child.stderr.on("data", (chunk) => {
        output += chunk;
        if (output.includes("Plugin server listening")) finish();
      });
    });
    const response = await fetch("http://127.0.0.1:" + port + "/health", {
      headers: { Authorization: "Bearer test-token" }, signal: AbortSignal.timeout(10000),
    });
    const health = await response.json();
    check("installed plugin server answers authenticated health", response.ok && health.status === "ok");
  } catch (error) {
    check("installed plugin server starts", false, error.message);
  } finally {
    child.kill();
    await closed;
  }
}
