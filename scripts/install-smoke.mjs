// ADR-0061 B2/T2: real install-to-use lane — pack every workspace package to tgz,
// npm-install them into a clean temp prefix, then drive the INSTALLED `ans` bin
// through --version / doctor / domain docs / doctor / search.
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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PACK_DIRS = [
  "packages/kernel",
  "packages/embedding",
  "packages/store",
  "packages/retriever",
  "apps/cli",
  "apps/mcp",
  "apps/plugin",
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

  // 2. Clean install into the temp prefix.
  const inst = sh(`npm install --no-save ${tgz.map((f) => JSON.stringify(join(outDir, f))).join(" ")}`, { cwd: prefix });
  check("npm install clean prefix", inst.code === 0, inst.out);
  const bin = join(prefix, "node_modules", ".bin", process.platform === "win32" ? "ans.cmd" : "ans");
  check("ans bin shim installed", existsSync(bin), bin);
  const ans = (args) => sh(`\"${bin}\" ${args}`, { cwd: prefix });

  // 3. Installed-surface walkthrough.
  const v = ans("--version");
  check("ans --version exit 0", v.code === 0, v.out);
  check("version is real (not 0.0.0)", /\d+\.\d+\.\d+/.test(v.out) && !/\b0\.0\.0\b/.test(v.out), v.out);

  const d1 = ans("doctor");
  check("installed doctor exit 0", d1.code === 0, d1.out);
  check("doctor shows [5] Domains", d1.out.includes("[5] Domains"), d1.out.slice(-400));
  check("doctor lists docs domain", d1.out.includes("docs"), d1.out.slice(-400));

  const dom = ans("domain docs");
  check("ans domain docs exit 0", dom.code === 0, dom.out);
  check("domain switch resolves shipped toml", dom.out.includes("sources:"), dom.out);

  const d2 = ans("doctor");
  check("doctor shows active domain docs", d2.out.includes("active: docs"), d2.out.slice(-400));

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
