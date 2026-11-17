// Copy resources and build hooks into the complete product, independent of
// apps/mcp/dist and apps/plugin/dist (which may be absent or from an older build).
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cli = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const plugin = resolve(cli, "../plugin");
const manifest = JSON.parse(readFileSync(join(plugin, "package.json"), "utf8"));
const hookEntries = Object.entries(manifest.exports)
  .filter(([name]) => name.startsWith("./hooks/"))
  .map(([, entry]) => resolve(plugin, entry.types));
await build({
  entryPoints: hookEntries,
  bundle: true,
  platform: "node",
  format: "cjs",
  outdir: join(cli, "plugin/dist/hooks"),
  outbase: join(plugin, "src/hooks"),
  outExtension: { ".js": ".cjs" },
  banner: { js: "#!/usr/bin/env node" },
  external: ["better-sqlite3", "@anysearch-cli/embedding"],
});

for (const name of ["configs", "hooks", ".claude-plugin", ".mcp.json", "skills", "AGENTS.md"]) {
  const dst = join(cli, "plugin", name);
  rmSync(dst, { recursive: true, force: true });
  cpSync(join(plugin, name), dst, { recursive: true });
}
const domains = join(cli, "mcp/domains");
rmSync(domains, { recursive: true, force: true });
mkdirSync(dirname(domains), { recursive: true });
cpSync(join(cli, "domains"), domains, { recursive: true });

// Design: the complete product uses its own public hook command — keep the
// source config for the existing plugin package and adapt only the product copy.
const codebuddyPath = join(cli, "plugin/configs/codebuddy/hooks.json");
const codebuddy = JSON.parse(readFileSync(codebuddyPath, "utf8"));
for (const groups of Object.values(codebuddy.hooks)) {
  for (const group of groups) {
    for (const hook of group.hooks) hook.command = "ans-hook-codebuddy";
  }
}
writeFileSync(codebuddyPath, JSON.stringify(codebuddy, null, 2) + "\n");
