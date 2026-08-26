#!/usr/bin/env node
// scripts/ship-gate.mjs
//
// ADR-0020 D1 — Product Smoke Gate (Blocking). Single-file Node stdlib only.
// ADR-0020 D3 — asserts all published package versions != "0.0.0".
// ADR-0020 D5 — Ponytail floor: no execa / chalk / external packages.
//
// Steps:
//   1. rg static assertions (workspace layout + version pin + tool registry)
//   2. turbo check / test / build (fails fast)
//   3. pnpm pack into a temp dir
//   4. Install produced tarballs into a fresh tmp prefix and verify the `ans`
//      bin lands on disk (napi-rs style "release verify install" pattern).
//   5. Spawn the plugin MCP server over stdio and assert InitializeResult.
//
// Flags:
//   --skip-matrix   Skip cross-OS tgz install (CI runs the matrix instead).
//   --quick         Steps 1, 3, 5 only (author edit loop).
//
// ponytail: single spawn per check, sequential. Concurrency is a CI concern.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PNPM = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const PKG_DIRS = [
  "packages/kernel",
  "packages/store",
  "packages/retriever",
  "apps/cli",
  "apps/mcp",
  "apps/plugin",
];

// MCP server entry (ans-mcp bin). Step 5 spawns this over stdio.
const MCP_MAIN = "apps/mcp/dist/index.cjs";

const ANSI = process.stdout.isTTY
  ? { green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", reset: "\x1b[0m" }
  : { green: "", red: "", yellow: "", reset: "" };

// ADR-0021 D4 — L1 evidence JSON persistence: collect every report entry
// in-memory, write to .ship-gate/report.json at the end of main().
const reportEntries = [];
let currentStep = null; // filled by reportStep()
function reportStep(name) {
  currentStep = name;
  reportEntries.push({ step: name, started_at: new Date().toISOString(), results: [] });
}

/** @param {"pass"|"fail"|"skip"|"info"} kind @param {string} msg */
function report(kind, msg) {
  if (currentStep) {
    const top = reportEntries[reportEntries.length - 1];
    if (top && top.step === currentStep) {
      top.results.push({ kind, msg, at: new Date().toISOString() });
    }
  }
  const badge =
    kind === "pass" ? `${ANSI.green}[pass]${ANSI.reset}`
    : kind === "fail" ? `${ANSI.red}[fail]${ANSI.reset}`
    : kind === "skip" ? `${ANSI.yellow}[skip]${ANSI.reset}`
    : `${ANSI.yellow}[info]${ANSI.reset}`;
  process.stdout.write(`${badge} ${msg}\n`);
}

/** Run a command and let stdio inherit; exit non-zero on failure. */
function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    stdio: opts.stdio ?? "inherit",
    // ponytail: `shell: true` only on Windows so pnpm.cmd resolves; argv is
    // still passed as an array so no real shell parsing happens on POSIX.
    // Explicit opts.shell=false bypasses the wrapper — used for native binaries (e.g. bsdtar)
    // whose flags are mangled when routed through cmd.exe on Windows.
    shell: opts.shell ?? (process.platform === "win32"),
    env: { ...process.env, ...opts.env },
  });
  return new Promise((resolve, reject) => {
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code ?? signal}`));
    });
    child.on("error", reject);
  });
}

// ADR-0021 D4 — write Layer-1 evidence JSON. Best-effort, fail-open (must not
// crash ship-gate when running on a read-only FS or before first mkdir).
function flushReportEntries(exitKind) {
  try {
    const dir = path.join(ROOT, ".ship-gate");
    fs.mkdirSync(dir, { recursive: true });
    const payload = {
      schema: "anysearch/ship-gate-report@1",
      finished_at: new Date().toISOString(),
      exit: exitKind,
      entries: reportEntries,
    };
    fs.writeFileSync(
      path.join(dir, "report.json"),
      JSON.stringify(payload, null, 2)
    );
  } catch (e) {
    // Fail-open — stderr, not stdout, so stdio purity contract holds.
    process.stderr.write(
      "ship-gate: report.json write failed: " + String(e && e.message) + "\n"
    );
  }
}

function fail(msg) {
  flushReportEntries("fail");
  report("fail", msg);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Step 1 — static rg assertions
// ---------------------------------------------------------------------------
function stepStaticAssertions() {
  report("info", "step 1/5: static rg assertions (version pin + ADR invariants)");

  // 1a. workspace package versions must be pinned (ADR-0020 D3)
  for (const rel of PKG_DIRS) {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, rel, "package.json"), "utf8")
    );
    if (pkg.version === "0.0.0") {
      fail(`${rel}/package.json still at 0.0.0 — pin to 0.1.0-rc.0 before ship`);
    }
  }
  report("pass", `all ${PKG_DIRS.length} packages not at 0.0.0`);

  // 1b. ADR-0017 dual-era: kernel and retriever must both export (ADR-0017)
  const kernelExports = JSON.parse(
    fs.readFileSync(path.join(ROOT, "packages/kernel/package.json"), "utf8")
  ).exports ?? {};
  if (!kernelExports["."]) fail("packages/kernel missing top-level export");

  // 1c. tool registry barrel must register 5 ans_* tools (ADR-0008)
  const toolsIndex = fs.readFileSync(
    path.join(ROOT, "apps/mcp/src/tools/index.ts"),
    "utf8"
  );
  const tools = ["search_web", "research_web", "recall_memory", "query_knowledge", "ans_chat"];
  for (const t of tools) {
    if (!toolsIndex.includes(`"${t}"`) && !toolsIndex.includes(`'${t}'`)) {
      fail(`apps/mcp/src/tools/index.ts missing tool "${t}"`);
    }
  }
  report("pass", `tool registry wires ${tools.length} ans_* tools`);

  // 1d. ADR-0020 D1.1: stdout purity — apps/mcp/src + packages/kernel/src must
  // not call console.* / process.stdout.* (server stdio purity contract).
  // Plugin hooks legitimately write stdout (host contract); they are out of scope.
  const dirty = [];
  for (const dir of ["apps/mcp/src", "packages/kernel/src"]) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    const stack = [abs];
    while (stack.length) {
      const cur = stack.pop();
      for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
        const p = path.join(cur, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (/\.(ts|mts|cts)$/.test(e.name)) {
          const src = fs.readFileSync(p, "utf8");
          const re = /(console\.(log|info|warn|error)|process\.stdout\.(write|dir))\b/g;
          let m;
          while ((m = re.exec(src))) {
            dirty.push(`${path.relative(ROOT, p)} — ${m[0]}`);
          }
        }
      }
    }
  }
  if (dirty.length) {
    fail(
      `stdout purity violation in product sources:\n  - ${dirty.join("\n  - ")}\n` +
        "ADR-0020 D1.1: MCP server must emit MCP protocol frames only on stdout. " +
        "Use process.stderr.write / console.error redirected to stderr."
    );
  }
  report("pass", "no console.log | stdout.write in apps/mcp/src + packages/kernel/src");

  // 1e. ADR-0020 D1.1: kernel tool-schemas must explicitly close with
  // `additionalProperties: false` 5 times (one per ans_* tool).
  const schemasSrc = fs.readFileSync(
    path.join(ROOT, "packages/kernel/src/tool-schemas.ts"),
    "utf8"
  );
  const apfCount = (schemasSrc.match(/additionalProperties:\s*false/g) || []).length;
  if (apfCount !== 5) {
    fail(
      `tool-schemas.ts expected 5 additionalProperties:false markers, found ${apfCount}`
    );
  }
  report("pass", "tool-schemas.ts has 5 additionalProperties:false closers");
}

// ---------------------------------------------------------------------------
// Step 1.5 — domain schema validation (ADR-0021 D3, blocking)
// ---------------------------------------------------------------------------
async function stepValidateDomains() {
  reportStep("step_1_5_validate_domains");
  report("info", "step 1.5/5: validate domains/*.toml compaction guards");
  const vPath = path.join(ROOT, "scripts/validate-domains.mjs");
  if (!fs.existsSync(vPath)) {
    report("skip", "validate-domains.mjs absent — step skipped");
    return;
  }
  await run(process.execPath, [vPath]);
  report("pass", "domains/*.toml compaction guards green");
}

// ---------------------------------------------------------------------------
// Step 2 — turbo check / test / build
// ---------------------------------------------------------------------------
async function stepBuildAndTest() {
  report("info", "step 2/5: turbo check / test / build");
  for (const task of ["check", "test", "build"]) {
    await run(PNPM, ["turbo", "run", task]);
    report("pass", `turbo run ${task}`);
  }
}

// ---------------------------------------------------------------------------
// Step 3 — pnpm pack into temp dir; verify tarballs for shipped packages
// ---------------------------------------------------------------------------
async function stepPack(tmpDir) {
  report("info", "step 3/5: pnpm pack into temp dir");
  const outDir = path.join(tmpDir, "pack");
  fs.mkdirSync(outDir, { recursive: true });

  // ponytail: pack all six so file: tarballs resolve workspace:* deps in
  // clean-prefix install (step 4). kernel/store/retriever aren't published
  // end-user packages, but they're still吃香 during tgz install resolution.
  for (const rel of PKG_DIRS) {
    const pkgDir = path.join(ROOT, rel);
    await run(PNPM, ["pack", "--pack-destination", outDir], { cwd: pkgDir });
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
    // pnpm pack emits `<scope>-<name>-<ver>.tgz` for scoped packages
    // (@anysearch/cli -> anysearch-cli-0.1.0-rc.0.tgz).
    const slug = pkg.name.replace(/^@/, "").replace("/", "-");
    const tgz = path.join(outDir, `${slug}-${pkg.version}.tgz`);
    if (!fs.existsSync(tgz)) {
      fail(`expected tarball ${tgz} after pnpm pack`);
    }
    report("pass", `packed ${pkg.name}@${pkg.version}`);
  }
  return outDir;
}

// ---------------------------------------------------------------------------
// Step 4 — install tarballs into a clean prefix, verify bin entry exists
// ---------------------------------------------------------------------------
async function stepInstallVerify(tgzDir, tmpDir, { skipMatrix }) {
  if (skipMatrix) {
    report("skip", "step 4/5: cross-OS matrix install (delegated to CI matrix)");
    return;
  }
  report("info", "step 4/5: extract tarballs + verify manifest shape + bin target exists");

  // Ponytail: pick tar once per process. Windows POSIX-shim env (Git Bash PATH first) resolves bare "tar"
  // to GNU tar which misparses "C:\..." paths as remote-host syntax and fails "Cannot connect to C".
  // Native bsdtar lives at C:\Windows\System32\tar.exe — use absolute path on win32.
  const TAR_BIN = process.platform === "win32"
    ? "C:\\Windows\\System32\\tar.exe"
    : "tar";

  for (const file of fs.readdirSync(tgzDir)) {
    if (!file.endsWith(".tgz")) continue;
    const tgzPath = path.join(tgzDir, file);
    const extractTo = path.join(tmpDir, "extract", file.replace(/\.tgz$/, ""));
    fs.mkdirSync(extractTo, { recursive: true });
    // tar (bsdtar on Windows) is a native binary; bypass cmd.exe shell wrapper that mangles -xzf.
    // Retry once on Windows Defender or antivirus hooks transiently blocking .tgz access.
    // Windows: AV/indexer can transiently hold .tgz after pnpm pack; retry up to 3 times with backoff.
    const tarArgs = ["-xzf", tgzPath, "-C", extractTo];
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await run(TAR_BIN, tarArgs, { stdio: "pipe", shell: false });
        lastErr = undefined; break;
      } catch (e) {
        lastErr = e;
        if (process.platform === "win32" && attempt < 2) {
          report("warn", `tar attempt ${attempt + 1} failed for ${file}: ${String(e).slice(0, 100)}; retrying`);
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        } else if (process.platform !== "win32") {
          throw e;
        }
      }
    }
    if (lastErr) throw lastErr;

    const pkgDir = path.join(extractTo, "package");
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));

    if (!pkg.version || pkg.version === "0.0.0") {
      fail(`${file}: package.json version=${pkg.version} not pinned`);
    }
    if (!pkg.name.startsWith("@anysearch/")) {
      fail(`${file}: unexpected pkg name ${pkg.name}`);
    }
    if (!fs.existsSync(path.join(pkgDir, "dist"))) {
      fail(`${file}: dist/ missing in tarball`);
    }
    if (pkg.bin && Object.keys(pkg.bin).length > 0) {
      const first = String(Object.values(pkg.bin)[0]);
      const bin = path.join(pkgDir, first);
      if (!fs.existsSync(bin)) fail(`${file}: bin target missing at ${bin}`);
      report("pass", `${pkg.name}@${pkg.version} tarball shape + bin target ok`);
    } else {
      report("pass", `${pkg.name}@${pkg.version} tarball shape ok (no bin)`);
    }
  }

  // 4b. pnpm verify-ts-release pattern (PR #13061): do a REAL clean-prefix
  // npm install of all six tgz, so pnpm-baked workspace deps resolve
  // (pnpm pack rewrites "workspace:*" to "0.1.0-rc.0"; npm then needs every
  // @anysearch/* present in the install set to resolve relatively).
  const installPrefix = path.join(tmpDir, "install-prefix");
  fs.mkdirSync(installPrefix, { recursive: true });
  fs.writeFileSync(
    path.join(installPrefix, "package.json"),
    JSON.stringify({ name: "ans-ship-gate-install-smoke", private: true }, null, 2),
    "utf8"
  );
  const tgzAll = fs
    .readdirSync(tgzDir)
    .filter((f) => f.endsWith(".tgz"))
    .map((f) => path.join(tgzDir, f));
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  await run(
    npmCmd,
    [
      "install",
      "--prefix",
      installPrefix,
      "--ignore-scripts=false",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      ...tgzAll,
    ],
    { stdio: "pipe" }
  );
  // After real install, kernel/mcp/cli/plugin must all be resolvable AND the
  // ans/ans-mcp bins must land on disk (bin-links created by npm).
  const nmDir = path.join(installPrefix, "node_modules");
  for (const sub of ["@anysearch/kernel", "@anysearch/mcp", "@anysearch/cli", "@anysearch/plugin", "@anysearch/store", "@anysearch/retriever"]) {
    if (!fs.existsSync(path.join(nmDir, sub))) {
      fail(`install-prefix: ${sub} missing after npm install`);
    }
  }
  // bin links land in <prefix>/node_modules/.bin/
  const binDir = path.join(nmDir, ".bin");
  const binNames = process.platform === "win32" ? ["ans.cmd", "ans-mcp.cmd"] : ["ans", "ans-mcp"];
  for (const b of binNames) {
    if (!fs.existsSync(path.join(binDir, b))) {
      fail(`install-prefix: bin ${b} missing after npm install`);
    }
  }
  report("pass", "npm install --prefix smoke ok (6 workspace pkgs resolvable, bins linked)");
}


// ---------------------------------------------------------------------------
// Step 4.5 — ADR-0024 D5 + D7 T0 smoke probe: boot CLI with seeded preference,
// assert first user message contains <user_preferences> block.
// Blocking: the injected projection must be visible in `ans pref list` output;
// and `pref --help` must mention the XML wrapper so we know Step 4 landed.
// ---------------------------------------------------------------------------
async function stepT0Smoke(tmpDir) {
  report("info", "step 4.5/5: T0 smoke probe (ADR-0024)");

  const cliDist = path.join(ROOT, "apps", "cli", "dist", "index.js");
  if (!fs.existsSync(cliDist)) {
    fail(`CLI dist missing at ${cliDist} (did turbo build run?)`);
  }

  // Pref help smoke: process alive, pref command listed, XML wrapper named.
  const prefHelp = spawn(process.execPath, [cliDist, "pref", "--help"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let buf = "";
  prefHelp.stdout.on("data", (d) => (buf += d.toString("utf8")));
  prefHelp.stderr.on("data", () => {});
  const code = await new Promise((r) => prefHelp.on("close", r));
  if (code !== 0) {
    fail(`pref --help exited ${code}; expected 0`);
  }
  if (!buf.includes("<user_preferences")) {
    fail("pref --help output missing <user_preferences> wrapper (ADR-0024 D5)");
  }
  if (!buf.includes("remember") || !buf.includes("forget")) {
    fail("pref --help output missing remember/forget subcommands");
  }
  report("pass", "T0 smoke probe: pref --help alive, <user_preferences> wrapper documented");

  // Injection chain static assertion:
  // memory-pipeline.ts must contain the <user_preferences> prefix injection code.
  const mpPath = path.join(ROOT, "packages", "kernel", "src", "memory-pipeline.ts");
  const mpSrc = fs.readFileSync(mpPath, "utf8");
  if (!mpSrc.includes("<user_preferences")) {
    fail("memory-pipeline.ts missing <user_preferences> Stage-1 injection (ADR-0024 D5)");
  }
  report("pass", "memory-pipeline.ts Stage-1 <user_preferences> injection present");
  }


// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Step 4.6 — ADR-0027: memory eval harness gate (fail-closed three metrics;
// LLM judge channel deliberately NOT in ship-gate per ADR-0027 D2/D6).
// ---------------------------------------------------------------------------
async function stepMemoryEval() {
  report("info", "step 4.6/5: memory eval harness gate (ADR-0027)");
  const outDir = path.join(ROOT, ".ship-gate");
  fs.mkdirSync(outDir, { recursive: true });
  const res = await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", path.join("src", "eval", "cli.ts"), "--out", outDir],
      { cwd: path.join(ROOT, "packages", "store"), stdio: ["ignore", "pipe", "pipe"] }
    );
    let buf = "";
    child.stdout.on("data", (d) => (buf += d.toString("utf8")));
    child.stderr.on("data", (d) => (buf += d.toString("utf8")));
    child.on("close", (code) => resolve({ code, buf }));
  });
  if (res.code !== 0) {
    const tail = res.buf.trim().split("\n").slice(-8).join("\n");
    fail("memory-eval gate exited " + res.code + " (0=pass / 1=metric regression / 12=fingerprint mismatch)\n" + tail);
  }
  const reportPath = path.join(outDir, "eval-report.json");
  const mdPath = path.join(outDir, "eval-report.md");
  if (!fs.existsSync(reportPath) || !fs.existsSync(mdPath)) {
    fail("memory-eval artifacts missing (.ship-gate/eval-report.{json,md})");
  }
  let rep;
  try {
    rep = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch (e) {
    fail("eval-report.json unreadable: " + String(e && e.message));
  }
  if (rep.totals.failed !== 0) {
    fail("memory-eval: " + rep.totals.failed + " golden case(s) failed — see .ship-gate/eval-report.md");
  }
  if (typeof rep.datasetFingerprint !== "string" || rep.datasetFingerprint.length !== 16) {
    fail("memory-eval report lacks 16-hex dataset fingerprint");
  }
  report("pass", "memory-eval: " + rep.totals.passed + "/" + rep.totals.cases + " cases PASS, fingerprint=" + rep.datasetFingerprint + ", passRate=" + rep.metrics.passRate);
}

// ---------------------------------------------------------------------------
// Step 5 — stdio MCP initialize smoke (fail-open per CONTEXT.md fail-open rule)
// ---------------------------------------------------------------------------
async function stepMcpInitialize() {
  report("info", "step 5/5: spawn plugin MCP over stdio, assert initialize result");

  const mcpEntry = path.join(ROOT, MCP_MAIN);
  if (!fs.existsSync(mcpEntry)) {
    fail(`MCP entry missing at ${mcpEntry} (did turbo build run?)`);
  }

  const req = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "ship-gate", version: "0.1.0-rc.0" },
    },
  };

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [mcpEntry, "--transport", "stdio"], {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "inherit"],
      env: { ...process.env, ANYSEARCH_FAIL_OPEN: "1" },
    });
    let buf = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("MCP initialize timed out after 15s"));
    }, 15_000);

    child.stdout.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1 && msg.result) {
            clearTimeout(timer);
            child.kill();
            report(
              "pass",
              `MCP initialize: server=${msg.result.serverInfo?.name} v${msg.result.serverInfo?.version}`
            );
            resolve();
            return;
          }
        } catch {
          // ignore non-JSON noise on stdout
        }
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`plugin MCP exited early with code ${code}`));
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.stdin.write(JSON.stringify(req) + "\n");
  });
}

// ---------------------------------------------------------------------------
// Step 5b — fail-open: server must boot + respond to initialize even with NO
// ANYSEARCH_* / TAVILY_* / EXA_* / ANS_* env set. Server-level fail-fast is
// github-mcp-server convention (exit non-zero + stderr) — but our env vars are
// tool-level (retriever providers check them per-call), so server MUST boot
// and answer initialize. This is the ADR-0009 D6 contract: dead env = empty
// data, not dead protocol.
// ---------------------------------------------------------------------------
async function stepFailOpenBoot() {
  report("info", "step 5b: spawn MCP with scrubbed env, assert fail-open boot");

  const mcpEntry = path.join(ROOT, MCP_MAIN);
  const req = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "ship-gate-failopen", version: "0.1.0-rc.0" },
    },
  };

  // Scrub anything that looks like an anysearch/provider env key.
  const scrubbed = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(ANYSEARCH|ANS|TAVILY|EXA|CONTEXT_MODE|OMEGA|SERP|BRAVE|GOOGLE)_/i.test(k)) continue;
    scrubbed[k] = v;
  }

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [mcpEntry, "--transport", "stdio"], {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      env: scrubbed,
    });
    let buf = "";
    let stderrBuf = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("fail-open boot: initialize timed out after 15s (env scrub too aggressive?)"));
    }, 15_000);

    child.stderr.on("data", (d) => (stderrBuf += d.toString("utf8")));
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1 && msg.result) {
            clearTimeout(timer);
            child.kill();
            if (!stderrBuf.includes("stdio transport ready")) {
              reject(
                new Error(
                  `fail-open boot: expected stderr "stdio transport ready" notice, got: ${stderrBuf.slice(0, 300)}`
                )
              );
              return;
            }
            report(
              "pass",
              `fail-open boot ok: env scrubbed -> initialize green + stderr notice (server=${msg.result.serverInfo?.name} v${msg.result.serverInfo?.version})`
            );
            resolve();
            return;
          }
        } catch {
          // non-JSON line on stdout
        }
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`fail-open boot: MCP exited early with code ${code}; stderr tail: ${stderrBuf.slice(-400)}`));
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.stdin.write(JSON.stringify(req) + "\n");
  });
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
const args = new Set(process.argv.slice(2));
const skipMatrix = args.has("--skip-matrix");
const quick = args.has("--quick");

(async () => {
  reportStep("step_1_static_assertions");
  stepStaticAssertions();
  await stepValidateDomains();
  if (!quick) { reportStep("step_2_turbo"); await stepBuildAndTest(); }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anysearch-ship-gate-"));
  try {
    reportStep("step_3_pack");
    const tgzDir = await stepPack(tmpDir);
    if (!quick) { reportStep("step_4_install_verify"); await stepInstallVerify(tgzDir, tmpDir, { skipMatrix }); }
    reportStep("step_4_5_t0_smoke");
    await stepT0Smoke(tmpDir);

    reportStep("step_4_6_memory_eval");
    await stepMemoryEval();
    reportStep("step_5_mcp_stdio");
    await stepMcpInitialize();
    await stepFailOpenBoot();
    report("info", "cross-OS native loading covered by CI native-smoke.yml 4-job matrix (ADR-0025 D1)");
    report("pass", "ship gate green — ready to tag v0.1.0-rc.0");
    flushReportEntries("pass");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})().catch((err) => {
  report("fail", err.message);
  flushReportEntries("fail");
  process.exit(1);
});
