// R65 F-10: ship repo-root domains/*.toml inside the @anysearch-cli/mcp
// tarball so an installed `ans-mcp` resolves builtin domains — same contract
// as apps/cli/scripts/sync-domains.mjs (ADR-0061 B1).
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const self = dirname(fileURLToPath(import.meta.url));
const src = join(self, "..", "..", "..", "domains");
const dst = join(self, "..", "domains");

if (!existsSync(src)) {
  console.error("sync-domains: source dir missing: " + src);
  process.exit(1);
}
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
let n = 0;
for (const f of readdirSync(src)) {
  if (f.endsWith(".toml")) {
    cpSync(join(src, f), join(dst, f));
    n++;
  }
}
console.log("sync-domains: " + n + " toml(s) -> " + dst);
