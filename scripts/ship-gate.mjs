#!/usr/bin/env node
// scripts/ship-gate.mjs
//
// ADR-0020 D1 — Product Smoke Gate (Blocking). Single-file Node stdlib only.
// ADR-0020 D3 — asserts all published package versions != "0.0.0".
// ADR-0020 D5 — Ponytail floor: no execa / chalk / external packages.
//
// Steps:
//   1. task parity + rg static assertions (workspace + version pin + registry)
//   2. domain schema validation (ADR-0021 D3)
//   3. turbo check / test / build (fails fast)
//   4. pnpm pack into a temp dir
//   5. Install produced tarballs into a fresh tmp prefix and verify the `ans`
//      bin lands on disk (napi-rs style "release verify install" pattern).
//   6. T0 smoke probe (ADR-0024)
//   7. memory eval harness gate (ADR-0027 / ADR-0028)
//   8. Spawn the plugin MCP server over stdio and assert InitializeResult.
//   9. fail-open boot: server must answer initialize with no anysearch backend.
//
// Flags:
//   --skip-matrix   Skip cross-OS tgz install (CI runs the matrix instead).
//   --quick         Skips step 3 (turbo) and step 5 (install); author edit loop.
//
// ponytail: single spawn per check, sequential. Concurrency is a CI concern.

import { spawn, spawnSync } from "node:child_process";
import { readGainLedger, writeGainLedger, applyTier, applyResolution, mustFail, WARN_STREAK_LIMIT } from "./gain-ledger.mjs";
import { evalIntegrityCheck, SHIP_OVERRIDE_REASON_CODES } from "./eval-integrity-contract.mjs";
import { checkQuarantineRatchet } from "./quarantine-ratchet.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// F-12: do NOT hardcode ".cmd". The standalone pnpm that pnpm/setup@v2
// installs on CI ships pnpm.exe (no pnpm.cmd), while a corepack/npm install
// ships pnpm.cmd. Bare "pnpm" lets cmd.exe resolve either via PATHEXT.
const PNPM = "pnpm";

const PKG_DIRS = [
  "packages/kernel",
  "packages/embedding",
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

function failUnverifiable(msg) {
  flushReportEntries("unverifiable");
  report("fail", msg);
  process.exit(2);
}

// ADR-0041 D1 (supersedes ADR-0040 D5/D6's raw spawn): layered verification object.
// (a) ANS_DB_PATH explicitly set but the file is missing -> misconfiguration -> fail (fail-closed);
// (b) a consumable db exists (ANS_DB_PATH or ~/.anysearch default) -> consumed track;
// (c) neither -> gate-built track: chain-gate-fixture.ts materializes .ship-gate/chain-gate.db
//     through the real SqliteSessionStore write path, verified via an explicit --db argument.
// Pass requires exit 0 AND JSON verdict "PASSED" (CVE-2025-25204 lesson); gate-built track
// additionally requires chainedRows >= 1 — an empty chain must not render green (Sigstore:
// absent evidence must fail-closed; "empty gate must be loud", r106 audit F-01). The skip ledger
// (ADR-0039 D7) is retained as defense-in-depth for the remaining exit-2 surface.
function stepAccessChainVerify() {
  const verifyScript = path.join(ROOT, "scripts", "verify-access-events.mjs");
  const ledgerPath = path.join(ROOT, ".ship-gate", "access-chain-skip-ledger.json");
  const readLedger = () => { try { return JSON.parse(fs.readFileSync(ledgerPath, "utf8")); } catch { return { schema: "anysearch/access-chain-skip-ledger@1", consecutiveWarn: 0, history: [] }; } };
  const writeLedger = (l) => { fs.mkdirSync(path.dirname(ledgerPath), { recursive: true }); fs.writeFileSync(ledgerPath, JSON.stringify(l, null, 2)); };
  let object;
  let dbArgs = [];
  const explicitDb = process.env.ANS_DB_PATH;
  if (explicitDb !== undefined) {
    if (!explicitDb || !fs.existsSync(explicitDb)) fail("ANS_DB_PATH is set but the database does not exist: " + explicitDb + " — misconfiguration, fail-closed (ADR-0041 D1)");
    object = "consumed";
  } else if (fs.existsSync(path.join(process.env.USERPROFILE || process.env.HOME || ".", ".anysearch", "anysearch.db"))) {
    object = "consumed";
  } else {
    object = "gate-built";
    const fx = spawnSync(process.execPath, ["--import", "tsx", path.join(ROOT, "scripts", "chain-gate-fixture.ts")], {
      cwd: path.join(ROOT, "packages", "store"), stdio: ["ignore", "pipe", "pipe"], env: process.env,
    });
    const fxOut = String(fx.stdout ?? "").trim().split("\n").pop() ?? "";
    if (fx.status !== 0 || !fxOut) fail("chain-gate fixture build failed (exit " + fx.status + "): " + String(fx.stderr ?? "").trim().slice(0, 300));
    dbArgs = ["--db", fxOut];
  }
  const res = spawnSync(process.execPath, [verifyScript, ...dbArgs], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: process.env,
  });
  const out = String(res.stdout ?? "").trim().split("\n").pop() ?? "";
  let parsed = null;
  try { parsed = JSON.parse(out); } catch { /* non-JSON output -> cannot satisfy double-check */ }
  if (res.status === 0 && parsed && parsed.verdict === "PASSED" && (object !== "gate-built" || (parsed.chainedRows ?? 0) >= 1)) {
    const l = readLedger(); l.consecutiveWarn = 0; l.history.push({ at: new Date().toISOString(), result: "pass", object }); writeLedger(l);
    report("pass", "access-events chain verified (object=" + object + ", exit 0 + verdict PASSED" + (object === "gate-built" ? ", chainedRows=" + parsed.chainedRows + " non-vacuous" : "") + "): " + out.slice(0, 160));
    return;
  }
  if (res.status === 2) {
    const l = readLedger(); l.consecutiveWarn += 1; l.history.push({ at: new Date().toISOString(), result: "skip-no-db", object }); writeLedger(l);
    if (l.consecutiveWarn >= 3) fail("access-chain verify skip streak " + l.consecutiveWarn + " >= 3 — forced human review: node scripts/gain-warn-resolve.mjs --decision stay-warn --note access-chain-no-db --ledger " + ledgerPath + " (ADR-0039 D7 discipline)");
    report("skip", "access-chain verifier: no database resolved — explicit skip, ledger streak " + l.consecutiveWarn + "/3");
    return;
  }
  fail("access-events chain verification failed (object " + object + ", exit " + res.status + (res.status === 0 ? ", verdict " + (parsed && parsed.verdict) : "") + "): " + out + (res.stderr ? " stderr: " + String(res.stderr).trim().slice(0, 300) : ""));
}

// ---------------------------------------------------------------------------
// Step 1 — static rg assertions
// ---------------------------------------------------------------------------
// ADR-0028 D5: synchronous stdio-piped invocation of the zero-dep parity gate.
function step1TaskParity() {
  const res = spawnSync(process.execPath, [path.join(ROOT, "scripts", "task-parity.mjs")], { cwd: ROOT, stdio: ["ignore", "inherit", "pipe"] });
  if (res.error) fail("task-parity spawn error: " + res.error.message);
  if (res.status !== 0) fail("task-parity gate red:\n" + String(res.stderr ?? "").trim());
  report("pass", "task parity: check/test implemented in all packages");
}

function stepStaticAssertions() {
  // ADR-0028 D5: task-parity gate runs first — turbo skip-if-absent masks missing check/test scripts, so parity is asserted here before anything else.
  step1TaskParity();
  report("info", "step 1/9: task parity + static rg assertions (version pin + ADR invariants)");

  // 1a. workspace package versions must be pinned (ADR-0020 D3)
  for (const rel of PKG_DIRS) {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, rel, "package.json"), "utf8")
    );
    // R62 due-chore: hard pin — every workspace package must be exactly the
    // release version (the release candidate), not merely "not 0.0.0".
    // Bump this pin in the same commit as the package version bump (R66 audit F-01).
    if (pkg.version !== "0.0.5") {
      fail(`${rel}/package.json not pinned at 0.0.5 (got ${pkg.version}) — release pin (D-006 patch-start)`);
    }
  }
  report("pass", `all ${PKG_DIRS.length} packages pinned at 0.0.5`);

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
  // 1f. ADR-0034 D5: attribution module exists with required exports.
  {
    const attPath = path.join(ROOT, "packages/kernel/src/attribution.ts");
    if (!fs.existsSync(attPath)) fail("ADR-0034: packages/kernel/src/attribution.ts missing");
    const att = fs.readFileSync(attPath, "utf8");
    const required = ["export function tokenize", "export function buildAttributionReport", "export function deriveGapRequests", "export function classifyClaim", "export function attachAttribution"];
    for (const req of required) {
      if (!att.includes(req)) fail("ADR-0034 attribution.ts missing export: " + req);
    }
    report("pass", "attribution module exports present");
  }

  // 1g. ADR-0034 D5: TypeBox schema parity — attribution-schema.ts must exist and mirror the runtime Attribution interface.
  {
    const schemaPath = path.join(ROOT, "packages/kernel/src/attribution-schema.ts");
    if (!fs.existsSync(schemaPath)) fail("ADR-0034: packages/kernel/src/attribution-schema.ts missing");
    const sch = fs.readFileSync(schemaPath, "utf8");
    const apf = (sch.match(/additionalProperties:\s*false/g) || []).length;
    if (apf < 4) {
      fail("ADR-0034 1g: attribution-schema.ts must close additionalProperties:false on all 4 object schemas (evidence/claim/gap/report), found " + apf);
    }
    for (const tok of ["AttributionReportSchema", "ClaimSchema", "GapRequestSchema", "AttributionEvidenceSchema",
      '"supported"', '"uncertain"', '"unsupported"', '"no_evidence"', '"partial_evidence"', '"conflicting_evidence"']) {
      if (!sch.includes(tok)) fail("ADR-0034 1g: attribution-schema.ts missing " + tok);
    }
    report("pass", "attribution TypeBox schema parity (4 additionalProperties closers + enums present)");
  }

  // 1h. ADR-0034 D5: IR contract — FusedEnvelope.attribution field must be declared before it is consumed.
  {
    const contractPath = path.join(ROOT, "packages/retriever/src/contract.ts");
    const cSrc = fs.readFileSync(contractPath, "utf8");
    if (!cSrc.includes("attribution?: AttributionReport")) {
      fail("ADR-0034: FusedEnvelope missing attribution?: AttributionReport field");
    }
    report("pass", "FusedEnvelope.attribution declared");
  }

  // 1i. ADR-0034 D4 D5: MCP dual-channel equivalence — both search_web and research_web must
  // surface attribution in BOTH the content JSON and structuredContent.
  {
    for (const tool of ["search-web.tool.ts", "research-web.tool.ts"]) {
      const src = fs.readFileSync(path.join(ROOT, "apps/mcp/src/tools", tool), "utf8");
      if (!src.includes("structuredContent")) fail("ADR-0034 1i: " + tool + " lacks structuredContent channel");
      const attrCount = (src.match(/attribution/g) || []).length;
      if (attrCount < 3) fail("ADR-0034 1i: " + tool + " attribution wiring incomplete (found " + attrCount + " occurrences)");
    }
    report("pass", "MCP search/research dual-channel attribution (content + structuredContent)");

    // 1i-fusion. ADR-0045 D2/D3: fusion governance static assertions (r118 impl).
    // Registry wiring: three split 60s are consumed from FUSION_REGISTRY at their single
    // decision points; rrf.ts carries no implicit k default.
    {
      const regSrc = fs.readFileSync(path.join(ROOT, "packages", "retriever", "src", "fusion-registry.ts"), "utf8");
      if (!regSrc.includes("anysearch/fusion-registry@1")) fail("fusion-registry.ts missing schema marker");
      const wiring = [
        ["packages/store/src/session-store.ts", "FUSION_REGISTRY.k_fusion.memory"],
        ["packages/store/src/fts5.ts", "FUSION_REGISTRY.k_fusion.memory"],
        ["packages/kernel/src/engine.ts", "FUSION_REGISTRY.k_fusion.web"],
        ["packages/store/src/eval/runner.ts", "FUSION_REGISTRY.ror_window"],
        ['packages/store/src/session-store.ts', 'registryWeight("memory", "fts")'],
        ["packages/kernel/src/engine.ts", "FUSION_REGISTRY.weights.web"],
        ["packages/retriever/src/fusion-registry.ts", "armAbsentSemantics"],
      ];
      for (const [rel, needle] of wiring) {
        if (!fs.readFileSync(path.join(ROOT, rel), "utf8").includes(needle)) {
          fail(rel + " not wired to " + needle + " (ADR-0045 D2 registry drift)");
        }
      }
      const rrfSrc = fs.readFileSync(path.join(ROOT, "packages", "retriever", "src", "rrf.ts"), "utf8");
      if (/k\s*=\s*60/.test(rrfSrc)) fail("rrf.ts still carries an implicit k=60 default (ADR-0045 D2)");
      report("pass", "ADR-0045 fusion-registry wiring: k split registered, no implicit default");

      // score_kind discipline: common provenance shape present; no bare fused score on
      // NormalizedResult (fused score is a rank_fusion signal only, ADR-0045 D3).
      const contractSrc = fs.readFileSync(path.join(ROOT, "packages", "retriever", "src", "contract.ts"), "utf8");
      const nrStart = contractSrc.indexOf("export interface NormalizedResult");
      const nrEnd = contractSrc.indexOf("export interface ProviderEnvelope");
      if (nrStart < 0 || nrEnd < 0) fail("contract.ts NormalizedResult block not found");
      const nrBlock = contractSrc.slice(nrStart, nrEnd);
      if (/^\s*score\s*[:=]/m.test(nrBlock)) fail("NormalizedResult carries a bare score field (ADR-0045 D3)");
      if (!contractSrc.includes('scoreKind: "rank_fusion"')) fail("contract.ts missing rank_fusion scoreKind");
      const engSrc = fs.readFileSync(path.join(ROOT, "packages", "kernel", "src", "engine.ts"), "utf8");
      if (!engSrc.includes("SCORE_KIND")) fail("engine.ts missing score_kind provenance annotation (ADR-0045 D3)");
      const ssSrc = fs.readFileSync(path.join(ROOT, "packages", "store", "src", "session-store.ts"), "utf8");
      if (!ssSrc.includes("SCORE_KIND")) fail("session-store.ts missing score_kind provenance annotation (ADR-0045 D3)");
      report("pass", "ADR-0045 score_kind discipline: no bare fused score on NormalizedResult");
    }

    // 1j. ADR-0035 D2/D3/D4/D6: KG-lite relation layer static assertions.
    {
      const relPath = path.join(ROOT, "packages/store/src/relation.ts");
      if (!fs.existsSync(relPath)) fail("ADR-0035 1j: packages/store/src/relation.ts missing");
      const rel = fs.readFileSync(relPath, "utf8");
      for (const tok of ["PREDICATES", "EDGE_PATTERN_ROWS", "extractRelations", "parseLlmTriples", "RELATION_RULES_VERSION"])
        if (!rel.includes(tok)) fail("ADR-0035 1j: relation.ts missing " + tok);
      const sql = fs.readFileSync(path.join(ROOT, "packages/store/src/schema.sql"), "utf8");
      for (const tok of ["IF NOT EXISTS edges", "idx_edges_active_triple", "edge_patterns", "rules_version"])
        if (!sql.includes(tok)) fail("ADR-0035 1j: schema.sql missing " + tok);
      const ss = fs.readFileSync(path.join(ROOT, "packages/store/src/session-store.ts"), "utf8");
      for (const tok of ["relationArmRows", "backfillRelations", "relationTelemetry", "linkRelations"])
        if (!ss.includes(tok)) fail("ADR-0035 1j: session-store.ts missing " + tok);
      if (!ss.includes('label: "relation"')) fail("ADR-0035 1j: session-store.ts missing the fifth-arm label (RRF extraArms wiring)");
      const cliRel = fs.readFileSync(path.join(ROOT, "apps/cli/src/commands/relation.ts"), "utf8");
      if (!cliRel.includes("backfill-relations")) fail("ADR-0035 1j: CLI relation command missing backfill-relations");
      report("pass", "ADR-0035 KG-lite layer: relation module + edges schema + store hooks + fifth-arm label + CLI present");
    }
    // 1n. ADR-0037 D3/D4/D5/D6: consolidation + forgetting layer static assertions.
    {
      const conPath = path.join(ROOT, "packages/store/src/consolidate.ts");
      if (!fs.existsSync(conPath)) fail("ADR-0037 1n: packages/store/src/consolidate.ts missing");
      const con = fs.readFileSync(conPath, "utf8");
      for (const tok of ["consolidateMemoryRun", "decideOp", "THETA_DUP", "BEGIN IMMEDIATE", "scanArchiveCandidates", "undoArchive", "applyArchive"])
        if (!con.includes(tok)) fail("ADR-0037 1n: consolidate.ts missing " + tok);
      const sql2 = fs.readFileSync(path.join(ROOT, "packages/store/src/schema.sql"), "utf8");
      for (const tok of ["semantic_memories", "archive_log", "archived INTEGER NOT NULL DEFAULT 0"])
        if (!sql2.includes(tok)) fail("ADR-0037 1n: schema.sql missing " + tok);
      const ss2 = fs.readFileSync(path.join(ROOT, "packages/store/src/session-store.ts"), "utf8");
      for (const tok of ["consolidateMemory", "scanArchive", "undoArchive", "archived = 0", "semanticTelemetry"])
        if (!ss2.includes(tok)) fail("ADR-0037 1n: session-store.ts missing " + tok);
      const kinit = fs.readFileSync(path.join(ROOT, "packages/kernel/src/llm-init.ts"), "utf8");
      if (!kinit.includes('LlmEndpointKind') || !kinit.includes("ANS_LLM_API_KEY")) fail("ADR-0037 1n: kernel llm-init.ts missing three-endpoint wiring (LlmEndpointKind/ANS_LLM_API_KEY)");
      report("pass", "ADR-0037 consolidation/forgetting layer: schema + consolidate module + store wiring + kernel 3-endpoint init present");

      // 1o. ADR-0037 Phase-3 CLI: consolidate command + memory forget + durable DB path wiring.
      {
        const conCli = fs.readFileSync(path.join(ROOT, "apps/cli/src/commands/consolidate.ts"), "utf8");
        for (const tok of ["createLlmSession", "classifyClaim", "resolveDbPath", "consolidateMemory", "--dry-run"])
          if (!conCli.includes(tok)) fail("ADR-0037 1o: apps/cli consolidate.ts missing " + tok);
        const dbHelper = fs.readFileSync(path.join(ROOT, "apps/cli/src/db.ts"), "utf8");
        if (!dbHelper.includes("createPersistentEngine") || !dbHelper.includes("resolveDbPath")) fail("ADR-0037 1o: db.ts helper missing");
        const memCli = fs.readFileSync(path.join(ROOT, "apps/cli/src/commands/memory.ts"), "utf8");
        for (const tok of ["scanArchive", "applyArchive", "undoArchive", "--undo"])
          if (!memCli.includes(tok)) fail("ADR-0037 1o: memory.ts forget subcommand missing " + tok);
        const idx = fs.readFileSync(path.join(ROOT, "apps/cli/src/index.ts"), "utf8");
        if (!idx.includes("runConsolidate") || !idx.includes('"consolidate"')) fail("ADR-0037 1o: index.ts missing consolidate registration");
        const comp = fs.readFileSync(path.join(ROOT, "packages/kernel/src/composition.ts"), "utf8");
        if (!comp.includes("ANS_DB_PATH") || !comp.includes("opts?.dbPath")) fail("ADR-0037 1o: kernel composition missing dbPath wiring");
        report("pass", "ADR-0037 Phase-3 CLI: consolidate + forget + durable DB path present");
      }
    }
  }

  // 1j. ADR-0034 D4: CLI --json purity — single JSON document on stdout, no decorative chars in this file.
  {
    const cli = fs.readFileSync(path.join(ROOT, "apps/cli/src/commands/search.ts"), "utf8");
    if (!cli.includes("process.stdout.write(JSON.stringify(out")) fail("ADR-0034 1j: CLI --json pure-JSON exit path missing");
    if (/[✓✗~═─]/.test(cli)) fail("ADR-0034 1j: decorative glyphs in CLI search (belong to kernel renderAttributionText only)");
    report("pass", "CLI --json pure structural output, glyphs confined to kernel renderer");
  }

  // 1k. ADR-0034 D4 ghost-reference guard: renderer must dedupe sources before numbering.
  {
    const att = fs.readFileSync(path.join(ROOT, "packages/kernel/src/attribution.ts"), "utf8");
    if (!att.includes("seen.add(e.url)")) fail("ADR-0034 1k: renderAttributionText lacks URL dedupe (ghost-reference risk)");
    report("pass", "attribution renderer dedupes source URLs");
  }

  // 1l. ADR-0040 D5: access_events tamper-evidence verifier — fail-closed at step 1.
  //     exit 1 -> ship red; exit 2 (no database) -> explicit skip + WARN ledger
  //     (3-streak escalation reuses the ADR-0039 D7 discipline).
  stepAccessChainVerify();

  // 1m. ADR-0046 D1/D2/D5/D7 + ADR-0047 D1/D4/D5: fusion ablation, paraphrase
  //     fixture contract, web provider ledger, and override governance must
  //     exist as source-level gates. Ship-gate verifies the verifier instead of
  //     only checking a reason-code token.
  {
    const runnerSrc = fs.readFileSync(path.join(ROOT, "packages/store/src/eval/runner.ts"), "utf8");
    for (const tok of ["computeArmDeltas", "NON_ANCHOR_MEMORY_ARMS", "armDeltas", "maxLexicalOverlap"])
      if (!runnerSrc.includes(tok)) fail("ADR-0046 runner missing " + tok);
    const gateSrc = fs.readFileSync(path.join(ROOT, "packages/store/src/eval/gate.ts"), "utf8");
    for (const tok of ["evaluateWeakestLink", "minHarm", "betaCorrection"])
      if (!gateSrc.includes(tok)) fail("ADR-0046 gate missing " + tok);
    const goldenSrc = fs.readFileSync(path.join(ROOT, "packages/store/src/eval/golden-cases.ts"), "utf8");
    for (const tok of ["paraphraseTier", "PARAPHRASE_MAX_LEXICAL_OVERLAP", "lexicalOverlap", "assertParaphraseSlice"])
      if (!goldenSrc.includes(tok)) fail("ADR-0046 golden-cases missing " + tok);
    const engineSrc = fs.readFileSync(path.join(ROOT, "packages/kernel/src/engine.ts"), "utf8");
    for (const tok of ["buildWebProviderLedger", "webProviderLedger"])
      if (!engineSrc.includes(tok)) fail("ADR-0046 engine missing webProviderLedger");
    if (gateSrc.includes("webProviderLedger")) fail("ADR-0046 D5 violated: memory gate must never read web provider ledger");
    const coreSrc = fs.readFileSync(path.join(ROOT, "packages/store/src/eval/override-core.ts"), "utf8");
    for (const tok of ["deriveOverrideEpoch", "postmortemDeadline", "decideOverrideGovernance", "parseShipOverridePostmortem"])
      if (!coreSrc.includes(tok)) fail("ADR-0047 override core missing " + tok);
    const ledgerSrc = fs.readFileSync(path.join(ROOT, "packages/store/src/eval/override-ledger.ts"), "utf8");
    for (const tok of ["parseShipOverrideLedger", "hashOverrideEntry", "withShipOverrideLedgerLock"])
      if (!ledgerSrc.includes(tok)) fail("ADR-0047 override ledger missing " + tok);
  }

  // 1n. ADR-0062 D2/D3: dual-gate domain filter + first-class abstain must exist
  //     as source-level contracts, and the eval-looks golden ledger must carry
  //     the four criterion anchors (must-abstain / paired must-hit / stub-
  //     provider degradation / cold-domain zero-result).
  {
    const contractSrc = fs.readFileSync(path.join(ROOT, "packages/retriever/src/contract.ts"), "utf8");
    for (const tok of ["includeDomains", "domainFilterSupported", "domain_filter_empty"])
      if (!contractSrc.includes(tok)) fail("ADR-0062 retriever contract missing " + tok);
    const engineSrc62 = fs.readFileSync(path.join(ROOT, "packages/kernel/src/engine.ts"), "utf8");
    for (const tok of ["adjudicateUrlPolicy", "retrieval.domain_filter.pre", "retrieval.domain_filter.post", "anysearch.outcome"])
      if (!engineSrc62.includes(tok)) fail("ADR-0062 engine missing " + tok);
    const cliSrc = fs.readFileSync(path.join(ROOT, "apps/cli/src/commands/search.ts"), "utf8");
    for (const tok of ["--fail-on-abstain", "formatAbstainLine"])
      if (!cliSrc.includes(tok)) fail("ADR-0062 CLI abstain surface missing " + tok);
    const mcpSrc = fs.readFileSync(path.join(ROOT, "apps/mcp/src/tools/search-web.tool.ts"), "utf8");
    if (!mcpSrc.includes("abstain")) fail("ADR-0062 MCP search_web missing abstain structuredContent");
    const evalLooks = JSON.parse(fs.readFileSync(path.join(ROOT, "eval-looks.json"), "utf8"));
    const ge = evalLooks.golden?.entries ?? [];
    if (!ge.some((e) => e.domain === "docs" && e.expected?.verdict === "abstain"))
      fail("ADR-0062 c1: no docs-domain abstain golden entry");
    if (!ge.some((e) => e.domain === "docs" && e.expected?.verdict === "answer" && (e.expected?.mustHitHosts?.length ?? 0) > 0))
      fail("ADR-0062 c2: no paired must-hit golden entry");
    if (!ge.some((e) => e.domain !== "docs" && e.expected?.verdict === "abstain"))
      fail("ADR-0062 c4: no cold-domain abstain golden entry");
    if (!fs.existsSync(path.join(ROOT, "scripts/probe-tavily-domains.mjs")))
      fail("ADR-0062 c5: tavily leakage probe missing");
    if (!fs.readFileSync(path.join(ROOT, "scripts/ship-gate.mjs"), "utf8").includes("stepOverrideGovernance")) {
      fail("ADR-0047 ship-gate missing stepOverrideGovernance");
    }
    // R64 D-005 criterion anchors (machine-checked, not doc-level caveats):
    //  (a) >=2 live entries carry byte-exact mustHitUrls (R63 caveat close-out);
    //  (b) byte-exact legs may only anchor controlled|frozen-spec targets;
    //  (c) >=1 live entry carries the mustHitPaths page-family layer;
    //  (d) every R64 migrated case keeps its migration provenance block
    //      (promote physically deletes ledger entries — the golden entry is
    //      the only durable carrier).
    const liveIds = new Set(Object.entries(evalLooks.golden?.scopes ?? {}).filter(([, sc]) => sc === "live" || sc === "both").map(([id]) => id));
    const liveEntries = ge.filter((e) => liveIds.has(e.id));
    const exactHolders = liveEntries.filter((e) => (e.expected?.mustHitUrls?.length ?? 0) > 0);
    if (exactHolders.length < 2)
      fail("R64 D-005: live entries carrying byte-exact mustHitUrls < 2 (R63 caveat close-out criterion not met)");
    for (const e of exactHolders)
      if (e.stability_class !== "controlled" && e.stability_class !== "frozen-spec")
        fail("R64 D-005: " + e.id + " anchors byte-exact mustHitUrls on stability_class=" + (e.stability_class ?? "missing") + " (only controlled|frozen-spec allowed)");
    if (!liveEntries.some((e) => (e.expected?.mustHitPaths?.length ?? 0) > 0))
      fail("R64 D-005: no live entry carries the mustHitPaths page-family layer");
    for (const id of ["docs-g0001", "docs-g0002", "docs-g0003", "docs-g0004", "docs-g0005", "docs-g0006", "docs-g0008", "docs-g0009", "docs-g0010", "docs-g0011"]) {
      const e = ge.find((x) => x.id === id);
      if (!e?.migration?.from || !e?.migration?.to || !e?.migration?.decidedAt)
        fail("R64 D-005: migrated case " + id + " missing migration provenance block (from/to/decidedAt required)");
    }
    report("pass", "ADR-0046/0047 source gates + ADR-0062 dual-gate abstain contracts + criterion anchors + R64 D-005 migration anchors (exact>=2 frozen-only, paths>=1, migration blocks)");
  }

  // 1q. R62 D-005 (T5): offline-eval governance — Declared Exclusion is a
  //     compile-time/static boundary, diff-visible and reviewable. Source
  //     assertions over the golden dataset — never a runtime NODATA quota.
  {
    const gcSrc = fs.readFileSync(path.join(ROOT, "packages/store/src/eval/golden-cases.ts"), "utf8");
    // (a) the exclusion set exists as an export;
    if (!gcSrc.includes("export const OFFLINE_EXCLUDED_GROUPS")) fail("R62 D-005: OFFLINE_EXCLUDED_GROUPS export missing");
    // (b) its whitelist is exactly [VECTOR_ARM_GROUP] with VECTOR_ARM_GROUP === "semantic" —
    //     widening the exclusion set fails here, at review time, not in a skipped run.
    const arm = gcSrc.match(/export const VECTOR_ARM_GROUP: EvalGroup = "([^"]+)"/);
    if (!arm || arm[1] !== "semantic") fail("R62 D-005: VECTOR_ARM_GROUP must be \"semantic\"");
    const excl = gcSrc.match(/export const OFFLINE_EXCLUDED_GROUPS: readonly EvalGroup\[\] = \[([^\]]*)\]/);
    const exclToks = (excl?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (exclToks.length !== 1 || exclToks[0] !== "VECTOR_ARM_GROUP")
      fail("R62 D-005: OFFLINE_EXCLUDED_GROUPS must be exactly [VECTOR_ARM_GROUP], got [" + exclToks.join(",") + "]");
    // (c) offline coverage floor, computed on the real dataset — 0.75 minimum.
    const cov = spawnSync(process.execPath, ["--import", "tsx", "-e",
      "import { GOLDEN_CASES, offlineCases } from './src/eval/golden-cases.ts';" +
      "const r = offlineCases().length / GOLDEN_CASES.length;" +
      "if (!(r >= 0.75)) { console.error('offline coverage ' + r.toFixed(3) + ' < 0.75'); process.exit(1); }" +
      "console.log('offline coverage ' + r.toFixed(3));"],
      { cwd: path.join(ROOT, "packages", "store"), encoding: "utf8" });
    if (cov.status !== 0) fail("R62 D-005: offline coverage check failed\n" + String(cov.stderr ?? cov.stdout ?? "").trim());
    // (d) the excluded slice is re-established by the online lane in ci.yml —
    //     R63 T4/F-2: job+step double assertion (a bare substring match could be
    //     satisfied by a comment or an orphaned step name while the lane is gone).
    const ciSrc = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
    if (!/^  test-online:/m.test(ciSrc)) fail("R62 D-005: ci.yml missing test-online job key");
    if (!ciSrc.includes("test:online") || !ciSrc.includes("pnpm -C packages/store test:online"))
      fail("R62 D-005: ci.yml test-online job missing the 'pnpm -C packages/store test:online' step");
    report("pass", "R62 D-005: offline exclusion governance (whitelist + 0.75 floor + test-online lane)");
  }

  // 1r. R63 T3 (D-003): quarantine ratchet — the live-drift quarantine set is shrink-only.
  //     entries ⊆ baseline ids (new = red); renewals stay 0 (renewal = red); an entry past
  //     expiresAt without a promote/retire/longterm ruling is red (TTL expiry forces a ruling);
  //     longterm exits capped at 1. Baseline is a separate reviewable file (diff-visible).
  {
    const qPath = path.join(ROOT, "packages", "store", "eval-quarantine.json");
    const bPath = path.join(ROOT, "packages", "store", "eval-quarantine.baseline.json");
    if (!fs.existsSync(bPath)) fail("R63 T3: eval-quarantine.baseline.json missing — ratchet has no floor");
    const qLedger = JSON.parse(fs.readFileSync(qPath, "utf8"));
    const qBase = JSON.parse(fs.readFileSync(bPath, "utf8"));
    if (qBase.schema !== "anysearch/eval-quarantine-baseline@1" || !Array.isArray(qBase.ids) || qBase.ids.length === 0)
      fail("R63 T3: eval-quarantine.baseline.json schema/ids invalid");
    const ratchetErrors = checkQuarantineRatchet(qLedger, qBase.ids);
    for (const e of ratchetErrors) fail("R63 T3 quarantine ratchet: " + e);
    report("pass", "R63 T3: quarantine ratchet green (entries shrink-only vs baseline[" + qBase.ids.length + "], renewals=0, no unruled expiry, longterm<=1)");
  }

  // 1n. ADR-0052 D2-D5: local observation representation, SQLite store, export
  // boundary, and eval isolation. These assertions are structural, not runtime
  // acceptance; runtime trace/eval smoke is verified below.
  {
    const obsPath = path.join(ROOT, "packages/store/src/observation.ts");
    if (!fs.existsSync(obsPath)) fail("ADR-0052 1n: packages/store/src/observation.ts missing");
    const obs = fs.readFileSync(obsPath, "utf8");
    for (const tok of [
      "OBSERVATION_SCHEMA_URL",
      "SEMCONV_GENAI_COMMIT",
      "SEMCONV_LEGACY_TAG",
      "SEMCONV_MCP_TAG",
      "OBSERVATION_TESTED_WITH",
      "SqliteObservationStore",
      "mapTraceToOtlp",
      "gen_ai.evaluation.result",
    ]) {
      if (!obs.includes(tok)) fail("ADR-0052 1n: observation.ts missing " + tok);
    }
    const indexSrc = fs.readFileSync(path.join(ROOT, "packages/store/src/index.ts"), "utf8");
    if (!indexSrc.includes("./observation")) fail("ADR-0052 1n: observation module not exported from store index");
    const gateSrc = fs.readFileSync(path.join(ROOT, "packages/store/src/eval/gate.ts"), "utf8");
    for (const forbidden of ["observability_traces", "observability_spans", "observability_evaluations", "ObservabilityTrace", "SqliteObservationStore", "gen_ai."]) {
      if (gateSrc.includes(forbidden)) fail("ADR-0052 D5 violated: eval gate references observational asset " + forbidden);
    }
    const cliSrc = fs.readFileSync(path.join(ROOT, "apps/cli/src/commands/search.ts"), "utf8");
    if (!cliSrc.includes("observation.recordOperation")) fail("ADR-0052 1n: CLI search observation missing");
    const mcpSrc = fs.readFileSync(path.join(ROOT, "apps/mcp/src/tools/index.ts"), "utf8");
    const mcpObs = fs.readFileSync(path.join(ROOT, "apps/mcp/src/tools/observation.ts"), "utf8");
    if (!mcpObs.includes("observeTool") || !mcpSrc.includes("registerSearchWeb")) fail("ADR-0052 1n: MCP observation helper/tool registry missing");
    const evalCli = fs.readFileSync(path.join(ROOT, "packages/store/src/eval/cli.ts"), "utf8");
    if (!evalCli.includes("SqliteObservationStore") || !evalCli.includes("recordEvaluationTrace")) fail("ADR-0052 1n: eval-runner observation write missing");
    const verifyScript = path.join(ROOT, "scripts", "verify-observation.mjs");
    if (!fs.existsSync(verifyScript) || !fs.readFileSync(verifyScript, "utf8").includes("verdict")) {
      fail("ADR-0052 1n: packaged observation verifier missing");
    }
    report("pass", "ADR-0052 observation representation/store/export boundary and eval isolation present");
  }

  // 1o. ADR-0053 D1-D5/D7: deterministic content trust boundary, source labels,
  // sanitization/schema gate, fail-closed source gate, and INJECT probe closure.
  {
    const ctPath = path.join(ROOT, "packages/retriever/src/content-trust.ts");
    if (!fs.existsSync(ctPath)) fail("ADR-0053 1o: retriever content-trust module missing");
    const ct = fs.readFileSync(ctPath, "utf8");
    for (const tok of ["sanitizeRetrieved", "RetrievalContentSchema", "combine_labels", "wrapRetrieved", "assertLlamaInput", "shouldAllowUrl", "additionalProperties: false"])
      if (!ct.includes(tok)) fail("ADR-0053 1o: content-trust missing " + tok);
    const retrieverIndex = fs.readFileSync(path.join(ROOT, "packages/retriever/src/index.ts"), "utf8");
    if (!retrieverIndex.includes("./content-trust")) fail("ADR-0053 1o: content-trust not exported");
    const pipeline = fs.readFileSync(path.join(ROOT, "packages/kernel/src/memory-pipeline.ts"), "utf8");
    for (const tok of ["TaggedGap", "distillGap(messages: any[], fromIdx: number): TaggedGap"])
      if (!pipeline.includes(tok)) fail("ADR-0053 1o: memory pipeline missing tagged gap " + tok);
    const store = fs.readFileSync(path.join(ROOT, "packages/store/src/session-store.ts"), "utf8");
    for (const tok of ["source-gate", "source_label", "trace_id"])
      if (!store.includes(tok)) fail("ADR-0053 1o: session-store missing " + tok);
    const domain = fs.readFileSync(path.join(ROOT, "packages/store/src/domain-schema.ts"), "utf8");
    if (!domain.includes("urlAllowlist")) fail("ADR-0053 1o: URL consumption allowlist schema missing");
    const chain = fs.readFileSync(path.join(ROOT, "packages/store/src/access-chain.ts"), "utf8");
    if (!chain.includes('CHAIN_SCHEMA_VERSION = 2') || !chain.includes('"source_label"')) fail("ADR-0053 1o: access-chain schema v2/source_label missing");
    const golden = fs.readFileSync(path.join(ROOT, "packages/store/src/eval/golden-cases.ts"), "utf8");
    for (const tok of ["inject_invisible_chars", "inject_instruction_injection", "inject_tool_output_url_egress", "inject_memory_poisoning", "inject_combined_adaptive"])
      if (!golden.includes(tok)) fail("ADR-0053 1o: inject case missing " + tok);
    const runner = fs.readFileSync(path.join(ROOT, "packages/store/src/eval/runner.ts"), "utf8");
    if (!runner.includes('case "inject"')) fail("ADR-0053 1o: inject runner op missing");
    const cliSearch = fs.readFileSync(path.join(ROOT, "apps/cli/src/commands/search.ts"), "utf8");
    if (!cliSearch.includes('"anysearch.source": "retrieved"')) fail("ADR-0053 1o: anysearch.source OTLP emission missing");
    report("pass", "ADR-0053 content trust boundary + inject probes present");
  }

}

// ---------------------------------------------------------------------------
// Step 2 — domain schema validation (ADR-0021 D3, blocking)
// ---------------------------------------------------------------------------
// ADR-0059 D6 (T-5): the ADR index (docs/adr/index.md) is a derived artifact — regenerate-and-diff
// so it can never silently lag behind docs/adr/ (round-57 failure mode: claimed 0001-0046 while 59
// existed). R69 T1: the artifact moved from README.md into docs/adr/ — same discipline, new target.
function stepAdrIndex() {
  report("info", "step 1b/9: ADR index freshness (docs/adr/index.md, ADR-0059 D6)");
  const res = spawnSync(process.execPath, [path.join("scripts", "gen-adr-index.mjs"), "--check"], { cwd: ROOT, encoding: "utf8" });
  const out = ((res.stdout ?? "") + (res.stderr ?? "")).trim();
  if (res.status !== 0) fail("ADR index (docs/adr/index.md) is stale (ADR-0059 D6): " + out);
  report("pass", out || "ADR index up to date");
}

// ADR-0059 D7 (T-6.1) / ADR-0061 G1: the grace window is WIRED now — the invariant
// flips from "debt note survives" to "implementation present + docs not over-claiming".
// The anti-pattern stays identical: silently re-claiming or silently de-wiring recurs.
function stepDocClaims() {
  report("info", "step 1c/9: engine grace-window wiring assertion (ADR-0059 D7 / ADR-0061 G1)");
  const eng = fs.readFileSync(path.join(ROOT, "packages", "kernel", "src", "engine.ts"), "utf8");
  if (!/graceWindowMs/.test(eng)) fail("engine.ts no longer declares graceWindowMs - update this assertion (ADR-0059 D7)");
  if (!/graceExpired/.test(eng) || !/controllers\[j\]\.abort\(\)/.test(eng)) fail("engine.ts lost the wired grace-window collect (ADR-0061 G1)");
  const ctx = fs.readFileSync(path.join(ROOT, "CONTEXT.md"), "utf8");
  if (/grace-window 早停尚未接线/.test(ctx)) fail("CONTEXT.md still claims the grace window is unwired (ADR-0061 G1 delivered it)");
  report("pass", "engine grace window wired; CONTEXT.md consistent (ADR-0061 G1)");
}

// ADR-0060 D1 (T-1): supersession integrity, two-sided (armory pattern). An Accepted record is
// corrected only by supersession; the forward pointer ("Status: Superseded by ADR-NNNN") must
// resolve to an existing ADR file AND that target must carry the back-reference. A one-sided
// pointer is exactly how the round-59 rot (an Accepted ADR describing a parallel universe)
// stayed invisible. Fail-closed, stdlib-only.
function stepSupersessionIntegrity() {
  report("info", "step 1d/9: ADR supersession integrity (ADR-0060 D1)");
  const adrDir = path.join(ROOT, "docs", "adr");
  const files = fs.readdirSync(adrDir).filter((f) => f.endsWith(".md")).sort();
  const byNum = new Map();
  for (const f of files) {
    const m = f.match(/^(\d{3,4})-/);
    if (m) byNum.set(m[1], f);
  }
  let checked = 0;
  for (const f of files) {
    const text = fs.readFileSync(path.join(adrDir, f), "utf8");
    const re = /^\s*Status:\s*Superseded by ADR-(\d{3,4})/gm;
    let m;
    while ((m = re.exec(text))) {
      const targetNum = m[1];
      const targetFile = byNum.get(targetNum);
      if (!targetFile) fail("supersession-integrity: " + f + " points at ADR-" + targetNum + ", which has no file in docs/adr");
      const sourceNum = f.match(/^(\d{3,4})-/)[1];
      const targetText = fs.readFileSync(path.join(adrDir, targetFile), "utf8");
      // round-59 audit R-6: a back-reference must ASSERT the supersession relationship, not
      // merely mention the ADR (nor use the noun "supersession"). Require ADR-<source> and a
      // supersession VERB ("superseded by" / "supersedes") on the same line.
      const srcLine = new RegExp("ADR-" + sourceNum + "\\b");
      const supersedes = /superseded?\s+by|supersedes/i;
      const backRef = targetText.split(/\r?\n/).some((l) => srcLine.test(l) && supersedes.test(l));
      if (!backRef) {
        fail("supersession-integrity: " + f + " is superseded by ADR-" + targetNum + ", but " + targetFile + " carries no back-reference to ADR-" + sourceNum);
      }
      checked++;
    }
  }
  if (checked === 0) fail("supersession-integrity: no \"Status: Superseded by ADR-NNNN\" pointer found - the assertion would pass vacuously");
  report("pass", "supersession-integrity: " + checked + " supersession pointer(s) resolve with a back-reference");
}

// ADR-0060 D3 (T-2): CONTEXT.md terms are Diataxis Reference - the body may state only machine
// facts, and every stated value must resolve to source wiring. Three layers, all fail-closed:
//   L1 numeric  - values CONTEXT declares must equal values parsed from source (bidirectional:
//                 change the source without changing CONTEXT and this goes red).
//   L2 symbol   - the symbols the term names must exist at their definition sites.
//   L3 negative - over-claim assertions only (a claim is not a wiring; only the absence of the
//                 retired claim strings is assertable). Mirrors the stepDocClaims pattern.
function stepContextWiring() {
  report("info", "step 1e/9: CONTEXT.md term wiring (ADR-0060 D3)");
  const eng = fs.readFileSync(path.join(ROOT, "packages", "kernel", "src", "engine.ts"), "utf8");
  const reg = fs.readFileSync(path.join(ROOT, "packages", "retriever", "src", "fusion-registry.ts"), "utf8");
  const rrf = fs.readFileSync(path.join(ROOT, "packages", "retriever", "src", "rrf.ts"), "utf8");
  const ctx = fs.readFileSync(path.join(ROOT, "CONTEXT.md"), "utf8");

  // round-59 audit R-4/R-5: scope the numeric + negative assertions to the Retroaererd Engine
  // term itself, not the whole glossary - a match elsewhere (e.g. an unrelated `k=NN` in another
  // term) must neither satisfy nor violate THIS term's contract.
  const termStart = ctx.indexOf("## Retroaererd Engine");
  if (termStart < 0) fail("CONTEXT wiring: '## Retroaererd Engine' term not found in CONTEXT.md");
  const termEnd = ctx.indexOf("\n## ", termStart + 1);
  const term = ctx.slice(termStart, termEnd < 0 ? ctx.length : termEnd);

  // L1 numeric (bidirectional, term-scoped)
  for (const field of ["minProviders", "minResults", "minDomains"]) {
    const src = new RegExp(field + ":\\s*(\\d+)").exec(eng);
    if (!src) fail("CONTEXT wiring L1: " + field + " not found in engine.ts - update this assertion");
    const got = new RegExp(field + "=(\\d+)").exec(term);
    if (!got) fail("CONTEXT wiring L1: the Retroaererd term does not declare " + field + " (source=" + src[1] + ")");
    if (got[1] !== src[1]) fail("CONTEXT wiring L1: the term declares " + field + "=" + got[1] + " but engine.ts has " + src[1] + " - regenerate the term");
  }
  const ceSrc = /crossEngineVerify:\s*(true|false)/.exec(eng);
  if (!ceSrc) fail("CONTEXT wiring L1: crossEngineVerify not found in engine.ts DEFAULT_GATE");
  const ceTerm = /crossEngineVerify=(true|false)/.exec(term);
  if (!ceTerm || ceTerm[1] !== ceSrc[1]) fail("CONTEXT wiring L1: the term declares crossEngineVerify=" + (ceTerm ? ceTerm[1] : "absent") + " but engine.ts has " + ceSrc[1]);
  const kf = /k_fusion:\s*Object\.freeze\(\{\s*memory:\s*(\d+),\s*web:\s*(\d+)/.exec(reg);
  if (!kf) fail("CONTEXT wiring L1: k_fusion not found in fusion-registry.ts - update this assertion");
  const kSrc = [kf[1], kf[2]];
  const kTerm = [...term.matchAll(/k=(\d+)/g)].map((m) => m[1]);
  for (const k of kSrc) {
    if (!kTerm.includes(k)) fail("CONTEXT wiring L1: the term does not declare k=" + k + " (fusion-registry k_fusion)");
  }
  for (const k of new Set(kTerm)) {
    if (!kSrc.includes(k)) fail("CONTEXT wiring L1: the term declares k=" + k + " which is not in fusion-registry k_fusion {" + kSrc.join(",") + "} - regenerate the term");
  }

  // L2 symbol existence at the definition site
  const defs = [[eng, "DEFAULT_GATE"], [eng, "checkCrossEngine"], [reg, "FUSION_REGISTRY"], [rrf, "rrfRank"]];
  for (const pair of defs) {
    const sym = pair[1];
    if (!new RegExp("(const|function)\\s+" + sym + "\\b").test(pair[0])) {
      fail("CONTEXT wiring L2: symbol " + sym + " not defined where the term points - update the term/assertion");
    }
  }

  // L3 negative over-claim assertions, term-scoped (round-59 audit R-4): the retired claim
  // strings must not return to the term. Both the hyphenated and the spaced spelling are listed
  // so the guard cannot be defeated by a spelling variant. Non-ASCII is built from char codes to
  // keep this file ASCII-clean.
  const GE = String.fromCharCode(0x2265);
  const FULL_L = String.fromCharCode(0xff08);
  const IDEO_COMMA = String.fromCharCode(0x3001);
  const FULL_R = String.fromCharCode(0xff09);
  const retired = [
    "tokio::JoinSet",
    GE + "4 angles",
    GE + "6 fetches",
    "serialized sufficiency-gate",
    "serialized sufficiency gate",
    "bounded budget" + FULL_L + "token-cap" + IDEO_COMMA + "usd-cap" + FULL_R,
    "Resume Anchoring on timeout/crash",
  ];
  for (const bad of retired) {
    if (term.includes(bad)) fail("CONTEXT wiring L3: the Retroaererd term re-claims a retired fact (" + bad + ") - ADR-0060 D3");
  }
  report("pass", "CONTEXT.md Retroaererd term wiring: L1 numeric + L2 symbols + L3 negative over-claim green (ADR-0060 D3)");
}

// ADR-0060 D5 (T-3): evidence anchors must resolve. Every backtick-quoted bare 40-hex git
// reference in docs/adr must resolve via `git cat-file -e`, or carry an explicit `[squashed]`
// marker (SPDX NOASSERTION-style honest unknown). A non-zero git exit is itself fail-closed
// (round-58 audit C-2 discipline). Refs pinned as owner/repo@sha are external and out of scope.
// stdlib-only.
function stepEvidenceAnchors() {
  report("info", "step 1f/9: ADR evidence-anchor resolvability (ADR-0060 D5)");
  // round-59 audit R-1: `git cat-file -e` on a non-tip history commit needs the full object DB,
  // so a SHALLOW clone is explicitly unverifiable (exit 2), never a misleading red. CI checks out
  // with fetch-depth: 0 (.github/workflows/ship-gate.yml).
  const shallow = spawnSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: ROOT, encoding: "utf8" });
  if (shallow.error) failUnverifiable("evidence-anchor: git rev-parse could not spawn (" + String(shallow.error.message) + ")");
  if (shallow.status !== 0) failUnverifiable("evidence-anchor: git rev-parse --is-shallow-repository failed (exit " + shallow.status + ")");
  if ((shallow.stdout ?? "").trim() === "true") {
    failUnverifiable("evidence-anchor: the repository is a SHALLOW clone, so non-tip history commits cannot be resolved - check out with fetch-depth: 0 (CI: .github/workflows/ship-gate.yml) before running the gate");
  }
  const adrDir = path.join(ROOT, "docs", "adr");
  const files = fs.readdirSync(adrDir).filter((f) => f.endsWith(".md")).sort();
  let resolved = 0;
  let whitelisted = 0;
  let external = 0;
  for (const f of files) {
    const lines = fs.readFileSync(path.join(adrDir, f), "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      // round-59 audit R-8: scan any backtick-quoted token CONTAINING a 40-hex run, so a prefixed
      // form (e.g. owner/repo@sha) can no longer hide from the regex. Three forms are lawful: a
      // bare 40-hex SHA (must resolve), a permalink URL (external reference, reported), or a
      // reference marked [squashed] (per-reference marker immediately after the token).
      const re = /`([^`]*)`/g;
      let m;
      while ((m = re.exec(line))) {
        const token = m[1];
        // round-59 audit: only a DELIMITED 40-hex run counts as a git reference. A 64-hex
        // sha256 digest contains no delimited 40-hex run, so it is correctly ignored (the
        // first cut of this scan false-positived on ADR-0045's sha256).
        if (!/(?<![0-9a-f])[0-9a-f]{40}(?![0-9a-f])/.test(token)) continue;
        const after = line.slice(m.index + m[0].length, m.index + m[0].length + 48);
        if (after.includes("[squashed]")) { whitelisted++; continue; }
        if (/^https?:\/\//.test(token)) { external++; continue; }
        if (!/^[0-9a-f]{40}$/.test(token)) {
          fail("evidence-anchor: " + f + ":" + (i + 1) + " quotes an unrecognized git-reference form `" + token + "` - use a bare 40-hex SHA (resolvable), a full permalink URL (external), or mark it [squashed]");
        }
        const res = spawnSync("git", ["cat-file", "-e", token + "^{commit}"], { cwd: ROOT, encoding: "utf8" });
        if (res.error) failUnverifiable("evidence-anchor: git cat-file could not spawn for " + f + ":" + (i + 1) + " (" + String(res.error.message) + ")");
        if (res.status !== 0) {
          fail("evidence-anchor: " + f + ":" + (i + 1) + " quotes " + token + " but `git cat-file -e` cannot resolve it - re-anchor (PR number / permalink / path+line) or mark it [squashed]");
        }
        resolved++;
      }
    });
  }
  if (resolved + whitelisted + external === 0) fail("evidence-anchor: no 40-hex git reference found in docs/adr - the assertion would pass vacuously");
  report("pass", "evidence-anchor: " + resolved + " resolvable 40-hex reference(s), " + external + " external permalink(s), " + whitelisted + " [squashed]-whitelisted");
}

// ADR-0069 (R68 T2): closeout handoff required-field lint. The R67 closeout
// shipped without the handoff-template's mandatory "绿色 run URL" section and
// Stack line — a doc-level omission no gate caught. Scope = closeout-shaped
// docs (*closeout* / *closure* filename keyword under .scratch/*/handoffs/;
// audit-only docs and next-round task books excluded) that are EITHER touched
// by this diff OR the newest closeout on disk. Older untouched closeouts are
// grandfathered — the rule postdates them.
// R69 T0: the bare round-NN-* shape leg was removed — direction/task docs
// (e.g. round-69-direction.md) are not closeouts and were false-positive hits.
function stepHandoffCloseoutLint() {
  report("info", "step 1g/9: closeout handoff required-field lint (ADR-0069)");
  const scratchDir = path.join(ROOT, ".scratch");
  const isCloseout = (name) =>
    /closeout|closure/i.test(name) &&
    !/audit/i.test(name) && !/^next/i.test(name) && name.endsWith(".md");
  const targets = new Set();

  // (a) closeout docs touched by this diff — the forward-going enforcement leg.
  // Range mirrors ship-gate.yml's memory-eval filter: pushed range, else
  // branch-vs-default-branch, else HEAD's own file list. Working-tree edits
  // count too (a doc being written right now must comply before commit).
  const diffSources = [
    ["diff", "--name-only", "origin/main...HEAD"],
    ["show", "--pretty=format:", "--name-only", "HEAD"],
    ["diff", "--name-only", "HEAD"],
    ["diff", "--name-only", "--cached"],
  ];
  for (const args of diffSources) {
    const d = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
    if (d.status !== 0) continue;
    for (const f of (d.stdout ?? "").split("\n").map((s) => s.trim()).filter(Boolean)) {
      const norm = f.replace(/\\/g, "/");
      const base = path.posix.basename(norm);
      if (norm.startsWith(".scratch/") && norm.includes("/handoffs/") && isCloseout(base)) targets.add(norm);
    }
  }

  // (b) the newest round's closeout docs on disk — the standing leg that
  // catches a round whose closeout landed non-compliant in an earlier diff.
  if (fs.existsSync(scratchDir)) {
    const roundDirs = fs.readdirSync(scratchDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^grill-round-(\d+)/i.test(d.name))
      .map((d) => ({ name: d.name, n: Number(d.name.match(/^grill-round-(\d+)/i)[1]) }))
      .sort((a, b) => b.n - a.n);
    for (const dir of roundDirs) {
      const hd = path.join(scratchDir, dir.name, "handoffs");
      if (!fs.existsSync(hd)) continue;
      const closeouts = fs.readdirSync(hd).filter(isCloseout);
      if (closeouts.length === 0) continue;
      for (const c of closeouts) targets.add((".scratch/" + dir.name + "/handoffs/" + c).replace(/\\/g, "/"));
      break; // newest round dir with closeouts only
    }
  }

  if (targets.size === 0) { report("skip", "handoff-lint: no closeout docs in scope (diff-clean and none on disk)"); return; }

  // Liveness leg needs gh + network; degrade to an explicit skip (never silent)
  // when unavailable — the shape legs below still run unconditionally.
  const ghOk = spawnSync("gh", ["--version"], { encoding: "utf8" }).status === 0;
  let repo = process.env.GITHUB_REPOSITORY || "";
  if (!repo) {
    const remote = spawnSync("git", ["remote", "get-url", "origin"], { cwd: ROOT, encoding: "utf8" });
    const m = (remote.stdout ?? "").trim().match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(\.git)?$/);
    if (m) repo = m[1];
  }
  const headSha = String(spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout ?? "").trim();

  const problems = [];
  let checkedLiveness = false;
  for (const rel of [...targets].sort()) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue; // renamed/deleted since diff — nothing to lint
    const s = fs.readFileSync(file, "utf8");
    if (!/^##\s*.*绿色\s*run\s*URL/m.test(s)) problems.push(rel + ": missing the required 「绿色 run URL」 section");
    if (!/Stack\b/m.test(s)) problems.push(rel + ": missing the required Stack header line");
    const ids = [...s.matchAll(/actions\/runs\/(\d+)/g)].map((m) => m[1]);
    if (ids.length === 0) { problems.push(rel + ": no actions/runs/<id> URL cited"); continue; }
    // "指向本轮 run": at least one cited run must resolve to a run whose headSha
    // is an ancestor-or-self of HEAD — a URL that points at another round's (or
    // an invented) run does not satisfy the field.
    if (ghOk && repo) {
      let bound = false;
      // R68 audit F-S3: per-file resolution flag — a global flag leaks file A's
      // successful resolution into file B's "all gh calls failed" case and would
      // mark an unverifiable doc as a violation.
      let resolved = false;
      for (const id of new Set(ids)) {
        const r = spawnSync("gh", ["api", "repos/" + repo + "/actions/runs/" + id, "--jq", ".head_sha"], { encoding: "utf8" });
        if (r.status !== 0) continue;
        const sha = (r.stdout ?? "").trim();
        if (!/^[0-9a-f]{40}$/.test(sha)) continue;
        resolved = true;
        checkedLiveness = true;
        if (sha === headSha || spawnSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { cwd: ROOT }).status === 0) { bound = true; break; }
      }
      // Only a resolved-but-unbound run is a violation; when gh could not reach
      // the API at all (no GH_TOKEN/offline) the leg is unverifiable, not red.
      if (resolved && !bound) problems.push(rel + ": no cited run resolves to a commit on this round's history (headSha ancestor-of-HEAD)");
    }
  }
  if (problems.length) fail("handoff-lint: closeout required fields missing/invalid:\n  " + problems.join("\n  "));
  report("pass", "handoff-lint: " + targets.size + " closeout doc(s) carry 绿色 run URL + Stack" + (checkedLiveness ? " and cite a run on this round's history" : " (liveness leg skipped: gh/repo unavailable)"));
}

// ADR-0059 D5 (T-4): three permanent invariants run FIRST, including under --quick, so a release
// verdict can never be produced from a broken workflow file, a dirty tree, or a drifted ignore set.
// NOTE on (c): the ledger wrote the command as `git ls-files -z --ignored --exclude-standard`,
// which this git rejects ("-i must be used with either -o or -c"); the invariant's intent is
// "no tracked file is also ignored", so `-c` (cached) is used.
function stepZeroInvariants() {
  report("info", "step 0/9: permanent invariants (ADR-0059 D5)");

  // (a) workflow YAML validity - promoted from .scratch/check-workflows.mjs (backlog B-2), fail-closed.
  const wf = spawnSync(process.execPath, [path.join("scripts", "check-workflows.mjs")], { cwd: ROOT, encoding: "utf8" });
  const wfOut = ((wf.stdout ?? "") + (wf.stderr ?? "")).trim();
  if (wf.status !== 0) fail("workflow YAML gate failed (ADR-0059 D5a):\n" + wfOut);
  report("pass", (wfOut.split("\n").filter(Boolean).slice(-1)[0]) || "workflow YAML gate ok");

  // (b) clean-tree invariant - a release verdict requires a committed tree (prism-coder precedent).
  const st = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
  // A non-zero git exit (e.g. git missing) must fail closed, not pass on empty stdout (round-58 audit C-2).
  if (st.status !== 0) failUnverifiable("clean-tree invariant: git status --porcelain failed (exit " + st.status + ") - cannot verify a committed tree");
  const dirty = (st.stdout ?? "").trim();
  if (dirty) fail("clean-tree invariant violated (ADR-0059 D5b): git status --porcelain is not empty:\n" + dirty.split("\n").slice(0, 10).join("\n"));
  report("pass", "clean-tree invariant: git status --porcelain is empty");

  // (c) gitignore-drift invariant - a tracked file must never also be ignored.
  const dr = spawnSync("git", ["ls-files", "-z", "-c", "--ignored", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" });
  if (dr.status !== 0) failUnverifiable("gitignore-drift invariant: git ls-files failed (exit " + dr.status + ") - cannot verify the ignore set");
  const drifted = (dr.stdout ?? "").split("\0").filter(Boolean);
  if (drifted.length) fail("gitignore-drift invariant violated (ADR-0059 D5c): tracked-but-ignored files:\n" + drifted.slice(0, 10).join("\n"));
  report("pass", "gitignore-drift invariant: no tracked-but-ignored files");
}

async function stepValidateDomains() {
  reportStep("step_1_5_validate_domains");
  report("info", "step 2/9: validate domains/*.toml compaction guards");
  const vPath = path.join(ROOT, "scripts/validate-domains.mjs");
  if (!fs.existsSync(vPath)) {
    report("skip", "validate-domains.mjs absent — step skipped");
    return;
  }
  await run(process.execPath, [vPath]);
  report("pass", "domains/*.toml compaction guards green");
}

// ---------------------------------------------------------------------------
// Step 3 — turbo check / test / build
// ---------------------------------------------------------------------------
async function stepBuildAndTest() {
  report("info", "step 3/9: turbo check / test / build");
  for (const task of ["check", "test", "build"]) {
    // ADR-0057 D3: test collects the full truth across packages (one red package
    // must not mask the others); check/build keep fail-fast semantics.
    const args = task === "test" ? ["turbo", "run", task, "--continue=dependencies-successful"] : ["turbo", "run", task];
    await run(PNPM, args);
    report("pass", `turbo run ${task}`);
  }
}

// ---------------------------------------------------------------------------
// Step 4 — pnpm pack into temp dir; verify tarballs for shipped packages
// ---------------------------------------------------------------------------
async function stepPack(tmpDir) {
  report("info", "step 4/9: pnpm pack into temp dir");
  const outDir = path.join(tmpDir, "pack");
  fs.mkdirSync(outDir, { recursive: true });

  // ponytail: pack all seven so file: tarballs resolve workspace:* deps in
  // clean-prefix install (step 4). kernel/store/retriever aren't published
  // end-user packages, but they're still吃香 during tgz install resolution.
  for (const rel of PKG_DIRS) {
    const pkgDir = path.join(ROOT, rel);
    await run(PNPM, ["pack", "--pack-destination", outDir], { cwd: pkgDir });
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
    // pnpm pack emits `<scope>-<name>-<ver>.tgz` for scoped packages
    // (@anysearch-cli/cli -> anysearch-cli-cli-<version>.tgz).
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
// Step 5 — install tarballs into a clean prefix, verify bin entry exists
// ---------------------------------------------------------------------------
async function stepInstallVerify(tgzDir, tmpDir, { skipMatrix }) {
  if (skipMatrix) {
    report("skip", "step 5/9: cross-OS matrix install (delegated to CI matrix)");
    return;
  }
  report("info", "step 5/9: extract tarballs + verify manifest shape + bin target exists");

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
    if (!pkg.name.startsWith("@anysearch-cli/")) {
      fail(`${file}: unexpected pkg name ${pkg.name}`);
    }
    // ADR-0057 T3 follow-up: only packages whose manifest points at dist/ are
    // expected to ship one. The four source-only workspace packages
    // (kernel / retriever / store / embedding) declare `exports: "./src/*.ts"`
    // with no build script, so their tarball legitimately has no dist/.
    // Asserting dist/ unconditionally made this gate unsatisfiable (4 of 7
    // packages). Mirrors the existing "no bin" branch below.
    const manifestForDist = JSON.stringify([pkg.files, pkg.main, pkg.module, pkg.bin, pkg.exports]);
    const declaresDist = manifestForDist.includes("dist");
    if (declaresDist && !fs.existsSync(path.join(pkgDir, "dist"))) {
      fail(`${file}: dist/ declared in manifest but missing in tarball`);
    }
    // R63 T2 (D-005): bundled-CLI publish shape. The three apps + embedding are the publish
    // set; kernel/store/retriever are build-time only (bundled) and must NOT appear in the
    // packed manifest's install-time fields. @anysearch-cli/embedding rides as an optional peer
    // (peerDependenciesMeta.optional), never optionalDependencies (the 404/auto-install bomb).
    {
      const PUBLISH_SET = ["@anysearch-cli/cli", "@anysearch-cli/mcp", "@anysearch-cli/plugin", "@anysearch-cli/embedding"];
      if (PUBLISH_SET.includes(pkg.name)) {
        const depKeys = Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith("@anysearch-cli/"));
        if (depKeys.length) fail(`${file}: publish manifest still declares bundled deps in dependencies: ${depKeys.join(", ")} (D-005: bundled internals are devDependencies)`);
        if ((pkg.optionalDependencies ?? {})["@anysearch-cli/embedding"]) fail(`${file}: @anysearch-cli/embedding in optionalDependencies — must be peer+optional (D-005 bomb-prevention)`);
        if (pkg.name !== "@anysearch-cli/embedding") {
          const peerOk = pkg.peerDependencies && "@anysearch-cli/embedding" in pkg.peerDependencies &&
            pkg.peerDependenciesMeta && pkg.peerDependenciesMeta["@anysearch-cli/embedding"] && pkg.peerDependenciesMeta["@anysearch-cli/embedding"].optional === true;
          if (!peerOk) fail(`${file}: @anysearch-cli/embedding missing peerDependencies+peerDependenciesMeta.optional (D-005 peer-optional contract)`);
          // R63 publish incident: npm publish <dir> bypasses pnpm workspace:* rewrite —
          // packed manifest must carry NO workspace: protocol in any dep field.
          for (const [depField, depSet] of Object.entries(pkg).filter(([k]) => /[Dd]ependencies$/.test(k))) {
            for (const [dn, dv] of Object.entries(depSet ?? {})) {
              if (String(dv).startsWith("workspace:")) fail(file + ": " + depField + "." + dn + " still workspace: (" + dv + ") — publish via pnpm pack tarball, not npm publish dir");
            }
          }
        }
        if (pkg.license !== "Apache-2.0") fail(`${file}: license must be Apache-2.0 (D-007)`);
        if (!pkg.repository || !String(pkg.repository.url ?? "").includes("Xxx91n/anysearch-cli")) fail(`${file}: repository field missing/wrong (D-005)`);
        if (!pkg.publishConfig || pkg.publishConfig.access !== "public") fail(`${file}: publishConfig.access must be public (scoped @anysearch-cli/*)`);
        // noExternal regression guard: packed dist must not bare-reference bundled
        // internals — covers require()/import() call forms, static and side-effect
        // imports, and export-from re-exports. @anysearch-cli/embedding is excluded —
        // it is the declared peer-optional external (dynamic import survives
        // bundling by design, ADR-0033).
        const distDir = path.join(pkgDir, "dist");
        if (fs.existsSync(distDir)) {
          const bare = /(?:(?:require|import)\s*\(\s*|(?:import|export)\b[^'";]*?\bfrom\s*|import\s*)["']@anysearch-cli\/(kernel|store|retriever|plugin)["'/]/;
          const stack = [distDir];
          while (stack.length) {
            const cur = stack.pop();
            for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
              const fp = path.join(cur, e.name);
              if (e.isDirectory()) { stack.push(fp); continue; }
              if (!/\.(js|cjs|mjs)$/.test(e.name)) continue;
              const src = fs.readFileSync(fp, "utf8");
              const m = src.match(bare);
              if (m) fail(`${file}: dist contains bare require/import/export of bundled @anysearch-cli/${m[1]} — noExternal regression (D-005)`);
            }
          }
        }
        report("pass", `${pkg.name} publish shape ok (deps clean / peer-optional embedding / license+repo+access / no bare internal require/import/export)`);
      }
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

  // 4b. pnpm verify-ts-release pattern (PR #13061): REAL clean-prefix npm install,
  //     R63 T5 (D-005) consumer-real shape — only the three APP tarballs go in.
  //     Bundled internals are not on npm at all; @anysearch-cli/embedding is an
  //     optional peer (peerDependenciesMeta.optional) so npm must NOT auto-install
  //     it — its absence here is the assertion, not a defect.
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
  const tgzApps = tgzAll.filter((f) => /anysearch-cli-(cli|mcp|plugin)-/.test(f));
  const tgzEmb = tgzAll.find((f) => /anysearch-cli-embedding-/.test(f));
  if (tgzApps.length !== 3) fail(`install-prefix: expected 3 app tarballs, got ${tgzApps.length}`);
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
      ...tgzApps,
    ],
    { stdio: "pipe" }
  );
  // Consumer-real install closure: apps present, bundled internals + the
  // optional peer ABSENT (proof the bundling and peer-optional shape hold).
  const nmDir = path.join(installPrefix, "node_modules");
  for (const sub of ["@anysearch-cli/mcp", "@anysearch-cli/cli", "@anysearch-cli/plugin"]) {
    if (!fs.existsSync(path.join(nmDir, sub))) {
      fail(`install-prefix: ${sub} missing after npm install`);
    }
  }
  for (const sub of ["@anysearch-cli/kernel", "@anysearch-cli/store", "@anysearch-cli/retriever", "@anysearch-cli/embedding"]) {
    if (fs.existsSync(path.join(nmDir, sub))) {
      fail(`install-prefix: ${sub} present — bundled internals must not be install-closure members (D-005)`);
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
  report("pass", "npm install --prefix smoke ok (3 apps resolvable, bundled internals + optional peer correctly absent, bins linked)");

  // 4c. R63 T5 (D-005): peer-optional dual-install — npm install of the embedding
  //     tarball alongside the apps lands it at the shared node_modules root and
  //     the bundled import("@anysearch-cli/embedding") in the installed cli resolves.
  if (!tgzEmb) fail("install-prefix: embedding tarball missing for peer-optional leg");
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
      tgzEmb,
    ],
    { stdio: "pipe" }
  );
  if (!fs.existsSync(path.join(nmDir, "@anysearch-cli", "embedding", "dist", "index.js"))) {
    fail("install-prefix: @anysearch-cli/embedding not installed at shared root after explicit peer install");
  }
  const peerRes = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", "import('@anysearch-cli/embedding').then(m=>console.log('PEER_OK',typeof m.embedText)).catch(e=>{console.error('PEER_FAIL',e.message);process.exit(1)})"],
    { cwd: path.join(nmDir, "@anysearch-cli", "cli"), encoding: "utf8" }
  );
  if (peerRes.status !== 0 || !(peerRes.stdout ?? "").includes("PEER_OK")) {
    fail("install-prefix: import('@anysearch-cli/embedding') not resolvable from installed cli — " + String((peerRes.stderr ?? peerRes.stdout ?? "")).slice(0, 300));
  }
  report("pass", "peer-optional dual-install ok (@anysearch-cli/embedding at shared root, import resolves from installed cli)");
}


// ---------------------------------------------------------------------------
// Step 6 — ADR-0024 D5 + D7 T0 smoke probe: boot CLI with seeded preference,
// assert first user message contains <user_preferences> block.
// Blocking: the injected projection must be visible in `ans pref list` output;
// and `pref --help` must mention the XML wrapper so we know Step 4 landed.
// ---------------------------------------------------------------------------
async function stepT0Smoke(tmpDir) {
  report("info", "step 6/9: T0 smoke probe (ADR-0024)");

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
  prefHelp.stderr.on("data", () => { });
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
// Step 7 — ADR-0027: memory eval harness gate (fail-closed three metrics;
// LLM judge channel deliberately NOT in ship-gate per ADR-0027 D2/D6).
// ---------------------------------------------------------------------------
async function stepMemoryEval() {
  report("info", "step 7/9: memory eval harness gate (ADR-0027)");
  const outDir = path.join(ROOT, ".ship-gate");
  fs.mkdirSync(outDir, { recursive: true });
  // round-59 audit R-2 / ADR-0060 D7: the gate is offline-deterministic. The vector-arm slice
  // is excluded here (it needs the embedding model) and re-established by the CI test-online job
  // (.github/workflows/ci.yml). The dataset fingerprint is unaffected (runAll keeps it full).
  const evalArgs = ["--import", "tsx", path.join("src", "eval", "cli.ts"), "--out", outDir, "--offline"];
  if (overrideReason !== undefined) evalArgs.push("--override", overrideReason);
  // ADR-0059 D2 (F-15): regular CI/merge runs are observational grade; decision grade is reserved
  // for the release workflow (release.yml). No --decision here, and no OF look is ever consumed.
  const res = await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      evalArgs,
      // ADR-0059 D2: the merge gate never consumes a preregistered OF look.
      { cwd: path.join(ROOT, "packages", "store"), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ANS_EVAL_NO_LOOK: "1" } }
    );
    let buf = "";
    child.stdout.on("data", (d) => (buf += d.toString("utf8")));
    child.stderr.on("data", (d) => (buf += d.toString("utf8")));
    child.on("close", (code) => resolve({ code, buf }));
  });
  if (res.code === 2) {
    const tail = res.buf.trim().split("\n").slice(-8).join("\n");
    failUnverifiable("memory-eval gate exited 2 (unverifiable/inconclusive)\n" + tail);
  }
  if (res.code !== 0) {
    const tail = res.buf.trim().split("\n").slice(-8).join("\n");
    fail("memory-eval gate exited " + res.code + " (0=pass/warn / 1=publish-red / 2=unverifiable / 12=fingerprint mismatch)\n" + tail);
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
  // ADR-0044 D3: a decision-grade failed integrity verdict is publish-red. Observational runs
  // remain report-only; the eval CLI only sets failed on a decision run.
  const integrityContract = evalIntegrityCheck(rep);
  if (!integrityContract.ok) fail(integrityContract.detail);
  report("info", "memory-eval integrity contract: " + integrityContract.detail);
  if (typeof rep.datasetFingerprint !== "string" || rep.datasetFingerprint.length !== 16) {
    fail("memory-eval report lacks 16-hex dataset fingerprint");
  }
  // ADR-0034 D5: report is contract — the attribution zone must exist even at zero state.
  {
    const z = rep.metrics && rep.metrics.attribution;
    const need = ["supported", "uncertain", "unsupported", "supportedPrecision", "unsupportedRecall", "totalClaims", "judgeEnhanced", "confusion"];
    if (!z || typeof z !== "object") fail("memory-eval report missing metrics.attribution zone (ADR-0034 D5 fail-closed)");
    const missing = need.filter((k) => !(k in z));
    if (missing.length) fail("memory-eval attribution zone missing keys: " + missing.join(", "));
    report("pass", "memory-eval attribution zone present (zero-state observation period)");
  }
  // ADR-0035 D5: relation zone must exist (fail-closed shape guard; its sub-metrics are observational).
  {
    const z = rep.metrics && rep.metrics.relation;
    const need = ["noEdgeChecks", "noEdgeViolations", "hopChecks", "hopHits", "hopHitRate", "tel"];
    if (!z || typeof z !== "object") fail("memory-eval report missing metrics.relation zone (ADR-0035 D5 fail-closed)");
    const missing = need.filter((k) => !(k in z));
    if (missing.length) fail("memory-eval relation zone missing keys: " + missing.join(", "));
    report("pass", "memory-eval relation zone present (noEdge=" + z.noEdgeChecks + " hop=" + z.hopChecks + ")");
  }
  // ADR-0037 D6 Phase-2: semantic serve zone (regressions fail-closed) + forget zone shape guards.
  {
    const zm = rep.metrics && rep.metrics.semantic;
    if (!zm || typeof zm !== "object") fail("memory-eval report missing metrics.semantic zone (ADR-0037 D6 fail-closed)");
    for (const k of ["queries", "hits", "served"]) if (!(k in zm)) fail("memory-eval semantic zone missing " + k);
    if (!("regressions" in zm)) fail("memory-eval semantic zone missing regressions key (ADR-0037 D6 Phase-2)");
    if (zm.regressions !== 0) fail("memory-eval semantic-arm regressions=" + zm.regressions + " — fail-closed (ADR-0037 D6 Phase-2)");
    const zf = rep.metrics && rep.metrics.forget;
    if (!zf || typeof zf !== "object") fail("memory-eval report missing metrics.forget zone (ADR-0037 D6 fail-closed)");
    for (const k of ["archiveChecks", "archives", "undoRestores", "dryRunExact"]) if (!(k in zf)) fail("memory-eval forget zone missing " + k);
    if (zf.archiveChecks > 0 && zf.dryRunExact !== zf.archiveChecks) fail("forget dry-run predictions not exact: " + zf.dryRunExact + "/" + zf.archiveChecks);
    if (zf.archiveChecks > 0 && zf.undoRestores === 0) fail("forget undo restores absent despite archives");
    report("pass", "memory-eval semantic serve + forget zones present (sem queries=" + zm.queries + " forget archives=" + zf.archives + ")");
  }
  // ADR-0039 step 7 + E3: observational zone presence is fail-closed (report-as-contract);
  // the VALUES inside are never gated (N1, Goodhart clause in ADR-0039 _Avoid_ 1).
  {
    const z = rep.metrics && rep.metrics.observational;
    if (!z || typeof z !== "object") failUnverifiable("memory-eval report missing metrics.observational zone (ADR-0039 E3 fail-closed)");
    if (z.schema !== "anysearch/observational@1") failUnverifiable("observational zone schema drift: " + z.schema);
    for (const k of ["accessAge", "tauScan", "bgnbd", "revival", "undoReentryEvents", "dayBucketDefinition", "eventWriteFailures", "armDeltas", "maxLexicalOverlap", "exclusiveHits", "nativeScoresMissing"]) if (!(k in z)) failUnverifiable("observational zone missing " + k);
    // D7: skip-ledger escalation — 3 consecutive identical observational skips force human review.
    const skipL = path.join(outDir, "skip-ledger.json");
    if (fs.existsSync(skipL)) {
      const sl = JSON.parse(fs.readFileSync(skipL, "utf8"));
      if (typeof sl.consecutiveWarn === "number" && sl.consecutiveWarn >= 3) {
        fail("observational explicit-skip streak " + sl.consecutiveWarn + " >= 3 — forced human review: node scripts/gain-warn-resolve.mjs --decision stay-warn --note observational-skip --ledger " + skipL + " (ADR-0039 D7)");
      }
    }
    report("pass", "memory-eval observational zone present (ADR-0039; values never gated, D7 streak ledger watched)");
    // ADR-0043 impl-plan 8: ship-gate reads switch state through the ledger (informational;
    // exit-code semantics unchanged — S0 data-absent boots must pass on both db shapes).
    if (fs.existsSync(skipL)) {
      try {
        const sl2 = JSON.parse(fs.readFileSync(skipL, "utf8"));
        const st = sl2 && sl2.state && typeof sl2.state.phase === "string" ? sl2.state : null;
        report("info", "switch-state: phase " + (st ? st.phase : "S0 (pre-@3 ledger)") + (st && st.since ? " since " + st.since : "") + (st && st.transitionId ? " transitionId " + st.transitionId : ""));
      } catch (e) {
        report("info", "switch-state: ledger unreadable (handled by eval quarantine): " + String(e && e.message ? e.message : e));
      }
    } else {
      report("info", "switch-state: no ledger yet — phase S0 (boot)");
    }

  }
  // ADR-0037 D6 (carries ADR-0028 D1): fingerprint single-flip — report fingerprint must equal the committed baseline.
  {
    const blPath = path.join(ROOT, "packages/store/eval-baseline.json");
    const bl = JSON.parse(fs.readFileSync(blPath, "utf8"));
    if (bl.fingerprint !== rep.datasetFingerprint) fail("fingerprint drift: report " + rep.datasetFingerprint + " != baseline " + bl.fingerprint + " (run eval --calibrate, commit baseline)");
    report("pass", "eval fingerprint matches baseline (" + rep.datasetFingerprint + ")");
  }
  // ADR-0038 D2/D5: three-tier gain gate (fail-closed) + holdout fingerprint cross-check + WARN ledger.
  {
    const blPath = path.join(ROOT, "packages/store/eval-baseline.json");
    const bl = JSON.parse(fs.readFileSync(blPath, "utf8"));
    if (typeof bl.holdoutFingerprint !== "string" || bl.holdoutFingerprint !== rep.holdoutFingerprint) {
      fail("holdout fingerprint mismatch: report " + rep.holdoutFingerprint + " vs baseline " + (bl.holdoutFingerprint ?? "<absent>") + " — run eval --calibrate (ADR-0038 D5)");
    }
    const gc = rep.gate && rep.gate.gainConclusion;
    if (!gc || typeof gc !== "object" || !gc.tier) fail("memory-eval report missing gate.gainConclusion (ADR-0038 D2 fail-closed)");
    const ledgerPath = path.join(outDir, "gain-ledger.json");
    const ledger = readGainLedger(ledgerPath);
    if (gc.tier === "red") {
      writeGainLedger(ledgerPath, applyTier(ledger, "red", new Date().toISOString(), gc.look));
      fail("gain gate RED (proven-negative, ADR-0038 D2): " + (gc.reasons || []).join(" | "));
    }
    if (gc.tier === "warn") {
      applyTier(ledger, gc.tier, new Date().toISOString(), gc.look);
      const streak = ledger.consecutiveWarn;
      const terminalUnproven = mustFail(ledger) || gc.look > gc.kMax;
      if (terminalUnproven) {
        applyResolution(ledger, "demote", new Date().toISOString(), "ADR-0052 r49 governance amendment: relation-arm unproven-positive, demote to observance");
        writeGainLedger(ledgerPath, ledger);
        report("pass", "gain gate demoted to observance (verdict=unproven-positive, disposition=demote, look " + gc.look + "/" + gc.kMax + "): " + ((gc.reasons || [])[0] ?? ""));
      } else {
        writeGainLedger(ledgerPath, ledger);
        report("pass", "gain gate WARN (streak " + streak + "/" + WARN_STREAK_LIMIT + "): " + ((gc.reasons || [])[0] ?? ""));
      }
    } else {
      writeGainLedger(ledgerPath, applyTier(ledger, gc.tier, new Date().toISOString(), gc.look));
      report("pass", "gain gate GREEN (look " + gc.look + "/" + gc.kMax + ", spent alpha " + Number(gc.spentAlpha).toFixed(6) + ")");
    }
  }
  report("pass", "memory-eval: " + rep.totals.passed + "/" + rep.totals.cases + " cases PASS, fingerprint=" + rep.datasetFingerprint + ", passRate=" + rep.metrics.passRate);
}

// ---------------------------------------------------------------------------
// Step 7b — ADR-0047 emergency ship override governance
// ---------------------------------------------------------------------------
async function stepOverrideGovernance() {
  report("info", "step 7b/9: emergency ship override verifier (ADR-0047)");
  const outDir = path.join(ROOT, ".ship-gate");
  const reportPath = path.join(outDir, "eval-report.json");
  const verifier = path.join(ROOT, "packages", "store", "src", "eval", "override-verifier.ts");
  const base = ["--import", "tsx", verifier];

  if (overrideReason !== undefined) {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    await run(process.execPath, [
      ...base,
      "record",
      "--ledger", outDir,
      "--dataset-fingerprint", report.datasetFingerprint,
      "--holdout-fingerprint", report.holdoutFingerprint,
      "--reason-code", overrideReason,
      "--gate-report", reportPath,
    ], { cwd: path.join(ROOT, "packages", "store") });
    await run(process.execPath, ["--import", "tsx", "src/eval/cli.ts", "--calibrate"], {
      cwd: path.join(ROOT, "packages", "store"),
    });
    report("pass", "override verifier recorded emergency override and forced rebaseline for " + overrideReason);
    return;
  }

  if (acknowledgeLate) {
    await run(process.execPath, [
      ...base,
      "acknowledge-late",
      "--ledger", outDir,
    ], { cwd: path.join(ROOT, "packages", "store") });
    report("pass", "override verifier recorded late acknowledgement");
    return;
  }

  await run(process.execPath, [...base, "status", "--ledger", outDir], { cwd: path.join(ROOT, "packages", "store") });
  report("info", "override ledger status valid; no override action requested");
}

// ---------------------------------------------------------------------------
// Step 8 — stdio MCP initialize smoke (fail-open per CONTEXT.md fail-open rule)
// ---------------------------------------------------------------------------
async function stepMcpInitialize() {
  report("info", "step 8/9: spawn plugin MCP over stdio, assert initialize result");

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
      clientInfo: { name: "ship-gate", version: "0.0.1" },
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
// Step 8b — ADR-0052 D7: packaged CLI/MCP trace round-trip and durable SQLite
// schema smoke. No network or provider keys are required; the verifier expects
// fail-open operation traces, not successful upstream retrieval.
// ---------------------------------------------------------------------------
async function stepObservationSmoke() {
  report("info", "step 8b/9: packaged CLI/MCP observation smoke (ADR-0052)");
  await run(process.execPath, [path.join(ROOT, "scripts", "verify-observation.mjs")], { stdio: "pipe" });
  report("pass", "packaged CLI/MCP observation trace round-trip green");
}

// ---------------------------------------------------------------------------
// Step 9 — fail-open: server must boot + respond to initialize even with NO
// ANYSEARCH_* / TAVILY_* / EXA_* / ANS_* env set. Server-level fail-fast is
// github-mcp-server convention (exit non-zero + stderr) — but our env vars are
// tool-level (retriever providers check them per-call), so server MUST boot
// and answer initialize. This is the ADR-0009 D6 contract: dead env = empty
// data, not dead protocol.
// ---------------------------------------------------------------------------
async function stepFailOpenBoot() {
  report("info", "step 9/9: spawn MCP with scrubbed env, assert fail-open boot");

  const mcpEntry = path.join(ROOT, MCP_MAIN);
  const req = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "ship-gate-failopen", version: "0.0.1" },
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
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const skipMatrix = args.has("--skip-matrix");
const quick = args.has("--quick");
const overrideIdx = rawArgs.indexOf("--override");
const overrideReason = overrideIdx >= 0 ? rawArgs[overrideIdx + 1] : undefined;
const acknowledgeLate = args.has("--acknowledge-late");
if (overrideIdx >= 0 && (!overrideReason || !SHIP_OVERRIDE_REASON_CODES.includes(overrideReason))) {
  process.stderr.write("ship-gate: --override requires one of " + SHIP_OVERRIDE_REASON_CODES.join(", ") + "\n");
  process.exit(2);
}

(async () => {
  reportStep("step_0_invariants");
  stepZeroInvariants();
  reportStep("step_1_static_assertions");
  stepStaticAssertions();
  stepAdrIndex();
  stepDocClaims();
  stepSupersessionIntegrity();
  stepContextWiring();
  stepEvidenceAnchors();
  stepHandoffCloseoutLint();
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
    await stepOverrideGovernance();
    reportStep("step_5_mcp_stdio");
    await stepMcpInitialize();
    await stepObservationSmoke();
    reportStep("step_9_fail_open_boot");
    await stepFailOpenBoot();
    report("info", "cross-OS native loading covered by CI native-smoke.yml 4-job matrix (ADR-0025 D1)");
    report("pass", "ship gate green — ready to tag the next release");
    flushReportEntries("pass");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})().catch((err) => {
  report("fail", err.message);
  flushReportEntries("fail");
  process.exit(1);
});
