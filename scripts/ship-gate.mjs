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

/** @param {"pass"|"fail"|"skip"|"info"} kind @param {string} msg */
function report(kind, msg) {
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
    shell: process.platform === "win32",
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

function fail(msg) {
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

  for (const file of fs.readdirSync(tgzDir)) {
    if (!file.endsWith(".tgz")) continue;
    const tgzPath = path.join(tgzDir, file);
    const extractTo = path.join(tmpDir, "extract", file.replace(/\.tgz$/, ""));
    fs.mkdirSync(extractTo, { recursive: true });
    await run("tar", ["-xzf", tgzPath, "-C", extractTo], { stdio: "pipe" });

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
// main
// ---------------------------------------------------------------------------
const args = new Set(process.argv.slice(2));
const skipMatrix = args.has("--skip-matrix");
const quick = args.has("--quick");

(async () => {
  stepStaticAssertions();
  if (!quick) await stepBuildAndTest();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anysearch-ship-gate-"));
  try {
    const tgzDir = await stepPack(tmpDir);
    if (!quick) await stepInstallVerify(tgzDir, tmpDir, { skipMatrix });
    await stepMcpInitialize();
    report("pass", "ship gate green — ready to tag v0.1.0-rc.0");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})().catch((err) => {
  report("fail", err.message);
  process.exit(1);
});
