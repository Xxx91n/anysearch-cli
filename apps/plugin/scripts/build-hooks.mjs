// `build:hooks` — this package's own hook bundles, into dist/hooks.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildHookBundles } from "./hook-build.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await buildHookBundles({ pluginRoot: root, outdir: join(root, "dist/hooks") });
