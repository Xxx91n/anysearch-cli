// Q2 probe: two REAL processes consolidate two sessions that both correct the
// same live semantic memory. A file barrier makes both plans read the old
// version before either write transaction starts.
//
// Runs the same scenario twice:
//   mode A  ANS_PROTOTYPE_CONSOLIDATE_GUARD=0  -> expected current behavior:
//           both update=1, two contradictory live rows (defect reproduced).
//   mode B  guard default (on)                 -> exactly one update, the other
//           reports a stale concurrency conflict; one live row.
//
// Also checks Q18: a malformed sessionId on ans_chat(operation=consolidate)
// is an error, not a silent full-archive fallback.
//
// Run: node --import tsx prototype/pi-concurrency-reliability/probe-q2-concurrent.ts
// (requires a prior `pnpm -r build`)

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "../../packages/store/src/session-store";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const WORKER = join(HERE, "q2-worker.ts");
const MCP_DIST = join(ROOT, "apps", "mcp", "dist", "index.js");
const OUT = join(HERE, "out");
const OLD = "Business hours are Monday to Friday 9-5.";
const ALPHA = "Support hours are now 24/7, no longer Monday to Friday 9-5.";
const OMEGA = "Support hours are now 10:00-18:00 on weekends, no longer Monday to Friday 9-5.";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
const findings: Array<{ id: string; question: string; pass: boolean; evidence: unknown }> = [];
function record(id: string, question: string, pass: boolean, evidence: unknown) {
  findings.push({ id, question, pass, evidence });
  console.log((pass ? "  ok   " : "  FAIL ") + id + " — " + question);
}

function rows(count: number, marker: string) {
  return Array.from({ length: count }, (_, i) => ({
    url: "https://support.example/" + marker + "-" + (i + 1),
    title: "Support hours (" + marker + " update v" + (i + 1) + ")",
    snippet: "Material " + marker + " v" + (i + 1) + ": " +
      (marker === "ALPHA" ? ALPHA : marker === "OMEGA" ? OMEGA : OLD),
    source: "tavily",
    score: 1,
    entity: "support-hours",
  }));
}

async function seed(dbPath: string): Promise<{ alpha: string; omega: string; oldId: number }> {
  const store = new SqliteSessionStore(dbPath);
  const seedSession = await store.createSession("probe");
  const alphaSession = await store.createSession("chat");
  const omegaSession = await store.createSession("chat");
  await store.saveResults(seedSession.id, rows(3, "OLD"));
  await store.saveResults(alphaSession.id, rows(3, "ALPHA"));
  await store.saveResults(omegaSession.id, rows(3, "OMEGA"));
  const oldIds = (store.dbQuery<{ id: number }>(
    "SELECT id FROM retrieval_results WHERE session_id = ? ORDER BY id", [seedSession.id])).map((r) => r.id);
  store.close();

  const raw = new Database(dbPath);
  const info = raw.prepare(
    "INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, ?, ?, ?, NULL)",
  ).run(OLD, JSON.stringify(oldIds), 0.7, 0.95);
  const oldId = Number(info.lastInsertRowid);
  for (const s of [alphaSession.id, omegaSession.id]) {
    raw.prepare("INSERT INTO resume_anchors (session_id, anchor_type, payload) VALUES (?, 'rolling_summary', ?)")
      .run(s, JSON.stringify({ summary: "Session note: " + OLD, timestamp: Date.now() }));
  }
  raw.close();
  return { alpha: alphaSession.id, omega: omegaSession.id, oldId };
}

function runWorker(args: { role: "alpha" | "omega"; dbPath: string; sessionId: string; barrierDir: string; guard: "0" | "1" }) {
  return new Promise<{ role: string; report?: any; error?: string; stdout: string; stderr: string }>((res) => {
    const child = spawn(process.execPath, ["--import", "tsx", WORKER], {
      cwd: ROOT,
      env: {
        ...process.env,
        Q2_ROLE: args.role,
        Q2_DB: args.dbPath,
        Q2_SESSION: args.sessionId,
        Q2_BARRIER_DIR: args.barrierDir,
        ANS_PROTOTYPE_CONSOLIDATE_GUARD: args.guard,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += c.toString(); });
    child.stderr.on("data", (c) => { stderr += c.toString(); });
    child.on("exit", () => {
      const line = stdout.split("\n").find((l) => l.startsWith("RESULT "));
      let parsed: any = {};
      if (line) { try { parsed = JSON.parse(line.slice("RESULT ".length)); } catch { parsed = {}; } }
      res({ role: args.role, ...parsed, stdout, stderr });
    });
  });
}

function snapshot(dbPath: string, oldId: number) {
  const db = new Database(dbPath, { readonly: true });
  const sem = db.prepare(
    "SELECT id, content, valid_until, superseded_by FROM semantic_memories ORDER BY id",
  ).all() as any[];
  const oldRow = sem.find((r) => r.id === oldId);
  const oldEpisodes = db.prepare(
    "SELECT id, superseded_by FROM retrieval_results WHERE entity = 'support-hours' AND snippet LIKE 'Material OLD%' ORDER BY id",
  ).all() as any[];
  const statuses = db.prepare(
    "SELECT session_id, payload FROM resume_anchors WHERE anchor_type = 'anchor_status' ORDER BY id",
  ).all() as any[];
  db.close();
  return { sem, oldRow, oldEpisodes, statuses };
}

async function scenario(label: "A" | "B", guard: "0" | "1") {
  const root = mkdtempSync(join(tmpdir(), "ans-q2-" + label + "-"));
  const dbPath = join(root, "anysearch.db");
  const barrierDir = join(root, "barrier");
  mkdirSync(barrierDir, { recursive: true });
  const ids = await seed(dbPath);
  const [alpha, omega] = await Promise.all([
    runWorker({ role: "alpha", dbPath, sessionId: ids.alpha, barrierDir, guard }),
    runWorker({ role: "omega", dbPath, sessionId: ids.omega, barrierDir, guard }),
  ]);
  const snap = snapshot(dbPath, ids.oldId);
  const live = snap.sem.filter((r) => r.valid_until === null);
  const workers = { alpha, omega };
  const detail = {
    mode: label,
    guard,
    oldId: ids.oldId,
    reports: {
      alpha: workers.alpha.error ? { error: workers.alpha.error } : workers.alpha.report,
      omega: workers.omega.error ? { error: workers.omega.error } : workers.omega.report,
    },
    liveSemantic: live.map((r) => ({ id: r.id, content: r.content })),
    oldRow: snap.oldRow,
    oldEpisodes: snap.oldEpisodes,
    statuses: snap.statuses.map((s) => { try { return JSON.parse(s.payload); } catch { return s.payload; } }),
    stderr: {
      alpha: workers.alpha.stderr.replace(/^.*$/gm, (l) => l).slice(0, 200),
      omega: workers.omega.stderr.replace(/^.*$/gm, (l) => l).slice(0, 200),
    },
  };
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  return detail;
}

// ---------- malformed consolidate scope through the built MCP server ----------

function startMcp(env: Record<string, string>) {
  const child = spawn(process.execPath, [MCP_DIST, "--transport", "stdio"], {
    env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (c) => { stderr += c.toString(); });
  const pending = new Map<number, { resolve: (v: any) => void; timer: NodeJS.Timeout }>();
  let nextId = 1;
  let buf = "";
  child.stdout.on("data", (c) => {
    buf += c.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let m: any;
      try { m = JSON.parse(line); } catch { continue; }
      if (m.id !== undefined && pending.has(m.id)) {
        const p = pending.get(m.id)!; pending.delete(m.id); clearTimeout(p.timer); p.resolve(m);
      }
    }
  });
  function rpc(method: string, params: unknown, timeoutMs = 30000): Promise<any> {
    return new Promise((res, rej) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); rej(new Error("rpc timeout: " + method)); }, timeoutMs);
      pending.set(id, { resolve: res, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  return { child, rpc, stderr: () => stderr };
}

async function invalidScopeCheck(): Promise<unknown> {
  const root = mkdtempSync(join(tmpdir(), "ans-q2-scope-"));
  const dbPath = join(root, "anysearch.db");
  const mcp = startMcp({
    ANS_DB_PATH: dbPath,
    ANS_PI_SESSION_DIR: join(root, "pi"),
    ANS_LLM_PROVIDER: "openai",
    ANS_LLM_MODEL: "probe-model",
    ANS_LLM_BASE_URL: "http://127.0.0.1:1/v1",
    ANS_LLM_API: "chat",
    ANS_LLM_API_KEY: "probe-key-not-used",
  });
  try {
    await mcp.rpc("initialize", {
      protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "q2-probe", version: "1" },
    });
    mcp.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
    const res = await mcp.rpc("tools/call", {
      name: "ans_chat", arguments: { operation: "consolidate", sessionId: "bad id with spaces" },
    });
    const text = (res.result?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    return { isError: res.result?.isError === true, text, structured: res.result?.structuredContent ?? null, stderr: mcp.stderr().slice(0, 300) };
  } finally {
    mcp.child.kill();
    await sleep(300);
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
}

try {
  const before = await scenario("A", "0");
  // Version relations in the pre-fix run disagree with each other: the old row
  // names one successor while its episodes name the other.
  const beforeDiverges = before.oldRow?.superseded_by !== null &&
    before.oldEpisodes.length > 0 &&
    before.oldEpisodes.every((r) => r.superseded_by !== before.oldRow.superseded_by);
  record("S0-repro", "current behavior: both writers report update and leave two contradictory live conclusions",
    before.reports.alpha.update === 1 && before.reports.omega.update === 1 &&
      before.liveSemantic.length === 2 && beforeDiverges,
    { mode: "A (guard=0)", liveSemantic: before.liveSemantic, reports: before.reports, oldRow: before.oldRow, oldEpisodes: before.oldEpisodes });

  const after = await scenario("B", "1");
  const updates = [after.reports.alpha, after.reports.omega];
  const applied = updates.filter((r: any) => r?.update === 1).length;
  const stale = updates.filter((r: any) => Number(r?.staleUpdates ?? 0) === 1).length;
  record("S1-serialized-conflict", "guard on: exactly one update lands, the other reports a stale conflict, one live conclusion",
    applied === 1 && stale === 1 && after.liveSemantic.length === 1,
    { mode: "B (guard=1)", liveSemantic: after.liveSemantic, reports: after.reports, oldRow: after.oldRow });

  const winnerId = after.oldRow?.superseded_by ?? null;
  record("S1-relations", "old row names the winning successor; old episodes point at that same successor",
    winnerId !== null &&
      after.oldEpisodes.every((r) => r.superseded_by === winnerId),
    { winnerId, oldRow: after.oldRow, oldEpisodes: after.oldEpisodes });

  record("S1-summaries", "affected summaries are paused once, pointing at the winning correction",
    after.statuses.length > 0 && after.statuses.every((s: any) => s?.invalidatedBy === winnerId),
    { statuses: after.statuses });

  const scope = await invalidScopeCheck();
  record("S2-invalid-scope", "malformed consolidate sessionId is an error, not a full-archive fallback",
    (scope as any).isError === true && /sessionId/i.test((scope as any).text ?? ""),
    scope);

  const evidence = {
    probe: "q2-concurrent",
    startedAt: new Date().toISOString(),
    fixedSamples: "SAMPLES-Q1-Q3.md",
    model: { provider: process.env.ANS_LLM_PROVIDER, model: process.env.ANS_LLM_MODEL, customEndpoint: !!process.env.ANS_LLM_BASE_URL },
    scenarios: { before, after, invalidScope: scope },
    checks: findings,
  };
  writeFileSync(join(OUT, "q2-concurrent.json"), JSON.stringify(evidence, null, 2) + "\n");
  const failed = findings.filter((f) => !f.pass);
  console.log("\n" + (failed.length === 0 ? "all checks passed" : failed.length + " check(s) failed") + " — out/q2-concurrent.json");
  process.exitCode = failed.length === 0 ? 0 : 1;
} catch (e) {
  console.error("probe failed: " + (e instanceof Error ? e.stack ?? e.message : String(e)));
  process.exitCode = 2;
}
