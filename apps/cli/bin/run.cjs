// Design: all public commands resolve inside this product. Check Node before
// loading dependencies, so an unsupported runtime gets a readable error.
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const targets = {
  ans: "dist/index.js",
  "ans-mcp": "mcp/dist/index.js",
  "ans-plugin-server": "plugin/dist/server/index.cjs",
  "ans-hook-claude": "plugin/dist/hooks/adapters/claude.cjs",
  "ans-hook-session-start": "plugin/dist/hooks/session-start.cjs",
  "ans-hook-codebuddy": "plugin/dist/hooks/adapters/codebuddy.cjs",
  "ans-hook-codex": "plugin/dist/hooks/adapters/codex.cjs",
  "ans-hook-antigravity": "plugin/dist/hooks/adapters/antigravity.cjs",
};

/** Start one entry or report its build and installation before loading it. */
async function start(role) {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 19)) {
    throw new Error("AnySearch needs Node 22.19.0 or newer; running " + process.versions.node + ".");
  }
  const root = resolve(__dirname, "..");
  const target = targets[role];
  if (!target) throw new Error("Unknown AnySearch entry: " + role);
  const info = JSON.parse(readFileSync(resolve(root, "dist/build-info.json"), "utf8"));
  const arg = process.argv[2];
  if (arg === "--installation") {
    process.stdout.write(JSON.stringify({
      ...info,
      entryRole: role,
      packageRoot: root,
      executable: resolve(root, target),
      node: process.versions.node,
    }, null, 2) + "\n");
    return;
  }
  if (arg === "--version" || arg === "-v") {
    process.stdout.write(info.version + "\n");
    return;
  }
  await import(pathToFileURL(resolve(root, target)).href);
}

module.exports = function run(role) {
  start(role).catch((error) => {
    process.stderr.write(role + ": " + error.message + "\n");
    // Preserve the host hook contract even when startup fails before the
    // adapter loads. CLI and service entry failures must still be nonzero.
    process.exitCode = role.startsWith("ans-hook-") ? 0 : 1;
  });
};
