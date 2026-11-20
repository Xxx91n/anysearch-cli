// build provenance stamp for apps/cli/dist.
// Written post-tsup; the vertical-delta runner asserts this commit against
// the working-tree HEAD (stale/absent stamp => FAIL, never a silent run).
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(pkgDir, "..", "..");
const git = (a) => {
  try { return execSync("git " + a, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
};
const stamp = {
  schema: "anysearch/build-stamp@1",
  commit: git("rev-parse HEAD") ?? "nogit",
  dirty: !!git("status --porcelain -- apps/cli/src packages/kernel/src packages/retriever/src packages/store/src packages/embedding/src"),
};
writeFileSync(join(pkgDir, ".build-stamp.json"), JSON.stringify(stamp, null, 2) + "\n", "utf8");
console.log("[stamp-dist] .build-stamp.json commit=" + stamp.commit.slice(0, 8) + " dirty=" + stamp.dirty);

// This stamp travels in the npm tarball. It records the source at build time;
// the launchers add their actual installed path, never the source checkout path.
const productStatus = git("status --porcelain -- apps packages domains pnpm-lock.yaml pnpm-workspace.yaml");
const manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const buildInfo = {
  schema: "anysearch/installation@1",
  packageName: manifest.name,
  version: manifest.version,
  commit: stamp.commit,
  dirty: productStatus === null ? null : productStatus !== "",
  // #311: when this bundle was stamped; the upgrade report compares it with a
  // running process's own recorded build.
  builtAt: new Date().toISOString(),
};
writeFileSync(join(pkgDir, "dist", "build-info.json"), JSON.stringify(buildInfo, null, 2) + "\n", "utf8");
// Both add-on bundles sit inside the product tarball and carry the same stamp.
// `plugin/dist` is the hook service; `mcp/dist` is the resident server whose
// process row answers "which MCP server is still on the old build" (#311). A row
// with no stamp answers nothing.
const bundleDirs = [join(pkgDir, "plugin", "dist"), join(pkgDir, "mcp", "dist")];
for (const dir of bundleDirs) {
  if (!existsSync(dir)) {
    // Loud on purpose: an unstamped bundle reports "no idea which build" forever,
    // and the upgrade list will keep listing it as undecidable.
    console.log("[stamp-dist] 跳过 " + dir + "（没有这个目录）");
    continue;
  }
  writeFileSync(join(dir, "build-info.json"), JSON.stringify(buildInfo, null, 2) + "\n", "utf8");
}
