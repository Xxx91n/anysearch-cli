// Q21 probe: two REAL processes + a real model correct the same live
// knowledge. A file barrier makes both plans read the old version before
// either writer starts its transaction.
//
//   B1  both use the same official notice (same text, different URLs, so
//       saveResults' same-URL invalidation does not hide one side).
//       Expectation: one update, one live row, the loser re-reads, recognises
//       the correction already exists and writes no second version.
//   B2  alpha has the official 7x24 notice, beta an undated weekend-only claim
//       of equal source standing. Expectation: one update lands, the loser
//       re-judges once, still cannot resolve it and reports both sides' materials
//       instead of overwriting.
//
// Run: node --import tsx prototype/pi-q20-q21-lock-recovery/probe-q21-concurrent.ts

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "../../packages/store/src/session-store";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const WORKER = join(HERE, "q21-worker.ts");
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });

const provider = process.env.ANS_LLM_PROVIDER ?? "";
const modelName = process.env.ANS_LLM_MODEL ?? "";
const apiKey = process.env.ANS_LLM_API_KEY;
if (!provider || !modelName) {
  console.error("missing ANS_LLM_PROVIDER / ANS_LLM_MODEL");
  process.exit(2);
}

const OLD = "A 公司在线客服工作日（周一至周五）9:00—17:00 提供服务。客服邮箱为 help@example.com。";
const ALPHA_TEXT = "A 公司官方通知（2026-11-01 生效）：在线客服改为 7×24 小时全天候服务，替代原工作日（周一至周五）9:00—17:00 的安排。";
const BETA_TEXT = "A 公司通知：在线客服仅在周末 10:00—18:00 提供服务。";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const findings: Array<{ id: string; question: string; pass: boolean; evidence: unknown }> = [];
function record(id: string, question: string, pass: boolean, evidence: unknown) {
  findings.push({ id, question, pass, evidence });
  console.log((pass ? "  ok   " : "  FAIL ") + id + " — " + question);
}

interface Seed {
  alphaSession: string;
  betaSession: string;
  oldId: number;
  alphaUrl: string;
  betaUrl: string;
}

async function seed(dbPath: string, mode: "B1" | "B2"): Promise<Seed> {
  const store = new SqliteSessionStore(dbPath);
  const seedSession = await store.createSession("probe");
  const alphaSession = await store.createSession("chat");
  const betaSession = await store.createSession("chat");

  await store.saveResults(seedSession.id, [1, 2, 3].map((i) => ({
    url: "https://a.example/support-hours-old-v" + i,
    title: "A 公司客服时间（旧页面 v" + i + "）",
    snippet: "A 公司官网客服页面写明：在线客服工作日（周一至周五）9:00—17:00 提供服务，客服邮箱 help@example.com。",
    source: "tavily",
    score: 1,
    entity: "a-support-hours",
  })));
  const oldIds = store.dbQuery<{ id: number }>(
    "SELECT id FROM retrieval_results WHERE session_id = ? ORDER BY id", [seedSession.id]).map((r) => r.id);

  const alphaUrl = "https://a.example/notice-2026-11-01";
  const betaUrl = mode === "B1" ? "https://a.example/notice-2026-11-01-copy" : "https://b.example/notice-2";
  const betaTitle = mode === "B1" ? "A 公司客服时间更新通知（官方）" : "A 公司客服时间通知（另一份）";

  await store.saveResults(alphaSession.id, [{
    url: alphaUrl,
    title: "A 公司客服时间更新通知（官方）",
    snippet: ALPHA_TEXT,
    source: "tavily",
    score: 1,
    entity: "a-support-hours",
  }]);
  await store.saveResults(betaSession.id, [{
    url: betaUrl,
    title: betaTitle,
    snippet: mode === "B1" ? ALPHA_TEXT : BETA_TEXT,
    source: "tavily",
    score: 1,
    entity: "a-support-hours",
  }]);
  store.close();

  const raw = new Database(dbPath);
  const info = raw.prepare(
    "INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, ?, ?, ?, NULL)",
  ).run(OLD, JSON.stringify(oldIds), 0.7, 0.95);
  const oldId = Number(info.lastInsertRowid);
  for (const s of [alphaSession.id, betaSession.id]) {
    raw.prepare("INSERT INTO resume_anchors (session_id, anchor_type, payload) VALUES (?, 'rolling_summary', ?)")
      .run(s, JSON.stringify({ summary: "会话备注：" + OLD, timestamp: Date.now() }));
  }
  raw.close();
  return { alphaSession: alphaSession.id, betaSession: betaSession.id, oldId, alphaUrl, betaUrl };
}

function runWorker(args: {
  role: "alpha" | "beta"; mode: "B1" | "B2"; dbPath: string; sessionId: string; barrierDir: string;
  extraEnv?: Record<string, string>;
}) {
  return new Promise<any>((res) => {
    const child = spawn(process.execPath, ["--import", "tsx", WORKER], {
      cwd: ROOT,
      env: {
        ...process.env,
        Q21_ROLE: args.role,
        Q21_MODE: args.mode,
        Q21_DB: args.dbPath,
        Q21_SESSION: args.sessionId,
        Q21_BARRIER_DIR: args.barrierDir,
        ...(args.extraEnv ?? {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += c.toString(); });
    child.stderr.on("data", (c) => { stderr += c.toString(); });
    child.on("exit", (code) => {
      const line = stdout.split("\n").find((l) => l.startsWith("RESULT "));
      let parsed: any = {};
      if (line) { try { parsed = JSON.parse(line.slice("RESULT ".length)); } catch { parsed = {}; } }
      res({ role: args.role, exitCode: code, ...parsed, stdout, stderr: stderr.slice(0, 600) });
    });
  });
}

function snapshot(dbPath: string, oldId: number, urls: string[]) {
  const db = new Database(dbPath, { readonly: true });
  const sem = db.prepare("SELECT id, content, valid_until, superseded_by FROM semantic_memories ORDER BY id").all() as any[];
  const oldRow = sem.find((r) => r.id === oldId) ?? null;
  const oldEpisodes = db.prepare(
    "SELECT id, url, superseded_by, valid_until FROM retrieval_results WHERE url LIKE 'https://a.example/support-hours-old-%' ORDER BY id",
  ).all() as any[];
  const materials = db.prepare(
    "SELECT id, url, snippet, superseded_by, valid_until FROM retrieval_results WHERE url IN (" + urls.map(() => "?").join(", ") + ") ORDER BY id",
  ).all(...urls) as any[];
  const statuses = db.prepare(
    "SELECT session_id, payload FROM resume_anchors WHERE anchor_type = 'anchor_status' ORDER BY id",
  ).all() as any[];
  const integrity = db.pragma("integrity_check", { simple: true });
  db.close();
  return {
    sem,
    liveSemantic: sem.filter((r) => r.valid_until === null).map((r) => ({ id: r.id, content: r.content })),
    oldRow,
    oldEpisodes,
    materials,
    statuses: statuses.map((s) => { try { return JSON.parse(s.payload); } catch { return s.payload; } }),
    integrity,
  };
}

async function scenario(mode: "B1" | "B2", scriptedVerify = false) {
  const root = mkdtempSync(join(tmpdir(), "ans-q21-" + mode + (scriptedVerify ? "-scripted" : "") + "-"));
  const dbPath = join(root, "anysearch.db");
  const barrierDir = join(root, "barrier");
  mkdirSync(barrierDir, { recursive: true });
  const ids = await seed(dbPath, mode);
  const workerEnv = scriptedVerify ? { Q21_SCRIPTED_VERIFY: "1" } : {};
  const [alpha, beta] = await Promise.all([
    runWorker({ role: "alpha", mode, dbPath, sessionId: ids.alphaSession, barrierDir, extraEnv: workerEnv }),
    runWorker({ role: "beta", mode, dbPath, sessionId: ids.betaSession, barrierDir, extraEnv: workerEnv }),
  ]);
  const snap = snapshot(dbPath, ids.oldId, [ids.alphaUrl, ids.betaUrl]);
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  return {
    mode,
    oldId: ids.oldId,
    reports: {
      alpha: alpha.error ? { error: alpha.error } : alpha.report,
      beta: beta.error ? { error: beta.error } : beta.report,
    },
    calls: { alpha: alpha.calls, beta: beta.calls },
    usage: { alpha: alpha.usage, beta: beta.usage },
    lastVerifyPrompts: { alpha: alpha.lastVerifyPrompt, beta: beta.lastVerifyPrompt },
    stderr: { alpha: alpha.stderr, beta: beta.stderr },
    state: snap,
  };
}

const evidence: any = {
  probe: "q21-concurrent",
  startedAt: new Date().toISOString(),
  samples: "SAMPLES-Q20-Q21-LOCK-COLDSTART.md (confirmed)",
  model: {
    provider, model: modelName,
    baseUrlPresent: !!process.env.ANS_LLM_BASE_URL,
    api: process.env.ANS_LLM_API ?? null,
    apiKeyLength: apiKey?.length ?? 0,
    note: "custom endpoint: cost unknown, never free",
  },
  scenarios: [] as any[],
  checks: findings as unknown[],
};

try {
  const b1 = await scenario("B1");
  evidence.scenarios.push(b1);
  console.log("B1 done");

  const b1reports = b1.reports;
  const b1updates = [b1reports.alpha, b1reports.beta].filter((r: any) => r?.update === 1);
  const b1loser = [b1reports.alpha, b1reports.beta].find((r: any) => Number(r?.staleUpdates ?? 0) === 1) ?? null;
  record("B1-one-update", "同文更正：只落地一次 update，只剩一条生效结论",
    b1state(b1).liveSemantic.length === 1 && b1updates.length === 1,
    { live: b1state(b1).liveSemantic, reports: b1reports });
  record("B1-loser", "后提交方重读一次、识别已更正、不再造第二个版本",
    b1loser !== null &&
      b1loser.retriedAfterStale === 1 &&
      b1loser.update === 0 &&
      (b1loser.noop >= 1 || b1loser.skip >= 1) &&
      Array.isArray(b1loser.semanticIds) && b1loser.semanticIds.length === 0,
    { loser: b1loser });
  record("B1-bounded", "后提交方最多 2 次真实模型判断（初次 + 重读后一次）",
    b1loser !== null && b1loserCalls(b1) <= 2,
    { calls: b1.calls });
  record("B1-relations", "旧 row 和旧 episode 的 superseded_by 指向同一条新 row",
    b1state(b1).oldRow?.superseded_by != null &&
      b1state(b1).oldEpisodes.length === 3 &&
      b1state(b1).oldEpisodes.every((e: any) => e.superseded_by === b1state(b1).oldRow.superseded_by),
    { oldRow: b1state(b1).oldRow, oldEpisodes: b1state(b1).oldEpisodes });
  record("B1-materials", "两边材料都留在归档，没有靠删证据来收场",
    b1state(b1).materials.length === 2 &&
      b1state(b1).materials.every((m: any) => m.valid_until === null),
    { materials: b1state(b1).materials });
  record("B1-summaries", "受影响摘要的暂停记录指向唯一的新 row",
    b1state(b1).statuses.length > 0 &&
      b1state(b1).statuses.every((s: any) => s?.invalidatedBy === b1state(b1).oldRow?.superseded_by),
    { statuses: b1state(b1).statuses });

  const b2 = await scenario("B2");
  evidence.scenarios.push(b2);
  console.log("B2 done");

  const b2reports = b2.reports;
  const b2updates = [b2reports.alpha, b2reports.beta].filter((r: any) => r?.update === 1);
  const b2loser = [b2reports.alpha, b2reports.beta].find((r: any) => Number(r?.staleUpdates ?? 0) === 1) ?? null;
  const conflict = b2loser?.conflictDetails?.[0] ?? null;
  record("B2-one-update", "互相冲突：先写入者只落地一次 update，仍只有一条生效结论",
    b2state(b2).liveSemantic.length === 1 && b2updates.length === 1,
    { live: b2state(b2).liveSemantic, reports: b2reports });
  record("B2-unresolved", "后提交方再判一次仍冲突，明确返回冲突而不是覆盖",
    b2loser !== null &&
      b2loser.update === 0 &&
      b2loser.retriedAfterStale === 1 &&
      b2loser.concurrentConflicts === 1 &&
      b2loser.conflict >= 1 &&
      b2loser.concurrentConflicts === 1,
    { loser: b2loser });
  record("B2-both-sides", "冲突报告带回双方材料原文、当前生效内容、来源和理由",
    conflict !== null &&
      typeof conflict.current === "string" && conflict.current.length > 0 &&
      typeof conflict.candidate === "string" && conflict.candidate.length > 0 &&
      conflict.current.trim() !== conflict.candidate.trim() &&
      Array.isArray(conflict.currentEvidence) && conflict.currentEvidence.length > 0 &&
      Array.isArray(conflict.candidateEvidence) && conflict.candidateEvidence.some((e: any) => e.url === b2stateUrls(b2).beta) &&
      typeof conflict.reason === "string" && conflict.reason.length > 0 &&
      typeof conflict.followUp === "string" && conflict.followUp.length > 0,
    { conflict });
  record("B2-bounded", "最多 2 次真实模型判断，没有第三次重试",
    b2loser !== null && b2loserCalls(b2) <= 2 && b2loser.retriedAfterStale === 1,
    { calls: b2.calls, retried: b2loser?.retriedAfterStale });
  record("B2-materials-archive", "双方材料都在归档，冲突没靠清库解决",
    b2state(b2).materials.length === 2 &&
      b2state(b2).materials.every((m: any) => m.valid_until === null),
    { materials: b2state(b2).materials });
  record("B2-relations", "版本关系与先写入者一致，旧 row/旧 episode 指向同一个新 row",
    b2state(b2).oldRow?.superseded_by != null &&
      b2state(b2).oldEpisodes.every((e: any) => e.superseded_by === b2state(b2).oldRow.superseded_by),
    { oldRow: b2state(b2).oldRow, oldEpisodes: b2state(b2).oldEpisodes });

  // DIAGNOSTIC (scripted checker): the frozen B2 sample above refused on the
  // FIRST judgment, so the real model never exercised the retry branch. This
  // run keeps the same inputs and real summarize calls but scripts the check to
  // accept both plans, then return "unclear" on the re-read. It isolates the
  // mechanics: one update, loser re-reads, reports both sides, writes nothing.
  const b2diag = await scenario("B2", true);
  evidence.diagnostic = { b2ScriptedVerify: b2diag };
  console.log("B2 diagnostic (scripted checker) done");
  const dRep = [b2diag.reports.alpha, b2diag.reports.beta].find((r: any) => Number(r?.staleUpdates ?? 0) === 1) ?? null;
  const dConflict = dRep?.conflictDetails?.[0] ?? null;
  record("B2-mechanics", "诊断（脚本判定）：真正竞态下后提交方重读一次、仍冲突则返回双方材料且不写",
    b2diag.state.liveSemantic.length === 1 && dRep !== null &&
      dRep.update === 0 && dRep.retriedAfterStale === 1 &&
      dRep.concurrentConflicts === 1 && dRep.conflict >= 1 &&
      dConflict !== null &&
      dConflict.current.trim() !== dConflict.candidate.trim() &&
      dConflict.currentEvidence.length > 0 &&
      dConflict.candidateEvidence.length > 0 &&
      dConflict.followUp.length > 0,
    { report: dRep, conflict: dConflict, calls: b2diag.calls });

  // Cost basis: real calls were made, price unknown.
  const usages = [b1.usage.alpha, b1.usage.beta, b2.usage.alpha, b2.usage.beta, b2diag.usage.alpha, b2diag.usage.beta].filter(Boolean);
  record("Q19", "调用了真实端点但价格未知：costBasis=unknown，不写成免费",
    usages.length === 6 && usages.every((u: any) => u.costBasis === "unknown"),
    { usages });

  const text = JSON.stringify(evidence);
  record("SEC", "证据文件不含密钥材料", !apiKey || !text.includes(apiKey), { apiKeyLength: apiKey?.length ?? 0 });

  evidence.usageTotals = usages.reduce((a: any, u: any) => ({
    calls: a.calls + u.calls,
    inputTokens: a.inputTokens + u.inputTokens,
    outputTokens: a.outputTokens + u.outputTokens,
    cacheReadTokens: a.cacheReadTokens + u.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + u.cacheWriteTokens,
    totalTokens: a.totalTokens + u.totalTokens,
  }), { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 });
  evidence.usageTotals.costBasis = "unknown";

  writeFileSync(join(OUT, "q21-concurrent.json"), JSON.stringify(evidence, null, 2) + "\n");
  const failed = findings.filter((f) => !f.pass);
  for (const f of failed) console.log("  FAIL DETAIL " + f.id + " " + JSON.stringify(f.evidence).slice(0, 1600));
  console.log("\n" + (failed.length === 0 ? "all checks passed" : failed.length + " check(s) failed") + " — out/q21-concurrent.json");
  process.exitCode = failed.length === 0 ? 0 : 1;
} catch (e) {
  console.error("probe failed: " + (e instanceof Error ? e.stack ?? e.message : String(e)));
  process.exitCode = 2;
}

function b1state(s: any) { return s.state; }
function b2state(s: any) { return s.state; }
function b1loserCalls(s: any): number {
  const loser = [s.reports.alpha, s.reports.beta].find((r: any) => Number(r?.staleUpdates ?? 0) === 1);
  if (!loser) return 99;
  const role = s.reports.alpha === loser ? "alpha" : "beta";
  return Number(s.calls[role]?.verify ?? 99);
}
function b2loserCalls(s: any): number {
  return b1loserCalls(s);
}
function b2stateUrls(s: any) {
  const beta = s.state.materials.find((m: any) => m.url.includes("b.example"));
  return { beta: beta?.url ?? "" };
}
