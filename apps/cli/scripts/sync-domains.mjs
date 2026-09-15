// ADR-0061 B1: ship the repo-root domains/*.toml inside the @anysearch-cli/cli
// tarball so an installed `ans` resolves builtin domains (see db.ts chain).
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
