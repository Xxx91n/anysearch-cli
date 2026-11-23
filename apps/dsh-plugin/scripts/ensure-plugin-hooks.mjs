// The test imports `@anysearch-cli/plugin/hooks/*`, and that specifier resolves
// to the plugin package's built CJS bundles rather than its source. Build those
// bundles into the copy this package actually resolves, so the test does not
// depend on another task having built them first — the push gate stopped
// running upstream tests (#490), and that was the only thing producing them.
//
// Design: resolve the plugin through `node_modules` the same way the import
// does, instead of assuming `../../plugin`. A workspace link and the real
// package directory are the same place on Linux and a symlink; when they are
// not the same place, building into `../../plugin` leaves the resolved copy
// empty and the test fails with a module-not-found that names the wrong path.
// `buildHookBundles` verifies every bundle it writes, so a short build throws
// here with the bundle names instead of surfacing inside the test run.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { buildHookBundles } from "../../plugin/scripts/hook-build.mjs";

const require = createRequire(import.meta.url);
const pluginRoot = resolvePluginRoot();
await buildHookBundles({ pluginRoot, outdir: join(pluginRoot, "dist/hooks") });

const manifest = JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf8"));
const bundles = Object.values(manifest.exports).filter((entry) => entry?.default?.includes("/hooks/"));
console.log(`dsh-plugin pretest: ${bundles.length} hook bundles under ${join(pluginRoot, "dist/hooks")}`);

function resolvePluginRoot() {
  for (const dir of require.resolve.paths("@anysearch-cli/plugin") ?? []) {
    const candidate = join(dir, "@anysearch-cli", "plugin");
    if (existsSync(join(candidate, "package.json"))) return candidate;
  }
  throw new Error("cannot find @anysearch-cli/plugin under this package's node_modules");
}
