// Copy resources and build hooks into the complete product, independent of
// apps/mcp/dist and apps/plugin/dist (which may be absent or from an older build).
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildHookBundles } from "../../plugin/scripts/hook-build.mjs";

const cli = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const plugin = resolve(cli, "../plugin");
await buildHookBundles({ pluginRoot: plugin, outdir: join(cli, "plugin/dist/hooks") });

for (const name of ["configs", "hooks", ".claude-plugin", ".mcp.json", "skills", "AGENTS.md"]) {
  const dst = join(cli, "plugin", name);
  rmSync(dst, { recursive: true, force: true });
  cpSync(join(plugin, name), dst, { recursive: true });
}
const domains = join(cli, "mcp/domains");
rmSync(domains, { recursive: true, force: true });
mkdirSync(dirname(domains), { recursive: true });
cpSync(join(cli, "domains"), domains, { recursive: true });

// Design: the source templates already name the host bins (codebuddy included),
// so the product copy is a straight copy — no per-host command rewrite.
