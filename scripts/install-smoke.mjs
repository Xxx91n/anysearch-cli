// #298 / #297 S1: pack the complete CLI product and optional embedding,
// install only the complete product into a clean prefix, then drive CLI,
// MCP and hook commands. Explicit embedding installation remains a second leg.
// Internal libraries and the old separate MCP/plugin apps are not installed.
//
// Online leg: only when EXA_API_KEY or TAVILY_API_KEY is set — one real search
// on the shipped docs domain must return >=1 result and name one of the docs
// hosts this lane watches (pnpm.io / typescriptlang.org /
// modelcontextprotocol.io).
//
// The two zero-result legs always run, keys or no keys. This repo's CI hands
// the job provider secrets, so an `if (online) … else { legs }` shape would run
// them only on the runs that have no keys — never on the runs that matter.
// Their checks live in 4a and 4b; what they are for:
//
// - Fault leg (4a): the probe domain's only arm (sources.enabled =
//   ["anysearch"]) points at a dead port (127.0.0.1:9), gets queried and fails,
//   so the run is `failed`, not `abstain`: exit 1, outcome "failed", no abstain
//   marker, zero results, providersFailed naming the arm. A build whose search
//   never queries an arm lands on `empty` instead, which this leg must reject.
// - Refusal leg (4b): the same probe domain points at a local fake AnySearch
//   MCP server (scripts/fake-anysearch-mcp.mjs) that answers two out-of-domain
//   URLs. An arm answered and the domain gate threw all of it away: exit 0,
//   outcome "abstain", gate "post", zero results, nobody failed, nothing cut
//   off. The stub has to be its own process — this script drives the CLI with
//   spawnSync, which blocks the event loop an in-process stub would need to
//   accept requests.
//
// Both legs' exit codes are read through checkExitCode(): a Windows teardown
// crash can rewrite the number, and it only warns when every structured check
// passed.
//
// A zero-result run whose every queried arm failed is a fault — the arm is
// down — and exits 1. Abstain means the domain really has nothing: the policy
// is active, no arm was cut off mid-flight, no provider answered on its own,
// and the emptiness has a reason — either the gate dropped results, or at least
// one arm was queried and every queried arm answered with nothing, none of them
// failing.
//
// Every CLI call this script drives goes through sh(), which carries a 30s
// bound and reports a timeout as a named failure (verifyInstalledProduct()
// carries its own 30s/90s bounds). The engine's own 4s deadline already covers
// a slow arm; this bound covers a wedged shell. On Windows the bound kills the
// cmd.exe wrapper, and a surviving node child can then make cleanup fail — that
// failure is surfaced, not swallowed.
//
// The offline golden lane is the committed
// packages/store/test/eval-docs-golden.test.ts suite inside `turbo test`.
//
// macOS limitation: covered by the ci.yml ponytail note — the only arm64 delta is
// the better-sqlite3 prebuild; add macos-latest when a real mac issue lands.
import { PROBE_CLEANUP_FAILED } from "./probe-process.mjs";
import { verifyInstalledProduct } from "./verify-installed-product.mjs";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
// the publish set. kernel/store/retriever are bundled into the apps'
// dist (build-time devDependencies) and are never published or installed.
const PACK_DIRS = [
  "apps/cli",
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
const CLI_TIMEOUT_MS = 30000;
let warned = 0;

// The exit code is part of the contract, but docs/limitations.md records that a
// Windows teardown crash can rewrite it. Called after a leg's structured checks,
// with legClean saying whether they all passed: a crash signature on a clean leg
// is the teardown fault and only warns, while a crash beside a red check is a
// real failure and stays red.
function checkExitCode(name, expected, run, legClean) {
  if (run.code === expected) return check(name, true);
  const teardownCrash = /libc\+\+abi|Abort trap|SIGSEGV|Segmentation fault/i.test(run.out) || run.code === 134;
  if (teardownCrash && legClean) {
    warned++;
    console.log("[WARN] " + name + " — teardown crash rewrote the exit code (got " + run.code + ")");
    return;
  }
  check(name, false, "exit " + run.code + ", wanted " + expected + "; " + run.out.slice(-300));
}

// `timeoutMs` bounds a single call. CLI calls pass it: the engine's own 4s
// deadline only covers the search itself, so this bound is what catches what
// that deadline cannot — a wedged shell, a console that never drains. Pack and
// install keep the platform default — they are not CLI calls, and a 30s cap
// there would fail the lane on a slow npm mirror.
function sh(cmd, opts = {}) {
  const { timeoutMs, ...rest } = opts;
  const r = spawnSync(cmd, {
    shell: true,
    encoding: "utf8",
    env: smokeEnv,
    ...(timeoutMs ? { timeout: timeoutMs } : {}),
    ...rest,
  });
  if (r.error?.code === "ETIMEDOUT") {
    return { code: 124, out: "timed out after " + timeoutMs + "ms: " + cmd, stdout: "" };
  }
  return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? ""), stdout: r.stdout ?? "" };
}

// Read the single PORT=<n> line the stub process prints, with a bound: a stub
// that never starts must fail this lane in seconds, not park it.
function readStubPort(child) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("stub printed no PORT line within 5s; saw: " + buf.slice(-300))), 5000);
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      const found = buf.match(/^PORT=(\d+)$/m);
      if (found) {
        clearTimeout(timer);
        resolve(Number(found[1]));
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("stub exited before printing PORT (code " + code + ")"));
    });
  });
}

const dir = mkdtempSync(join(tmpdir(), "ans-install-smoke-"));
const outDir = join(dir, "out");
const prefix = join(dir, "prefix");
mkdirSync(outDir, { recursive: true });
mkdirSync(prefix, { recursive: true });
writeFileSync(join(prefix, "package.json"), '{"name":"ans-smoke","private":true}', "utf8");

const smokeEnv = { ...process.env, HOME: dir, USERPROFILE: dir, ANS_DB_PATH: join(dir, "smoke.db") };

let preserveInstall = false;

try {
  // 1. Pack all workspace packages (workspace:* deps resolve to the packed versions).
  for (const d of PACK_DIRS) {
    const r = sh(`pnpm -C ${JSON.stringify(join(ROOT, d))} pack --pack-destination ${JSON.stringify(outDir)}`, { cwd: ROOT });
    if (r.code !== 0) check("pack " + d, false, r.out);
  }
  const tgz = readdirSync(outDir).filter((f) => f.endsWith(".tgz"));
  check("pack produced " + PACK_DIRS.length + " tarballs", tgz.length === PACK_DIRS.length, tgz.join(","));
  check("no stale 0.0.0 tarball", tgz.every((f) => !f.includes("0.0.0")), tgz.join(","));

  // Install only the public product. Keep it saved so the later explicit
  // embedding install does not prune it as an extraneous package.
  const appTgz = tgz.filter((f) => /anysearch-cli-cli-/.test(f));
  check("install set = one complete product tarball", appTgz.length === 1, tgz.join(","));
  const inst = sh(`npm install ${appTgz.map((f) => JSON.stringify(join(outDir, f))).join(" ")}`, { cwd: prefix });
  check("npm install clean prefix", inst.code === 0, inst.out);
  const nm = join(prefix, "node_modules");
  check("install closure excludes onnxruntime-node", !existsSync(join(nm, "onnxruntime-node")), readdirSync(nm).join(","));
  check("install closure excludes @huggingface/transformers", !existsSync(join(nm, "@huggingface")), readdirSync(nm).join(","));
  check("peer-optional: @anysearch-cli/embedding NOT auto-installed", !existsSync(join(nm, "@anysearch-cli", "embedding")), readdirSync(join(nm, "@anysearch-cli")).join(","));
  check("bundled internals absent from install closure", ["kernel", "store", "retriever"].every((b) => !existsSync(join(nm, "@anysearch-cli", b))), readdirSync(join(nm, "@anysearch-cli")).join(","));
  await verifyInstalledProduct(prefix, check);
  const bin = join(nm, ".bin", process.platform === "win32" ? "ans.cmd" : "ans");
  check("ans bin shim installed", existsSync(bin), bin);
  const ans = (args) => sh(`\"${bin}\" ${args}`, { cwd: prefix, env: smokeEnv, timeoutMs: CLI_TIMEOUT_MS });

  // 3. Installed-surface walkthrough.
  const v = ans("--version");
  check("ans --version exit 0", v.code === 0, v.out);
  check("version is real (not 0.0.0)", /\d+\.\d+\.\d+/.test(v.out) && !/\b0\.0\.0\b/.test(v.out), v.out);

  const d1 = ans("doctor");
  check("installed doctor exit 0", d1.code === 0, d1.out);
  // Every doctor check below shows the row it is about: the output's tail is all summary.
  const rowOf = (needle) => d1.out.split("\n").find((line) => line.includes(needle)) ?? d1.out;
  // Assert the state (未配置), not just the row name.
  check("doctor reports vector arm as 未配置 (absent in a clean prefix)", d1.out.includes("[未配置] vector arm"), rowOf("vector arm"));
  // Four layers: [安装]/[能力]/[宿主]/[数据].
  check("doctor shows the four layers", ["[安装]", "[能力]", "[宿主]", "[数据]"].every((l) => d1.out.includes(l)), d1.out.slice(0, 400));
  check("doctor shows the DB layout row", d1.out.includes("库布局"), rowOf("库布局"));
  // Name the shipped domain: the bare 领域文件 also appears on the failure row
  // ("领域文件发现"), which fires when no TOML was found at all.
  check("doctor shows the domain rows", d1.out.includes("领域文件 docs"), rowOf("领域文件 docs"));

  const dom = ans("domain docs");
  check("ans domain docs exit 0", dom.code === 0, dom.out);
  check("domain switch resolves shipped toml", dom.out.includes("领域已换成：docs"), dom.out);
  check("domain switch echoes the resolved declaration", dom.out.includes("信息源："), dom.out);

  const d2 = ans("doctor");
  check("doctor shows active domain docs", d2.out.includes("当前生效：docs"), d2.out.slice(-400));

  // 3b.: peer-optional dual-install — npm i cli + embedding into one
  // prefix lands both under the same node_modules root, and the app's bundled
  // import("@anysearch-cli/embedding") resolves (pack+install verification).
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

  // 3c.: pnpm-layout leg — isolated sibling node_modules
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
  const pd = sh(`node --preserve-symlinks --preserve-symlinks-main ${JSON.stringify(join(hashA, "@anysearch-cli", "cli", "dist", "index.js"))} doctor`, { cwd: prefix, timeoutMs: CLI_TIMEOUT_MS });
  check("pnpm-layout: doctor runs under isolated roots", pd.code === 0, pd.out.slice(-500));
  check("pnpm-layout: sibling-root fallback reports vector arm present", /vector arm.*present/.test(pd.out), pd.out.slice(-500));

  // 4. Search legs. The online leg runs only when this machine holds a search
  //    key; the two zero-result legs below always run.
  const online = Boolean(process.env.EXA_API_KEY || process.env.TAVILY_API_KEY);
  if (online) {
    const s = ans("search 'MCP Streamable HTTP transport session id'");
    check("search exit 0 with provider key", s.code === 0, s.out.slice(-400));
    check("search returns results", /Results: [1-9]/.test(s.out), s.out.slice(-400));
    check("a result lands on the docs urlAllowlist", ALLOWLIST.some((h) => s.out.includes(h)), s.out.slice(-400));
  } else {
    console.log("[SKIP] online search leg: no EXA_API_KEY / TAVILY_API_KEY");
  }

  // 4a/4b share one probe domain and differ only in the endpoint.
  //    tavily/exa construct keyless, so "no keys" does NOT mean "only the
  //    anysearch arm" — sources.enabled narrows the fanout explicitly, and the
  //    TOML allowlist stays the only policy authority (an ambient
  //    ANS_URL_ALLOWLIST could otherwise let a result survive and flip the
  //    refusal leg).
  const probeDir = join(dir, "probe-domains");
  mkdirSync(probeDir, { recursive: true });
  writeFileSync(join(probeDir, "probe.toml"), [
    'name = "probe"',
    'description = "install-smoke zero-result legs — single-arm fixture"',
    '[settings]', 'language = "TypeScript"', 'depth = "docs"',
    '[skills]', 'active = ["search"]',
    '[sources]', 'enabled = ["anysearch"]', 'urlAllowlist = ["nonexistent.invalid"]',
    '[rag]', 'adapter = "none"', ''
  ].join("\n"), "utf8");
  const probeEnv = {
    ...smokeEnv,
    ANS_DOMAIN: "probe",
    ANS_DOMAINS_DIR: probeDir,
    ANS_ALLOW_ENV_OVERRIDE: "0",
    // A shell-leftover ANS_PROVIDERS would filter the probe domain's one arm
    // out of the fanout and turn both legs into `empty`. Explicit empty.
    ANS_PROVIDERS: "",
  };
  const probeQuery = `\"${bin}\" search 'MCP Streamable HTTP transport session id' --json`;

  // 4a. Fault leg: the only arm is a dead port. An outage, not a refusal —
  //     asserting the outcome (not just providersFailed) is what stops a build
  //     whose search never queries an arm from passing here.
  {
    const s = sh(probeQuery, {
      cwd: prefix,
      env: { ...probeEnv, ANYSEARCH_ENDPOINT: "http://127.0.0.1:9" },
      timeoutMs: CLI_TIMEOUT_MS,
    });
    let j = null;
    try { j = JSON.parse(s.stdout); } catch { /* asserted below */ }
    const failedBefore = failed;
    check("fault leg: search --json stdout parses", j !== null, s.out.slice(-400));
    // A `cancelled` here means the engine's 4s deadline beat the dead port, not
    // that the arm answered — a red run is still the right signal, and this note
    // says where to look first.
    check("fault leg: outcome === failed", j?.outcome === "failed", "a cancelled verdict here means the 4s deadline beat the dead port; " + s.out.slice(-400));
    check("fault leg: no abstain marker", j?.abstain === null, s.out.slice(-400));
    check("fault leg: zero results", Array.isArray(j?.results) && j.results.length === 0, s.out.slice(-400));
    check("fault leg: providersQueried is [anysearch]", JSON.stringify(j?.providersQueried) === JSON.stringify(["anysearch"]), s.out.slice(-400));
    check("fault leg: providersFailed names anysearch", Array.isArray(j?.providersFailed) && j.providersFailed.includes("anysearch"), s.out.slice(-400));
    checkExitCode("fault leg: exit 1", 1, s, failed === failedBefore);
  }

  // 4b. Refusal leg: a local fake MCP server answers two out-of-domain URLs, so
  //     an arm answered and the gate threw it all away. gate "post" must hold:
  //     a marker alone would also be written when the stub answers nothing.
  {
    const stub = spawn(process.execPath, [join(ROOT, "scripts", "fake-anysearch-mcp.mjs")], {
      // stderr goes straight to this lane: nobody drains a pipe here, and a stub
      // that dies must say why in the log instead of only "exited before PORT".
      stdio: ["ignore", "pipe", "inherit"],
    });
    let port;
    try {
      port = await readStubPort(stub);
    } catch (error) {
      stub.kill();
      check("refusal leg: stub starts", false, String(error));
    }
    if (port === undefined) {
      // The named failure above already counted; there is nothing to drive.
      console.log("[SKIP] refusal leg: stub did not start");
    } else {
      try {
        const s = sh(probeQuery, {
          cwd: prefix,
          env: { ...probeEnv, ANYSEARCH_ENDPOINT: "http://127.0.0.1:" + port + "/mcp" },
          timeoutMs: CLI_TIMEOUT_MS,
        });
        let j = null;
        try { j = JSON.parse(s.stdout); } catch { /* asserted below */ }
        const failedBefore = failed;
        check("refusal leg: search --json stdout parses", j !== null, s.out.slice(-400));
        check("refusal leg: outcome === abstain", j?.outcome === "abstain", s.out.slice(-400));
        check("refusal leg: abstain marker set", j?.abstain?.abstain === true, s.out.slice(-400));
        check("refusal leg: gate === post", j?.abstain?.gate === "post", s.out.slice(-400));
        check("refusal leg: preFiltered >= 1", typeof j?.abstain?.preFiltered === "number" && j.abstain.preFiltered >= 1, s.out.slice(-400));
        check("refusal leg: postFiltered === 0", j?.abstain?.postFiltered === 0, s.out.slice(-400));
        check("refusal leg: zero results", Array.isArray(j?.results) && j.results.length === 0, s.out.slice(-400));
        check("refusal leg: providersQueried is [anysearch]", JSON.stringify(j?.providersQueried) === JSON.stringify(["anysearch"]), s.out.slice(-400));
        check("refusal leg: no provider failed", JSON.stringify(j?.providersFailed) === JSON.stringify([]), s.out.slice(-400));
        checkExitCode("refusal leg: exit 0", 0, s, failed === failedBefore);
      } finally {
        stub.kill();
      }
    }
  }
} catch (error) {
  if (error.code === PROBE_CLEANUP_FAILED) {
    preserveInstall = true;
    console.error("Probe cleanup incomplete; kept temporary installation: " + dir);
  }
  throw error;
} finally {
  if (!preserveInstall) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      // A surviving child on Windows can hold the temp prefix. Report it as a
      // named failure so the summary line still prints — true whenever the probe
      // itself did not throw; a throw from the probe body still wins, as it must.
      check("cleanup: temporary installation removed", false, String(error));
    }
  }
}

console.log("install-smoke: " + passed + " passed, " + failed + " failed" + (warned ? ", " + warned + " warning(s)" : ""));
process.exit(failed === 0 ? 0 : 1);
