// ADR-0061 B2/T2 + ADR-0064 (R63 T5): real install-to-use lane — pack the PUBLISHED
// packages (3 apps + the peer-optional embedding), npm-install the APP tarballs only
// into a clean temp prefix (consumer-real: bundled internals never ship), then drive
// the INSTALLED `ans` bin through --version / doctor / domain docs / doctor / search.
// A second leg co-installs the embedding tarball and asserts peer resolution + the
// doctor vector-arm line flipping from absent-SKIP to present (D-005).
//
// Online leg: when EXA_API_KEY or TAVILY_API_KEY is set, the script hard-asserts
// that a real search returns >=1 result AND that at least one result URL lands on
// the docs-domain urlAllowlist (pnpm.io / typescriptlang.org / modelcontextprotocol.io).
// Without keys it fault-injects a dead endpoint (ANYSEARCH_ENDPOINT=127.0.0.1:9)
// and asserts the documented abstain contract on `search --json` stdout under a
// probe domain whose sources.enabled is [anysearch] alone —
// abstain:true && providersFailed∋anysearch && results.length===0 (ADR-0063 /
// R62 D-004: abstain exit 0 replaces the retired exit-1/Results:0 contract).
// The offline golden lane is the committed
// packages/store/test/eval-docs-golden.test.ts suite inside `turbo test`.
//
// macOS limitation: covered by the ci.yml ponytail note — the only arm64 delta is
// the better-sqlite3 prebuild; add macos-latest when a real mac issue lands.
import { execSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
// R63 T5 (D-005): the publish set. kernel/store/retriever are bundled into the apps'
// dist (build-time devDependencies) and are never published or installed.
const PACK_DIRS = [
  "apps/cli",
  "apps/mcp",
  "apps/plugin",
  "packages/embedding",
];
const ALLOWLIST = ["modelcontextprotocol.io", "typescriptlang.org", "pnpm.io"];

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log("[OK] " + name);
  } else {
    failed++;
    console.error("[FAIL] " + name + (detail ? " — " + String(detail).slice(0, 300) : ""));
  }
}
function sh(cmd, opts) {
  const r = spawnSync(cmd, { shell: true, encoding: "utf8", ...opts });
  return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? ""), stdout: r.stdout ?? "" };
}

const dir = mkdtempSync(join(tmpdir(), "ans-install-smoke-"));
const outDir = join(dir, "out");
const prefix = join(dir, "prefix");
mkdirSync(outDir, { recursive: true });
mkdirSync(prefix, { recursive: true });
writeFileSync(join(prefix, "package.json"), '{"name":"ans-smoke","private":true}', "utf8");

try {
  // 1. Pack all workspace packages (workspace:* deps resolve to the packed versions).
  for (const d of PACK_DIRS) {
    const r = sh(`pnpm -C ${JSON.stringify(join(ROOT, d))} pack --pack-destination ${JSON.stringify(outDir)}`, { cwd: ROOT });
    if (r.code !== 0) check("pack " + d, false, r.out);
  }
  const tgz = readdirSync(outDir).filter((f) => f.endsWith(".tgz"));
  check("pack produced " + PACK_DIRS.length + " tarballs", tgz.length === PACK_DIRS.length, tgz.join(","));
  check("no stale 0.0.0 tarball", tgz.every((f) => !f.includes("0.0.0")), tgz.join(","));

  // 2. Clean install into the temp prefix — R63 T5 (D-005): consumer-real shape.
  // Only the three APP tarballs are installed; bundled internals are not on npm at
  // all, and @anysearch-cli/embedding is an optional PEER (peerDependenciesMeta.optional)
  // so npm does not auto-install it — no --omit=optional knob needed. (No --no-save:
  // deps must land in prefix/package.json or the peer leg's second npm install would
  // prune the apps as extraneous.)
  const appTgz = tgz.filter((f) => /anysearch-cli-(cli|mcp|plugin)-/.test(f));
  check("install set = 3 app tarballs only", appTgz.length === 3, tgz.join(","));
  const inst = sh(`npm install ${appTgz.map((f) => JSON.stringify(join(outDir, f))).join(" ")}`, { cwd: prefix });
  check("npm install clean prefix", inst.code === 0, inst.out);
  const nm = join(prefix, "node_modules");
  check("install closure excludes onnxruntime-node", !existsSync(join(nm, "onnxruntime-node")), readdirSync(nm).join(","));
  check("install closure excludes @huggingface/transformers", !existsSync(join(nm, "@huggingface")), readdirSync(nm).join(","));
  check("peer-optional: @anysearch-cli/embedding NOT auto-installed", !existsSync(join(nm, "@anysearch-cli", "embedding")), readdirSync(join(nm, "@anysearch-cli")).join(","));
  check("bundled internals absent from install closure", ["kernel", "store", "retriever"].every((b) => !existsSync(join(nm, "@anysearch-cli", b))), readdirSync(join(nm, "@anysearch-cli")).join(","));
  const bin = join(nm, ".bin", process.platform === "win32" ? "ans.cmd" : "ans");
  check("ans bin shim installed", existsSync(bin), bin);
  const ans = (args) => sh(`\"${bin}\" ${args}`, { cwd: prefix });

  // 3. Installed-surface walkthrough.
  const v = ans("--version");
  check("ans --version exit 0", v.code === 0, v.out);
  check("version is real (not 0.0.0)", /\d+\.\d+\.\d+/.test(v.out) && !/\b0\.0\.0\b/.test(v.out), v.out);

  const d1 = ans("doctor");
  check("installed doctor exit 0", d1.code === 0, d1.out);
  // R62 D-002: arm-absent telemetry is a doctor-visible SKIP, not a failure.
  check("doctor reports vector arm status", d1.out.includes("vector arm"), d1.out.slice(-600));
  check("doctor shows [5] Domains", d1.out.includes("[5] Domains"), d1.out.slice(-400));
  check("doctor lists docs domain", d1.out.includes("docs"), d1.out.slice(-400));

  const dom = ans("domain docs");
  check("ans domain docs exit 0", dom.code === 0, dom.out);
  check("domain switch resolves shipped toml", dom.out.includes("sources:"), dom.out);

  const d2 = ans("doctor");
  check("doctor shows active domain docs", d2.out.includes("active: docs"), d2.out.slice(-400));

  // 3b. R63 T5 (D-005): peer-optional dual-install — npm i cli + embedding into one
  // prefix lands both under the same node_modules root, and the app's bundled
  // import("@anysearch-cli/embedding") resolves (ADR-0020 pack+install verification).
  const embTgz = tgz.find((f) => f.startsWith("anysearch-cli-embedding-"));
  check("embedding tarball packed for peer leg", !!embTgz, tgz.join(","));
    // --omit=optional skips the heavy transformers/onnxruntime subtree — the peer leg
  // verifies package landing + bare-specifier resolution + arm-present telemetry;
  // the optional subtree itself is npm-side behavior, not ours.
  const inst2 = sh(`npm install --omit=optional ${JSON.stringify(join(outDir, embTgz))}`, { cwd: prefix });
  check("npm install embedding tarball (explicit peer)", inst2.code === 0, inst2.out);
  check("embedding lands at shared node_modules root", existsSync(join(nm, "@anysearch-cli", "embedding", "dist", "index.js")), "missing dist/index.js");
  // resolve from the real call-site dir (the bundled store code inside the installed cli)
  const cliDir = join(nm, "@anysearch-cli", "cli");
  const res = sh(`node --input-type=module -e "import('@anysearch-cli/embedding').then(m=>console.log('PEER_OK',typeof m.embedText)).catch(e=>{console.error('PEER_FAIL',e.message);process.exit(1)})"`, { cwd: cliDir });
  check("import('@anysearch-cli/embedding') resolves from installed cli", res.code === 0 && res.out.includes("PEER_OK"), res.out.slice(-300));
  const d3 = ans("doctor");
  check("doctor shows vector arm present after peer install", d3.code === 0 && !/embedding absent/.test(d3.out), d3.out.slice(-400));

  // 3c. R71 T1 (ADR-0072): pnpm-layout leg — isolated sibling node_modules
  // roots. pnpm add -g installs each top-level package in its own
  // <prefix>/global/v11/<hash>/node_modules tree, so the bundled
  // import("@anysearch-cli/embedding") cannot reach the sibling package — the
  // sibling-root fallback (embedding-arm.ts) anchors at argv[1] and scans
  // v11/*/node_modules. Simulate the layout: hashA holds junctions to every
  // installed package except embedding; hashB holds embedding alone;
  // --preserve-symlinks keeps resolution logical so the plain import misses
  // and the fallback is what finds it (spike: pnpm arm was red pre-fallback).
  const v11 = join(dir, "pnpm-global", "v11");
  const hashA = join(v11, "aaaaaaaa", "node_modules");
  const hashB = join(v11, "bbbbbbbb", "node_modules");
  mkdirSync(join(hashA, "@anysearch-cli"), { recursive: true });
  mkdirSync(join(hashB, "@anysearch-cli"), { recursive: true });
  for (const e of readdirSync(nm, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (e.name === "@anysearch-cli") {
      for (const sub of readdirSync(join(nm, "@anysearch-cli"))) {
        if (sub === "embedding") continue;
        symlinkSync(join(nm, "@anysearch-cli", sub), join(hashA, "@anysearch-cli", sub), "junction");
      }
    } else if (e.name !== ".bin") {
      symlinkSync(join(nm, e.name), join(hashA, e.name), "junction");
    }
  }
  symlinkSync(join(nm, "@anysearch-cli", "embedding"), join(hashB, "@anysearch-cli", "embedding"), "junction");
  const pd = sh(`node --preserve-symlinks --preserve-symlinks-main ${JSON.stringify(join(hashA, "@anysearch-cli", "cli", "dist", "index.js"))} doctor`, { cwd: prefix });
  check("pnpm-layout: doctor runs under isolated roots", pd.code === 0, pd.out.slice(-500));
  check("pnpm-layout: sibling-root fallback reports vector arm present", /vector arm \(present/.test(pd.out), pd.out.slice(-500));

  // 4. Search leg — online hard assertion or offline abstain contract.
  const online = Boolean(process.env.EXA_API_KEY || process.env.TAVILY_API_KEY);
  if (online) {
    const s = ans("search 'MCP Streamable HTTP transport session id'");
    check("search exit 0 with provider key", s.code === 0, s.out.slice(-400));
    check("search returns results", /Results: [1-9]/.test(s.out), s.out.slice(-400));
    check("a result lands on the docs urlAllowlist", ALLOWLIST.some((h) => s.out.includes(h)), s.out.slice(-400));
  } else {
    // R62 D-004: hermetic abstain leg. tavily/exa construct keyless (their
    // factories never throw), so "no keys" does NOT mean "only the anysearch
    // arm" — a probe domain narrows sources.enabled to [anysearch] explicitly,
    // and a dead port fault-injects that arm. Zero external network is touched,
    // in any network condition. Assertions anchor structured --json fields, not
    // the exit code (R62 D-003 teardown rewrites it intermittently) — abstain
    // is the contract; the exit-1/Results:0 shape is retired.
    const probeDir = join(dir, "probe-domains");
    mkdirSync(probeDir, { recursive: true });
    writeFileSync(join(probeDir, "probe.toml"), [
      'name = "probe"',
      'description = "install-smoke offline leg — single-arm fault-injection domain (R62 D-004)"',
      '[settings]', 'language = "TypeScript"', 'depth = "docs"',
      '[skills]', 'active = ["search"]',
      '[sources]', 'enabled = ["anysearch"]', 'urlAllowlist = ["nonexistent.invalid"]',
      '[rag]', 'adapter = "none"', ''
    ].join("\n"), "utf8");
    const s = sh(`\"${bin}\" search 'MCP Streamable HTTP transport session id' --json`, {
      cwd: prefix,
      env: { ...process.env, ANS_DOMAIN: "probe", ANS_DOMAINS_DIR: probeDir, ANYSEARCH_ENDPOINT: "http://127.0.0.1:9" },
    });
    let j = null;
    try { j = JSON.parse(s.stdout); } catch { /* null asserted below */ }
    check("offline search --json stdout parses", j !== null, s.out.slice(-400));
    check("offline abstain:true", j?.abstain?.abstain === true, s.out.slice(-400));
    check("providersFailed includes anysearch", Array.isArray(j?.providersFailed) && j.providersFailed.includes("anysearch"), s.out.slice(-400));
    check("offline results.length === 0", Array.isArray(j?.results) && j.results.length === 0, s.out.slice(-400));
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("install-smoke: " + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
